# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Admin console: new **Logs → WebDAV logs** page listing the latest 5,000 WebDAV requests (time, method, path, status, credential, client IP, precondition and move headers, size, duration) with live search, column sorting, paging and refresh. Passwords and file contents are never logged.

- WebDAV saves from KeePass2Android: transactional uploads to `<vault>.kdbx.tmp.<suffix>` or `<vault>_tmp_<suffix>.kdbx` are staged per app password and applied with `MOVE` onto exactly that vault. Without `If-Match`, writes are checked against the version the app password last downloaded, so stale saves still become conflict copies instead of overwriting.

- Vault entry attachments: show names and sizes, download locally, and add files up to 10 MiB or confirm removal in read-write vaults. Attachment changes save with the encrypted KDBX revision.
- Copy the TOTP provisioning URI from the entry detail, including for entries with a raw Base32 secret.
- Live search, column-header sorting, and pagination in the Admin vault files, accounts, and WebDAV credentials tables and the Vault entries table. Choose 10 (default), 20, or 50 rows per page.
- Stale REST and WebDAV writes preserve the submitted encrypted KDBX as an admin-only conflict copy without overwriting the original.
- Admin sidebar profile with initials, username, email and controls to change the signed-in administrator's email and password.
- User creation in the Admin console requires a valid email address. Users can add or change their email in their Vault profile; existing accounts without an email are not affected.
- Vault webclient: "Add entry" button and create-entry flow for read-write vaults (entries are added to the first KDBX group and saved with the usual ETag precondition).
- KDBX signature validation on vault upload and content writes (admin upload, REST, WebDAV): files without the KDBX magic bytes are rejected with `400 Bad Request`.
- Documentation for the planned browser-extension basis (`KeePort:CorsOrigins` + token approach) in the README.
- Vault webclient: TOTP support — entries can store an `otpauth://` URI or base32 secret in the `otp` field; the current code with countdown and copy button is shown live in the entry detail (browser-only, secret never leaves the client).
- User profile: per-user auto-lock timeout (default 5 minutes, adjustable 1–1440) and self-service password change via new `POST /api/auth/change-password` and `PUT /api/auth/settings` endpoints.

### Changed

- Marked vault attachment management as accepted in the hardening plan; mobile WebDAV verification and first-release steps remain open.
- Documented how to reload a vault from WebDAV in KeePass2Android without database caching and why saves from this client fail.
- WebDAV requests are logged to the console and stored in SQLite with method, path, status and precondition headers (never passwords or file content) to diagnose client compatibility.
- WebDAV logs show IPv4 clients as plain IPv4 (`192.168.2.79`) instead of the IPv6-mapped form (`::ffff:192.168.2.79`).
- Marked WebDAV client compatibility as accepted on devices: KeePass2Android (save, sync, merge) and KeePassium on iOS (edit and sync).
- WebDAV `OPTIONS` lists `MOVE`. `MOVE` on a vault itself is rejected with `403`; vaults are still renamed in the Admin console only.
- Completed function and method documentation across the API, frontends, shared table code, and tests, including descriptions of each parameter.
- Configure login and WebDAV rate limits in the Admin console instead of environment variables. Values are persisted in SQLite and apply immediately.
- Documented that WebDAV `LOCK` tokens are not persisted and `UNLOCK` does not release a server-side lock; clients should use ETags for conflict protection.
- First-run admin setup requires a valid email address. Existing administrators can add an address in their profile.
- The Vault profile button is now in the sidebar footer with the signed-in user's name, email address and initials.
- Vault and Admin now use shadcn/ui with split sign-in screens, responsive sidebar navigation and a saved light/dark preference. The Vault shows a searchable entry table with a detail sheet and account settings dialog; Admin uses the same layout for vault files, users, WebDAV credentials and permissions.
- Vault webclient: auto-lock on tab hide now waits 5 minutes instead of locking immediately, so switching tabs no longer discards the unlocked vault right away.
- API endpoints no longer use redundant `async` signatures (CS1998 warnings eliminated); README clone URL updated to the real repository.

### Removed

- Dead `getFile()` client method in the vault webclient (called a non-existent backend endpoint).

### Fixed

- Fixed KDBX compatibility with other KeePass clients by correcting Argon2 memory handling. New vaults use Argon2id with 64 MiB of memory and three passes. Vaults created with the incorrect Argon2 settings need to be recreated or recovered using the previous KeePort version.
- The Vault and Admin sidebars now align their headers with their respective workspaces.

### Security

- Login and setup share a configurable per-IP rate limit; session checks and sign-out are exempt. WebDAV has a separate configurable limit applied before authentication.
- Admin accounts can only sign in to the Admin console; Vault and WebDAV require a separate user account. Admin sessions are scoped to the Admin API, so existing admins need to sign in again after updating.

## [0.1.0] - 2026-11-23

### Added

- Self-hosted KeePort backend with SQLite metadata and filesystem vault storage.
- Vault webclient with browser-only KDBX unlock/edit/save, dark/light mode, search, and auto-lock on tab hide.
- Admin console for first-run setup, users, vault files, ACLs, restore, and WebDAV credentials.
- KeePass KDBX compatibility through `kdbxweb` and `argon2-browser`, including KDBX 3.1/4 and optional key files.
- Role model with `Admin` and `User`, per-file `read` / `read-write` ACLs enforced across REST, Vault UI, and WebDAV.
- REST API for vault metadata/content sync with ETag preconditions and atomic writes.
- WebDAV endpoint supporting `OPTIONS`, `PROPFIND`, `GET`, `PUT`, `HEAD`, `LOCK`, and `UNLOCK` for existing permitted files.
- First-run one-time setup token, Argon2id password hashing, session cookies, CSRF protection, and auth rate limiting.
- Docker image, `docker-compose.yml`, deployment guide, and integration tests for roles/ACLs, ETag conflicts, and atomic writes.
