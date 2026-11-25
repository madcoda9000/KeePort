# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2026-11-25

### Added

- **Admin dashboard.** The admin console now opens on a dashboard that shows at a glance:
  - Whether KeePort runs, plus its uptime, version, .NET and operating system.
  - The container's IP addresses and ports, admin HTTPS with the certificate's fingerprint and expiry, and the trusted proxies.
  - Where the data is stored.
  - The number of vaults, deleted vaults and conflict copies, and of user and admin accounts (with disabled ones) and active WebDAV app passwords.
  - Successful and failed sign-ins to the admin console and the web vault in the last 24 hours and 7 days.
  - WebDAV requests, errors and rejected outdated saves in the last 24 hours.
  - A "Needs attention" box points to conflict copies, data outside a host folder, an expiring admin certificate and failed admin sign-ins.
  - Values that could not be read show "Not available", never zero.
- KeePort counts sign-ins per hour. It stores no names, IP addresses or passwords and keeps the counts for 30 days. Rate-limited requests are not counted.
- `GET /api/admin/dashboard` provides the data to administrators.

## [0.9.0] - 2026-11-25

### Added

- **Additional fields** in the web vault. Entries show all their custom fields, e.g. the card number, CVV and PIN of a KeePass2Android credit card or the "Additional attributes" of KeePassXC. Protected fields are masked with show and copy buttons. Users with read-write access edit them, add new fields (optionally protected) and remove fields. The search covers unprotected custom fields.
- **KeePass2Android templates.** Entries created from a template (credit card, ID card, Wi-Fi, membership, …) show the template's fields in the template's order and hide empty standard fields the template does not use ("Show all fields" brings them back). A badge with the template name appears in the table. Fields a template defines as protected stay protected even while they are empty.
- **New entries from templates:** the arrow next to "Add entry" lists the vault's templates. The new entry is linked to its template and gets its icon and fields, exactly as KeePass2Android creates it.
- **Expiry date** for every entry ("Expires"), stored as the KeePass expiry date that KeePass2Android, KeePassium and KeePassXC show.
- Template entries in the templates folder open read-only, with a hint to edit them in KeePass2Android.

### Fixed

- After saving in the web vault, locking and unlocking the same vault again opened it read-only until the page was reloaded, because the save response reported the permission as `none`. The API now returns the caller's real permission, and the web vault keeps the permission from the file list.

## [0.8.0] - 2026-11-25

### Added

- **Reload** button in the web vault next to "Lock vault". It loads the latest version of the open vault from the server, e.g. after KeePass2Android or KeePassium synced a change, without entering the master password again. The selected folder stays selected. If nothing changed, KeePort says the vault is already up to date. If the file now uses a different master password or key file, the open vault stays as it is and KeePort asks you to lock and unlock it.

## [0.7.2] - 2026-11-25

### Fixed

- Creating or renaming a folder in the web vault briefly showed "A folder named … already exists here" while saving, although the folder was created correctly. The dialog now closes as soon as the change is saved, and the name is no longer checked against the vault that already contains it. The move dialog closes the same way.

## [0.7.1] - 2026-11-25

### Changed

