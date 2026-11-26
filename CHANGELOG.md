# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-11-26

### Changed

- New look with a violet brand colour in the web vault and the admin console: buttons, focus rings, the active sidebar item and entry titles use it, the logo has a violet-to-pink gradient, and the dark theme is slightly tinted instead of plain grey.
- Entries without their own icon show their first letter on a coloured tile, and tags have a fixed colour each (in the entry list, the sidebar and the tag editor).
- The figures on the vault page and the admin dashboard are larger and have coloured icons. "Read-write" is shown in green, "Read-only" in amber, and "KeePort is running" in green.
- Notices such as "Unlocked …" are tinted, and the sign-in page has a coloured side panel.

## [0.14.3] - 2026-11-25

### Fixed

- The mouse pointer turns into a hand over everything that can be clicked (buttons, sidebar entries, menu items, checkboxes, tabs, tags) in the web vault and the admin console. Before, it always stayed an arrow.
- Entry titles in the list are recognisable as the place to click: the pointer turns into a hand, the title is underlined on hover and keyboard focus, and a tooltip says "Open …".

## [0.14.2] - 2026-11-25

### Added

- A **user manual** in the [GitHub wiki](https://github.com/madcoda9000/KeePort/wiki): first steps, every page of the admin console and the web vault, KeePass apps, privacy and security, and an FAQ. The README links to it.

### Changed

- The web vault and the admin console use the canonical Tailwind CSS class names (`wrap-break-word`, `-left-(--sidebar-width)`, `inset-s-1/2`, `w-0.5`) instead of the older spellings. The look does not change.
- The project plans (`docs/plans`) and the local agent notes (`AGENTS.md`) are no longer part of the repository.

### Fixed

- A change under **Users** that also contained a rejected password (for example one that is too short) used to apply the role and disabled state anyway. Now the whole change is refused and the account stays as it was.

### Security

- When an administrator sets a new password for an account under **Users**, the account is now signed out everywhere: open sessions in the web vault or admin console end at once. Before, they stayed signed in until they expired. An administrator who resets their own password stays signed in in the current browser.

## [0.14.1] - 2026-11-25

### Fixed

- In the entry history, version cards with long dates could run past the right edge of the entry form, cutting off the delete button. Long dates now wrap.

### Changed

- The README describes all features up to 0.14: everyday comfort (copy buttons, double-click, column chooser, passphrases, clipboard clearing), the security report, opt-in outside connections in the "How it works" diagram and the security model, and the frontend tests. The screenshots are new and include the security report and the entry history.

## [0.14.0] - 2026-11-25

### Added

- **Choose columns** in the entry list: "Columns" next to the search hides or shows Username, Password, TOTP, Modified and Website. The choice is remembered in this browser.
- **Save website icon:**
  - The button in the entry form (shown when "Load website icons" is on) stores the website's icon in the vault, so KeePass2Android, KeePassXC and KeePassium show it too.
  - Because browsers cannot read images from other sites, the KeePort server downloads the icon once. It sees the host name for this and nothing else.
  - The download only reaches public HTTPS sites: addresses in your network, loopback and reserved ranges are refused, also after redirects. It is limited in size, time and rate.
  - The icon is stored as a 32×32 PNG, and identical icons are reused.
  - `KEEPORT_FAVICON_DOWNLOAD=false` turns the download off.
- **Breach check (opt-in):**
  - With "Check passwords against Have I Been Pwned" in the account settings, the security report gets a "Breached" tile, and affected passwords show "Found in data breaches (n times)".
  - The browser sends only the first 5 characters of each password's SHA-1 hash, with padding, and compares the rest locally. The check runs when the report opens and can be repeated.
- `GET /api/vault/favicon?host=…` for signed-in vault users.

### Changed

- The web vault's Content-Security-Policy allows connections to `https://api.pwnedpasswords.com` for the breach check. The admin console is unchanged.
- `PUT /api/auth/settings` accepts `checkBreaches`.

## [0.13.0] - 2026-11-25

### Added

- **Security report** in the web vault:
  - A new "Security" view in the sidebar shows tiles for weak, reused, old (not changed for over a year) and empty passwords and for expired entries. Clicking a tile lists the affected entries.
  - Everything is computed in the browser; nothing is sent or stored.
  - Weak passwords are found by length, character variety and patterns such as keyboard rows, sequences and years, and by comparing with the 1000 most common passwords.
  - The age of a password comes from the entry history, so changing only the notes does not reset it.
  - The entry list shows a warning sign next to weak or reused passwords, with a tooltip.
- **Passphrases** in the password generator: 4–10 words from the EFF Large Wordlist, with a choice of separator, capitalized words and an extra digit. The word list (62 KB) is only loaded when passphrases are used.
- **Modified column** in the entry list, e.g. "3 days ago" with the exact time as tooltip, sortable. The entry form shows when the entry was created and last modified.
- **Double-click** a row in the entry list to open the entry; a single click marks the row. Buttons, links and checkboxes in the row keep working as before.
- `THIRD-PARTY-NOTICES.md` lists the sources and licenses of the word lists.

### Changed

- The generator's strength indicator rates random secrets more realistically: weak below 50 bits, fair below 64, strong below 100, very strong from 100 bits. A six-word passphrase (77 bits) now shows as strong.

## [0.12.0] - 2026-11-25

### Added

- **Entry history** in the web vault:
  - The entry form has a "History" tab that lists the current state and all saved versions, newest first, with the time and what changed (e.g. "Password, Website"). The overview never shows values.
  - A version can be opened to see all of its fields, attachments, tags and expiry. Passwords and protected fields are masked with show and copy buttons.
  - **Restore** works like KeePass: the current state is saved as a version first, then the entry takes over the old values.
  - Single versions can be **deleted**, e.g. to remove an old password from the history.
  - Read-only users can view the history.
- **Tags:**
  - Entries show up to three tags in the list. The entry form edits them as chips, with suggestions from the tags already used in the vault.
  - The sidebar lists all tags with their counts. Clicking a tag there or in the list filters the entries across all folders.
  - "Tags…" in the selection bar adds or removes tags on several entries at once.
  - Tags are stored the way KeePass expects, so KeePass2Android, KeePassXC and KeePassium show them; commas, semicolons and colons are not allowed inside a tag.

### Fixed

- The web vault never trimmed an entry's history, so vaults edited mostly in the browser kept growing. Saving an entry now keeps at most the number of versions and the history size set in the vault (KeePass defaults: 10 versions, 6 MiB), like KeePass and KeePass2Android do.
- Messages in the entry form (e.g. "Vault saved.") are now visible on every tab.

## [0.11.0] - 2026-11-25

### Added

- **Copy buttons in the entry list:** username, password and the current TOTP code can be copied right from the table, with a tooltip, without opening the entry.
- **TOTP column** in the entry list, showing whether an entry has TOTP set up (sortable).
- **Delete entries** in the web vault, from the entry form or for several selected entries:
  - Deleted entries move to the recycle bin.
  - Entries already in the recycle bin are deleted permanently, as are all deleted entries in vaults without a recycle bin. KeePass apps remove permanently deleted entries when they sync.
  - "Empty recycle bin" removes everything in it.
- **Expired entries** carry an "Expired" badge, and the folder sidebar gets an "Expired" view while any entry has expired.
- **Entry icons:**
  - Icons stored in the vault (for example favicons that KeePassXC downloaded) replace the key symbol.
  - "Load website icons" in the account settings additionally shows each site's favicon. It is off by default, applies per user, and the browser requests the icon directly from the site, which then sees the user's IP address. The KeePort server never sees the URLs.
- **Password generator** in the entry form: length, character groups, an option to avoid look-alike characters and a strength estimate. It uses the browser's cryptographic random source.
- **Show password** button in the entry form.
- **Open website** buttons in the entry list and the form, for http(s) addresses.
- **Clipboard clearing:** copied values are removed from the clipboard after 30 seconds and when the vault locks. The delay can be changed or turned off in the account settings. Browsers allow this only while the KeePort tab is in front.

### Changed

- The web vault's Content-Security-Policy allows images over HTTPS for website icons. The admin console keeps its stricter policy.
- `PUT /api/auth/settings` accepts `showFavicons` and `clipboardClearSeconds`; fields left out stay unchanged.

## [0.10.1] - 2026-11-25

### Fixed

- Since 0.9.0 the live TOTP code with its countdown and copy buttons appeared below the additional fields and the expiry date, so it was often out of view. It is shown directly below the TOTP field again.

### Changed

- The README screenshots show the current version: the folder tree in the web vault, a KeePass2Android credit card with its template fields, and the admin dashboard.

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

[0.15.0]: https://github.com/madcoda9000/KeePort/compare/v0.14.3...v0.15.0
[0.14.3]: https://github.com/madcoda9000/KeePort/compare/v0.14.2...v0.14.3
[0.14.2]: https://github.com/madcoda9000/KeePort/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/madcoda9000/KeePort/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/madcoda9000/KeePort/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/madcoda9000/KeePort/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/madcoda9000/KeePort/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/madcoda9000/KeePort/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/madcoda9000/KeePort/compare/v0.10.0...v0.10.1
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
