using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Tests;

public class KeePortApiTests : IDisposable
{
    private readonly string _dataDir;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _admin;
    private readonly HttpClient _user;

    public KeePortApiTests()
    {
        _dataDir = Path.Combine(Path.GetTempPath(), $"keeport-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dataDir);
        Environment.SetEnvironmentVariable("KeePort__DataDir", _dataDir);
        Environment.SetEnvironmentVariable("KeePort__CookieSecure", "false");
        _factory = new WebApplicationFactory<Program>();
        _admin = _factory.CreateClient();
        _user = _factory.CreateClient();
    }

    public void Dispose()
    {
        _admin.Dispose();
        _user.Dispose();
        _factory.Dispose();
        Environment.SetEnvironmentVariable("KeePort__DataDir", null);
        Environment.SetEnvironmentVariable("KeePort__CookieSecure", null);
        try { Directory.Delete(_dataDir, recursive: true); } catch { /* best effort test cleanup */ }
    }

    [Fact]
    public async Task Roles_Acls_And_WebDav_Boundaries_Are_Enforced()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var alice = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var webDav = await CreateWebDavCredentialAsync(_admin, adminCsrf, alice.Id);
        var vault = await UploadVaultAsync(_admin, adminCsrf, "shared.kdbx", "v1");

        var aliceLogin = await LoginAsync(_user, "alice", "User passphrase 123");
        var beforeGrant = await GetJsonAsync(_user, "/api/vault/files");
        Assert.Empty(beforeGrant.EnumerateArray());
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(_user, HttpMethod.Get, "/api/admin/users", csrf: aliceLogin.csrf)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content", csrf: aliceLogin.csrf)).StatusCode);

        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, alice.Id, "read");
        var readFiles = await GetJsonAsync(_user, "/api/vault/files");
        var readFile = Assert.Single(readFiles.EnumerateArray());
        Assert.Equal("read", readFile.GetProperty("permission").GetString());

        var readContent = await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content", csrf: aliceLogin.csrf);
        Assert.Equal(HttpStatusCode.OK, readContent.StatusCode);
        Assert.Equal(KdbxBytes("v1"), await readContent.Content.ReadAsByteArrayAsync());
        var readETag = readContent.Headers.GetValues("ETag").Single();

