# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-24

### Added

- `KEEPORT_TRUSTED_PROXIES` lists reverse proxies (IPs or CIDR networks) whose `X-Forwarded-For` and `X-Forwarded-Proto` KeePort accepts, in addition to loopback. Behind the Synology or QNAP reverse proxy, Caddy or nginx, rate limits, WebDAV logs and sessions then use each device's own address instead of the proxy's. Without the setting, behavior is unchanged.
- Startup log line listing the trusted proxies, and a warning (at most once per sender and hour) when `X-Forwarded-For` arrives from an address that is not trusted, naming the address to add.
- Deployment guide section "Trust your reverse proxy" with the steps for every platform.

### Changed

- Client addresses are formatted the same way everywhere: IPv4 clients of dual-stack sockets count as plain IPv4 (`192.168.1.5`, not `::ffff:192.168.1.5`) in rate limits, sessions and WebDAV logs.
- The deployment guide, README and `.env.example` explain what `KEEPORT_ADMIN_BIND=0.0.0.0` means: the admin console becomes reachable on every network of the host, and Docker port publishing bypasses host firewalls.

### Security

- Catch-all proxy entries (`0.0.0.0/0`, `::/0`) and invalid entries stop KeePort at startup instead of being ignored, so client addresses cannot be spoofed through an overly broad configuration.

## [0.1.1] - 2026-11-24

### Added

- Step-by-step deployment guides for Synology DSM (SSH or Container Manager, DSM reverse proxy, Hyper Backup) and QNAP QTS / QuTS hero (Container Station, QTS reverse proxy, Hybrid Backup Sync), next to the Caddy and nginx setups for Linux servers.
- `KEEPORT_HTTP_HOST_PORT` sets the host port of the web vault and WebDAV (default `8080`), for example to avoid the QTS web interface on QNAP.
- `KEEPORT_DATA` selects where data is kept: the Docker volume `keeport-data` (default, unchanged for existing installations) or a folder path that NAS backup tools can include.

### Changed

- Rewrote the deployment guide with a platform chooser, architecture diagram, configuration reference, update and backup steps per platform, and a troubleshooting table. It also documents that KeePort sees a reverse proxy's address for all clients unless the proxy runs on `127.0.0.1`.

- Rewrote the README with an overview, feature table, screenshots in light and dark theme (fictional demo data, `docs/images/`), architecture diagram, verified client list, configuration reference and update instructions.
- The quickstart in the README and deployment guide clones a release tag (`--branch v0.1.0`) instead of the development branch.

### Fixed

- TOTP entries saved in the web vault now appear as TOTP in KeePass2Android and KeePassXC. A raw Base32 secret is stored in the `otp` field as `otpauth://totp/<title>?secret=…&period=30&digits=6` (protected), and the `otpauth://totp/` prefix is lowercased. Previously the bare secret was stored and KeePass2Android only showed it as a plain text field. Existing entries are converted the next time they are saved in the web vault. An empty TOTP setting no longer leaves an empty `otp` field.
- WebDAV logs table: long paths and `Destination` values are truncated again, so the table no longer overflows its card and hides the Duration column on narrower screens.
- Quickstart used `cd keeport` although the clone directory is `KeePort`; the deployment guide still pointed to a placeholder repository URL.
- Local development instructions set a writable data directory (`.data/`, ignored by Git); the default `/data` is meant for the container.

## [0.1.0] - 2026-11-24

First beta release.

### Added

