using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

public sealed partial class KeePortDb : IDisposable
{
    private readonly string _connectionString;

    /// <summary>Resolves the SQLite database and vault storage paths from configuration.</summary>
    /// <param name="configuration">The configuration containing the storage directory and SQLite settings.</param>
    public KeePortDb(IConfiguration configuration)
    {
        DataDir = configuration["KeePort:DataDir"] ?? "/data";
        DatabasePath = Path.Combine(DataDir, "keeport.db");
        VaultDirectory = Path.Combine(DataDir, "vault");
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = DatabasePath,
            ForeignKeys = true,
            Mode = SqliteOpenMode.ReadWriteCreate
        }.ToString();
    }

    public string DataDir { get; }
    public string DatabasePath { get; }
    public string VaultDirectory { get; }

    /// <summary>Creates the storage directories, initializes the SQLite schema, and prepares first-run setup.</summary>
    public void Initialize()
    {
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(VaultDirectory);

        using var connection = Open();
        connection.Open();
        Execute(connection, """
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            """);

        Execute(connection, """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('Admin', 'User')),
                disabled INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_login_at TEXT NULL,
                auto_lock_minutes INTEGER NULL,
                email TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                csrf_token TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_seen_at TEXT NULL,
                user_agent TEXT NULL,
                ip_address TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rate_limit_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                auth_per_minute INTEGER NOT NULL CHECK (auth_per_minute > 0),
                webdav_per_minute INTEGER NOT NULL CHECK (webdav_per_minute > 0)
            );

            CREATE TABLE IF NOT EXISTS vault_files (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                stored_name TEXT NOT NULL UNIQUE,
                size INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                revision INTEGER NOT NULL,
                etag TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT NULL,
                created_by TEXT NULL,
                updated_by TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_vault_files_name ON vault_files(name COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_vault_files_deleted ON vault_files(deleted_at);

            CREATE TABLE IF NOT EXISTS vault_permissions (
                file_id TEXT NOT NULL REFERENCES vault_files(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission TEXT NOT NULL CHECK (permission IN ('Read', 'ReadWrite')),
                updated_at TEXT NOT NULL,
                PRIMARY KEY (file_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS webdav_credentials (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                label TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used_at TEXT NULL,
                revoked_at TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS webdav_read_state (
                credential_id TEXT NOT NULL REFERENCES webdav_credentials(id) ON DELETE CASCADE,
                file_id TEXT NOT NULL REFERENCES vault_files(id) ON DELETE CASCADE,
                etag TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (credential_id, file_id)
            );

            CREATE TABLE IF NOT EXISTS webdav_request_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                status INTEGER NOT NULL,
                credential TEXT NULL,
                remote_ip TEXT NULL,
                duration_ms INTEGER NOT NULL,
                content_length INTEGER NULL,
                if_match INTEGER NOT NULL,
                depth TEXT NULL,
                destination TEXT NULL,
                overwrite TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                category TEXT NOT NULL,
                action TEXT NOT NULL,
                success INTEGER NOT NULL,
                actor_id TEXT NULL,
                actor_name TEXT NULL,
                target_type TEXT NULL,
                target_id TEXT NULL,
                target_name TEXT NULL,
                details TEXT NULL,
                remote_ip TEXT NULL,
                user_agent TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_audit_log_occurred ON audit_log(occurred_at);
            CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
            CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id, action);

            CREATE TABLE IF NOT EXISTS login_counters (
                bucket TEXT NOT NULL,
                channel TEXT NOT NULL CHECK (channel IN ('admin', 'vault')),
                outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
                count INTEGER NOT NULL,
                PRIMARY KEY (bucket, channel, outcome)
            );
            """);

        Execute(connection, """
            INSERT INTO rate_limit_settings (id, auth_per_minute, webdav_per_minute)
            VALUES (1, @auth, @webdav) ON CONFLICT(id) DO NOTHING;
            """, new SqliteParameter("@auth", RateLimitSettings.DefaultAuthPerMinute),
            new SqliteParameter("@webdav", RateLimitSettings.DefaultWebDavPerMinute));

        EnsureColumn("users", "auto_lock_minutes", "INTEGER NULL");
        EnsureColumn("users", "email", "TEXT NULL");
        EnsureColumn("users", "show_favicons", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("users", "clipboard_clear_seconds", "INTEGER NULL");
        EnsureColumn("users", "check_breaches", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("users", "language", "TEXT NULL");
        EnsureRevisionSchema(connection);
        EnsureEmailSchema(connection);
        EnsureMfaSchema(connection);
        EnsurePasskeySchema(connection);
        Execute(connection, "INSERT INTO app_state (key, value) VALUES ('login_stats_since', @now) ON CONFLICT(key) DO NOTHING;",
            new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")));
        EnsureSetupToken();
    }

    /// <summary>Adds a column only when an existing database is missing it.</summary>
    /// <param name="table">The existing SQLite table to inspect.</param>
    /// <param name="column">The column to add if it is missing.</param>
    /// <param name="definition">The SQL type and constraints for the new column.</param>
    private void EnsureColumn(string table, string column, string definition)
    {
        using var connection = Open();
        connection.Open();
        using (var command = connection.CreateCommand())
        {
            command.CommandText = $"PRAGMA table_info({table});";
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
        }

        Execute(connection, $"ALTER TABLE {table} ADD COLUMN {column} {definition};");
    }

    /// <summary>Creates a setup token when no administrator or pending token exists.</summary>
    private void EnsureSetupToken()
    {
        if (HasAdmin())
        {
            ClearSetupToken();
            return;
        }

        if (GetSetupToken() is null)
        {
            var token = Base64Url(RandomNumberGenerator.GetBytes(32));
            using var connection = Open();
            connection.Open();
            Execute(connection, """
                INSERT INTO app_state (key, value) VALUES ('setup_token', @token)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value;
                """, new SqliteParameter("@token", token));
        }
    }

    /// <summary>Checks whether an administrator account exists.</summary>
    public bool HasAdmin()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM users WHERE role = 'Admin';";
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    /// <summary>Reads the pending first-run setup token, if present.</summary>
    public string? GetSetupToken()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM app_state WHERE key = 'setup_token';";
        return command.ExecuteScalar() as string;
    }

    /// <summary>Removes the pending setup token from application state.</summary>
    public void ClearSetupToken()
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM app_state WHERE key = 'setup_token';");
    }

    /// <summary>Reads the configured limits from the singleton settings row.</summary>
    public RateLimitSettings GetRateLimitSettings()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT auth_per_minute, webdav_per_minute FROM rate_limit_settings WHERE id = 1;";
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            throw new InvalidOperationException("Rate limit settings have not been initialized.");
        }
        return new RateLimitSettings(reader.GetInt32(0), reader.GetInt32(1));
    }

    /// <summary>Writes both limit values together.</summary>
    /// <param name="settings">The configured login/setup and WebDAV request limits.</param>
    public void UpdateRateLimitSettings(RateLimitSettings settings)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO rate_limit_settings (id, auth_per_minute, webdav_per_minute) VALUES (1, @auth, @webdav)
            ON CONFLICT(id) DO UPDATE SET auth_per_minute = excluded.auth_per_minute, webdav_per_minute = excluded.webdav_per_minute;
            """, new SqliteParameter("@auth", settings.AuthPerMinute), new SqliteParameter("@webdav", settings.WebDavPerMinute));
    }

    /// <summary>Finds a user account by case-insensitive username.</summary>
    /// <param name="username">The account username.</param>
    public UserRecord? GetUserByUsername(string username)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, username, password_hash, role, disabled, created_at, last_login_at, auto_lock_minutes, email, show_favicons, clipboard_clear_seconds, check_breaches, language, email_verified_at, notify_sign_in, notify_app_password, mfa_totp_enabled_at, mfa_email_enabled_at
            FROM users WHERE username = @username COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("@username", username);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadUser(reader) : null;
    }

    /// <summary>Finds a user account by ID.</summary>
    /// <param name="id">The user account ID.</param>
    public UserRecord? GetUserById(string id)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, username, password_hash, role, disabled, created_at, last_login_at, auto_lock_minutes, email, show_favicons, clipboard_clear_seconds, check_breaches, language, email_verified_at, notify_sign_in, notify_app_password, mfa_totp_enabled_at, mfa_email_enabled_at
            FROM users WHERE id = @id;
            """;
        command.Parameters.AddWithValue("@id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadUser(reader) : null;
    }

    /// <summary>Lists user accounts in username order.</summary>
    public IReadOnlyList<UserRecord> ListUsers()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, username, password_hash, role, disabled, created_at, last_login_at, auto_lock_minutes, email, show_favicons, clipboard_clear_seconds, check_breaches, language, email_verified_at, notify_sign_in, notify_app_password, mfa_totp_enabled_at, mfa_email_enabled_at
            FROM users ORDER BY username COLLATE NOCASE;
            """;
        var users = new List<UserRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            users.Add(ReadUser(reader));
        }
        return users;
    }

    /// <summary>Inserts a user account with its initial role, credentials, and preferences.</summary>
    /// <param name="user">The user account associated with the operation.</param>
    public void CreateUser(UserRecord user)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO users (id, username, password_hash, role, disabled, created_at, last_login_at, email)
            VALUES (@id, @username, @passwordHash, @role, @disabled, @createdAt, @lastLoginAt, @email);
            """,
            new SqliteParameter("@id", user.Id),
            new SqliteParameter("@username", user.Username),
            new SqliteParameter("@passwordHash", user.PasswordHash),
            new SqliteParameter("@role", user.Role.ToString()),
            new SqliteParameter("@disabled", user.Disabled ? 1 : 0),
            new SqliteParameter("@createdAt", user.CreatedAt.ToString("O")),
            new SqliteParameter("@lastLoginAt", DbValue(user.LastLoginAt?.ToString("O"))),
            new SqliteParameter("@email", DbValue(user.Email)));
    }

    /// <summary>Updates a user's role and disabled status together.</summary>
    /// <param name="id">The user account ID.</param>
    /// <param name="role">The role used to select the account privileges or session scope.</param>
    /// <param name="disabled">Whether the user must be prevented from signing in.</param>
    public void UpdateUserRoleAndDisabled(string id, UserRole role, bool disabled)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            UPDATE users SET role = @role, disabled = @disabled WHERE id = @id;
            """,
            new SqliteParameter("@id", id),
            new SqliteParameter("@role", role.ToString()),
            new SqliteParameter("@disabled", disabled ? 1 : 0));
    }

    /// <summary>Replaces the stored password hash for a user.</summary>
    /// <param name="id">The user account ID.</param>
    /// <param name="passwordHash">The encoded password hash to store.</param>
    public void UpdateUserPassword(string id, string passwordHash)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET password_hash = @passwordHash WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@passwordHash", passwordHash));
    }

    /// <summary>Stores the validated contact email for one account.</summary>
    /// <param name="id">The user account ID.</param>
    /// <param name="email">The validated contact email address to store.</param>
    public void UpdateUserEmail(string id, string email)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET email = @email WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@email", email));
    }

    /// <summary>Stores a user's auto-lock delay or clears their override.</summary>
    /// <param name="id">The user account ID.</param>
    /// <param name="autoLockMinutes">The delay in minutes before auto-lock, or null to clear the user override.</param>
    public void UpdateUserAutoLockMinutes(string id, int? autoLockMinutes)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET auto_lock_minutes = @autoLockMinutes WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@autoLockMinutes", DbValue(autoLockMinutes)));
    }

    /// <summary>Stores whether the web vault may load website icons directly from the sites in the user's entries.</summary>
    /// <param name="id">The user's identifier.</param>
    /// <param name="showFavicons">Whether website icons are loaded.</param>
    public void UpdateUserShowFavicons(string id, bool showFavicons)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET show_favicons = @value WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@value", showFavicons ? 1 : 0));
    }

    /// <summary>Stores the interface language of an account: de, en or fr, or null to follow the browser.</summary>
    /// <param name="id">The user's identifier.</param>
    /// <param name="language">The language code, or null for automatic.</param>
    public void UpdateUserLanguage(string id, string? language)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET language = @value WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@value", DbValue(language)));
    }

    /// <summary>Stores whether the web vault checks passwords against "Have I Been Pwned".</summary>
    /// <param name="id">The user's identifier.</param>
    /// <param name="checkBreaches">Whether the breach check is on.</param>
    public void UpdateUserCheckBreaches(string id, bool checkBreaches)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET check_breaches = @value WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@value", checkBreaches ? 1 : 0));
    }

    /// <summary>Stores after how many seconds the web vault clears copied values from the clipboard.</summary>
    /// <param name="id">The user's identifier.</param>
    /// <param name="seconds">The delay in seconds; 0 turns clearing off.</param>
    public void UpdateUserClipboardClearSeconds(string id, int seconds)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET clipboard_clear_seconds = @value WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@value", seconds));
    }

    /// <summary>Records the time of a user's last successful sign-in.</summary>
    /// <param name="id">The user account ID.</param>
    /// <param name="lastLoginAt">The time of the last successful sign-in.</param>
    public void UpdateLastLogin(string id, DateTimeOffset lastLoginAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET last_login_at = @lastLoginAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@lastLoginAt", lastLoginAt.ToString("O")));
    }

    /// <summary>Deletes the user account and its dependent access records in one transaction.</summary>
    /// <param name="id">The user account ID.</param>
    public void DeleteUser(string id)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, "DELETE FROM vault_permissions WHERE user_id = @id;", new SqliteParameter("@id", id));
        Execute(connection, transaction, "DELETE FROM webdav_credentials WHERE user_id = @id;", new SqliteParameter("@id", id));
        Execute(connection, transaction, "DELETE FROM sessions WHERE user_id = @id;", new SqliteParameter("@id", id));
        Execute(connection, transaction, "DELETE FROM users WHERE id = @id;", new SqliteParameter("@id", id));
        transaction.Commit();
    }

    /// <summary>Inserts a session with its token hashes and lifetime metadata.</summary>
    /// <param name="session">The session including its owner, token hashes, and expiration.</param>
    public void CreateSession(SessionRecord session)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, last_seen_at, user_agent, ip_address)
            VALUES (@id, @userId, @tokenHash, @csrfToken, @createdAt, @expiresAt, @lastSeenAt, @userAgent, @ipAddress);
            """,
            new SqliteParameter("@id", session.Id),
            new SqliteParameter("@userId", session.UserId),
            new SqliteParameter("@tokenHash", session.TokenHash),
            new SqliteParameter("@csrfToken", session.CsrfToken),
            new SqliteParameter("@createdAt", session.CreatedAt.ToString("O")),
            new SqliteParameter("@expiresAt", session.ExpiresAt.ToString("O")),
            new SqliteParameter("@lastSeenAt", DbValue(session.LastSeenAt?.ToString("O"))),
            new SqliteParameter("@userAgent", DbValue(session.UserAgent)),
            new SqliteParameter("@ipAddress", DbValue(session.IpAddress)));
    }

    /// <summary>Loads the session and associated user for a matching token hash.</summary>
    /// <param name="tokenHash">The stored hash of the session token.</param>
    public SessionRecord? GetSessionByTokenHash(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT s.id, s.user_id, s.token_hash, s.csrf_token, s.created_at, s.expires_at, s.last_seen_at, s.user_agent, s.ip_address,
                   u.id, u.username, u.password_hash, u.role, u.disabled, u.created_at, u.last_login_at, u.auto_lock_minutes, u.email, u.show_favicons, u.clipboard_clear_seconds, u.check_breaches, u.language, u.email_verified_at, u.notify_sign_in, u.notify_app_password, u.mfa_totp_enabled_at, u.mfa_email_enabled_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = @tokenHash;
            """;
        command.Parameters.AddWithValue("@tokenHash", tokenHash);
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        var session = new SessionRecord
        {
            Id = reader.GetString(0),
            UserId = reader.GetString(1),
            TokenHash = reader.GetString(2),
            CsrfToken = reader.GetString(3),
            CreatedAt = ParseDate(reader.GetString(4)),
            ExpiresAt = ParseDate(reader.GetString(5)),
            LastSeenAt = reader.IsDBNull(6) ? null : ParseDate(reader.GetString(6)),
            UserAgent = reader.IsDBNull(7) ? null : reader.GetString(7),
            IpAddress = reader.IsDBNull(8) ? null : reader.GetString(8)
        };

        var user = ReadUser(reader, 9);
        return session with { User = user };
    }

    /// <summary>Updates the session's last-seen time and expiration.</summary>
    /// <param name="id">The database ID of the session to refresh.</param>
    /// <param name="lastSeenAt">The time of the most recent session activity.</param>
    /// <param name="expiresAt">The updated expiration time for the session.</param>
    public void TouchSession(string id, DateTimeOffset lastSeenAt, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE sessions SET last_seen_at = @lastSeenAt, expires_at = @expiresAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@lastSeenAt", lastSeenAt.ToString("O")),
            new SqliteParameter("@expiresAt", expiresAt.ToString("O")));
    }

    /// <summary>Removes the session identified by its token hash.</summary>
    /// <param name="tokenHash">The stored hash of the session token.</param>
    public void DeleteSessionByTokenHash(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM sessions WHERE token_hash = @tokenHash;", new SqliteParameter("@tokenHash", tokenHash));
    }

    /// <summary>Signs a user out everywhere by removing their sessions, optionally keeping one.</summary>
    /// <param name="userId">The user account ID.</param>
    /// <param name="keepSessionId">The ID of a session to keep, e.g. the caller's own, or null to remove all.</param>
    public void DeleteSessionsForUser(string userId, string? keepSessionId = null)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM sessions WHERE user_id = @userId AND id IS NOT @keep;",
            new SqliteParameter("@userId", userId),
            new SqliteParameter("@keep", (object?)keepSessionId ?? DBNull.Value));
    }

    /// <summary>Looks up a vault by ID, optionally including soft-deleted vaults.</summary>
    /// <param name="id">The vault file ID.</param>
    /// <param name="includeDeleted">Whether to include soft-deleted vaults.</param>
    public VaultFileRecord? GetVaultFile(string id, bool includeDeleted = false)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, stored_name, size, sha256, revision, etag, created_at, updated_at, deleted_at, created_by, updated_by
            FROM vault_files WHERE id = @id AND (@includeDeleted = 1 OR deleted_at IS NULL);
            """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@includeDeleted", includeDeleted ? 1 : 0);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadVaultFile(reader) : null;
    }

    /// <summary>Finds an active vault by its name.</summary>
    /// <param name="name">The proposed display filename for the vault, including its .kdbx extension.</param>
    public VaultFileRecord? GetVaultFileByName(string name)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, stored_name, size, sha256, revision, etag, created_at, updated_at, deleted_at, created_by, updated_by
            FROM vault_files WHERE name = @name COLLATE NOCASE AND deleted_at IS NULL;
            """;
        command.Parameters.AddWithValue("@name", name);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadVaultFile(reader) : null;
    }

    /// <summary>Lists active vaults visible to the user and includes their effective permissions.</summary>
    /// <param name="user">The user account associated with the operation.</param>
    public IReadOnlyList<VaultFileRecord> ListVaultFilesForUser(UserRecord user)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        if (user.Role == UserRole.Admin)
        {
            command.CommandText = """
                SELECT id, name, stored_name, size, sha256, revision, etag, created_at, updated_at, deleted_at, created_by, updated_by
                FROM vault_files WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;
                """;
            var adminFiles = new List<VaultFileRecord>();
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var file = ReadVaultFile(reader);
                file.Permission = "read-write";
                adminFiles.Add(file);
            }
            return adminFiles;
        }

        command.CommandText = """
            SELECT f.id, f.name, f.stored_name, f.size, f.sha256, f.revision, f.etag, f.created_at, f.updated_at, f.deleted_at, f.created_by, f.updated_by,
                   p.permission
            FROM vault_files f
            JOIN vault_permissions p ON p.file_id = f.id
            WHERE p.user_id = @userId AND f.deleted_at IS NULL
            ORDER BY f.name COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("@userId", user.Id);
        var files = new List<VaultFileRecord>();
        using var permissionReader = command.ExecuteReader();
        while (permissionReader.Read())
        {
            var file = ReadVaultFile(permissionReader);
            file.Permission = permissionReader.GetString(12) == nameof(VaultPermission.ReadWrite) ? "read-write" : "read";
            files.Add(file);
        }
        return files;
    }

    /// <summary>Lists vault metadata for administration, optionally including soft-deleted vaults.</summary>
    /// <param name="includeDeleted">Whether to include soft-deleted vaults.</param>
    public IReadOnlyList<VaultFileRecord> ListAllVaultFiles(bool includeDeleted)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, stored_name, size, sha256, revision, etag, created_at, updated_at, deleted_at, created_by, updated_by
            FROM vault_files
            WHERE @includeDeleted = 1 OR deleted_at IS NULL
            ORDER BY name COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("@includeDeleted", includeDeleted ? 1 : 0);
        var files = new List<VaultFileRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            files.Add(ReadVaultFile(reader));
        }
        return files;
    }

    /// <summary>Inserts the metadata for a vault stored on disk.</summary>
    /// <param name="file">The metadata of the vault file to operate on.</param>
    public void CreateVaultFile(VaultFileRecord file)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO vault_files (id, name, stored_name, size, sha256, revision, etag, created_at, updated_at, deleted_at, created_by, updated_by)
            VALUES (@id, @name, @storedName, @size, @sha256, @revision, @etag, @createdAt, @updatedAt, @deletedAt, @createdBy, @updatedBy);
            """,
            new SqliteParameter("@id", file.Id),
            new SqliteParameter("@name", file.Name),
            new SqliteParameter("@storedName", file.StoredName),
            new SqliteParameter("@size", file.Size),
            new SqliteParameter("@sha256", file.Sha256),
            new SqliteParameter("@revision", file.Revision),
            new SqliteParameter("@etag", file.ETag),
            new SqliteParameter("@createdAt", file.CreatedAt.ToString("O")),
            new SqliteParameter("@updatedAt", file.UpdatedAt.ToString("O")),
            new SqliteParameter("@deletedAt", DbValue(file.DeletedAt?.ToString("O"))),
            new SqliteParameter("@createdBy", DbValue(file.CreatedBy)),
            new SqliteParameter("@updatedBy", DbValue(file.UpdatedBy)));
    }

    /// <summary>Records a new content revision, including its size, checksum, ETag, and author.</summary>
    /// <param name="id">The vault file ID.</param>
    /// <param name="size">The encrypted file size in bytes.</param>
    /// <param name="sha256">The hexadecimal SHA-256 checksum of the encrypted bytes.</param>
    /// <param name="revision">The revision number of the file content.</param>
    /// <param name="etag">The entity tag identifying the file revision.</param>
    /// <param name="updatedBy">The ID of the user making the change, if known.</param>
    public void UpdateVaultFileContent(string id, long size, string sha256, long revision, string etag, string? updatedBy)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            UPDATE vault_files
            SET size = @size, sha256 = @sha256, revision = @revision, etag = @etag, updated_at = @updatedAt, updated_by = @updatedBy
            WHERE id = @id;
            """,
            new SqliteParameter("@id", id),
            new SqliteParameter("@size", size),
            new SqliteParameter("@sha256", sha256),
            new SqliteParameter("@revision", revision),
            new SqliteParameter("@etag", etag),
            new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToString("O")),
            new SqliteParameter("@updatedBy", DbValue(updatedBy)));
    }

    /// <summary>Changes the display name of a vault and records who renamed it.</summary>
    /// <param name="id">The vault file ID.</param>
    /// <param name="name">The proposed display filename for the vault, including its .kdbx extension.</param>
    /// <param name="updatedBy">The ID of the user making the change, if known.</param>
    public void RenameVaultFile(string id, string name, string? updatedBy)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            UPDATE vault_files SET name = @name, updated_at = @updatedAt, updated_by = @updatedBy WHERE id = @id;
            """,
            new SqliteParameter("@id", id),
            new SqliteParameter("@name", name),
            new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToString("O")),
            new SqliteParameter("@updatedBy", DbValue(updatedBy)));
    }

    /// <summary>Marks a vault as deleted without removing its stored file.</summary>
    /// <param name="id">The vault file ID.</param>
    public void SoftDeleteVaultFile(string id)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE vault_files SET deleted_at = @deletedAt WHERE id = @id AND deleted_at IS NULL;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@deletedAt", DateTimeOffset.UtcNow.ToString("O")));
    }

    /// <summary>Clears the deletion marker on a vault.</summary>
    /// <param name="id">The vault file ID.</param>
    public void RestoreVaultFile(string id)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE vault_files SET deleted_at = NULL, updated_at = @updatedAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToString("O")));
    }

    /// <summary>Looks up the explicit permission assigned to a user for a vault.</summary>
    /// <param name="userId">The ID of the user account.</param>
    /// <param name="fileId">The ID of the vault file.</param>
    public VaultPermissionRecord? GetPermission(string userId, string fileId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT file_id, user_id, permission, updated_at
            FROM vault_permissions WHERE file_id = @fileId AND user_id = @userId;
            """;
        command.Parameters.AddWithValue("@fileId", fileId);
        command.Parameters.AddWithValue("@userId", userId);
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? new VaultPermissionRecord
            {
                FileId = reader.GetString(0),
                UserId = reader.GetString(1),
                Permission = Enum.Parse<VaultPermission>(reader.GetString(2)),
                UpdatedAt = ParseDate(reader.GetString(3))
            }
            : null;
    }

    /// <summary>Lists the explicit grants for a vault with their usernames.</summary>
    /// <param name="fileId">The ID of the vault file.</param>
    public IReadOnlyList<VaultPermissionRecord> ListPermissionsForFile(string fileId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT p.file_id, p.user_id, p.permission, p.updated_at, u.username
            FROM vault_permissions p
            JOIN users u ON u.id = p.user_id
            WHERE p.file_id = @fileId
            ORDER BY u.username COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("@fileId", fileId);
        var permissions = new List<VaultPermissionRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            permissions.Add(new VaultPermissionRecord
            {
                FileId = reader.GetString(0),
                UserId = reader.GetString(1),
                Permission = Enum.Parse<VaultPermission>(reader.GetString(2)),
                UpdatedAt = ParseDate(reader.GetString(3)),
                Username = reader.GetString(4)
            });
        }
        return permissions;
    }

    /// <summary>Replaces a vault's entire access list in one transaction.</summary>
    /// <param name="fileId">The ID of the vault file.</param>
    /// <param name="permissions">The full set of user IDs and grants to store in place of the existing access list.</param>
    public void ReplacePermissionsForFile(string fileId, IEnumerable<(string UserId, VaultPermission Permission)> permissions)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, "DELETE FROM vault_permissions WHERE file_id = @fileId;", new SqliteParameter("@fileId", fileId));
        foreach (var (userId, permission) in permissions)
        {
            Execute(connection, transaction, """
                INSERT INTO vault_permissions (file_id, user_id, permission, updated_at)
                VALUES (@fileId, @userId, @permission, @updatedAt);
                """,
                new SqliteParameter("@fileId", fileId),
                new SqliteParameter("@userId", userId),
                new SqliteParameter("@permission", permission.ToString()),
                new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToString("O")));
        }
        transaction.Commit();
    }

    /// <summary>Finds a WebDAV credential by its WebDAV username and loads its owner.</summary>
    /// <param name="username">The WebDAV credential's login name.</param>
    public WebDavCredentialRecord? GetWebDavCredentialByUsername(string username)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.id, c.user_id, c.username, c.label, c.password_hash, c.created_at, c.last_used_at, c.revoked_at,
                   u.id, u.username, u.password_hash, u.role, u.disabled, u.created_at, u.last_login_at, u.auto_lock_minutes, u.email, u.show_favicons, u.clipboard_clear_seconds, u.check_breaches, u.language, u.email_verified_at, u.notify_sign_in, u.notify_app_password, u.mfa_totp_enabled_at, u.mfa_email_enabled_at
            FROM webdav_credentials c
            JOIN users u ON u.id = c.user_id
            WHERE c.username = @username COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("@username", username);
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        var credential = new WebDavCredentialRecord
        {
            Id = reader.GetString(0),
            UserId = reader.GetString(1),
            Username = reader.GetString(2),
            Label = reader.GetString(3),
            PasswordHash = reader.GetString(4),
            CreatedAt = ParseDate(reader.GetString(5)),
            LastUsedAt = reader.IsDBNull(6) ? null : ParseDate(reader.GetString(6)),
            RevokedAt = reader.IsDBNull(7) ? null : ParseDate(reader.GetString(7))
        };
        credential.User = ReadUser(reader, 8);
        return credential;
    }

    /// <summary>Lists WebDAV credentials and their usage and revocation metadata.</summary>
    public IReadOnlyList<WebDavCredentialRecord> ListWebDavCredentials()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.id, c.user_id, c.username, c.label, c.password_hash, c.created_at, c.last_used_at, c.revoked_at,
                   u.id, u.username, u.password_hash, u.role, u.disabled, u.created_at, u.last_login_at, u.auto_lock_minutes, u.email, u.show_favicons, u.clipboard_clear_seconds, u.check_breaches, u.language, u.email_verified_at, u.notify_sign_in, u.notify_app_password, u.mfa_totp_enabled_at, u.mfa_email_enabled_at
            FROM webdav_credentials c
            JOIN users u ON u.id = c.user_id
            ORDER BY c.created_at DESC;
            """;
        var credentials = new List<WebDavCredentialRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var credential = new WebDavCredentialRecord
            {
                Id = reader.GetString(0),
                UserId = reader.GetString(1),
                Username = reader.GetString(2),
                Label = reader.GetString(3),
                PasswordHash = reader.GetString(4),
                CreatedAt = ParseDate(reader.GetString(5)),
                LastUsedAt = reader.IsDBNull(6) ? null : ParseDate(reader.GetString(6)),
                RevokedAt = reader.IsDBNull(7) ? null : ParseDate(reader.GetString(7))
            };
            credential.User = ReadUser(reader, 8);
            credentials.Add(credential);
        }
        return credentials;
    }

    /// <summary>Inserts a WebDAV credential linked to its owner.</summary>
    /// <param name="credential">The WebDAV credential metadata.</param>
    public void CreateWebDavCredential(WebDavCredentialRecord credential)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO webdav_credentials (id, user_id, username, label, password_hash, created_at, last_used_at, revoked_at)
            VALUES (@id, @userId, @username, @label, @passwordHash, @createdAt, @lastUsedAt, @revokedAt);
            """,
            new SqliteParameter("@id", credential.Id),
            new SqliteParameter("@userId", credential.UserId),
            new SqliteParameter("@username", credential.Username),
            new SqliteParameter("@label", credential.Label),
            new SqliteParameter("@passwordHash", credential.PasswordHash),
            new SqliteParameter("@createdAt", credential.CreatedAt.ToString("O")),
            new SqliteParameter("@lastUsedAt", DbValue(credential.LastUsedAt?.ToString("O"))),
            new SqliteParameter("@revokedAt", DbValue(credential.RevokedAt?.ToString("O"))));
    }

    /// <summary>Marks a WebDAV credential as revoked at the specified time.</summary>
    /// <param name="id">The credential ID.</param>
    /// <param name="revokedAt">The time at which the credential is revoked.</param>
    public void RevokeWebDavCredential(string id, DateTimeOffset revokedAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE webdav_credentials SET revoked_at = @revokedAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@revokedAt", revokedAt.ToString("O")));
    }

    /// <summary>Records when a WebDAV credential was last used.</summary>
    /// <param name="id">The credential ID.</param>
    /// <param name="lastUsedAt">The time of the most recent successful use.</param>
    public void UpdateWebDavCredentialLastUsed(string id, DateTimeOffset lastUsedAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE webdav_credentials SET last_used_at = @lastUsedAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@lastUsedAt", lastUsedAt.ToString("O")));
    }

    /// <summary>Returns the ETag of the vault version last downloaded with a WebDAV credential, if any.</summary>
    /// <param name="credentialId">The ID of the WebDAV credential that downloaded the vault.</param>
    /// <param name="fileId">The ID of the vault file.</param>
    public string? GetWebDavReadETag(string credentialId, string fileId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT etag FROM webdav_read_state WHERE credential_id = @credentialId AND file_id = @fileId;";
        command.Parameters.AddWithValue("@credentialId", credentialId);
        command.Parameters.AddWithValue("@fileId", fileId);
        return command.ExecuteScalar() as string;
    }

    /// <summary>Records the ETag of the vault version a WebDAV credential last downloaded or wrote.</summary>
    /// <param name="credentialId">The ID of the WebDAV credential that holds this vault version.</param>
    /// <param name="fileId">The ID of the vault file.</param>
    /// <param name="etag">The entity tag of the vault version the client now holds.</param>
    public void SetWebDavReadETag(string credentialId, string fileId, string etag)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO webdav_read_state (credential_id, file_id, etag, updated_at)
            VALUES (@credentialId, @fileId, @etag, @updatedAt)
            ON CONFLICT(credential_id, file_id) DO UPDATE SET etag = excluded.etag, updated_at = excluded.updated_at;
            """,
            new SqliteParameter("@credentialId", credentialId),
            new SqliteParameter("@fileId", fileId),
            new SqliteParameter("@etag", etag),
            new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToString("O")));
    }

    /// <summary>The number of WebDAV request log entries kept; older entries are removed on insert.</summary>
    public const int WebDavRequestLogLimit = 5000;

    /// <summary>Appends a WebDAV request to the log and removes entries beyond the retention limit.</summary>
    /// <param name="entry">The request metadata to store; its ID is assigned by SQLite and ignored here.</param>
    public void AddWebDavRequestLog(WebDavRequestLogDto entry)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, """
            INSERT INTO webdav_request_log
                (occurred_at, method, path, status, credential, remote_ip, duration_ms, content_length, if_match, depth, destination, overwrite)
            VALUES
                (@occurredAt, @method, @path, @status, @credential, @remoteIp, @durationMs, @contentLength, @ifMatch, @depth, @destination, @overwrite);
            """,
            new SqliteParameter("@occurredAt", entry.OccurredAt.ToString("O")),
            new SqliteParameter("@method", entry.Method),
            new SqliteParameter("@path", entry.Path),
            new SqliteParameter("@status", entry.Status),
            new SqliteParameter("@credential", DbValue(entry.Credential)),
            new SqliteParameter("@remoteIp", DbValue(entry.RemoteIp)),
            new SqliteParameter("@durationMs", entry.DurationMs),
            new SqliteParameter("@contentLength", DbValue(entry.ContentLength)),
            new SqliteParameter("@ifMatch", entry.IfMatch ? 1 : 0),
            new SqliteParameter("@depth", DbValue(entry.Depth)),
            new SqliteParameter("@destination", DbValue(entry.Destination)),
            new SqliteParameter("@overwrite", DbValue(entry.Overwrite)));
        Execute(connection, transaction,
            "DELETE FROM webdav_request_log WHERE id <= (SELECT MAX(id) FROM webdav_request_log) - @limit;",
            new SqliteParameter("@limit", WebDavRequestLogLimit));
        transaction.Commit();
    }

    /// <summary>Lists the retained WebDAV request log entries, newest first.</summary>
    public IReadOnlyList<WebDavRequestLogDto> ListWebDavRequestLog()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, occurred_at, method, path, status, credential, remote_ip, duration_ms, content_length, if_match, depth, destination, overwrite
            FROM webdav_request_log ORDER BY id DESC;
            """;
        using var reader = command.ExecuteReader();
        var entries = new List<WebDavRequestLogDto>();
        while (reader.Read())
        {
            entries.Add(new WebDavRequestLogDto(
                reader.GetInt64(0),
                ParseDate(reader.GetString(1)),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetInt32(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.GetInt64(7),
                reader.IsDBNull(8) ? null : reader.GetInt64(8),
                reader.GetInt32(9) != 0,
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetString(12)));
        }
        return entries;
    }

    /// <summary>How long hourly sign-in counters are kept.</summary>
    public static readonly TimeSpan LoginCounterRetention = TimeSpan.FromDays(30);

    /// <summary>Returns the hourly UTC bucket key of a point in time, e.g. 2026-11-25T07.</summary>
    /// <param name="time">The point in time.</param>
    public static string LoginBucket(DateTimeOffset time)
        => time.UtcDateTime.ToString("yyyy-MM-dd'T'HH", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// Counts one sign-in attempt in the hourly bucket of its channel and outcome and removes buckets older than the
    /// retention. Only the count is stored: no user name, IP address or other personal data.
    /// </summary>
    /// <param name="channel">The admin console or the web vault.</param>
    /// <param name="success">Whether the sign-in created a session.</param>
    /// <param name="now">The time of the attempt.</param>
    public void RecordLogin(LoginChannel channel, bool success, DateTimeOffset now)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, """
            INSERT INTO login_counters (bucket, channel, outcome, count) VALUES (@bucket, @channel, @outcome, 1)
            ON CONFLICT(bucket, channel, outcome) DO UPDATE SET count = count + 1;
            """,
            new SqliteParameter("@bucket", LoginBucket(now)),
            new SqliteParameter("@channel", channel == LoginChannel.Admin ? "admin" : "vault"),
            new SqliteParameter("@outcome", success ? "success" : "failure"));
        Execute(connection, transaction, "DELETE FROM login_counters WHERE bucket < @cutoff;",
            new SqliteParameter("@cutoff", LoginBucket(now - LoginCounterRetention)));
        transaction.Commit();
    }

    /// <summary>
    /// Sums the sign-in counters for the last 24 hours (the current hour and the 23 before it) and the last 7 days
    /// (the current hour and the 167 before it).
    /// </summary>
    /// <param name="now">The current time.</param>
    public LoginStatsDto GetLoginStats(DateTimeOffset now)
    {
        using var connection = Open();
        connection.Open();
        var since = DateTimeOffset.UtcNow;
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT value FROM app_state WHERE key = 'login_stats_since';";
            if (command.ExecuteScalar() is string value)
            {
                since = ParseDate(value);
            }
        }

        /* Sums one channel's counters from a first bucket on.
         * <param name="channel">The channel key, admin or vault.</param>
         * <param name="from">The first bucket to include.</param>
         */
        LoginCounts Sum(string channel, string from)
        {
            using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT
                    COALESCE(SUM(CASE WHEN outcome = 'success' THEN count END), 0),
                    COALESCE(SUM(CASE WHEN outcome = 'failure' THEN count END), 0)
                FROM login_counters WHERE channel = @channel AND bucket >= @from AND bucket <= @to;
                """;
            command.Parameters.AddWithValue("@channel", channel);
            command.Parameters.AddWithValue("@from", from);
            command.Parameters.AddWithValue("@to", LoginBucket(now));
            using var reader = command.ExecuteReader();
            reader.Read();
            return new LoginCounts(reader.GetInt64(0), reader.GetInt64(1));
        }

        var day = LoginBucket(now - TimeSpan.FromHours(23));
        var week = LoginBucket(now - TimeSpan.FromHours(167));
        return new LoginStatsDto(since, Sum("admin", day), Sum("admin", week), Sum("vault", day), Sum("vault", week));
    }

    /// <summary>Reads the vault, account and WebDAV totals for the admin dashboard with aggregate queries.</summary>
    /// <param name="now">The current time, used for the 24-hour WebDAV window.</param>
    public DashboardCountsDto GetDashboardCounts(DateTimeOffset now)
    {
        using var connection = Open();
        connection.Open();

        /* Runs one aggregate query that returns a single number.
         * <param name="sql">The query.</param>
         */
        long Count(string sql)
        {
            using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Parameters.AddWithValue("@since", (now - TimeSpan.FromHours(24)).ToUniversalTime().ToString("O"));
            return Convert.ToInt64(command.ExecuteScalar() ?? 0L);
        }

        // Conflict copies are vault files named "<name>.conflict-<time>-<client>-<id>.kdbx" (VaultService.ConflictCopyName).
        const string conflict = "name LIKE '%.conflict-%'";
        DateTimeOffset? lastRequest = null;
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT occurred_at FROM webdav_request_log ORDER BY id DESC LIMIT 1;";
            if (command.ExecuteScalar() is string value)
            {
                lastRequest = ParseDate(value);
            }
        }

        return new DashboardCountsDto(
            Vaults: Count($"SELECT COUNT(*) FROM vault_files WHERE deleted_at IS NULL AND NOT {conflict};"),
            DeletedVaults: Count("SELECT COUNT(*) FROM vault_files WHERE deleted_at IS NOT NULL;"),
            ConflictCopies: Count($"SELECT COUNT(*) FROM vault_files WHERE deleted_at IS NULL AND {conflict};"),
            Users: Count("SELECT COUNT(*) FROM users WHERE role = 'User';"),
            DisabledUsers: Count("SELECT COUNT(*) FROM users WHERE role = 'User' AND disabled <> 0;"),
            Admins: Count("SELECT COUNT(*) FROM users WHERE role = 'Admin';"),
            DisabledAdmins: Count("SELECT COUNT(*) FROM users WHERE role = 'Admin' AND disabled <> 0;"),
            ActiveWebDavCredentials: Count("SELECT COUNT(*) FROM webdav_credentials WHERE revoked_at IS NULL;"),
            WebDavRequestsLast24Hours: Count("SELECT COUNT(*) FROM webdav_request_log WHERE occurred_at >= @since;"),
            // 401 is the normal sign-in prompt of Basic authentication that every KeePass app receives first, not an error.
            WebDavErrorsLast24Hours: Count("SELECT COUNT(*) FROM webdav_request_log WHERE occurred_at >= @since AND status >= 400 AND status <> 401;"),
            WebDavStaleWritesLast24Hours: Count("SELECT COUNT(*) FROM webdav_request_log WHERE occurred_at >= @since AND status = 412;"),
            LastWebDavRequestAt: lastRequest);
    }

    /// <summary>Checks whether a WebDAV username is already in use.</summary>
    /// <param name="username">The WebDAV credential's login name.</param>
    public bool WebDavUsernameExists(string username)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM webdav_credentials WHERE username = @username COLLATE NOCASE;";
        command.Parameters.AddWithValue("@username", username);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    /// <summary>Converts a null reference to the sentinel used for SQL NULL values.</summary>
    /// <param name="value">A parameter value that may be null before conversion to SQLite's null sentinel.</param>
    private static object DbValue(object? value) => value ?? DBNull.Value;

    /// <summary>Creates an unopened SQLite connection with the configured connection string.</summary>
    private SqliteConnection Open() => new(_connectionString);

    /// <summary>Executes a parameterized SQL command on an open connection.</summary>
    /// <param name="connection">The open SQLite connection on which to execute the command.</param>
    /// <param name="sql">The SQL command text with placeholders for bound values.</param>
    /// <param name="parameters">The values to bind to the SQL command placeholders.</param>
    private static void Execute(SqliteConnection connection, string sql, params SqliteParameter[] parameters)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddRange(parameters);
        command.ExecuteNonQuery();
    }

    /// <summary>Executes a parameterized SQL command within the supplied transaction.</summary>
    /// <param name="connection">The open SQLite connection on which to execute the command.</param>
    /// <param name="transaction">The active SQLite transaction for the command.</param>
    /// <param name="sql">The SQL command text with placeholders for bound values.</param>
    /// <param name="parameters">The values to bind to the SQL command placeholders.</param>
    private static void Execute(SqliteConnection connection, SqliteTransaction transaction, string sql, params SqliteParameter[] parameters)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        command.Parameters.AddRange(parameters);
        command.ExecuteNonQuery();
    }

    /// <summary>Reads a user from the current row starting at the specified column offset.</summary>
    /// <param name="reader">The reader positioned on the row to decode.</param>
    /// <param name="offset">The index of the first user column within the current row.</param>
    private static UserRecord ReadUser(SqliteDataReader reader, int offset = 0)
    {
        return new UserRecord
        {
            Id = reader.GetString(offset),
            Username = reader.GetString(offset + 1),
            PasswordHash = reader.GetString(offset + 2),
            Role = Enum.Parse<UserRole>(reader.GetString(offset + 3)),
            Disabled = reader.GetInt32(offset + 4) != 0,
            CreatedAt = ParseDate(reader.GetString(offset + 5)),
            LastLoginAt = reader.IsDBNull(offset + 6) ? null : ParseDate(reader.GetString(offset + 6)),
            AutoLockMinutes = reader.IsDBNull(offset + 7) ? null : reader.GetInt32(offset + 7),
            Email = reader.IsDBNull(offset + 8) ? null : reader.GetString(offset + 8),
            ShowFavicons = !reader.IsDBNull(offset + 9) && reader.GetInt32(offset + 9) != 0,
            ClipboardClearSeconds = reader.IsDBNull(offset + 10) ? null : reader.GetInt32(offset + 10),
            CheckBreaches = !reader.IsDBNull(offset + 11) && reader.GetInt32(offset + 11) != 0,
            Language = reader.IsDBNull(offset + 12) ? null : reader.GetString(offset + 12),
            EmailVerifiedAt = reader.IsDBNull(offset + 13) ? null : ParseDate(reader.GetString(offset + 13)),
            NotifySignIn = reader.IsDBNull(offset + 14) || reader.GetInt32(offset + 14) != 0,
            NotifyAppPassword = reader.IsDBNull(offset + 15) || reader.GetInt32(offset + 15) != 0,
            MfaTotpEnabledAt = reader.IsDBNull(offset + 16) ? null : ParseDate(reader.GetString(offset + 16)),
            MfaEmailEnabledAt = reader.IsDBNull(offset + 17) ? null : ParseDate(reader.GetString(offset + 17))
        };
    }

    /// <summary>Reads vault metadata from the current SQLite row.</summary>
    /// <param name="reader">The reader positioned on the row to decode.</param>
    private static VaultFileRecord ReadVaultFile(SqliteDataReader reader)
    {
        return new VaultFileRecord
        {
            Id = reader.GetString(0),
            Name = reader.GetString(1),
            StoredName = reader.GetString(2),
            Size = reader.GetInt64(3),
            Sha256 = reader.GetString(4),
            Revision = reader.GetInt64(5),
            ETag = reader.GetString(6),
            CreatedAt = ParseDate(reader.GetString(7)),
            UpdatedAt = ParseDate(reader.GetString(8)),
            DeletedAt = reader.IsDBNull(9) ? null : ParseDate(reader.GetString(9)),
            CreatedBy = reader.IsDBNull(10) ? null : reader.GetString(10),
            UpdatedBy = reader.IsDBNull(11) ? null : reader.GetString(11)
        };
    }

    /// <summary>Parses a persisted timestamp using round-trip date semantics.</summary>
    /// <param name="value">The serialized timestamp read from SQLite.</param>
    private static DateTimeOffset ParseDate(string value) => DateTimeOffset.Parse(value, null, System.Globalization.DateTimeStyles.RoundtripKind);

    /// <summary>Encodes bytes as unpadded URL-safe Base64.</summary>
    /// <param name="bytes">The raw bytes to encode as Base64URL.</param>
    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Decodes unpadded URL-safe Base64 after restoring standard padding.</summary>
    /// <param name="value">The unpadded Base64URL text to decode.</param>
    public static byte[] Base64UrlDecode(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        var padding = (4 - base64.Length % 4) % 4;
        return Convert.FromBase64String(base64 + new string('=', padding));
    }

    /// <summary>Completes disposal; per-operation connections have no shared resources to release.</summary>
    public void Dispose()
    {
        // SQLite connections are opened per operation.
    }
}
