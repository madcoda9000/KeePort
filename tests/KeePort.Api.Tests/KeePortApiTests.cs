using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using KeePort.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;

namespace KeePort.Api.Tests;

public class KeePortApiTests : IDisposable
{
    private const string AdminAuthPath = "/api/admin/auth";
    private const string RateLimitsPath = "/api/admin/settings/rate-limits";
    private const string AdminPassword = "Admin passphrase 123";
    private const string AdminEmail = "admin@example.test";

    private readonly string _dataDir;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _admin;
    private readonly HttpClient _user;

    /// <summary>Creates an isolated data directory and separate admin and vault HTTP clients.</summary>
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

    /// <summary>Disposes the HTTP clients and host, then cleans up the test environment.</summary>
    public void Dispose()
    {
        _admin.Dispose();
        _user.Dispose();
        _factory.Dispose();
        Environment.SetEnvironmentVariable("KeePort__DataDir", null);
        Environment.SetEnvironmentVariable("KeePort__CookieSecure", null);
        try { Directory.Delete(_dataDir, recursive: true); } catch { /* best effort test cleanup */ }
    }

    /// <summary>Verifies role isolation, vault access grants, and WebDAV access boundaries.</summary>
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
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(_user, HttpMethod.Get, "/api/admin/users", csrf: aliceLogin.csrf)).StatusCode);
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

    /// <summary>Verifies that stale writes preserve the original and save the submitted conflict copy.</summary>
    [Fact]
    public async Task ETag_Conflicts_Do_Not_Overwrite_And_Writes_Are_Atomic()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "etag.kdbx", "one");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, userId, "read-write");
        var (csrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");

        var missingPrecondition = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("zero"), csrf: csrf);
        Assert.Equal(HttpStatusCode.PreconditionRequired, missingPrecondition.StatusCode);

        var firstGet = await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content");
        var etag1 = firstGet.Headers.GetValues("ETag").Single();

        var firstWrite = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("two"), csrf: csrf, etag: etag1);
        Assert.Equal(HttpStatusCode.OK, firstWrite.StatusCode);
        var etag2 = firstWrite.Headers.GetValues("ETag").Single();
        Assert.NotEqual(etag1, etag2);

        using var staleWrite = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("three"), csrf: csrf, etag: etag1);
        Assert.Equal(HttpStatusCode.Conflict, staleWrite.StatusCode);
        var conflict = await staleWrite.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(etag2, conflict.GetProperty("currentETag").GetString());
        Assert.Contains("saved as a conflict copy", conflict.GetProperty("message").GetString());

        var credentials = await CreateWebDavCredentialAsync(_admin, adminCsrf, userId);
        using var missingWebDavPrecondition = await SendAsync(_user, HttpMethod.Put, "/webdav/etag.kdbx", bytes: KdbxBytes("zero"), basic: credentials.BasicAuth);
        Assert.Equal(HttpStatusCode.PreconditionRequired, missingWebDavPrecondition.StatusCode);
        using var staleWebDavWrite = await SendAsync(_user, HttpMethod.Put, "/webdav/etag.kdbx", bytes: KdbxBytes("four"), etag: etag1, basic: credentials.BasicAuth);
        Assert.Equal(HttpStatusCode.PreconditionFailed, staleWebDavWrite.StatusCode);
        Assert.Equal(etag2, staleWebDavWrite.Headers.GetValues("ETag").Single());
        Assert.Contains("saved as a conflict copy", (await staleWebDavWrite.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());

        using var invalidStaleWrite = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: Encoding.UTF8.GetBytes("invalid"), csrf: csrf, etag: etag1);
        Assert.Equal(HttpStatusCode.BadRequest, invalidStaleWrite.StatusCode);

        using var currentGet = await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content");
        Assert.Equal(KdbxBytes("two"), await currentGet.Content.ReadAsByteArrayAsync());
        Assert.Equal(etag2, currentGet.Headers.GetValues("ETag").Single());

        var files = await GetJsonAsync(_admin, "/api/admin/files?includeDeleted=false");
        Assert.Equal(3, files.GetArrayLength());
        var copies = files.EnumerateArray().Where(/* Excludes the original vault from the conflict-copy candidates.
         * <param name="file">One returned file entry that may be the preserved conflict copy.</param>
         */ file => file.GetProperty("id").GetString() != vault.Id).ToArray();
        var userFiles = await GetJsonAsync(_user, "/api/vault/files");
        Assert.Equal(vault.Id, Assert.Single(userFiles.EnumerateArray()).GetProperty("id").GetString());
        using var listing = await SendAsync(_user, new HttpMethod("PROPFIND"), "/webdav/", basic: credentials.BasicAuth);
        Assert.Equal(HttpStatusCode.MultiStatus, listing.StatusCode);
        var listingText = await listing.Content.ReadAsStringAsync();
        Assert.Contains("etag.kdbx", listingText);
        Assert.DoesNotContain(".conflict-", listingText);
        foreach (var copy in copies)
        {
            var copyId = copy.GetProperty("id").GetString();
            var name = copy.GetProperty("name").GetString()!;
            Assert.StartsWith("etag.conflict-", name);
            var expected = name.Contains("-rest-", StringComparison.Ordinal) ? "three" : "four";
            Assert.Contains(expected == "three" ? "-rest-" : "-webdav-", name);
            using var read = await _admin.GetAsync($"/api/admin/files/{copyId}/content");
            read.EnsureSuccessStatusCode();
            Assert.Equal(KdbxBytes(expected), await read.Content.ReadAsByteArrayAsync());
            Assert.Empty((await GetJsonAsync(_admin, $"/api/admin/files/{copyId}/permissions")).EnumerateArray());
            using var denied = await _user.GetAsync($"/api/vault/files/{copyId}/content");
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        }

        var vaultDir = Path.Combine(_dataDir, "vault");
        Assert.Empty(Directory.GetFiles(vaultDir, "*.tmp-*"));
        Assert.Equal(3, Directory.GetFiles(vaultDir, "*.kdbx").Length);
    }

    /// <summary>Checks that concurrent writes from one revision cannot both replace the original vault.</summary>
    [Fact]
    public async Task Concurrent_Writes_Create_A_Conflict_Copy_With_A_Valid_Name()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var originalName = new string('x', 195) + ".kdbx";
        var vault = await UploadVaultAsync(_admin, adminCsrf, originalName, "original");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, userId, "read-write");
        var (csrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");
        var url = $"/api/vault/files/{vault.Id}/content";
        var submissions = new[] { KdbxBytes("first"), KdbxBytes("second") };
        var writes = submissions.Select(/* Submits each candidate write with the same original ETag.
         * <param name="bytes">The encrypted payload submitted by one competing write.</param>
         */ bytes => SendAsync(_user, HttpMethod.Put, url, bytes: bytes, csrf: csrf, etag: vault.ETag));
        var responses = await Task.WhenAll(writes);
        using var first = responses[0];
        using var second = responses[1];
        // Identifies the single successful concurrent write by its status.
        // <param name="response">A concurrent write response being checked for success.</param>
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        // Identifies the rejected concurrent write by its conflict status.
        // <param name="response">A concurrent write response being checked for conflict.</param>
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        var winner = first.StatusCode == HttpStatusCode.OK ? 0 : 1;
        using var original = await _user.GetAsync(url);
        Assert.Equal(submissions[winner], await original.Content.ReadAsByteArrayAsync());
        Assert.Equal("2", original.Headers.GetValues("X-KeePort-Revision").Single());

        var files = await GetJsonAsync(_admin, "/api/admin/files?includeDeleted=false");
        var copy = Assert.Single(files.EnumerateArray().Where(/* Excludes the winning vault file when finding the preserved losing submission.
         * <param name="file">One returned file entry to compare with the original vault ID.</param>
         */ file => file.GetProperty("id").GetString() != vault.Id));
        var name = copy.GetProperty("name").GetString()!;
        Assert.True(name.Length <= 200);
        Assert.Contains(".conflict-", name);
        using var copied = await _admin.GetAsync($"/api/admin/files/{copy.GetProperty("id").GetString()}/content");
        Assert.Equal(submissions[1 - winner], await copied.Content.ReadAsByteArrayAsync());
    }

    /// <summary>Checks that the shared setup/login quota leaves authenticated session operations available.</summary>
    [Fact]
    public async Task Credential_Rate_Limit_Does_Not_Block_Existing_Sessions()
    {
        var csrf = await SetupAdminAsync(_admin);
        var payload = new { username = "unknown", password = "unused passphrase" };
        for (var attempt = 0; attempt < 9; attempt++)
        {
            var path = attempt % 2 == 0 ? "/api/auth/login" : $"{AdminAuthPath}/login";
            using var rejected = await _user.PostAsJsonAsync(path, payload);
            Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
        }
        using var limited = await _user.PostAsJsonAsync("/api/auth/login", payload);
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.NotNull(limited.Headers.RetryAfter?.Delta);
        Assert.Equal("rate_limited", (await limited.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var profiles = await Task.WhenAll(Enumerable.Range(0, 12).Select(/* Issues a session lookup independently of the credential attempt quota.
         * <param name="_">The attempt index, unused because every lookup uses the same admin session.</param>
         */ _ => _admin.GetAsync($"{AdminAuthPath}/me")));
        foreach (var profile in profiles)
        {
            using (profile)
            {
                Assert.Equal(HttpStatusCode.OK, profile.StatusCode);
            }
        }
        Assert.Equal(csrf, (await GetJsonAsync(_admin, $"{AdminAuthPath}/csrf")).GetProperty("csrfToken").GetString());
        using var logout = await SendAsync(_admin, HttpMethod.Post, $"{AdminAuthPath}/logout", csrf: csrf);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
    }

    /// <summary>Checks that requests across WebDAV paths and methods use a separate configurable quota before authentication.</summary>
    [Fact]
    public async Task WebDav_Rate_Limit_Applies_Before_Authentication()
    {
        var csrf = await SetupAdminAsync(_admin);
        using var client = _factory.CreateClient();
        using var previous = await client.GetAsync("/webdav/");
        Assert.Equal(HttpStatusCode.Unauthorized, previous.StatusCode);
        using var update = await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: new RateLimitSettings(10, 2), csrf: csrf);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        using var collection = await client.GetAsync("/webdav/");
        using var unsupported = await SendAsync(client, new HttpMethod("REPORT"), "/webdav/example.kdbx");
        Assert.Equal(HttpStatusCode.Unauthorized, collection.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unsupported.StatusCode);

        using var limited = await SendAsync(client, HttpMethod.Options, "/WEBDAV");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.NotNull(limited.Headers.RetryAfter?.Delta);
        Assert.Empty(limited.Headers.WwwAuthenticate);
        using var vaultLogin = await client.PostAsJsonAsync("/api/auth/login", new { username = "unknown", password = "unused passphrase" });
        Assert.Equal(HttpStatusCode.Unauthorized, vaultLogin.StatusCode);
    }

    /// <summary>Checks defaults, admin-only access, CSRF validation and persistence across application startups.</summary>
    [Fact]
    public async Task Rate_Limit_Settings_Are_Protected_And_Persisted()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        Assert.Equal(new RateLimitSettings(10, 60), await _admin.GetFromJsonAsync<RateLimitSettings>(RateLimitsPath));
        await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var (userCsrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");
        var updated = new RateLimitSettings(3, 13);

        using var anonymous = _factory.CreateClient();
        using var anonymousGet = await anonymous.GetAsync(RateLimitsPath);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousGet.StatusCode);
        using var vaultGet = await _user.GetAsync(RateLimitsPath);
        Assert.Equal(HttpStatusCode.Unauthorized, vaultGet.StatusCode);
        using var vaultPut = await SendAsync(_user, HttpMethod.Put, RateLimitsPath, json: updated, csrf: userCsrf);
        Assert.Equal(HttpStatusCode.Unauthorized, vaultPut.StatusCode);
        using var missingCsrf = await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: updated);
        Assert.Equal(HttpStatusCode.Forbidden, missingCsrf.StatusCode);
        using var invalid = await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: new RateLimitSettings(0, -1), csrf: adminCsrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(new RateLimitSettings(10, 60), await _admin.GetFromJsonAsync<RateLimitSettings>(RateLimitsPath));

        using var saved = await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: updated, csrf: adminCsrf);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal(updated, await saved.Content.ReadFromJsonAsync<RateLimitSettings>());
        using var restarted = _factory.WithWebHostBuilder(/* Reuses the factory's configuration when starting the replacement test host.
         * <param name="_">The host builder, intentionally left unchanged for the restart.</param>
         */ _ => { });
        using var adminAfterRestart = restarted.CreateClient();
        using var login = await adminAfterRestart.PostAsJsonAsync($"{AdminAuthPath}/login", new { username = "admin", password = AdminPassword });
        login.EnsureSuccessStatusCode();
        Assert.Equal(updated, await adminAfterRestart.GetFromJsonAsync<RateLimitSettings>(RateLimitsPath));
    }

    /// <summary>Checks that changes apply to existing IP partitions without resetting an unchanged quota.</summary>
    [Fact]
    public async Task Auth_Rate_Limit_Changes_Apply_Immediately_Without_Resetting_Other_Quotas()
    {
        var csrf = await SetupAdminAsync(_admin);
        var payload = new { username = "unknown", password = "unused passphrase" };
        using var initial = await _user.PostAsJsonAsync("/api/auth/login", payload);
        Assert.Equal(HttpStatusCode.Unauthorized, initial.StatusCode);

        var limits = new RateLimitSettings(1, 2);
        using var firstUpdate = await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: limits, csrf: csrf);
        firstUpdate.EnsureSuccessStatusCode();
        using var first = await _user.PostAsJsonAsync("/api/auth/login", payload);
        Assert.Equal(HttpStatusCode.Unauthorized, first.StatusCode);
        using var limited = await _user.PostAsJsonAsync($"{AdminAuthPath}/login", payload);
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);

        using var noChange = await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: limits, csrf: csrf);
        noChange.EnsureSuccessStatusCode();
        using var unchanged = await _user.PostAsJsonAsync("/api/auth/login", payload);
        Assert.Equal(HttpStatusCode.TooManyRequests, unchanged.StatusCode);
        using var webDavOnly = await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: limits with { WebDavPerMinute = 7 }, csrf: csrf);
        webDavOnly.EnsureSuccessStatusCode();
        using var stillLimited = await _user.PostAsJsonAsync("/api/auth/login", payload);
        Assert.Equal(HttpStatusCode.TooManyRequests, stillLimited.StatusCode);
    }

    /// <summary>Checks that sign-in, session restoration and sign-out are isolated between the two applications.</summary>
    [Fact]
    public async Task Admin_And_Vault_Sessions_Are_Isolated()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "private.kdbx", "one");

        using var adminOnVault = await _user.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = AdminPassword });
        using var userOnAdmin = await _user.PostAsJsonAsync($"{AdminAuthPath}/login", new { username = "alice", password = "User passphrase 123" });
        Assert.Equal(HttpStatusCode.Unauthorized, adminOnVault.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, userOnAdmin.StatusCode);
        Assert.False(adminOnVault.Headers.Contains("Set-Cookie"));
        Assert.False(userOnAdmin.Headers.Contains("Set-Cookie"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await _admin.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _admin.GetAsync("/api/vault/files")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _admin.GetAsync($"/api/vault/files/{vault.Id}/content")).StatusCode);
        using var adminVaultWrite = await SendAsync(_admin, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content",
            bytes: KdbxBytes("two"), csrf: adminCsrf, etag: vault.ETag);
        Assert.Equal(HttpStatusCode.Unauthorized, adminVaultWrite.StatusCode);

        await LoginAsync(_admin, "alice", "User passphrase 123");
        Assert.Equal("admin", (await GetJsonAsync(_admin, $"{AdminAuthPath}/me")).GetProperty("username").GetString());
        Assert.Equal("alice", (await GetJsonAsync(_admin, "/api/auth/me")).GetProperty("username").GetString());
        using var logout = await SendAsync(_admin, HttpMethod.Post, $"{AdminAuthPath}/logout", csrf: adminCsrf);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _admin.GetAsync($"{AdminAuthPath}/me")).StatusCode);
        Assert.Equal("alice", (await GetJsonAsync(_admin, "/api/auth/me")).GetProperty("username").GetString());
    }

    /// <summary>Checks that promoted accounts no longer have Vault or WebDAV access and cannot get new app passwords.</summary>
    [Fact]
    public async Task Admin_Role_Blocks_Existing_Vault_Session_And_WebDav_Credentials()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var credential = await CreateWebDavCredentialAsync(_admin, adminCsrf, userId);
        await LoginAsync(_user, "alice", "User passphrase 123");
        Assert.Equal(HttpStatusCode.OK, (await _user.GetAsync("/api/vault/files")).StatusCode);
        using var allowed = await SendAsync(_user, HttpMethod.Options, "/webdav", basic: credential.BasicAuth);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);

        using var promoted = await SendAsync(_admin, HttpMethod.Patch, $"/api/admin/users/{userId}", json: new { role = "admin" }, csrf: adminCsrf);
        promoted.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync("/api/vault/files")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync($"{AdminAuthPath}/me")).StatusCode);
        using var denied = await SendAsync(_user, HttpMethod.Options, "/webdav", basic: credential.BasicAuth);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        using var issue = await SendAsync(_admin, HttpMethod.Post, "/api/admin/webdav-credentials",
            json: new { userId, label = "integration", password = "Webdav passphrase 123" }, csrf: adminCsrf);
        Assert.Equal(HttpStatusCode.BadRequest, issue.StatusCode);
    }

    /// <summary>Checks that first-run setup rejects missing or invalid email without consuming the token.</summary>
    [Fact]
    public async Task Setup_Requires_And_Persists_A_Valid_Email()
    {
        var setupToken = ReadSetupToken();
        const string username = "admin";
        const string password = AdminPassword;
        using var missing = await _admin.PostAsJsonAsync($"{AdminAuthPath}/setup", new { setupToken, username, password });
        using var invalid = await _admin.PostAsJsonAsync($"{AdminAuthPath}/setup", new { setupToken, username, password, email = "invalid-email" });
        foreach (var response in new[] { missing, invalid })
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("invalid_email", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
            Assert.False(response.Headers.Contains("Set-Cookie"));
        }
        Assert.True((await GetJsonAsync(_admin, $"{AdminAuthPath}/setup-status")).GetProperty("requiresSetup").GetBoolean());
        await SetupAdminAsync(_admin);
        Assert.Equal(AdminEmail, (await GetJsonAsync(_admin, $"{AdminAuthPath}/me")).GetProperty("email").GetString());
        Assert.False((await GetJsonAsync(_admin, $"{AdminAuthPath}/setup-status")).GetProperty("requiresSetup").GetBoolean());
    }

    /// <summary>Checks that an admin can update their own email and change their login password with CSRF protection.</summary>
    [Fact]
    public async Task Admin_Profile_Can_Update_Email_And_Password()
    {
        var csrf = await SetupAdminAsync(_admin);
        const string email = "new-admin@example.test";
        const string newPassword = "Updated passphrase 456";
        using var invalid = await SendAsync(_admin, HttpMethod.Put, $"{AdminAuthPath}/email", json: new { email = "invalid-email" }, csrf: csrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var noCsrf = await SendAsync(_admin, HttpMethod.Put, $"{AdminAuthPath}/email", json: new { email });
        Assert.Equal(HttpStatusCode.Forbidden, noCsrf.StatusCode);
        using var updated = await SendAsync(_admin, HttpMethod.Put, $"{AdminAuthPath}/email", json: new { email }, csrf: csrf);
        updated.EnsureSuccessStatusCode();
        using var wrongPassword = await SendAsync(_admin, HttpMethod.Post, $"{AdminAuthPath}/change-password",
            json: new { currentPassword = "wrong", newPassword }, csrf: csrf);
        Assert.Equal(HttpStatusCode.Forbidden, wrongPassword.StatusCode);
        using var changed = await SendAsync(_admin, HttpMethod.Post, $"{AdminAuthPath}/change-password",
            json: new { currentPassword = AdminPassword, newPassword }, csrf: csrf);
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        using var oldLogin = await _user.PostAsJsonAsync($"{AdminAuthPath}/login", new { username = "admin", password = AdminPassword });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);
        using var newLogin = await _user.PostAsJsonAsync($"{AdminAuthPath}/login", new { username = "admin", password = newPassword });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
        Assert.Equal(email, (await GetJsonAsync(_user, $"{AdminAuthPath}/me")).GetProperty("email").GetString());
    }

    /// <summary>Checks that missing and invalid contact addresses are rejected during admin account creation.</summary>
    [Fact]
    public async Task Admin_Creation_Requires_A_Valid_Email_Address()
    {
        var csrf = await SetupAdminAsync(_admin);
        var account = new { username = "alice", password = "User passphrase 123", role = "user" };
        using var missing = await SendAsync(_admin, HttpMethod.Post, "/api/admin/users", json: account, csrf: csrf);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal("invalid_email", (await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        using var invalid = await SendAsync(_admin, HttpMethod.Post, "/api/admin/users",
            json: new { account.username, account.password, account.role, email = "Alice <alice@example.test>" }, csrf: csrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("invalid_email", (await invalid.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var users = await GetJsonAsync(_admin, "/api/admin/users");
        Assert.Equal("admin", Assert.Single(users.EnumerateArray()).GetProperty("username").GetString());
    }

    /// <summary>Checks that only a signed-in account can change its email, without changing its other settings.</summary>
    [Fact]
    public async Task Profile_Email_Update_Requires_Auth_And_Persists_A_Valid_Address()
    {
        const string url = "/api/auth/email";
        var csrf = await SetupAdminAsync(_admin);
        await CreateUserAsync(_admin, csrf, "alice", "user");
        var payload = new { email = "  new.alice+profile@example.test  " };
        using var anonymous = await SendAsync(_user, HttpMethod.Put, url, json: payload);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        var (userCsrf, userId) = await LoginAsync(_user, "alice", "User passphrase 123");
        using var settings = await SendAsync(_user, HttpMethod.Put, "/api/auth/settings", json: new { autoLockMinutes = 15 }, csrf: userCsrf);
        settings.EnsureSuccessStatusCode();
        Assert.Equal("alice@example.test", (await settings.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("email").GetString());
        using var noCsrf = await SendAsync(_user, HttpMethod.Put, url, json: payload);
        Assert.Equal(HttpStatusCode.Forbidden, noCsrf.StatusCode);
        using var invalid = await SendAsync(_user, HttpMethod.Put, url, json: new { email = "not-an-email" }, csrf: userCsrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("alice@example.test", (await GetJsonAsync(_user, "/api/auth/me")).GetProperty("email").GetString());

        using var updated = await SendAsync(_user, HttpMethod.Put, url, json: payload, csrf: userCsrf);
        updated.EnsureSuccessStatusCode();
        var profile = await GetJsonAsync(_user, "/api/auth/me");
        Assert.Equal(userId, profile.GetProperty("id").GetString());
        Assert.Equal("new.alice+profile@example.test", profile.GetProperty("email").GetString());
        Assert.Equal(15, profile.GetProperty("autoLockMinutes").GetInt32());
        var users = (await GetJsonAsync(_admin, "/api/admin/users")).EnumerateArray().ToArray();
        Assert.Equal(AdminEmail, users.Single(/* Selects the original administrator account from the response.
         * <param name="user">One returned account being checked for the administrator username.</param>
         */ user => user.GetProperty("username").GetString() == "admin").GetProperty("email").GetString());
    }

    /// <summary>Checks that opening an existing SQLite database adds the email column without replacing accounts.</summary>
    [Fact]
    public void Existing_Accounts_Can_Set_An_Email_After_Migration()
    {
        var legacyDir = Directory.CreateDirectory(Path.Combine(_dataDir, "legacy")).FullName;
        using (var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(legacyDir, "keeport.db") }.ToString()))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE users (
                    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
                    role TEXT NOT NULL, disabled INTEGER NOT NULL, created_at TEXT NOT NULL,
                    last_login_at TEXT NULL, auto_lock_minutes INTEGER NULL
                );
                INSERT INTO users VALUES ('legacy', 'admin', 'fixture-hash', 'Admin', 0, '2026-01-01T00:00:00Z', NULL, 12);
                """;
            command.ExecuteNonQuery();
        }
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["KeePort:DataDir"] = legacyDir }).Build();
        using var db = new KeePortDb(configuration);
        db.Initialize();
        var account = Assert.Single(db.ListUsers());
        Assert.Equal("legacy", account.Id);
        Assert.Null(account.Email);
        Assert.Equal(12, account.AutoLockMinutes);
        db.UpdateUserEmail(account.Id, "legacy@example.test");
        db.Initialize();
        Assert.Equal("legacy@example.test", db.GetUserById(account.Id)?.Email);
    }

    /// <summary>Completes first-run setup and returns the administrator's CSRF token.</summary>
    /// <param name="client">The test client connected to the Admin API.</param>
    private async Task<string> SetupAdminAsync(HttpClient client)
    {
        await client.GetAsync("/api/health");
        var token = ReadSetupToken();
        var response = await client.PostAsJsonAsync($"{AdminAuthPath}/setup", new { setupToken = token, username = "admin", password = AdminPassword, email = AdminEmail });
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("csrfToken").GetString()!;
    }

    /// <summary>Reads the one-time setup token from the isolated test database.</summary>
    private string ReadSetupToken()
    {
        using var connection = new SqliteConnection($"Data Source={Path.Combine(_dataDir, "keeport.db")}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM app_state WHERE key = 'setup_token';";
        var value = command.ExecuteScalar() as string;
        return value ?? throw new InvalidOperationException("Setup token was not created.");
    }

    /// <summary>Signs in through the vault API and returns the session's CSRF token and user ID.</summary>
    /// <param name="client">The test client connected to the Vault API.</param>
    /// <param name="username">The account username.</param>
    /// <param name="password">The plaintext password to hash or verify.</param>
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

    /// <summary>Creates an account through the Admin API and returns its ID and username.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    /// <param name="csrf">The CSRF token for the client session.</param>
    /// <param name="username">The account username.</param>
    /// <param name="role">The role used to select the account privileges or session scope.</param>
    private static async Task<(string Id, string Username)> CreateUserAsync(HttpClient client, string csrf, string username, string role)
    {
        var response = await SendAsync(client, HttpMethod.Post, "/api/admin/users", json: new { username, email = $"{username}@example.test", password = "User passphrase 123", role }, csrf: csrf);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (json.GetProperty("id").GetString()!, json.GetProperty("username").GetString()!);
    }

    /// <summary>Uploads a multipart KDBX fixture and returns its ID and ETag.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    /// <param name="csrf">The CSRF token for the client session.</param>
    /// <param name="name">The proposed display filename for the vault, including its .kdbx extension.</param>
    /// <param name="content">The fixture text to append after the KDBX signature.</param>
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

    /// <summary>Creates a WebDAV credential and prepares its Basic authorization header.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    /// <param name="csrf">The CSRF token for the client session.</param>
    /// <param name="userId">The ID of the user account.</param>
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

    /// <summary>Replaces the vault's access list with a grant for the specified user.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    /// <param name="csrf">The CSRF token for the client session.</param>
    /// <param name="fileId">The ID of the vault file.</param>
    /// <param name="userId">The ID of the user account.</param>
    /// <param name="permission">The grant to assign to the test user, such as read or read-write.</param>
    private static async Task SetPermissionsAsync(HttpClient client, string csrf, string fileId, string userId, string permission)
    {
        var response = await SendAsync(client, HttpMethod.Put, $"/api/admin/files/{fileId}/permissions", json: new { permissions = new[] { new { userId, permission } } }, csrf: csrf);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>Fetches a successful JSON response and returns its root element.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    /// <param name="url">The API route to call, including any query string.</param>
    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>Sends a test request with the optional body, authentication, CSRF, and ETag headers.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    /// <param name="method">The HTTP method of the request.</param>
    /// <param name="url">The API route to call, including any query string.</param>
    /// <param name="json">An optional object to serialize as the JSON request body.</param>
    /// <param name="bytes">Optional binary request content, used when no JSON body is passed.</param>
    /// <param name="csrf">The CSRF token for the client session.</param>
    /// <param name="etag">The optional entity tag to send in the If-Match header.</param>
    /// <param name="basic">The optional preformatted Basic authorization value.</param>
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

    /// <summary>Verifies that uploads and vault writes reject a payload without KDBX magic bytes.</summary>
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

        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "signed.kdbx", "payload");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, userId, "read-write");
        var (csrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");
        var invalidWrite = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: Encoding.UTF8.GetBytes("still-not-a-kdbx"), csrf: csrf, etag: vault.ETag);
        Assert.Equal(HttpStatusCode.BadRequest, invalidWrite.StatusCode);
    }

    /// <summary>Replays KeePass2Android's transactional WebDAV save: temporary PUT, ignored DELETE, then MOVE without If-Match.</summary>
    [Fact]
    public async Task WebDav_KeePass2Android_Transactional_Save_Uses_Last_Download_As_Precondition()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "mobile.kdbx", "v1");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, userId, "read-write");
        var webDav = await CreateWebDavCredentialAsync(_admin, adminCsrf, userId);

        using var download = await SendAsync(_user, HttpMethod.Get, "/webdav/mobile.kdbx", basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);

        using var tempPut = await SendAsync(_user, HttpMethod.Put, "/webdav/mobile.kdbx.tmp.04819273", bytes: KdbxBytes("v2"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Created, tempPut.StatusCode);
        using var deleteTarget = await SendAsync(_user, HttpMethod.Delete, "/webdav/mobile.kdbx", basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Forbidden, deleteTarget.StatusCode);
        using var move = await MoveAsync(_user, "/webdav/mobile.kdbx.tmp.04819273", "http://localhost/webdav/mobile.kdbx", webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.NoContent, move.StatusCode);

        using var afterMove = await SendAsync(_user, HttpMethod.Get, "/webdav/mobile.kdbx", basic: webDav.BasicAuth);
        Assert.Equal(KdbxBytes("v2"), await afterMove.Content.ReadAsByteArrayAsync());
        using var tempGone = await MoveAsync(_user, "/webdav/mobile.kdbx.tmp.04819273", "http://localhost/webdav/mobile.kdbx", webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.NotFound, tempGone.StatusCode);

        // Non-transactional mode: a direct PUT without If-Match is checked against the last download.
        using var directPut = await SendAsync(_user, HttpMethod.Put, "/webdav/mobile.kdbx", bytes: KdbxBytes("v3"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.NoContent, directPut.StatusCode);
        var etagAfterDirect = directPut.Headers.GetValues("ETag").Single();

        // A change in the web vault after the client's last download turns the next mobile save into a conflict copy.
        var (csrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");
        using var webVaultWrite = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("web"), csrf: csrf, etag: etagAfterDirect);
        Assert.Equal(HttpStatusCode.OK, webVaultWrite.StatusCode);

        using var staleTemp = await SendAsync(_user, HttpMethod.Put, "/webdav/mobile.kdbx.tmp.11111111", bytes: KdbxBytes("stale-mobile"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Created, staleTemp.StatusCode);
        using var staleMove = await MoveAsync(_user, "/webdav/mobile.kdbx.tmp.11111111", "/webdav/mobile.kdbx", webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.PreconditionFailed, staleMove.StatusCode);
        using var stalePut = await SendAsync(_user, HttpMethod.Put, "/webdav/mobile.kdbx", bytes: KdbxBytes("stale-direct"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.PreconditionFailed, stalePut.StatusCode);

        using var current = await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content");
        Assert.Equal(KdbxBytes("web"), await current.Content.ReadAsByteArrayAsync());
        var files = await GetJsonAsync(_admin, "/api/admin/files?includeDeleted=false");
        Assert.Equal(2, files.EnumerateArray().Count(/* Counts the WebDAV conflict copies of the mobile vault.
         * <param name="file">One returned file entry.</param>
         */ file => file.GetProperty("name").GetString()!.StartsWith("mobile.conflict-", StringComparison.Ordinal)));
        Assert.DoesNotContain(files.EnumerateArray(), /* Ensures no temporary upload became a vault.
         * <param name="file">One returned file entry.</param>
         */ file => file.GetProperty("name").GetString()!.Contains(".tmp.", StringComparison.Ordinal));
    }

    /// <summary>Verifies the limits of temporary uploads and MOVE: permissions, targets, Overwrite and KDBX validation.</summary>
    [Fact]
    public async Task WebDav_Temporary_Uploads_And_Move_Are_Restricted()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var own = await UploadVaultAsync(_admin, adminCsrf, "own.kdbx", "own");
        var other = await UploadVaultAsync(_admin, adminCsrf, "other.kdbx", "other");
        var readOnly = await UploadVaultAsync(_admin, adminCsrf, "readonly.kdbx", "ro");
        await SetPermissionsAsync(_admin, adminCsrf, own.Id, userId, "read-write");
        await SetPermissionsAsync(_admin, adminCsrf, other.Id, userId, "read-write");
        await SetPermissionsAsync(_admin, adminCsrf, readOnly.Id, userId, "read");
        var webDav = await CreateWebDavCredentialAsync(_admin, adminCsrf, userId);

        using var noVault = await SendAsync(_user, HttpMethod.Put, "/webdav/new.kdbx.tmp.12345678", bytes: KdbxBytes("x"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.NotFound, noVault.StatusCode);
        using var readOnlyTemp = await SendAsync(_user, HttpMethod.Put, "/webdav/readonly.kdbx.tmp.12345678", bytes: KdbxBytes("x"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Forbidden, readOnlyTemp.StatusCode);
        using var invalidTemp = await SendAsync(_user, HttpMethod.Put, "/webdav/own.kdbx.tmp.12345678", bytes: Encoding.UTF8.GetBytes("not-kdbx"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.BadRequest, invalidTemp.StatusCode);

        using var temp = await SendAsync(_user, HttpMethod.Put, "/webdav/own.kdbx.tmp.12345678", bytes: KdbxBytes("own-v2"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Created, temp.StatusCode);
        using var otherTarget = await MoveAsync(_user, "/webdav/own.kdbx.tmp.12345678", "/webdav/other.kdbx", webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Forbidden, otherTarget.StatusCode);
        using var noOverwrite = await MoveAsync(_user, "/webdav/own.kdbx.tmp.12345678", "/webdav/own.kdbx", webDav.BasicAuth, overwrite: "F");
        Assert.Equal(HttpStatusCode.PreconditionFailed, noOverwrite.StatusCode);
        using var noDestination = await MoveAsync(_user, "/webdav/own.kdbx.tmp.12345678", null, webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.BadRequest, noDestination.StatusCode);
        using var renameVault = await MoveAsync(_user, "/webdav/own.kdbx", "/webdav/renamed.kdbx", webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Forbidden, renameVault.StatusCode);

        // Without a download by this credential there is no known base version, so the move still needs If-Match.
        using var withoutBase = await MoveAsync(_user, "/webdav/own.kdbx.tmp.12345678", "/webdav/own.kdbx", webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.PreconditionRequired, withoutBase.StatusCode);
        using var unchanged = await _admin.GetAsync($"/api/admin/files/{own.Id}/content");
        Assert.Equal(KdbxBytes("own"), await unchanged.Content.ReadAsByteArrayAsync());

        // Released KeePass2Android versions name the temporary file <stem>_tmp_<digits>.kdbx.
        using var ownDownload = await SendAsync(_user, HttpMethod.Get, "/webdav/own.kdbx", basic: webDav.BasicAuth);
        using var releasedTemp = await SendAsync(_user, HttpMethod.Put, "/webdav/own_tmp_17643505.kdbx", bytes: KdbxBytes("own-released"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.Created, releasedTemp.StatusCode);
        using var releasedMove = await MoveAsync(_user, "/webdav/own_tmp_17643505.kdbx", "http://192.168.2.100:8080/webdav/own.kdbx", webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.NoContent, releasedMove.StatusCode);
        using var releasedResult = await _admin.GetAsync($"/api/admin/files/{own.Id}/content");
        Assert.Equal(KdbxBytes("own-released"), await releasedResult.Content.ReadAsByteArrayAsync());

        using var tempAgain = await SendAsync(_user, HttpMethod.Put, "/webdav/own.kdbx.tmp.87654321", bytes: KdbxBytes("own-v3"), basic: webDav.BasicAuth);
        using var deleteTemp = await SendAsync(_user, HttpMethod.Delete, "/webdav/own.kdbx.tmp.87654321", basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.NoContent, deleteTemp.StatusCode);
        using var options = await SendAsync(_user, HttpMethod.Options, "/webdav/", basic: webDav.BasicAuth);
        Assert.Contains("MOVE", options.Content.Headers.Allow);
    }

    /// <summary>Verifies that WebDAV requests are logged without secrets and that only admins can read the log.</summary>
    [Fact]
    public async Task WebDav_Requests_Are_Logged_For_Admins_Only()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "logged.kdbx", "v1");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, userId, "read-write");
        var webDav = await CreateWebDavCredentialAsync(_admin, adminCsrf, userId);

        using var unauthenticated = await SendAsync(_user, HttpMethod.Get, "/webdav/logged.kdbx");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthenticated.StatusCode);
        using var unknownTemp = await SendAsync(_user, HttpMethod.Put, "/webdav/missing_tmp_123.kdbx", bytes: KdbxBytes("x"), basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.NotFound, unknownTemp.StatusCode);
        using var download = await SendAsync(_user, HttpMethod.Get, "/webdav/logged.kdbx", basic: webDav.BasicAuth);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);

        using var logResponse = await _admin.GetAsync("/api/admin/logs/webdav");
        logResponse.EnsureSuccessStatusCode();
        var logText = await logResponse.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Webdav passphrase 123", logText);
        var entries = JsonSerializer.Deserialize<JsonElement>(logText).EnumerateArray().ToArray();
        Assert.Equal(3, entries.Length);

        // Newest first: the successful download, then the rejected temporary upload, then the unauthenticated read.
        Assert.Equal("GET", entries[0].GetProperty("method").GetString());
        Assert.Equal(200, entries[0].GetProperty("status").GetInt32());
        Assert.Equal(webDav.Username, entries[0].GetProperty("credential").GetString());
        Assert.Equal("/webdav/missing_tmp_123.kdbx", entries[1].GetProperty("path").GetString());
        Assert.Equal(404, entries[1].GetProperty("status").GetInt32());
        Assert.Equal(5, entries[1].GetProperty("contentLength").GetInt64());
        Assert.Equal(401, entries[2].GetProperty("status").GetInt32());
        Assert.Equal(JsonValueKind.Null, entries[2].GetProperty("credential").ValueKind);

        await LoginAsync(_user, "alice", "User passphrase 123");
        using var userAccess = await _user.GetAsync("/api/admin/logs/webdav");
        Assert.Equal(HttpStatusCode.Unauthorized, userAccess.StatusCode);
    }

    /// <summary>Verifies that X-Forwarded-For from an untrusted sender is ignored by default.</summary>
    [Fact]
    public async Task Forwarded_Client_Ip_Is_Ignored_Without_Trusted_Proxies()
    {
        await SetupAdminAsync(_admin);
        var status = await SendFromAsync(_factory, "172.18.0.1", "203.0.113.7", "/webdav/untrusted");
        Assert.Equal(StatusCodes.Status401Unauthorized, status);

        var entry = await FindWebDavLogAsync(_admin, "/webdav/untrusted");
        Assert.Equal("172.18.0.1", entry.GetProperty("remoteIp").GetString());
    }

    /// <summary>Verifies that trusted proxies pass on the client IP to the WebDAV log and to per-client rate limits.</summary>
    [Fact]
    public async Task Trusted_Proxies_Pass_On_The_Client_Ip()
    {
        using var factory = _factory.WithWebHostBuilder(/* Trusts one proxy address and one proxy network.
         * <param name="builder">The web host builder of the test server.</param>
         */ builder => builder.UseSetting("KeePort:TrustedProxies", "172.18.0.1, 10.20.0.0/16"));
        using var admin = factory.CreateClient();
        var csrf = await SetupAdminAsync(admin);
        using var limits = await SendAsync(admin, HttpMethod.Put, RateLimitsPath, json: new RateLimitSettings(10, 2), csrf: csrf);
        Assert.Equal(HttpStatusCode.OK, limits.StatusCode);

        // Per-client quota: the first client is limited after two requests, another client behind the same proxy is not.
        Assert.Equal(StatusCodes.Status401Unauthorized, await SendFromAsync(factory, "172.18.0.1", "203.0.113.10", "/webdav/client-a-1"));
        Assert.Equal(StatusCodes.Status401Unauthorized, await SendFromAsync(factory, "172.18.0.1", "203.0.113.10", "/webdav/client-a-2"));
        Assert.Equal(StatusCodes.Status429TooManyRequests, await SendFromAsync(factory, "172.18.0.1", "203.0.113.10", "/webdav/client-a-3"));
        Assert.Equal(StatusCodes.Status401Unauthorized, await SendFromAsync(factory, "172.18.0.1", "203.0.113.11", "/webdav/client-b"));

        // Network entries, IPv4-mapped senders, untrusted senders and spoofed chains.
        await SendFromAsync(factory, "10.20.5.5", "198.51.100.4", "/webdav/network");
        await SendFromAsync(factory, "::ffff:172.18.0.1", "203.0.113.12", "/webdav/mapped");
        await SendFromAsync(factory, "10.21.0.1", "198.51.100.9", "/webdav/outside");
        await SendFromAsync(factory, "172.18.0.1", "1.2.3.4, 203.0.113.13", "/webdav/chain");

        Assert.Equal("203.0.113.11", (await FindWebDavLogAsync(admin, "/webdav/client-b")).GetProperty("remoteIp").GetString());
        Assert.Equal("198.51.100.4", (await FindWebDavLogAsync(admin, "/webdav/network")).GetProperty("remoteIp").GetString());
        Assert.Equal("203.0.113.12", (await FindWebDavLogAsync(admin, "/webdav/mapped")).GetProperty("remoteIp").GetString());
        Assert.Equal("10.21.0.1", (await FindWebDavLogAsync(admin, "/webdav/outside")).GetProperty("remoteIp").GetString());
        Assert.Equal("203.0.113.13", (await FindWebDavLogAsync(admin, "/webdav/chain")).GetProperty("remoteIp").GetString());
    }

    /// <summary>Verifies that the data storage report is available to administrators only.</summary>
    [Fact]
    public async Task Data_Storage_Report_Is_Admin_Only()
    {
        var csrf = await SetupAdminAsync(_admin);
        var storage = await GetJsonAsync(_admin, "/api/admin/settings/storage");
        // The tests run outside Docker, so the storage kind cannot be determined and needs no attention.
        Assert.Equal("unknown", storage.GetProperty("kind").GetString());
        Assert.False(storage.GetProperty("needsAttention").GetBoolean());
        Assert.Equal(Path.GetFullPath(_dataDir).TrimEnd('/'), storage.GetProperty("dataDir").GetString());

        await CreateUserAsync(_admin, csrf, "alice", "user");
        await LoginAsync(_user, "alice", "User passphrase 123");
        using var userAccess = await _user.GetAsync("/api/admin/settings/storage");
        Assert.Equal(HttpStatusCode.Unauthorized, userAccess.StatusCode);
    }

    /// <summary>Verifies that session cookies are Secure over HTTPS even when KEEPORT_COOKIE_SECURE is false.</summary>
    [Fact]
    public async Task Session_Cookies_Are_Secure_Over_Https()
    {
        using var https = _factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        await https.GetAsync("/api/health");
        using var setup = await https.PostAsJsonAsync($"{AdminAuthPath}/setup", new { setupToken = ReadSetupToken(), username = "admin", password = AdminPassword, email = AdminEmail });
        setup.EnsureSuccessStatusCode();
        var cookies = setup.Headers.GetValues("Set-Cookie").ToArray();
        Assert.NotEmpty(cookies);
        Assert.All(cookies, /* Checks one session cookie for the Secure attribute.
         * <param name="cookie">One Set-Cookie header value.</param>
         */ cookie => Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase));

        // Plain HTTP keeps following KEEPORT_COOKIE_SECURE (false in these tests).
        var (_, _) = await CreateUserAsync(_admin, await LoginAdminAsync(_admin), "alice", "user");
        using var http = await _user.PostAsJsonAsync("/api/auth/login", new { username = "alice", password = "User passphrase 123" });
        http.EnsureSuccessStatusCode();
        Assert.All(http.Headers.GetValues("Set-Cookie"), /* Checks one plain-HTTP session cookie.
         * <param name="cookie">One Set-Cookie header value.</param>
         */ cookie => Assert.DoesNotContain("secure", cookie, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Signs in the administrator created by an earlier setup and returns the CSRF token.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    private static async Task<string> LoginAdminAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync($"{AdminAuthPath}/login", new { username = "admin", password = AdminPassword });
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("csrfToken").GetString()!;
    }

    /// <summary>Sends an unauthenticated WebDAV GET as if it arrived from a proxy, and returns the status code.</summary>
    /// <param name="factory">The test application to send the request to.</param>
    /// <param name="sender">The address of the connecting proxy or client.</param>
    /// <param name="forwardedFor">The X-Forwarded-For header value.</param>
    /// <param name="path">The request path, unique per request so the log entry can be found.</param>
    private static async Task<int> SendFromAsync(WebApplicationFactory<Program> factory, string sender, string forwardedFor, string path)
    {
        var context = await factory.Server.SendAsync(/* Builds the request with the simulated connection address.
         * <param name="c">The HTTP context of the simulated request.</param>
         */ c =>
        {
            c.Request.Method = HttpMethods.Get;
            c.Request.Path = path;
            c.Request.Headers["X-Forwarded-For"] = forwardedFor;
            c.Connection.RemoteIpAddress = IPAddress.Parse(sender);
        });
        return context.Response.StatusCode;
    }

    /// <summary>Returns the WebDAV log entry recorded for a request path.</summary>
    /// <param name="admin">An HTTP client signed in as administrator.</param>
    /// <param name="path">The unique request path to look for.</param>
    private static async Task<JsonElement> FindWebDavLogAsync(HttpClient admin, string path)
    {
        var entries = await GetJsonAsync(admin, "/api/admin/logs/webdav");
        return Assert.Single(entries.EnumerateArray(), /* Matches the entry for the requested path.
         * <param name="e">One WebDAV log entry.</param>
         */ e => e.GetProperty("path").GetString() == path);
    }

    /// <summary>Sends a WebDAV MOVE with optional Destination and Overwrite headers.</summary>
    /// <param name="client">The test HTTP client for the request.</param>
    /// <param name="url">The source path of the move.</param>
    /// <param name="destination">The Destination header value, or null to omit it.</param>
    /// <param name="basic">The preformatted Basic authorization value.</param>
    /// <param name="overwrite">The Overwrite header value; KeePass2Android sends T.</param>
    private static async Task<HttpResponseMessage> MoveAsync(HttpClient client, string url, string? destination, string basic, string overwrite = "T")
    {
        using var request = new HttpRequestMessage(new HttpMethod("MOVE"), url);
        request.Headers.TryAddWithoutValidation("Authorization", basic);
        request.Headers.TryAddWithoutValidation("Overwrite", overwrite);
        if (destination is not null) request.Headers.TryAddWithoutValidation("Destination", destination);
        return await client.SendAsync(request);
    }

    /// <summary>Prefixes test payload text with the KDBX signature bytes.</summary>
    /// <param name="payload">The fixture text to encode after the KDBX signature.</param>
    private static byte[] KdbxBytes(string payload)
        => new byte[] { 0x03, 0xD9, 0xA2, 0x9A }.Concat(Encoding.UTF8.GetBytes(payload)).ToArray();

    /// <summary>Holds a test vault's ID and current ETag.</summary>
    /// <param name="Id">The stable identifier for this resource.</param>
    /// <param name="ETag">The current entity tag for the uploaded test vault.</param>
    private sealed record AdminVault(string Id, string ETag);
    /// <summary>Holds a test credential's username and Basic authorization value.</summary>
    /// <param name="Username">The generated WebDAV login name used by the test.</param>
    /// <param name="BasicAuth">The authorization value for authenticating test WebDAV requests.</param>
    private sealed record WebDavCredential(string Username, string BasicAuth);
}