- Self-hosted KeePort backend with SQLite metadata and filesystem vault storage.
- Vault webclient with browser-only KDBX unlock/edit/save, dark/light mode, search, and auto-lock on tab hide.
- Admin console for first-run setup, users, vault files, ACLs, restore, and WebDAV credentials.
- KeePass KDBX compatibility through `kdbxweb` and `argon2-browser`, including KDBX 3.1/4 and optional key files.
- Role model with `Admin` and `User`, per-file `read` / `read-write` ACLs enforced across REST, Vault UI, and WebDAV.
- REST API for vault metadata/content sync with ETag preconditions and atomic writes.
- WebDAV endpoint supporting `OPTIONS`, `PROPFIND`, `GET`, `PUT`, `HEAD`, `MOVE`, `LOCK`, and `UNLOCK` for existing permitted files.
- First-run one-time setup token, Argon2id password hashing, session cookies, CSRF protection, and auth rate limiting.
- Docker image, `docker-compose.yml`, deployment guide, and integration tests for roles/ACLs, ETag conflicts, and atomic writes.
- WebDAV saves from KeePass2Android: transactional uploads to `<vault>.kdbx.tmp.<suffix>` or `<vault>_tmp_<suffix>.kdbx` are staged per app password and applied with `MOVE` onto exactly that vault. Without `If-Match`, writes are checked against the version the app password last downloaded, so stale saves still become conflict copies instead of overwriting.
- Verified WebDAV clients on devices: KeePass2Android on Android (save, sync, merge) and KeePassium on iOS (edit and sync).
- Admin console: **Logs → WebDAV logs** page listing the latest 5,000 WebDAV requests (time, method, path, status, credential, client IP, precondition and move headers, size, duration) with live search, column sorting, paging and refresh. Requests are also written to the container log. Passwords and file contents are never logged.
- Stale REST and WebDAV writes preserve the submitted encrypted KDBX as an admin-only conflict copy without overwriting the original.
- KDBX signature validation on vault upload and content writes (admin upload, REST, WebDAV): files without the KDBX magic bytes are rejected with `400 Bad Request`.
- Vault entry attachments: show names and sizes, download locally, and add files up to 10 MiB or confirm removal in read-write vaults. Attachment changes save with the encrypted KDBX revision.
- Vault webclient: TOTP support — entries can store an `otpauth://` URI or base32 secret in the `otp` field; the current code with countdown and copy button is shown live in the entry detail (browser-only, secret never leaves the client).
- Copy the TOTP provisioning URI from the entry detail, including for entries with a raw Base32 secret.
- Vault webclient: "Add entry" button and create-entry flow for read-write vaults (entries are added to the first KDBX group and saved with the usual ETag precondition).
- Live search, column-header sorting, and pagination in the Admin vault files, accounts, WebDAV credentials and WebDAV logs tables and the Vault entries table. Choose 10 (default), 20, or 50 rows per page.
- Admin sidebar profile with initials, username, email and controls to change the signed-in administrator's email and password.
- User creation in the Admin console requires a valid email address. Users can add or change their email in their Vault profile; existing accounts without an email are not affected.
- User profile: per-user auto-lock timeout (default 5 minutes, adjustable 1–1440) and self-service password change via new `POST /api/auth/change-password` and `PUT /api/auth/settings` endpoints.
- Documentation for the planned browser-extension basis (`KeePort:CorsOrigins` + token approach) in the README.

### Changed

- Vault and Admin now use shadcn/ui with split sign-in screens, responsive sidebar navigation and a saved light/dark preference. The Vault shows a searchable entry table with a detail sheet and account settings dialog; Admin uses the same layout for vault files, users, WebDAV credentials and permissions.
- Configure login and WebDAV rate limits in the Admin console instead of environment variables. Values are persisted in SQLite and apply immediately.
- First-run admin setup requires a valid email address. Existing administrators can add an address in their profile.
- The Vault profile button is now in the sidebar footer with the signed-in user's name, email address and initials.
- Vault webclient: auto-lock on tab hide now waits 5 minutes instead of locking immediately, so switching tabs no longer discards the unlocked vault right away.
- WebDAV `MOVE` on a vault itself is rejected with `403`; vaults are still renamed in the Admin console only.
- Documented that WebDAV `LOCK` tokens are not persisted and `UNLOCK` does not release a server-side lock; clients should use ETags for conflict protection.
- Completed function and method documentation across the API, frontends, shared table code, and tests, including descriptions of each parameter.
- API endpoints no longer use redundant `async` signatures (CS1998 warnings eliminated); README clone URL updated to the real repository.

### Removed

- Dead `getFile()` client method in the vault webclient (called a non-existent backend endpoint).

### Fixed

- Fixed KDBX compatibility with other KeePass clients by correcting Argon2 memory handling. New vaults use Argon2id with 64 MiB of memory and three passes. Vaults created with the incorrect Argon2 settings need to be recreated or recovered using the previous KeePort version.
- WebDAV logs show IPv4 clients as plain IPv4 (`192.168.2.79`) instead of the IPv6-mapped form (`::ffff:192.168.2.79`).
- The Vault and Admin sidebars now align their headers with their respective workspaces.

### Security

- Login and setup share a configurable per-IP rate limit; session checks and sign-out are exempt. WebDAV has a separate configurable limit applied before authentication.
- Admin accounts can only sign in to the Admin console; Vault and WebDAV require a separate user account. Admin sessions are scoped to the Admin API, so existing admins need to sign in again after updating.

[0.2.0]: https://github.com/madcoda9000/KeePort/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/madcoda9000/KeePort/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/madcoda9000/KeePort/releases/tag/v0.1.0