        var readOnlyWrite = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("v2"), csrf: aliceLogin.csrf, etag: readETag);
        Assert.Equal(HttpStatusCode.Forbidden, readOnlyWrite.StatusCode);

        var readOnlyWebDavWrite = await SendAsync(_user, HttpMethod.Put, "/webdav/shared.kdbx", bytes: KdbxBytes("v2-webdav"), basic: webDav.BasicAuth, etag: readETag);
        Assert.Equal(HttpStatusCode.Forbidden, readOnlyWebDavWrite.StatusCode);

        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, alice.Id, "read-write");
        var writeContent = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("v2"), csrf: aliceLogin.csrf, etag: readETag);
        Assert.Equal(HttpStatusCode.OK, writeContent.StatusCode);
        var writeETag = writeContent.Headers.GetValues("ETag").Single();

        var webDavWrite = await SendAsync(_user, HttpMethod.Put, "/webdav/shared.kdbx", bytes: KdbxBytes("v3"), basic: webDav.BasicAuth, etag: writeETag);
        Assert.Equal(HttpStatusCode.NoContent, webDavWrite.StatusCode);
        var webDavRead = await SendAsync(_user, HttpMethod.Get, "/webdav/shared.kdbx", basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.OK, webDavRead.StatusCode);
        Assert.Equal(KdbxBytes("v3"), await webDavRead.Content.ReadAsByteArrayAsync());

        var webDavDelete = await SendAsync(_user, new HttpMethod("DELETE"), "/webdav/shared.kdbx", basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Forbidden, webDavDelete.StatusCode);
    }

    [Fact]
    public async Task ETag_Conflicts_Do_Not_Overwrite_And_Writes_Are_Atomic()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var vault = await UploadVaultAsync(_admin, adminCsrf, "etag.kdbx", "one");

        var missingPrecondition = await SendAsync(_admin, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("zero"), csrf: adminCsrf);
        Assert.Equal(HttpStatusCode.PreconditionRequired, missingPrecondition.StatusCode);

        var firstGet = await SendAsync(_admin, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content", csrf: adminCsrf);
        var etag1 = firstGet.Headers.GetValues("ETag").Single();

        var firstWrite = await SendAsync(_admin, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("two"), csrf: adminCsrf, etag: etag1);
        Assert.Equal(HttpStatusCode.OK, firstWrite.StatusCode);
        var etag2 = firstWrite.Headers.GetValues("ETag").Single();
        Assert.NotEqual(etag1, etag2);

        var staleWrite = await SendAsync(_admin, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("three"), csrf: adminCsrf, etag: etag1);
        Assert.Equal(HttpStatusCode.Conflict, staleWrite.StatusCode);

        var currentGet = await SendAsync(_admin, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content", csrf: adminCsrf);
        Assert.Equal(KdbxBytes("two"), await currentGet.Content.ReadAsByteArrayAsync());

        var vaultDir = Path.Combine(_dataDir, "vault");
        Assert.Empty(Directory.GetFiles(vaultDir, "*.tmp-*"));
        Assert.Single(Directory.GetFiles(vaultDir, "*.kdbx"));
    }

    private async Task<string> SetupAdminAsync(HttpClient client)
    {
        await client.GetAsync("/api/health");
        var token = ReadSetupToken();
        var response = await client.PostAsJsonAsync("/api/auth/setup", new { setupToken = token, username = "admin", password = "Admin passphrase 123" });
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("csrfToken").GetString()!;
    }

    private string ReadSetupToken()
    {
        using var connection = new SqliteConnection($"Data Source={Path.Combine(_dataDir, "keeport.db")}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM app_state WHERE key = 'setup_token';";
        var value = command.ExecuteScalar() as string;
        return value ?? throw new InvalidOperationException("Setup token was not created.");
    }

    private static async Task<(string csrf, string userId)> LoginAsync(HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Login failed {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        }
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (json.GetProperty("csrfToken").GetString()!, json.GetProperty("user").GetProperty("id").GetString()!);
    }

    private static async Task<(string Id, string Username)> CreateUserAsync(HttpClient client, string csrf, string username, string role)
    {
        var response = await SendAsync(client, HttpMethod.Post, "/api/admin/users", json: new { username, password = "User passphrase 123", role }, csrf: csrf);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (json.GetProperty("id").GetString()!, json.GetProperty("username").GetString()!);
    }

    private static async Task<AdminVault> UploadVaultAsync(HttpClient client, string csrf, string name, string content)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(KdbxBytes(content));
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        form.Add(fileContent, "file", name);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/admin/files?name={Uri.EscapeDataString(name)}") { Content = form };
        request.Headers.Add("X-CSRF-Token", csrf);
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new AdminVault(json.GetProperty("id").GetString()!, json.GetProperty("etag").GetString()!);
    }

    private static async Task<WebDavCredential> CreateWebDavCredentialAsync(HttpClient client, string csrf, string userId)
    {
        const string password = "Webdav passphrase 123";
        var response = await SendAsync(client, HttpMethod.Post, "/api/admin/webdav-credentials", json: new { userId, label = "integration", password }, csrf: csrf);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var username = json.GetProperty("username").GetString()!;
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
        return new WebDavCredential(username, $"Basic {basic}");
    }

    private static async Task SetPermissionsAsync(HttpClient client, string csrf, string fileId, string userId, string permission)
    {
        var response = await SendAsync(client, HttpMethod.Put, $"/api/admin/files/{fileId}/permissions", json: new { permissions = new[] { new { userId, permission } } }, csrf: csrf);
        response.EnsureSuccessStatusCode();
    }

    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string url,
        object? json = null,
        byte[]? bytes = null,
        string? csrf = null,
        string? etag = null,
        string? basic = null)
    {
        using var request = new HttpRequestMessage(method, url);
        if (csrf is not null) request.Headers.Add("X-CSRF-Token", csrf);
        if (etag is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Expected-ETag", etag);
            request.Headers.TryAddWithoutValidation("If-Match", etag);
        }
        if (basic is not null) request.Headers.TryAddWithoutValidation("Authorization", basic);
        if (bytes is not null) request.Content = new ByteArrayContent(bytes);
        if (json is not null) request.Content = JsonContent.Create(json);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Kdbx_Signature_Is_Enforced_On_Upload_And_Write()
    {
        var adminCsrf = await SetupAdminAsync(_admin);

        using var invalidForm = new MultipartFormDataContent();
        var invalidFile = new ByteArrayContent(Encoding.UTF8.GetBytes("definitely-not-a-kdbx"));
        invalidFile.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        invalidForm.Add(invalidFile, "file", "broken.kdbx");
        using var invalidUploadRequest = new HttpRequestMessage(HttpMethod.Post, "/api/admin/files?name=broken.kdbx") { Content = invalidForm };
        invalidUploadRequest.Headers.Add("X-CSRF-Token", adminCsrf);
        var invalidUpload = await _admin.SendAsync(invalidUploadRequest);
        Assert.Equal(HttpStatusCode.BadRequest, invalidUpload.StatusCode);

        var vault = await UploadVaultAsync(_admin, adminCsrf, "signed.kdbx", "payload");
        var invalidWrite = await SendAsync(_admin, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: Encoding.UTF8.GetBytes("still-not-a-kdbx"), csrf: adminCsrf, etag: vault.ETag);
        Assert.Equal(HttpStatusCode.BadRequest, invalidWrite.StatusCode);
    }

    private static byte[] KdbxBytes(string payload)
        => new byte[] { 0x03, 0xD9, 0xA2, 0x9A }.Concat(Encoding.UTF8.GetBytes(payload)).ToArray();

    private sealed record AdminVault(string Id, string ETag);
    private sealed record WebDavCredential(string Username, string BasicAuth);
}
