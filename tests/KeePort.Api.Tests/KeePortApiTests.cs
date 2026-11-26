using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using KeePort.Api.Data;
using KeePort.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

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
        // The saved metadata must carry the caller's real permission; the web vault keeps it for the next unlock.
        Assert.Equal("read-write", (await writeContent.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("permission").GetString());
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

    /// <summary>
    /// Checks that an admin password reset signs the user out everywhere, that a rejected password changes nothing, and
    /// that an admin resetting their own password keeps the current session.
    /// </summary>
    [Fact]
    public async Task Password_Reset_Ends_Sessions_And_Rejected_Reset_Changes_Nothing()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (userId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        await LoginAsync(_user, "alice", "User passphrase 123");
        Assert.Equal(HttpStatusCode.OK, (await _user.GetAsync("/api/vault/files")).StatusCode);

        // A too short password is rejected before the role change in the same request is applied.
        using (var rejected = await SendAsync(_admin, HttpMethod.Patch, $"/api/admin/users/{userId}", json: new { role = "admin", password = "short" }, csrf: adminCsrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK, (await _user.GetAsync("/api/vault/files")).StatusCode);

        using (var reset = await SendAsync(_admin, HttpMethod.Patch, $"/api/admin/users/{userId}", json: new { password = "Fresh passphrase 456" }, csrf: adminCsrf))
        {
            reset.EnsureSuccessStatusCode();
            Assert.Equal("user", (await reset.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("role").GetString());
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync("/api/vault/files")).StatusCode);
        await LoginAsync(_user, "alice", "Fresh passphrase 456");
        Assert.Equal(HttpStatusCode.OK, (await _user.GetAsync("/api/vault/files")).StatusCode);

        var adminId = (await GetJsonAsync(_admin, $"{AdminAuthPath}/me")).GetProperty("id").GetString();
        using (var own = await SendAsync(_admin, HttpMethod.Patch, $"/api/admin/users/{adminId}", json: new { password = "New admin passphrase 789" }, csrf: adminCsrf))
        {
            own.EnsureSuccessStatusCode();
        }
        Assert.Equal(HttpStatusCode.OK, (await _admin.GetAsync($"{AdminAuthPath}/me")).StatusCode);
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

    /// <summary>Verifies the icon download endpoint: sign-in required, host validation, result and the off switch.</summary>
    [Fact]
    public async Task Favicon_Endpoint_Requires_A_Session_Validates_Hosts_And_Can_Be_Turned_Off()
    {
        var fake = new FakeFaviconFetcher();
        using var factory = _factory.WithWebHostBuilder(/* Replaces the real downloader so no request leaves the test.
            * <param name="builder">The test host builder.</param>
            */ builder => builder.ConfigureServices(/* Registers the fake downloader.
                * <param name="services">The service collection.</param>
                */ services => services.AddSingleton<IFaviconFetcher>(fake)));
        using var client = factory.CreateClient();
        using var admin = factory.CreateClient();
        var csrf = await SetupAdminAsync(admin);
        await CreateUserAsync(admin, csrf, "alice", "user");

        using (var anonymous = await client.GetAsync("/api/vault/favicon?host=github.com"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        }
        await LoginAsync(client, "alice", "User passphrase 123");
        using (var invalid = await client.GetAsync("/api/vault/favicon?host=192.168.0.1"))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        }
        using (var local = await client.GetAsync("/api/vault/favicon?host=nas"))
        {
            Assert.Equal(HttpStatusCode.BadRequest, local.StatusCode);
        }
        using (var icon = await client.GetAsync("/api/vault/favicon?host=GitHub.com"))
        {
            Assert.Equal(HttpStatusCode.OK, icon.StatusCode);
            Assert.Equal("image/png", icon.Content.Headers.ContentType?.MediaType);
            Assert.Equal(FakeFaviconFetcher.Png, await icon.Content.ReadAsByteArrayAsync());
        }
        Assert.Equal(new[] { "github.com" }, fake.Hosts);
        using (var missing = await client.GetAsync("/api/vault/favicon?host=no-icon.example.com"))
        {
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        }

        using var offFactory = factory.WithWebHostBuilder(/* Turns the download off.
            * <param name="builder">The test host builder.</param>
            */ builder => builder.UseSetting("KeePort:FaviconDownload", "false"));
        using var offClient = offFactory.CreateClient();
        await LoginAsync(offClient, "alice", "User passphrase 123");
        using var off = await offClient.GetAsync("/api/vault/favicon?host=github.com");
        Assert.Equal(HttpStatusCode.NotFound, off.StatusCode);
        Assert.Equal("favicon_disabled", (await off.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    /// <summary>A downloader that returns a fixed icon for every host except no-icon.example.com.</summary>
    private sealed class FakeFaviconFetcher : IFaviconFetcher
    {
        /// <summary>The icon returned for every host.</summary>
        public static readonly byte[] Png = [0x89, 0x50, 0x4e, 0x47, 9];

        /// <summary>The hosts requested so far.</summary>
        public List<string> Hosts { get; } = [];

        /// <inheritdoc />
        public Task<FaviconResult?> FetchAsync(string host, CancellationToken cancellationToken)
        {
            Hosts.Add(host);
            return Task.FromResult(host == "no-icon.example.com" ? null : new FaviconResult(Png, "image/png"));
        }
    }

    /// <summary>Verifies the website icon and clipboard preferences: off and default at first, partial updates and validation.</summary>
    [Fact]
    public async Task Vault_Preferences_For_Icons_And_Clipboard_Are_Stored_Per_User()
    {
        var csrf = await SetupAdminAsync(_admin);
        await CreateUserAsync(_admin, csrf, "alice", "user");
        var (userCsrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");

        var initial = await GetJsonAsync(_user, "/api/auth/me");
        Assert.False(initial.GetProperty("showFavicons").GetBoolean());
        Assert.False(initial.GetProperty("checkBreaches").GetBoolean());
        Assert.Equal(JsonValueKind.Null, initial.GetProperty("clipboardClearSeconds").ValueKind);

        using (var autoLock = await SendAsync(_user, HttpMethod.Put, "/api/auth/settings", json: new { autoLockMinutes = 20 }, csrf: userCsrf))
        {
            autoLock.EnsureSuccessStatusCode();
        }
        using (var icons = await SendAsync(_user, HttpMethod.Put, "/api/auth/settings", json: new { showFavicons = true, clipboardClearSeconds = 0, checkBreaches = true }, csrf: userCsrf))
        {
            icons.EnsureSuccessStatusCode();
        }
        var updated = await GetJsonAsync(_user, "/api/auth/me");
        Assert.True(updated.GetProperty("showFavicons").GetBoolean());
        Assert.Equal(0, updated.GetProperty("clipboardClearSeconds").GetInt32());
        Assert.Equal(20, updated.GetProperty("autoLockMinutes").GetInt32());
        Assert.True(updated.GetProperty("checkBreaches").GetBoolean());

        using var invalid = await SendAsync(_user, HttpMethod.Put, "/api/auth/settings", json: new { clipboardClearSeconds = 601 }, csrf: userCsrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        // The vault pages may load website icons over HTTPS; the APIs stay locked down.
        using var page = await _user.GetAsync("/");
        Assert.Contains("img-src 'self' data: https:", page.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Contains("connect-src 'self' https://api.pwnedpasswords.com", page.Headers.GetValues("Content-Security-Policy").Single());
    }

    /// <summary>Verifies the dashboard totals, the sign-in counters and that only administrators get the data.</summary>
    [Fact]
    public async Task Dashboard_Reports_Totals_And_Sign_Ins_To_Admins_Only()
    {
        using (var anonymous = await _user.GetAsync("/api/admin/dashboard"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        }

        var adminCsrf = await SetupAdminAsync(_admin);
        var (aliceId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var (bobId, _) = await CreateUserAsync(_admin, adminCsrf, "bob", "user");
        using (var disable = await SendAsync(_admin, HttpMethod.Patch, $"/api/admin/users/{bobId}", json: new { disabled = true }, csrf: adminCsrf))
        {
            disable.EnsureSuccessStatusCode();
        }
        var shared = await UploadVaultAsync(_admin, adminCsrf, "shared.kdbx", "one");
        var removed = await UploadVaultAsync(_admin, adminCsrf, "removed.kdbx", "one");
        using (var delete = await SendAsync(_admin, HttpMethod.Delete, $"/api/admin/files/{removed.Id}", csrf: adminCsrf))
        {
            delete.EnsureSuccessStatusCode();
        }
        await SetPermissionsAsync(_admin, adminCsrf, shared.Id, aliceId, "read-write");
        await CreateWebDavCredentialAsync(_admin, adminCsrf, aliceId);

        // Sign-ins: one rejected and one successful in the vault, one rejected in the admin console.
        using (var wrong = await _user.PostAsJsonAsync("/api/auth/login", new { username = "alice", password = "wrong password" }))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        }
        var (csrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");
        using (var wrongAdmin = await _admin.PostAsJsonAsync($"{AdminAuthPath}/login", new { username = "admin", password = "wrong password" }))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, wrongAdmin.StatusCode);
        }

        // A stale write creates a conflict copy.
        using var read = await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{shared.Id}/content");
        var etag = read.Headers.GetValues("ETag").Single();
        using (var write = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{shared.Id}/content", bytes: KdbxBytes("two"), csrf: csrf, etag: etag))
        {
            write.EnsureSuccessStatusCode();
        }
        using (var stale = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{shared.Id}/content", bytes: KdbxBytes("three"), csrf: csrf, etag: etag))
        {
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        }

        using (var forbidden = await _user.GetAsync("/api/admin/dashboard"))
        {
            Assert.NotEqual(HttpStatusCode.OK, forbidden.StatusCode);
        }

        using (var prompt = await SendAsync(_user, HttpMethod.Get, "/webdav/shared.kdbx"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, prompt.StatusCode);
        }

        var dashboard = await GetJsonAsync(_admin, "/api/admin/dashboard");
        Assert.Empty(dashboard.GetProperty("errors").EnumerateArray());
        var counts = dashboard.GetProperty("counts");
        Assert.Equal(1, counts.GetProperty("vaults").GetInt64());
        Assert.Equal(1, counts.GetProperty("deletedVaults").GetInt64());
        Assert.Equal(1, counts.GetProperty("conflictCopies").GetInt64());
        Assert.Equal(2, counts.GetProperty("users").GetInt64());
        Assert.Equal(1, counts.GetProperty("disabledUsers").GetInt64());
        Assert.Equal(1, counts.GetProperty("admins").GetInt64());
        Assert.Equal(0, counts.GetProperty("disabledAdmins").GetInt64());
        Assert.Equal(1, counts.GetProperty("activeWebDavCredentials").GetInt64());
        // The unauthenticated WebDAV request is a normal 401 sign-in prompt and not counted as an error.
        Assert.True(counts.GetProperty("webDavRequestsLast24Hours").GetInt64() >= 1);
        Assert.Equal(0, counts.GetProperty("webDavErrorsLast24Hours").GetInt64());

        var logins = dashboard.GetProperty("logins");
        Assert.Equal(1, logins.GetProperty("vaultLast24Hours").GetProperty("success").GetInt64());
        Assert.Equal(1, logins.GetProperty("vaultLast24Hours").GetProperty("failure").GetInt64());
        Assert.Equal(1, logins.GetProperty("vaultLast7Days").GetProperty("failure").GetInt64());
        // The setup creates a session without a sign-in, so only the rejected admin sign-in is counted.
        Assert.Equal(0, logins.GetProperty("adminLast24Hours").GetProperty("success").GetInt64());
        Assert.Equal(1, logins.GetProperty("adminLast24Hours").GetProperty("failure").GetInt64());

        var server = dashboard.GetProperty("server");
        Assert.False(string.IsNullOrWhiteSpace(server.GetProperty("version").GetString()));
        Assert.True(server.GetProperty("uptimeSeconds").GetInt64() >= 0);
        Assert.DoesNotContain("password", dashboard.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Verifies the 24-hour and 7-day windows of the sign-in counters, their retention and that they survive a restart.</summary>
    [Fact]
    public void Login_Counters_Use_Hourly_Windows_And_Expire_After_30_Days()
    {
        var dir = Path.Combine(_dataDir, "login-counters");
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["KeePort:DataDir"] = dir }).Build();
        var now = new DateTimeOffset(2026, 11, 25, 12, 30, 0, TimeSpan.Zero);
        using (var db = new KeePortDb(configuration))
        {
            db.Initialize();
            db.RecordLogin(LoginChannel.Vault, success: true, now);
            db.RecordLogin(LoginChannel.Vault, success: true, now.AddHours(-23)); // oldest hour still in the 24-hour window
            db.RecordLogin(LoginChannel.Vault, success: false, now.AddHours(-24)); // only in the 7-day window
            db.RecordLogin(LoginChannel.Admin, success: false, now.AddHours(-167)); // oldest hour of the 7-day window
            db.RecordLogin(LoginChannel.Admin, success: false, now.AddHours(-168)); // outside both windows
        }

        using (var restarted = new KeePortDb(configuration))
        {
            restarted.Initialize();
            var stats = restarted.GetLoginStats(now);
            Assert.Equal(new LoginCounts(2, 0), stats.VaultLast24Hours);
            Assert.Equal(new LoginCounts(2, 1), stats.VaultLast7Days);
            Assert.Equal(new LoginCounts(0, 0), stats.AdminLast24Hours);
            Assert.Equal(new LoginCounts(0, 1), stats.AdminLast7Days);

            // A sign-in 31 days later removes buckets older than the 30-day retention.
            restarted.RecordLogin(LoginChannel.Vault, success: true, now.AddDays(31));
            var later = restarted.GetLoginStats(now);
            Assert.Equal(new LoginCounts(0, 0), later.VaultLast7Days);
            Assert.Equal(new LoginCounts(0, 0), later.AdminLast7Days);
        }
    }

    /// <summary>
    /// Checks that sign-ins, admin changes and vault saves land in the audit log with their action tags, that the
    /// filters and counts work, that only admins can read it, and that no password ends up in it.
    /// </summary>
    [Fact]
    public async Task Audit_Log_Records_Actions_With_Tags_And_Filters()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (aliceId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "family.kdbx", "v1");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, aliceId, "read-write");
        var webDav = await CreateWebDavCredentialAsync(_admin, adminCsrf, aliceId);

        using (var unknown = await _user.PostAsJsonAsync("/api/auth/login", new { username = "mallory", password = "Guess passphrase 1" }))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        }
        using (var wrong = await _user.PostAsJsonAsync("/api/auth/login", new { username = "alice", password = "Wrong passphrase 1" }))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        }
        var (aliceCsrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");

        using var restSave = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("v2"), csrf: aliceCsrf, etag: vault.ETag);
        restSave.EnsureSuccessStatusCode();
        var restETag = restSave.Headers.ETag!.Tag;
        using var webDavSave = await SendAsync(_user, HttpMethod.Put, "/webdav/family.kdbx", bytes: KdbxBytes("v3"), basic: webDav.BasicAuth, etag: restETag);
        Assert.True(webDavSave.IsSuccessStatusCode);
        using var stale = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("v4"), csrf: aliceCsrf, etag: restETag);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var all = await GetJsonAsync(_admin, "/api/admin/logs/audit?pageSize=200");
        var actions = all.GetProperty("items").EnumerateArray().Select(/* Tag. */ e => e.GetProperty("action").GetString()).ToList();
        foreach (var expected in new[] { "SetupCompleted", "UserCreated", "VaultUploaded", "VaultPermissionsChanged", "AppPasswordCreated", "LoginFailed", "LoginSucceeded", "VaultSaved", "VaultConflictCopy" })
        {
            Assert.Contains(expected, actions);
        }
        Assert.DoesNotContain("User passphrase 123", all.GetRawText());
        Assert.DoesNotContain("Wrong passphrase 1", all.GetRawText());
        Assert.DoesNotContain(webDav.BasicAuth, all.GetRawText());

        var permissions = all.GetProperty("items").EnumerateArray().Single(/* Grant change. */ e => e.GetProperty("action").GetString() == "VaultPermissionsChanged");
        Assert.Equal("alice: none → read-write", permissions.GetProperty("details").GetString());
        Assert.Equal("family.kdbx", permissions.GetProperty("targetName").GetString());
        Assert.Equal("admin", permissions.GetProperty("actorName").GetString());

        var saves = await GetJsonAsync(_admin, "/api/admin/logs/audit?action=VaultSaved");
        Assert.Equal(2, saves.GetProperty("total").GetInt64());
        var saveDetails = saves.GetProperty("items").EnumerateArray().Select(/* Details. */ e => e.GetProperty("details").GetString()).ToList();
        Assert.Contains("Web vault · revision 2", saveDetails);
        Assert.Contains(saveDetails, /* WebDAV save. */ d => d!.StartsWith("WebDAV · ", StringComparison.Ordinal) && d.EndsWith("revision 3", StringComparison.Ordinal));

        var failed = await GetJsonAsync(_admin, "/api/admin/logs/audit?failedOnly=true");
        Assert.Equal(3, failed.GetProperty("total").GetInt64());
        Assert.Equal(2, failed.GetProperty("stats").GetProperty("failedSignIns24Hours").GetInt64());
        var unknownLogin = failed.GetProperty("items").EnumerateArray().Single(/* Unknown name. */ e => e.GetProperty("actorName").GetString() == "mallory");
        Assert.Equal("Unknown username", unknownLogin.GetProperty("details").GetString());
        Assert.Equal(JsonValueKind.Null, unknownLogin.GetProperty("actorId").ValueKind);

        var byAlice = await GetJsonAsync(_admin, "/api/admin/logs/audit?actor=ali&category=auth");
        Assert.All(byAlice.GetProperty("items").EnumerateArray(), /* Only alice. */ e => Assert.Equal("alice", e.GetProperty("actorName").GetString()));
        Assert.Equal(2, byAlice.GetProperty("total").GetInt64());

        var search = await GetJsonAsync(_admin, "/api/admin/logs/audit?search=family");
        Assert.True(search.GetProperty("total").GetInt64() >= 4);
        var page2 = await GetJsonAsync(_admin, "/api/admin/logs/audit?pageSize=10&page=2");
        Assert.Equal(2, page2.GetProperty("page").GetInt32());
        Assert.Contains(all.GetProperty("actions").EnumerateArray(), /* Known tag. */ a => a.GetProperty("action").GetString() == "VaultDownloaded");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync("/api/admin/logs/audit")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _admin.GetAsync("/api/admin/logs/audit?from=yesterday")).StatusCode);
    }

    /// <summary>
    /// Checks the user's own sign-in list, the CSV export with formula protection, and the retention setting that
    /// removes older entries.
    /// </summary>
    [Fact]
    public async Task Audit_Log_Sign_In_List_Csv_And_Retention()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        using (var wrong = await _user.PostAsJsonAsync("/api/auth/login", new { username = "alice", password = "Wrong passphrase 1" }))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        }
        using (var formula = await _user.PostAsJsonAsync("/api/auth/login", new { username = "=HYPERLINK(\"http://x\")", password = "Guess passphrase 1" }))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, formula.StatusCode);
        }
        await LoginAsync(_user, "alice", "User passphrase 123");

        var signIns = (await GetJsonAsync(_user, "/api/auth/sign-ins")).EnumerateArray().ToList();
        Assert.Equal(2, signIns.Count);
        Assert.True(signIns[0].GetProperty("success").GetBoolean());
        Assert.False(signIns[1].GetProperty("success").GetBoolean());
        Assert.Equal("Web vault", signIns[0].GetProperty("channel").GetString());

        using var csv = await _admin.GetAsync("/api/admin/logs/audit.csv?category=auth");
        csv.EnsureSuccessStatusCode();
        Assert.Equal("text/csv", csv.Content.Headers.ContentType!.MediaType);
        var text = await csv.Content.ReadAsStringAsync();
        Assert.StartsWith("Time (UTC),Action,Category,Result,User", text.TrimStart('﻿'));
        Assert.Contains("\"'=HYPERLINK(\"\"http://x\"\")\"", text);
        Assert.DoesNotContain("UserCreated", text);

        using (var invalid = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/audit", json: new { retentionDays = 0 }, csrf: adminCsrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        }
        Assert.Equal(365, (await GetJsonAsync(_admin, "/api/admin/settings/audit")).GetProperty("retentionDays").GetInt32());
        var db = _factory.Services.GetRequiredService<KeePortDb>();
        db.AddAuditEntry(new AuditEntryDto(0, DateTimeOffset.UtcNow.AddDays(-40), "auth", "Logout", true, null, "old", null, null, null, null, null, null), 365);
        Assert.Equal(1, (await GetJsonAsync(_admin, "/api/admin/logs/audit?actor=old")).GetProperty("total").GetInt64());
        using (var shorter = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/audit", json: new { retentionDays = 30 }, csrf: adminCsrf))
        {
            shorter.EnsureSuccessStatusCode();
        }
        Assert.Equal(0, (await GetJsonAsync(_admin, "/api/admin/logs/audit?actor=old")).GetProperty("total").GetInt64());
        var changed = await GetJsonAsync(_admin, "/api/admin/logs/audit?action=AuditRetentionChanged");
        Assert.Equal("365 → 30 days", changed.GetProperty("items")[0].GetProperty("details").GetString());
    }

    /// <summary>Checks that both account types can store an interface language, that it is validated and logged, and that null follows the browser again.</summary>
    [Fact]
    public async Task Language_Is_Stored_Per_Account_And_Validated()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var (userCsrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");
        Assert.Equal(JsonValueKind.Null, (await GetJsonAsync(_user, "/api/auth/me")).GetProperty("language").ValueKind);

        using (var german = await SendAsync(_user, HttpMethod.Put, "/api/auth/language", json: new { language = "de" }, csrf: userCsrf))
        {
            german.EnsureSuccessStatusCode();
        }
        Assert.Equal("de", (await GetJsonAsync(_user, "/api/auth/me")).GetProperty("language").GetString());
        using (var invalid = await SendAsync(_user, HttpMethod.Put, "/api/auth/language", json: new { language = "es" }, csrf: userCsrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        }
        using (var automatic = await SendAsync(_user, HttpMethod.Put, "/api/auth/language", json: new { language = (string?)null }, csrf: userCsrf))
        {
            automatic.EnsureSuccessStatusCode();
        }
        Assert.Equal(JsonValueKind.Null, (await GetJsonAsync(_user, "/api/auth/me")).GetProperty("language").ValueKind);

        using (var french = await SendAsync(_admin, HttpMethod.Put, $"{AdminAuthPath}/language", json: new { language = "fr" }, csrf: adminCsrf))
        {
            french.EnsureSuccessStatusCode();
        }
        Assert.Equal("fr", (await GetJsonAsync(_admin, $"{AdminAuthPath}/me")).GetProperty("language").GetString());
        var logged = await GetJsonAsync(_admin, "/api/admin/logs/audit?search=Language");
        Assert.Equal(3, logged.GetProperty("total").GetInt64());
    }

    /// <summary>
    /// Checks that every save keeps the previous content as a version (web vault and WebDAV, not conflicts), that admins
    /// can download and restore versions, that a restore is a new revision, and that the retention settings prune.
    /// </summary>
    [Fact]
    public async Task Vault_Versions_Are_Kept_Restored_And_Pruned()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (aliceId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "family.kdbx", "v1");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, aliceId, "read-write");
        var webDav = await CreateWebDavCredentialAsync(_admin, adminCsrf, aliceId);
        var (aliceCsrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");

        using var save2 = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("v2"), csrf: aliceCsrf, etag: vault.ETag);
        save2.EnsureSuccessStatusCode();
        using var save3 = await SendAsync(_user, HttpMethod.Put, "/webdav/family.kdbx", bytes: KdbxBytes("v3"), basic: webDav.BasicAuth, etag: save2.Headers.ETag!.Tag);
        Assert.True(save3.IsSuccessStatusCode);
        using var stale = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("stale"), csrf: aliceCsrf, etag: vault.ETag);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var list = await GetJsonAsync(_admin, $"/api/admin/files/{vault.Id}/versions");
        Assert.Equal(3, list.GetProperty("current").GetProperty("revision").GetInt64());
        Assert.StartsWith("WebDAV · ", list.GetProperty("current").GetProperty("source").GetString());
        var versions = list.GetProperty("versions").EnumerateArray().ToList();
        Assert.Equal(new long[] { 2, 1 }, versions.Select(/* Revision. */ v => v.GetProperty("revision").GetInt64()).ToArray());
        Assert.Equal("Web vault", versions[0].GetProperty("source").GetString());
        Assert.Equal("alice", versions[0].GetProperty("savedBy").GetString());
        Assert.Equal("Upload", versions[1].GetProperty("source").GetString());

        using (var download = await _admin.GetAsync($"/api/admin/files/{vault.Id}/versions/1/content"))
        {
            download.EnsureSuccessStatusCode();
            Assert.Equal(KdbxBytes("v1"), await download.Content.ReadAsByteArrayAsync());
            Assert.Equal("family-r1.kdbx", download.Content.Headers.ContentDisposition!.FileNameStar ?? download.Content.Headers.ContentDisposition.FileName);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await _admin.GetAsync($"/api/admin/files/{vault.Id}/versions/3/content")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync($"/api/admin/files/{vault.Id}/versions")).StatusCode);

        using (var restore = await SendAsync(_admin, HttpMethod.Post, $"/api/admin/files/{vault.Id}/versions/1/restore", csrf: adminCsrf))
        {
            restore.EnsureSuccessStatusCode();
            Assert.Equal(4, (await restore.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("revision").GetInt64());
        }
        using (var read = await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content", csrf: aliceCsrf))
        {
            Assert.Equal(KdbxBytes("v1"), await read.Content.ReadAsByteArrayAsync());
        }
        var afterRestore = await GetJsonAsync(_admin, $"/api/admin/files/{vault.Id}/versions");
        Assert.Equal("Restore of revision 1", afterRestore.GetProperty("current").GetProperty("source").GetString());
        Assert.Equal(new long[] { 3, 2, 1 }, afterRestore.GetProperty("versions").EnumerateArray().Select(/* Revision. */ v => v.GetProperty("revision").GetInt64()).ToArray());
        Assert.Equal(1, (await GetJsonAsync(_admin, "/api/admin/logs/audit?action=VaultVersionRestored")).GetProperty("total").GetInt64());

        using (var invalid = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/versions", json: new { maxCount = 1001, maxDays = 90 }, csrf: adminCsrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        }
        using (var fewer = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/versions", json: new { maxCount = 2, maxDays = 90 }, csrf: adminCsrf))
        {
            fewer.EnsureSuccessStatusCode();
        }
        var pruned = await GetJsonAsync(_admin, $"/api/admin/files/{vault.Id}/versions");
        Assert.Equal(new long[] { 3, 2 }, pruned.GetProperty("versions").EnumerateArray().Select(/* Revision. */ v => v.GetProperty("revision").GetInt64()).ToArray());
        Assert.False(File.Exists(Path.Combine(_dataDir, "vault-versions", vault.Id, "1.kdbx")));
        Assert.True((await GetJsonAsync(_admin, "/api/admin/settings/versions")).GetProperty("usedBytes").GetInt64() > 0);

        using (var off = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/versions", json: new { maxCount = 0, maxDays = 90 }, csrf: adminCsrf))
        {
            off.EnsureSuccessStatusCode();
        }
        Assert.Empty((await GetJsonAsync(_admin, $"/api/admin/files/{vault.Id}/versions")).GetProperty("versions").EnumerateArray());
        var current = (await GetJsonAsync(_admin, $"/api/admin/files/{vault.Id}/versions")).GetProperty("current");
        Assert.Equal(4, current.GetProperty("revision").GetInt64());
    }

    /// <summary>Checks that a save is refused, and the vault left unchanged, when the previous version cannot be kept.</summary>
    [Fact]
    public async Task Save_Is_Refused_When_The_Previous_Version_Cannot_Be_Kept()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        var (aliceId, _) = await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var vault = await UploadVaultAsync(_admin, adminCsrf, "family.kdbx", "v1");
        await SetPermissionsAsync(_admin, adminCsrf, vault.Id, aliceId, "read-write");
        var (aliceCsrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");

        // A file where the vault's version folder should be makes creating the version fail, like a full or read-only disk.
        Directory.CreateDirectory(Path.Combine(_dataDir, "vault-versions"));
        await File.WriteAllTextAsync(Path.Combine(_dataDir, "vault-versions", vault.Id), "blocks the folder");

        using var save = await SendAsync(_user, HttpMethod.Put, $"/api/vault/files/{vault.Id}/content", bytes: KdbxBytes("v2"), csrf: aliceCsrf, etag: vault.ETag);
        Assert.Equal(HttpStatusCode.InsufficientStorage, save.StatusCode);
        Assert.Equal("version_failed", (await save.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        using var read = await SendAsync(_user, HttpMethod.Get, $"/api/vault/files/{vault.Id}/content", csrf: aliceCsrf);
        Assert.Equal(KdbxBytes("v1"), await read.Content.ReadAsByteArrayAsync());
        Assert.Equal(1, (await GetJsonAsync(_admin, $"/api/admin/files/{vault.Id}/versions")).GetProperty("current").GetProperty("revision").GetInt64());
    }

    /// <summary>
    /// Checks the SMTP settings: validation, the password is stored encrypted and never returned, only admins have
    /// access, and a failing test mail reports the server error and is logged.
    /// </summary>
    [Fact]
    public async Task Email_Settings_Keep_The_Password_Secret_And_Report_Test_Failures()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        using (var invalid = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/email", json: new { host = "mail.example.test", port = 0, security = "starttls" }, csrf: adminCsrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        }
        await ConfigureEmailAsync(adminCsrf, password: "Smtp secret 42");
        var status = await GetJsonAsync(_admin, "/api/admin/settings/email");
        Assert.True(status.GetProperty("configured").GetBoolean());
        Assert.True(status.GetProperty("settings").GetProperty("hasPassword").GetBoolean());
        Assert.Equal(JsonValueKind.Null, status.GetProperty("settings").GetProperty("password").ValueKind);
        Assert.DoesNotContain("Smtp secret 42", status.GetRawText());
        var stored = _factory.Services.GetRequiredService<KeePortDb>().GetState("email_settings")!;
        Assert.DoesNotContain("Smtp secret 42", stored);
        Assert.Equal("Smtp secret 42", _factory.Services.GetRequiredService<EmailSettingsService>().RevealPassword(
            _factory.Services.GetRequiredService<EmailSettingsService>().Get()));

        // Saving without a password keeps the stored one.
        await ConfigureEmailAsync(adminCsrf, password: null);
        Assert.True((await GetJsonAsync(_admin, "/api/admin/settings/email")).GetProperty("settings").GetProperty("hasPassword").GetBoolean());

        using (var test = await SendAsync(_admin, HttpMethod.Post, "/api/admin/settings/email/test", csrf: adminCsrf))
        {
            Assert.Equal(HttpStatusCode.BadGateway, test.StatusCode);
            Assert.Equal("email_failed", (await test.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        }
        Assert.Equal(1, (await GetJsonAsync(_admin, "/api/admin/logs/audit?action=TestEmailSent&failedOnly=true")).GetProperty("total").GetInt64());
        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync("/api/admin/settings/email")).StatusCode);
    }

    /// <summary>
    /// Checks confirming an address with a code (wrong code, throttling, success) and that changing the address
    /// unconfirms it and tells the previous address.
    /// </summary>
    [Fact]
    public async Task Email_Address_Is_Confirmed_With_A_Code()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await ConfigureEmailAsync(adminCsrf);
        await CreateUserAsync(_admin, adminCsrf, "alice", "user");
        var (csrf, _) = await LoginAsync(_user, "alice", "User passphrase 123");
        using (var request = await SendAsync(_user, HttpMethod.Post, "/api/auth/email/verification", csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.NoContent, request.StatusCode);
        }
        using (var again = await SendAsync(_user, HttpMethod.Post, "/api/auth/email/verification", csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, again.StatusCode);
        }
        var mail = OutboxMail("alice@example.test", "verify");
        var code = System.Text.RegularExpressions.Regex.Match(mail.TextBody, @"\b\d{6}\b").Value;
        Assert.Equal(6, code.Length);
        var wrong = code == "000000" ? "111111" : "000000";
        using (var bad = await SendAsync(_user, HttpMethod.Post, "/api/auth/email/verify", json: new { code = wrong }, csrf: csrf))
        {
            Assert.Equal("wrong_code", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        }
        using (var ok = await SendAsync(_user, HttpMethod.Post, "/api/auth/email/verify", json: new { code }, csrf: csrf))
        {
            ok.EnsureSuccessStatusCode();
            Assert.True((await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("emailVerified").GetBoolean());
        }

        using (var change = await SendAsync(_user, HttpMethod.Put, "/api/auth/email", json: new { email = "alice.new@example.test" }, csrf: csrf))
        {
            change.EnsureSuccessStatusCode();
            Assert.False((await change.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("emailVerified").GetBoolean());
        }
        Assert.Contains("alice.new@example.test", OutboxMail("alice@example.test", "emailChanged").TextBody);
    }

    /// <summary>
    /// Checks the invitation (link, set password once, address confirmed), the forgotten-password flow (same answer for
    /// unknown accounts, admins excluded, sessions ended) and the notifications about new browsers, app passwords and
    /// password resets.
    /// </summary>
    [Fact]
    public async Task Invitation_Password_Reset_And_Notifications()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await ConfigureEmailAsync(adminCsrf);
        using (var adminInvite = await SendAsync(_admin, HttpMethod.Post, "/api/admin/users", json: new { username = "boss", email = "boss@example.test", role = "admin", invite = true }, csrf: adminCsrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, adminInvite.StatusCode);
        }
        string bobId;
        using (var invite = await SendAsync(_admin, HttpMethod.Post, "/api/admin/users", json: new { username = "bob", email = "bob@example.test", role = "user", invite = true }, csrf: adminCsrf))
        {
            invite.EnsureSuccessStatusCode();
            bobId = (await invite.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        }
        var inviteToken = TokenFrom(OutboxMail("bob@example.test", "invite"));
        var info = await (await _user.PostAsJsonAsync("/api/auth/token", new { token = inviteToken })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invite", info.GetProperty("purpose").GetString());
        Assert.Equal("bob", info.GetProperty("username").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await _user.PostAsJsonAsync("/api/auth/set-password", new { token = inviteToken, password = "short" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _user.PostAsJsonAsync("/api/auth/set-password", new { token = inviteToken, password = "Bob passphrase 123" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _user.PostAsJsonAsync("/api/auth/set-password", new { token = inviteToken, password = "Other passphrase 1" })).StatusCode);
        var (bobCsrf, _) = await LoginAsync(_user, "bob", "Bob passphrase 123");
        Assert.True((await GetJsonAsync(_user, "/api/auth/me")).GetProperty("emailVerified").GetBoolean());

        // A sign-in from another browser is reported; the first sign-in was not.
        Assert.Null(_factory.Services.GetRequiredService<KeePortDb>().GetLatestEmail("bob@example.test", "signIn"));
        using (var other = _factory.CreateClient())
        {
            other.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/120.0");
            await LoginAsync(other, "bob", "Bob passphrase 123");
        }
        Assert.Contains("Firefox 120", OutboxMail("bob@example.test", "signIn").TextBody);

        // A new app password is reported to its owner.
        await CreateWebDavCredentialAsync(_admin, adminCsrf, bobId);
        Assert.NotNull(OutboxMail("bob@example.test", "appPassword"));

        // Forgotten password: same answer for everyone, a link only for confirmed user accounts.
        foreach (var identifier in new[] { "nobody", "admin", "bob@example.test" })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await _admin.PostAsJsonAsync("/api/auth/password-reset", new { identifier })).StatusCode);
        }
        Assert.Null(_factory.Services.GetRequiredService<KeePortDb>().GetLatestEmail(AdminEmail, "reset"));
        var resetToken = TokenFrom(OutboxMail("bob@example.test", "reset"));
        Assert.Equal("reset", (await (await _admin.PostAsJsonAsync("/api/auth/token", new { token = resetToken })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("purpose").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PostAsJsonAsync("/api/auth/set-password", new { token = resetToken, password = "Bob fresh passphrase 9" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync("/api/auth/me")).StatusCode);
        await LoginAsync(_user, "bob", "Bob fresh passphrase 9");
        Assert.NotNull(OutboxMail("bob@example.test", "passwordChangedReset"));
        Assert.Equal(3, (await GetJsonAsync(_admin, "/api/admin/logs/audit?action=PasswordResetRequested")).GetProperty("total").GetInt64());

        // An admin's reset of the password is reported too.
        using (var reset = await SendAsync(_admin, HttpMethod.Patch, $"/api/admin/users/{bobId}", json: new { password = "Admin set passphrase 7" }, csrf: adminCsrf))
        {
            reset.EnsureSuccessStatusCode();
        }
        Assert.NotNull(OutboxMail("bob@example.test", "passwordChangedAdmin"));
        _ = bobCsrf;
    }

    /// <summary>Checks that many failed sign-ins warn administrators with a confirmed address, at most once an hour.</summary>
    [Fact]
    public async Task Admins_Are_Warned_About_Many_Failed_Sign_Ins()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await ConfigureEmailAsync(adminCsrf);
        var db = _factory.Services.GetRequiredService<KeePortDb>();
        var adminId = (await GetJsonAsync(_admin, $"{AdminAuthPath}/me")).GetProperty("id").GetString()!;
        db.SetEmailVerified(adminId, DateTimeOffset.UtcNow);
        for (var i = 0; i < AdminWarningService.FailedSignInThreshold; i++)
        {
            db.AddAuditEntry(new AuditEntryDto(0, DateTimeOffset.UtcNow, "auth", "LoginFailed", false, null, "mallory", "session", null, "Web vault", "Unknown username", "198.51.100.7", null), 365);
        }
        var warnings = ActivatorUtilities.CreateInstance<AdminWarningService>(_factory.Services);
        warnings.CheckOnce(DateTimeOffset.UtcNow);
        var mail = OutboxMail(AdminEmail, "warnFailedSignIns");
        Assert.Contains("10 failed sign-ins", mail.TextBody);
        warnings.CheckOnce(DateTimeOffset.UtcNow);
        Assert.Equal(mail.Id, OutboxMail(AdminEmail, "warnFailedSignIns").Id);
    }

    /// <summary>
    /// Sets up an authenticator app and checks the sign-in with it: challenge without session, wrong and right codes,
    /// no reuse of a code, recovery codes once only, five wrong codes end the sign-in, and the admin's reset.
    /// </summary>
    [Fact]
    public async Task Totp_Setup_Sign_In_Recovery_And_Reset()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        // This test signs in more often than the default limit of 10 per minute allows.
        (await SendAsync(_admin, HttpMethod.Put, RateLimitsPath, json: new { authPerMinute = 1000, webDavPerMinute = 1000 }, csrf: adminCsrf)).EnsureSuccessStatusCode();
        var anna = await CreateUserAsync(_admin, adminCsrf, "anna", "user");
        var (csrf, _) = await LoginAsync(_user, "anna", "User passphrase 123");

        using (var wrongPassword = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/start", json: new { password = "wrong" }, csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.Forbidden, wrongPassword.StatusCode);
        }
        string secret;
        using (var start = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/start", json: new { password = "User passphrase 123" }, csrf: csrf))
        {
            start.EnsureSuccessStatusCode();
            var json = await start.Content.ReadFromJsonAsync<JsonElement>();
            secret = json.GetProperty("secret").GetString()!;
            Assert.StartsWith("otpauth://totp/KeePort:anna?secret=" + secret, json.GetProperty("uri").GetString());
        }
        var bytes = Totp.FromBase32(secret);
        var step = Totp.StepAt(DateTimeOffset.UtcNow);
        using (var wrong = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/confirm", json: new { code = "000000" == Totp.Compute(bytes, step) ? "111111" : "000000" }, csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        }
        string[] recovery;
        using (var confirm = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/confirm", json: new { code = Totp.Compute(bytes, step) }, csrf: csrf))
        {
            confirm.EnsureSuccessStatusCode();
            var json = await confirm.Content.ReadFromJsonAsync<JsonElement>();
            recovery = json.GetProperty("recoveryCodes").EnumerateArray().Select(/* Code. */ c => c.GetString()!).ToArray();
            Assert.Equal(10, recovery.Length);
            Assert.Matches("^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$", recovery[0]);
            Assert.Equal(10, json.GetProperty("status").GetProperty("recoveryCodesLeft").GetInt32());
            Assert.True(json.GetProperty("status").GetProperty("active").GetBoolean());
        }
        Assert.True((await GetJsonAsync(_admin, "/api/admin/users")).EnumerateArray().Single(/* Anna. */ u => u.GetProperty("username").GetString() == "anna").GetProperty("twoFactor").GetBoolean());

        // The password alone gives no session, only a challenge.
        using var other = _factory.CreateClient();
        var challenge = await (await other.PostAsJsonAsync("/api/auth/login", new { username = "anna", password = "User passphrase 123" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(challenge.GetProperty("mfaRequired").GetBoolean());
        Assert.Equal(["totp"], challenge.GetProperty("methods").EnumerateArray().Select(/* Method. */ m => m.GetString()).ToArray());
        var token = challenge.GetProperty("mfaToken").GetString();
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/auth/me")).StatusCode);
        // A vault token does not work in the admin console.
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostAsJsonAsync($"{AdminAuthPath}/login/mfa", new { mfaToken = token, method = "totp", code = Totp.Compute(bytes, step + 1) })).StatusCode);
        // The code that confirmed the setup cannot be used again.
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = token, method = "totp", code = Totp.Compute(bytes, step) })).StatusCode);
        var signedIn = await other.PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = token, method = "totp", code = Totp.Compute(bytes, step + 1) });
        signedIn.EnsureSuccessStatusCode();
        Assert.Equal("anna", (await GetJsonAsync(other, "/api/auth/me")).GetProperty("username").GetString());
        // The pending sign-in is used up.
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = token, method = "recovery", code = recovery[1] })).StatusCode);

        // A recovery code works once, written without dashes and in capitals too.
        async Task<HttpResponseMessage> RecoverAsync(string code)
        {
            var next = await (await _factory.CreateClient().PostAsJsonAsync("/api/auth/login", new { username = "anna", password = "User passphrase 123" })).Content.ReadFromJsonAsync<JsonElement>();
            return await _factory.CreateClient().PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = next.GetProperty("mfaToken").GetString(), method = "recovery", code });
        }
        Assert.Equal(HttpStatusCode.OK, (await RecoverAsync(recovery[0].Replace("-", "").ToUpperInvariant())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await RecoverAsync(recovery[0])).StatusCode);
        Assert.Equal(9, (await GetJsonAsync(_user, "/api/auth/mfa")).GetProperty("recoveryCodesLeft").GetInt32());

        // Five wrong codes end the pending sign-in.
        var tries = await (await other.PostAsJsonAsync("/api/auth/login", new { username = "anna", password = "User passphrase 123" })).Content.ReadFromJsonAsync<JsonElement>();
        var triesToken = tries.GetProperty("mfaToken").GetString();
        for (var i = 0; i < MfaService.MaxAttempts; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await other.PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = triesToken, method = "recovery", code = "aaaa-aaaa-aaaa-aaaa" })).StatusCode);
        }
        var afterTries = await other.PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = triesToken, method = "recovery", code = recovery[2] });
        Assert.Equal("mfa_expired", (await afterTries.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        Assert.True((await GetJsonAsync(_admin, "/api/admin/logs/audit?action=LoginFailed")).GetProperty("total").GetInt64() >= 5);

        // Turning it off needs the password and a code.
        using (var noCode = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/disable", json: new { password = "User passphrase 123", method = "totp", code = "123" }, csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, noCode.StatusCode);
        }

        // The admin's reset turns it off and signs the account out.
        using (var reset = await SendAsync(_admin, HttpMethod.Post, $"/api/admin/users/{anna.Id}/reset-mfa", csrf: adminCsrf))
        {
            Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await _user.GetAsync("/api/auth/me")).StatusCode);
        var plain = await (await _user.PostAsJsonAsync("/api/auth/login", new { username = "anna", password = "User passphrase 123" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(plain.GetProperty("user").GetProperty("twoFactor").GetBoolean());
        Assert.Equal(1, (await GetJsonAsync(_admin, "/api/admin/logs/audit?action=MfaReset")).GetProperty("total").GetInt64());
    }

    /// <summary>
    /// Checks e-mail codes as second factor: allowed for users but not admins by default, need a confirmed address,
    /// codes are throttled, and the address cannot be changed while they are on.
    /// </summary>
    [Fact]
    public async Task Email_Codes_As_Second_Factor()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await ConfigureEmailAsync(adminCsrf);
        await CreateUserAsync(_admin, adminCsrf, "carl", "user");
        var (csrf, carlId) = await LoginAsync(_user, "carl", "User passphrase 123");
        var db = _factory.Services.GetRequiredService<KeePortDb>();

        using (var unverified = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/email/enable", json: new { password = "User passphrase 123" }, csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.BadRequest, unverified.StatusCode);
        }
        db.SetEmailVerified(carlId, DateTimeOffset.UtcNow);
        using (var enable = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/email/enable", json: new { password = "User passphrase 123" }, csrf: csrf))
        {
            enable.EnsureSuccessStatusCode();
            Assert.Equal(10, (await enable.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("recoveryCodes").GetArrayLength());
        }
        Assert.NotNull(OutboxMail("carl@example.test", "mfaEnabled"));
        using (var change = await SendAsync(_user, HttpMethod.Put, "/api/auth/email", json: new { email = "evil@example.test" }, csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.Conflict, change.StatusCode);
        }

        using var other = _factory.CreateClient();
        var challenge = await (await other.PostAsJsonAsync("/api/auth/login", new { username = "carl", password = "User passphrase 123" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("c…@example.test", challenge.GetProperty("emailHint").GetString());
        var token = challenge.GetProperty("mfaToken").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await other.PostAsJsonAsync("/api/auth/login/mfa/email", new { mfaToken = token })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await other.PostAsJsonAsync("/api/auth/login/mfa/email", new { mfaToken = token })).StatusCode);
        var code = System.Text.RegularExpressions.Regex.Match(OutboxMail("carl@example.test", "mfaCode").TextBody, @"\b(\d{6})\b").Groups[1].Value;
        Assert.Equal(HttpStatusCode.BadRequest, (await other.PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = token, method = "totp", code })).StatusCode);
        (await other.PostAsJsonAsync("/api/auth/login/mfa", new { mfaToken = token, method = "email", code })).EnsureSuccessStatusCode();

        // When the admin no longer allows e-mail codes for users, they stop counting as second factor.
        using (var settings = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/mfa", json: new { requireForAdmins = false, requireForUsers = false, emailForAdmins = false, emailForUsers = false }, csrf: adminCsrf))
        {
            settings.EnsureSuccessStatusCode();
        }
        var plain = await (await other.PostAsJsonAsync("/api/auth/login", new { username = "carl", password = "User passphrase 123" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(plain.TryGetProperty("mfaRequired", out _));

        // Admins may not use e-mail codes by default.
        Assert.False((await GetJsonAsync(_admin, $"{AdminAuthPath}/mfa")).GetProperty("emailAllowed").GetBoolean());
    }

    /// <summary>
    /// Checks the rule that requires a second factor: until it is set up only the setup works, and the last factor
    /// cannot be turned off. Also checks that a password reset link needs a code from the app.
    /// </summary>
    [Fact]
    public async Task Required_Two_Factor_And_Reset_Link_With_Code()
    {
        var adminCsrf = await SetupAdminAsync(_admin);
        await ConfigureEmailAsync(adminCsrf);
        using (var settings = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/mfa", json: new { requireForAdmins = false, requireForUsers = true, emailForAdmins = false, emailForUsers = true }, csrf: adminCsrf))
        {
            settings.EnsureSuccessStatusCode();
        }
        await CreateUserAsync(_admin, adminCsrf, "dora", "user");
        var login = await (await _user.PostAsJsonAsync("/api/auth/login", new { username = "dora", password = "User passphrase 123" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(login.GetProperty("user").GetProperty("mfaSetupRequired").GetBoolean());
        var csrf = login.GetProperty("csrfToken").GetString()!;
        var blocked = await _user.GetAsync("/api/vault/files");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Equal("mfa_setup_required", (await blocked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        Assert.True((await GetJsonAsync(_user, "/api/auth/mfa")).GetProperty("required").GetBoolean());

        var start = await (await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/start", json: new { password = "User passphrase 123" }, csrf: csrf)).Content.ReadFromJsonAsync<JsonElement>();
        var bytes = Totp.FromBase32(start.GetProperty("secret").GetString()!);
        var step = Totp.StepAt(DateTimeOffset.UtcNow);
        var confirm = await (await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/confirm", json: new { code = Totp.Compute(bytes, step) }, csrf: csrf)).Content.ReadFromJsonAsync<JsonElement>();
        var recovery = confirm.GetProperty("recoveryCodes")[0].GetString();
        Assert.Equal(HttpStatusCode.OK, (await _user.GetAsync("/api/vault/files")).StatusCode);
        Assert.False((await GetJsonAsync(_user, "/api/auth/me")).GetProperty("mfaSetupRequired").GetBoolean());
        using (var disable = await SendAsync(_user, HttpMethod.Post, "/api/auth/mfa/totp/disable", json: new { password = "User passphrase 123", method = "totp", code = Totp.Compute(bytes, step + 1) }, csrf: csrf))
        {
            Assert.Equal(HttpStatusCode.Conflict, disable.StatusCode);
        }

        // A reset link alone is not enough for an account with an authenticator app.
        var doraId = (await GetJsonAsync(_user, "/api/auth/me")).GetProperty("id").GetString()!;
        _factory.Services.GetRequiredService<KeePortDb>().SetEmailVerified(doraId, DateTimeOffset.UtcNow);
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PostAsJsonAsync("/api/auth/password-reset", new { identifier = "dora" })).StatusCode);
        var resetToken = TokenFrom(OutboxMail("dora@example.test", "reset"));
        Assert.True((await (await _admin.PostAsJsonAsync("/api/auth/token", new { token = resetToken })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("mfaRequired").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await _admin.PostAsJsonAsync("/api/auth/set-password", new { token = resetToken, password = "Dora fresh passphrase 1" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _admin.PostAsJsonAsync("/api/auth/set-password", new { token = resetToken, password = "Dora fresh passphrase 1", method = "recovery", code = recovery })).StatusCode);
    }

    /// <summary>Stores SMTP settings that point at a closed local port, so e-mails are queued but never delivered.</summary>
    /// <param name="adminCsrf">The admin's CSRF token.</param>
    /// <param name="password">An SMTP password to store, or null to keep the stored one.</param>
    private async Task ConfigureEmailAsync(string adminCsrf, string? password = null)
    {
        using var response = await SendAsync(_admin, HttpMethod.Put, "/api/admin/settings/email", json: new
        {
            host = "127.0.0.1",
            port = 1,
            security = "none",
            username = password is null ? null : "keeport",
            password,
            fromAddress = "keeport@example.test",
            fromName = "KeePort",
            publicUrl = "https://vault.example.test",
            warnFailedSignIns = true,
            warnCertificate = true,
            warnStorage = true,
            warnDiskSpace = true
        }, csrf: adminCsrf);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>Reads the newest queued e-mail of a kind to an address; fails the test when there is none.</summary>
    /// <param name="recipient">The recipient address.</param>
    /// <param name="kind">The template name.</param>
    private OutboxEmail OutboxMail(string recipient, string kind)
        => _factory.Services.GetRequiredService<KeePortDb>().GetLatestEmail(recipient, kind)
           ?? throw new Xunit.Sdk.XunitException($"No {kind} e-mail to {recipient} was queued.");

    /// <summary>Extracts the one-time token from the link in an invitation or reset e-mail.</summary>
    /// <param name="mail">The e-mail.</param>
    private static string TokenFrom(OutboxEmail mail)
        => System.Text.RegularExpressions.Regex.Match(mail.TextBody, @"#token=([A-Za-z0-9_-]+)").Groups[1].Value;

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