- "All entries", its count and the search in the web vault leave out entry templates (e.g. KeePass2Android's "Templates" folder) and entries in the recycle bin, as KeePass apps do. They are still listed when you select the templates folder or the recycle bin.

## [0.7.0] - 2026-11-25

### Added

- **Folders in the web vault.** While a vault is unlocked, its folder tree (KDBX groups) appears in the sidebar below "Shared vaults", with the number of entries per folder. Selecting a folder shows its own entries; "All entries" shows every entry, and the search always covers all folders.
- Users with read-write access create folders and subfolders, rename them and delete empty ones. Deleted folders are recorded as deleted objects, so KeePass apps remove them when they sync instead of bringing them back.
- Select several entries with the new checkboxes (also "select all" per page or all results) and move them to another folder with **Move to…**. KeePass apps take over the new location when they merge.
- The recycle bin is shown as a protected folder at the end of the tree; entries can be moved out of it to restore them. The templates folder (e.g. KeePass2Android's) gets its own icon.
- **Add entry** creates the entry in the selected folder instead of always in the root folder.

### Changed

- The vault that is currently unlocked is highlighted in green with an open lock in the "Shared vaults" list.
- If saving a folder change or a move fails (e.g. because another app saved the vault in the meantime), the vault is reloaded from the last saved version, so the browser never shows changes that are not on the server.

## [0.6.1] - 2026-11-24

### Fixed

- After an update, browsers kept showing the previous web vault and admin console (e.g. the old version badge) until a hard reload, because `index.html` was served without caching instructions. Entry pages are now sent with `Cache-Control: no-cache`, so a new release appears on the next page load; content-hashed files under `assets/` are cached for a year.
- The data storage card and the Synology guide show the real path format on DSM (`/@syno/docker/keeport-data` for `/volume1/docker/keeport-data`) instead of a shortened example.

## [0.6.0] - 2026-11-24

### Added

- KeePort detects where its data is stored — a host folder, a Docker volume, or not mounted — and shows it in **Admin → Settings → Data storage**. While the data is in a Docker volume (NAS backup tools such as Hyper Backup don't include it) or not mounted at all (lost when the container is recreated), the admin console shows a warning banner on every page and the container log warns on every start.
- `scripts/keeport-update.sh` updates a Synology, QNAP or other Docker installation to the latest or a given release: it backs up the data, keeps `.env` and data, rebuilds and waits for the container to become healthy, restores the previous version automatically if that fails, and warns when the data is in a Docker volume.
- Deployment guide: "Move data from the Docker volume to a folder", a data storage check after installation, and the update script as the recommended way to update a NAS.

### Changed

- The deployment guide recommends an absolute path for `KEEPORT_DATA`; a relative path like `./keeport-data` ends up inside the KeePort folder.

## [0.5.0] - 2026-11-24

### Added

- The admin console is served over **HTTPS with a self-signed certificate** by default, so creating vaults works in the browser without a reverse proxy, SSH tunnel or hosts entry. KeePort creates the certificate on first start (`/data/tls/admin.pfx`, ECDSA P-256, valid 5 years, renewed automatically) and logs its SHA-256 fingerprint. Browsers warn once; accept the certificate.
- `KEEPORT_ADMIN_HTTPS` (default `true`) turns this off when a reverse proxy terminates TLS, and `KEEPORT_ADMIN_TLS_HOSTS` adds names or IPs to the certificate.
- The web vault's sign-in page warns when it is opened over plain `http://` with an IP or host name, because unlocking vaults needs HTTPS.

### Changed

- **`KEEPORT_ADMIN_BIND` defaults to `0.0.0.0`**, so the admin console is reachable in the LAN at `https://<host>:8081/admin`. Never forward the admin port or publish it through a reverse proxy; on a server with a public IP set `KEEPORT_ADMIN_BIND=127.0.0.1`. Existing `.env` files keep their value.
- **Open the admin console with `https://`.** Plain `http://` to the admin port no longer works. A reverse proxy that forwards to the admin port via `http://` must switch to `https://` or set `KEEPORT_ADMIN_HTTPS=false`.
- Session cookies are always `Secure` when the request uses HTTPS.
- The deployment guide replaces the SSH tunnel and access-control-profile steps for the admin console with the built-in HTTPS and explains the certificate warning and fingerprint check.

## [0.4.1] - 2026-11-24

### Fixed

- Opening the admin console or web vault over plain `http://` with an IP address (e.g. `http://192.168.1.20:8081`) made **Create KDBX** fail with `randomBytes is not a function`, and unlocking vaults failed the same way: browsers only provide the Web Crypto API over HTTPS or `localhost`. Both pages now detect this, disable the action and explain how to get a secure connection.

### Changed

- The deployment guide explains which actions need HTTPS or `localhost`, adds steps to publish the admin console on Synology over HTTPS restricted to the LAN with an access control profile, and mentions the SSH tunnel and upload alternatives.

## [0.4.0] - 2026-11-24

### Added

- `KEEPORT_TRUSTED_PROXIES=gateway` trusts the container's current Docker gateway, which is where a reverse proxy on the same host connects from (Synology or QNAP reverse proxy, Caddy/nginx on the host). KeePort reads the gateway from `/proc/net/route` on every start, so the setting keeps working when the Docker network is recreated and gets a new address (e.g. after `docker compose down`). The keyword can be combined with IPs and networks; outside Docker it stops the startup with a clear message. The startup log shows the resolved address.

### Changed

- The deployment guide recommends `gateway` for proxies on the same host and keeps the manual address lookup for proxies elsewhere.

## [0.3.0] - 2026-11-24

### Added

- The web vault and admin console show the running KeePort version as a badge on the sign-in screen and in the sidebar header, so you can check at a glance whether an update was applied. The version is taken from the release at build time.

## [0.2.1] - 2026-11-24

### Fixed

- `KEEPORT_COOKIE_SECURE=yes` (or `on`/`1`, `no`/`off`/`0`) no longer crashes KeePort at startup, which made the container restart in a loop. Unknown values stop the startup with a message that names the variable instead of a stack trace.

### Removed

- `KEEPORT_ADMIN_PORT`. It only told KeePort which container port counts as the admin port, while the container always listens on `8081`; setting it to the desired host port (e.g. `8021`) made the admin console unreachable. Use `KEEPORT_ADMIN_HOST_PORT` to move the admin console on the host. An existing `KEEPORT_ADMIN_PORT` line in `.env` is now ignored.

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

[0.10.0]: https://github.com/madcoda9000/KeePort/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/madcoda9000/KeePort/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/madcoda9000/KeePort/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/madcoda9000/KeePort/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/madcoda9000/KeePort/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/madcoda9000/KeePort/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/madcoda9000/KeePort/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/madcoda9000/KeePort/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/madcoda9000/KeePort/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/madcoda9000/KeePort/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/madcoda9000/KeePort/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/madcoda9000/KeePort/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/madcoda9000/KeePort/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/madcoda9000/KeePort/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/madcoda9000/KeePort/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/madcoda9000/KeePort/releases/tag/v0.1.0
