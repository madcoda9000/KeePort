using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

public sealed class KeePortDb : IDisposable
{
    private readonly string _connectionString;

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
            """);

        EnsureColumn("users", "auto_lock_minutes", "INTEGER NULL");
        EnsureColumn("users", "email", "TEXT NULL");
        EnsureSetupToken();
    }

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

    public bool HasAdmin()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM users WHERE role = 'Admin';";
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    public string? GetSetupToken()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM app_state WHERE key = 'setup_token';";
        return command.ExecuteScalar() as string;
    }

    public void ClearSetupToken()
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM app_state WHERE key = 'setup_token';");
    }

    public UserRecord? GetUserByUsername(string username)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, username, password_hash, role, disabled, created_at, last_login_at, auto_lock_minutes, email
            FROM users WHERE username = @username COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("@username", username);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadUser(reader) : null;
    }

    public UserRecord? GetUserById(string id)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, username, password_hash, role, disabled, created_at, last_login_at, auto_lock_minutes, email
            FROM users WHERE id = @id;
            """;
        command.Parameters.AddWithValue("@id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadUser(reader) : null;
    }

    public IReadOnlyList<UserRecord> ListUsers()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, username, password_hash, role, disabled, created_at, last_login_at, auto_lock_minutes, email
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

    public void UpdateUserPassword(string id, string passwordHash)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET password_hash = @passwordHash WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@passwordHash", passwordHash));
    }

    /// <summary>Stores the validated contact email for one account.</summary>
    public void UpdateUserEmail(string id, string email)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET email = @email WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@email", email));
    }

    public void UpdateUserAutoLockMinutes(string id, int? autoLockMinutes)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET auto_lock_minutes = @autoLockMinutes WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@autoLockMinutes", DbValue(autoLockMinutes)));
    }

    public void UpdateLastLogin(string id, DateTimeOffset lastLoginAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET last_login_at = @lastLoginAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@lastLoginAt", lastLoginAt.ToString("O")));
    }

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

    public SessionRecord? GetSessionByTokenHash(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT s.id, s.user_id, s.token_hash, s.csrf_token, s.created_at, s.expires_at, s.last_seen_at, s.user_agent, s.ip_address,
                   u.id, u.username, u.password_hash, u.role, u.disabled, u.created_at, u.last_login_at, u.auto_lock_minutes, u.email
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

    public void TouchSession(string id, DateTimeOffset lastSeenAt, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE sessions SET last_seen_at = @lastSeenAt, expires_at = @expiresAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@lastSeenAt", lastSeenAt.ToString("O")),
            new SqliteParameter("@expiresAt", expiresAt.ToString("O")));
    }

    public void DeleteSessionByTokenHash(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM sessions WHERE token_hash = @tokenHash;", new SqliteParameter("@tokenHash", tokenHash));
    }

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

    public void SoftDeleteVaultFile(string id)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE vault_files SET deleted_at = @deletedAt WHERE id = @id AND deleted_at IS NULL;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@deletedAt", DateTimeOffset.UtcNow.ToString("O")));
    }

    public void RestoreVaultFile(string id)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE vault_files SET deleted_at = NULL, updated_at = @updatedAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToString("O")));
    }

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

    public WebDavCredentialRecord? GetWebDavCredentialByUsername(string username)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.id, c.user_id, c.username, c.label, c.password_hash, c.created_at, c.last_used_at, c.revoked_at,
                   u.id, u.username, u.password_hash, u.role, u.disabled, u.created_at, u.last_login_at, u.auto_lock_minutes, u.email
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

    public IReadOnlyList<WebDavCredentialRecord> ListWebDavCredentials()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.id, c.user_id, c.username, c.label, c.password_hash, c.created_at, c.last_used_at, c.revoked_at,
                   u.id, u.username, u.password_hash, u.role, u.disabled, u.created_at, u.last_login_at, u.auto_lock_minutes, u.email
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

    public void RevokeWebDavCredential(string id, DateTimeOffset revokedAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE webdav_credentials SET revoked_at = @revokedAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@revokedAt", revokedAt.ToString("O")));
    }

    public void UpdateWebDavCredentialLastUsed(string id, DateTimeOffset lastUsedAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE webdav_credentials SET last_used_at = @lastUsedAt WHERE id = @id;",
            new SqliteParameter("@id", id),
            new SqliteParameter("@lastUsedAt", lastUsedAt.ToString("O")));
    }

    public bool WebDavUsernameExists(string username)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM webdav_credentials WHERE username = @username COLLATE NOCASE;";
        command.Parameters.AddWithValue("@username", username);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    private static object DbValue(object? value) => value ?? DBNull.Value;

    private SqliteConnection Open() => new(_connectionString);

    private static void Execute(SqliteConnection connection, string sql, params SqliteParameter[] parameters)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddRange(parameters);
        command.ExecuteNonQuery();
    }

    private static void Execute(SqliteConnection connection, SqliteTransaction transaction, string sql, params SqliteParameter[] parameters)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        command.Parameters.AddRange(parameters);
        command.ExecuteNonQuery();
    }

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
            Email = reader.IsDBNull(offset + 8) ? null : reader.GetString(offset + 8)
        };
    }

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

    private static DateTimeOffset ParseDate(string value) => DateTimeOffset.Parse(value, null, System.Globalization.DateTimeStyles.RoundtripKind);

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] Base64UrlDecode(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        var padding = (4 - base64.Length % 4) % 4;
        return Convert.FromBase64String(base64 + new string('=', padding));
    }

    public void Dispose()
    {
        // SQLite connections are opened per operation.
    }
}
