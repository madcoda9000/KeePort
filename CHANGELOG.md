# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.27.2] - 2026-11-28

### Security

- Web vault and admin console development tools: the shadcn CLI is updated to 4.23.1, which brings minimatch 11.0.9 and fixes a denial of service through crafted glob patterns (GHSA-g3hv-75wg-m249). Only the CLI used to add components during development was affected; the built app and the Docker image never contained minimatch.

## [0.27.1] - 2026-11-28

### Fixed

- Account settings in the web vault and admin console, and **Admin → Settings**: long area names in the menu on the left wrap onto a second line instead of being cut off at the edge (for example "Connexion à deux facteurs" in French).

## [0.27.0] - 2026-11-28

### Changed

- **Backend on .NET 10 (LTS).** Support for .NET 8 ended on 10 November 2026; .NET 10 receives security updates until November 2028. Features, data and settings are unchanged, and an update needs nothing but the new image.
  - Docker image based on `mcr.microsoft.com/dotnet/aspnet:10.0-alpine` (built with `sdk:10.0-alpine`); Microsoft.Data.Sqlite 10.0.15.
  - The admin console keeps its stored self-signed certificate, so the fingerprint does not change and browsers do not warn again. A test with a certificate written by the .NET 8 builds guards this.
  - **Admin → Dashboard** shows the new runtime (".NET 10.0.x").
  - Trusted reverse proxies use the networks API of .NET 10 (`System.Net.IPNetwork`, `KnownIPNetworks`), and certificates are loaded with `X509CertificateLoader`; behaviour is unchanged.
  - Development needs the .NET 10 SDK; `global.json` pins it.
- Page for shared secrets: "KeePort" in the line at the bottom links to the project on GitHub (opens in a new tab).

### Security

- The server runtime (ASP.NET Core, Kestrel, cryptography) receives security fixes again.

## [0.26.1] - 2026-11-27

### Changed

- Admin console, **Settings**: the seven areas (E-mail, Two-factor sign-in, Sharing secrets, Rate limits, Vault versions, Audit log, Data storage) are no longer stacked on one long page. A menu on the left (a row on narrow screens) shows one area at a time; the data storage warning opens its area directly.

## [0.26.0] - 2026-11-27

### Added

- **Share secrets** with people without a KeePort account: **Share…** in an open entry creates a link (`/s/<id>#<key>`) for the chosen fields, an optional message, a validity and a number of views.
  - The entry is encrypted in the browser (AES-256-GCM, keys from HKDF-SHA-256); the key is in the part of the link after `#`, which never reaches the server. KeePort stores only ciphertext and deletes it after the last view, on expiry or on revocation.
  - Optional **password for the recipient** (Argon2id). The server checks a proof derived from key and password before it hands out the ciphertext, so a wrong password does not use up a view; ten wrong attempts lock the link.
  - Optional **e-mail ways**: KeePort e-mails the link (a recipient password is then required), and/or the recipient confirms the address with a six-digit code.
  - **Recipient page** without the web vault's code, with its own strict Content-Security-Policy, `no-store` and `noindex`. Opening counts as a view only after **Open secret**, so link previews do not use it up.
  - **Shares** in the account settings lists your links with status and views; active links can be revoked.
  - **Admin → Settings → Sharing secrets**: off by default; for all users or only selected users, per-user allow/block, per-vault switch, longest validity (default 7 days), most views (default 5), required recipient password, and the two e-mail ways. Lists all shares (metadata only) and can revoke them. Links of a forbidden vault or user stop working.
  - Sharing needs read-write access to the vault.
  - Audit log category **Sharing** (`ShareCreated`, `ShareSent`, `ShareViewed`, `ShareRevoked`, `ShareSettingsChanged`); e-mail kinds `shareLink` and `shareCode`.
  - Expired secrets are deleted every hour; ended shares are listed for 30 days.

## [0.25.0] - 2026-11-27

### Added

- **Keyboard shortcuts** in the web vault and the admin console. Press **?** for an overview. Single keys only work while the cursor is not in an input field; on a Mac, ⌘ replaces Ctrl.
  - Web vault: **/** search, **Esc** empties the search, then the selection, then the mark; **↓ ↑** (or **J K**) move the mark through the list across pages, **Enter** opens the marked entry, **Space** selects it, **N** new entry, **Del** moves the selected or marked entries to the recycle bin after a confirmation; **U**, **P**, **T** copy username, password or TOTP code and **O** opens the website of the marked or open entry; **Ctrl+S** saves the open entry; **Shift+L** locks the vault.
  - **Command palette** in the web vault (**Ctrl+K**): find entries, folders and actions (new entry, security report, reload, import, export, lock, settings, theme) by typing. It searches only in the browser.
  - Admin console: **/** search, **Esc** empties the search, **G** then **D**, **V**, **U**, **W**, **S** or **L** opens Dashboard, Vault files, Users, WebDAV credentials, Settings or Audit log.
  - Copy buttons in the list show their key in the tooltip; the sidebar shows "Press ? for keyboard shortcuts".
  - New account setting **Keyboard shortcuts** (on by default) under **Account**, stored on the account for the web vault and the admin console (`PUT /api/auth/shortcuts`, `PUT /api/admin/auth/shortcuts`).
- New dependency `cmdk` 1.1.1 (MIT) for the command palette, added with the shadcn/ui components Command, Input Group and Kbd.

## [0.24.2] - 2026-11-27

### Changed

- Export: the file is now named `keeport-<vault>-<date>.csv`, for example `keeport-family-2026-11-27.csv`, instead of `<vault>-export-<date>.csv`.

## [0.24.1] - 2026-11-27

### Fixed

- Import: records that cannot be imported are now listed with the line of the file they start on. Before, KeePort counted records, so the number was too small when an earlier value (for example a note) spanned several lines.

## [0.24.0] - 2026-11-27

### Added

- **Import** in the web vault (**Import / Export → Import entries…**, with write permission): add entries from another password manager to the open vault.
  - Recognized automatically: **Bitwarden** (CSV and unencrypted JSON, including organization exports), **1Password**, **Apple Passwords**, **Chrome, Edge and Brave**, **Firefox**, **KeePassXC** and **Proton Pass**.
  - **Any other CSV file** (comma, semicolon or tab): the columns are assigned by their headers and can be changed in the dialog.
  - A **preview** lists folder, title, username, address and status, without passwords. Records that cannot be imported (e.g. without title and address, or a Bitwarden card in CSV) are listed with their line.
  - Entries go into a new folder "Imported YYYY-MM-DD" or the current folder. The source's folders are kept on request.
  - **Duplicates** (same address and username as an existing entry) are skipped by default.
  - TOTP, tags, additional addresses, custom fields, and creation and change dates are taken over. Bitwarden cards, identities and SSH keys become custom fields; hidden values stay protected.
  - The vault is saved right away. After the import, KeePort reminds you to delete the export file.
- **Export** in the web vault (**Import / Export → Export entries…**, also with read permission): download the whole vault or the current folder with its subfolders as a CSV file in the KeePassXC layout (Group, Title, Username, Password, URL, Notes, TOTP, Tags, Last Modified, Created), which KeePassXC, Bitwarden and KeePort can import. Recycle bin, templates, custom fields, attachments and history are not included. An option puts an apostrophe before values that a spreadsheet would run as a formula.

### Security

- Import and export run only in the browser after unlocking. The CSV or JSON file is never sent to the server; the server receives the encrypted vault as with every save.
- The export dialog warns that the file is not encrypted.

## [0.23.0] - 2026-11-26

### Added

- **E-mail log** in the admin console under **Logs → E-mail log**: every e-mail KeePort sent or tried to send, newest first, with time, type (e.g. invitation, sign-in code, security notification), recipient, subject, status (*Waiting*, *Retrying*, *Sent*, *Given up*), attempts and the mail server's error. A status filter, search and sorting help to find an e-mail (`GET /api/admin/logs/email`, at most 1000 entries).
- The **test e-mail** now appears in the e-mail log too, as sent or given up.
- **Admin → Settings → E-mail → Keep e-mail log (days)**: how long sent and given-up e-mails stay in the log, 1–365 days, by default 30 (`logRetentionDays` in the e-mail settings).

### Changed

- Sent and given-up e-mails are kept for 30 days by default instead of 7. The queue summary on the settings page still counts the last 7 days.

### Security

- As before, the content of an e-mail (codes, links) is deleted from the database as soon as it was sent or given up; the log keeps only type, recipient, subject, status and error.

## [0.22.0] - 2026-11-26

### Added

- **Expiry reminder** in the web vault: entries whose expiry date is near are marked before they expire.
  - A new view **Expiring soon** in the sidebar (amber, with count) lists them, next to **Expired**.
  - In the entry list they show a badge such as "Expires in 5 days", "Expires tomorrow" or "Expires today".
  - The **security report** has a new tile **Expiring soon**.
  - After unlocking, the notice says how many entries expire soon, with a link to the view.
  - **Profile → Vault → Expiry reminder (days)**: how many days before expiry an entry counts as expiring soon, by default 30; 0 turns it off. The setting is stored on the account (`expiryWarningDays` in `PUT /api/auth/settings`).
- **Quick choice for the expiry date** in the entry form: "in 1 / 3 / 6 / 12 months", e.g. after changing a password.

### Security

- Expiry dates are read only in the browser after unlocking; the server learns nothing about them. Only the number of reminder days is stored on the account.

## [0.21.2] - 2026-11-26

### Fixed

- The signed-in administrator can no longer disable their own account or remove their own administrator role, which locked them out at once. **Edit…** on the own account shows both as unavailable, and the server refuses it (`409 cannot_disable_self`); a new password for the own account still works.

## [0.21.1] - 2026-11-26

### Changed

- **Admin → Users** fits without scrolling sideways: the table shows user with e-mail, role, status, 2FA and last sign-in, and every action is in a **⋯** menu per row — **Edit…** (role, disable account, new password in a dialog), **Send invitation**, **Reset 2FA** and **Delete**, each with a confirmation where needed.

## [0.21.0] - 2026-11-26

### Added

- **Passkeys** for the web vault and the admin console: fingerprint, face or device PIN, a password manager with passkeys, or a security key.
  - **Profile → Two-factor sign-in → Passkeys:** add a passkey (with the account password and a name), see where and when each was used, and remove one. The first passkey of an account creates recovery codes, like the other factors.
  - **Sign in with a passkey** on the sign-in page, without username and password. The passkey must check the user (fingerprint, face or PIN), so it proves both factors.
  - After a password, a passkey counts as **second factor** ("Continue with passkey"). Accounts with a passkey can no longer sign in with the password alone, and a passkey fulfils the administrator's two-factor requirement.
  - Passkeys need a domain name with HTTPS; on an IP address (e.g. the admin console with its self-signed certificate) the profile explains why they are missing.
  - **Reset 2FA** in **Admin → Users** also removes the account's passkeys.
  - Optional `KEEPORT_PASSKEY_RP_ID` and `KEEPORT_PASSKEY_ORIGINS` if a reverse proxy hides the domain from KeePort.
  - Audit log: `PasskeyAdded`, `PasskeyRemoved`; sign-ins name the passkey used.
  - New endpoints under `…/auth`: `POST mfa/passkeys/options`, `POST mfa/passkeys`, `POST mfa/passkeys/{id}/delete`, `POST login/passkey/options`, `POST login/passkey`, `POST login/mfa/passkey/options`, `POST login/mfa/passkey`. The two-factor state lists `passkeys`.

### Changed

- The account settings split **Security** into **Password** and **Two-factor sign-in**, so neither needs much scrolling.

### Security

- New dependency **Fido2 4.3.3** (fido2-net-lib, MIT) checks passkeys on the server, with Fido2.Models, NSec.Cryptography (libsodium), System.Formats.Cbor and Microsoft.IdentityModel.JsonWebTokens.
- Attestation is not requested; a passkey is bound to its domain, each sign-in ceremony works once within 5 minutes, and a signature counter that does not go up is refused. Only the public key is stored.

## [0.20.1] - 2026-11-26

### Changed

- **Account settings** in the web vault and the admin console open in a larger window with a menu on the left: **Account** (e-mail address, language), **Security** (account password, two-factor sign-in), **Sign-ins** (web vault), **Notifications** and **Vault** (auto-lock, clipboard, website icons, breach check). Only the chosen area is shown, so there is much less scrolling; on narrow screens the menu becomes a row at the top.

## [0.20.0] - 2026-11-26

### Added

- **Two-factor sign-in** for the web vault and the admin console, under **Profile → Two-factor sign-in**:
  - **Authenticator app** (TOTP, RFC 6238): a QR code and the key to type in; it is turned on only after a correct code. Codes from one step before or after are accepted, and each code works only once.
  - **Codes by e-mail** to the confirmed address (6 digits, valid 10 minutes, at most one per minute and five per hour). By default users may use them and administrators may not. While they are on, the e-mail address cannot be changed.
  - **10 recovery codes**, shown once with copy and download as `.txt`; new ones can be created with the account password.
  - Turning a factor on or off needs the account password (turning off the app also needs a code). The owner gets an e-mail about every change.
- **Second sign-in step:** after a correct password, accounts with a second factor enter a code from the app, by e-mail or a recovery code. Five wrong codes or 10 minutes end the attempt. Wrong codes count as failed sign-ins on the dashboard and in the audit log.
- **Admin → Settings → Two-factor sign-in:** require a second factor for administrators and/or users (off by default). Accounts without one see only the setup after signing in, and the server refuses every other request until it is done. A second setting decides who may use codes by e-mail.
- **Admin → Users:** a **2FA** column, and **Reset 2FA** turns off every factor of an account and signs it out everywhere.
- **Emergency reset** for the only administrator: `keeport-admin reset-mfa <username>` in the container.
- A password reset link for an account with an authenticator app also asks for a code from it or a recovery code.
- Audit log: `MfaEnabled`, `MfaDisabled`, `MfaRecoveryCodesCreated`, `MfaReset`, `MfaSettingsChanged`; successful sign-ins name the second factor used.
- Accounts returned by the API have `twoFactor` and `mfaSetupRequired`. New endpoints: `POST …/auth/login/mfa`, `POST …/auth/login/mfa/email`, `GET …/auth/mfa`, `POST …/auth/mfa/totp/start`, `…/totp/confirm`, `…/totp/disable`, `…/email/enable`, `…/email/disable`, `…/recovery-codes`, `GET`/`PUT /api/admin/settings/mfa`, `POST /api/admin/users/{id}/reset-mfa`. With a second factor, `POST …/auth/login` answers `{ mfaRequired, mfaToken, methods, emailHint }` instead of a session.

### Security

- TOTP secrets are encrypted with ASP.NET Core Data Protection (key in `/data/keys`). Recovery codes (80 random bits each), e-mail codes and the token of a pending sign-in are stored only as SHA-256 hashes.
- WebDAV is not affected: KeePass apps keep using their app passwords.
- New dependency **uqr 0.1.3** (npm, MIT, no dependencies) draws the QR code in the browser; the secret never leaves KeePort.

## [0.19.0] - 2026-11-26

### Added

- **E-mail (SMTP):** **Admin → Settings → E-mail** sets up sending through any SMTP server (STARTTLS, SSL/TLS or none), with sender, the web vault address for links and a **Send test e-mail** button that shows the server's answer. E-mails go through a queue in the database and are retried after 1, 5, 15 and 60 minutes; the card shows waiting, sent and failed e-mails and the last error. The SMTP password is stored encrypted with ASP.NET Core Data Protection (key in `/data/keys`) and is never shown again.
- **Confirm e-mail address:** in the profile of the web vault and the admin console, with a 6-digit code (valid 30 minutes, 5 attempts). Changing the address makes it unconfirmed again and tells the previous address.
- **Invitations:** when creating a user, an administrator can send an invitation instead of setting a password. The user chooses the password through a link (valid 48 hours, works once), so the administrator never knows it. Invitations can be sent again from the user list.
- **Forgot password?** on the web vault's sign-in page: a link (valid 30 minutes) to the confirmed address of a user account. The answer is the same whether an account exists or not; administrator accounts cannot be reset by e-mail. Resetting signs the account out everywhere.
- **Security notifications** to the account owner: sign-in from a browser not used in the last 90 days, password changed or reset, e-mail address changed (to the previous address), new WebDAV app password. Sign-in and app password notifications can be turned off in the profile; password changes are always reported.
- **Warnings to administrators** with a confirmed address: many failed sign-ins (10 within 15 minutes, at most hourly), the admin certificate expires within 30 days, data not in a host folder (weekly), low disk space under 1 GB or 5 % (daily). Each can be turned off.
- E-mails are written in the recipient's language (English, German or French) as text and HTML; they never contain passwords or vault content.
- Audit log: `EmailSettingsChanged`, `TestEmailSent`, `InvitationSent`, `InvitationAccepted`, `PasswordResetRequested`, `PasswordResetCompleted`, `EmailVerified`.
- Accounts returned by the API have `emailVerified`, `notifySignIn` and `notifyAppPassword`. New endpoints: `GET`/`PUT /api/admin/settings/email`, `POST /api/admin/settings/email/test`, `POST /api/admin/users/{id}/invite`, `POST …/auth/email/verification`, `POST …/auth/email/verify`, `PUT …/auth/notifications`, `POST /api/auth/password-reset`, `POST /api/auth/token`, `POST /api/auth/set-password`; `POST /api/admin/users` accepts `invite`.

### Security

- New dependency **MailKit 5.0.0** (MIT, with MimeKit.Core) for SMTP.
- One-time links carry 256 random bits and are stored only as SHA-256 hashes; the token is in the URL fragment (`#token=…`), so it does not appear in server or proxy logs. Sent e-mails lose their bodies in the queue right away.

## [0.18.0] - 2026-11-26

### Added

- **Vault versions:** every save keeps the previous state of the vault file on the server — from the web vault, from a KeePass app over WebDAV and when an administrator restores a version. **Admin → Vault files → Versions** lists the current revision and the kept versions with time, account, how they were saved (e.g. "WebDAV · Pixel 8") and size; each version can be downloaded as `<name>-r<revision>.kdbx` or restored.
- Restoring saves the old content as a **new revision**, so every KeePass app notices the change and reloads, and the state before the restore stays available as a version.
- **Admin → Settings → Vault versions:** how many versions are kept per vault (default 30, 0 turns versions off) and for how many days (default 90, 0 keeps them regardless of age), with the space they currently use. Older versions are removed after every save and once a day.
- Audit log: `VaultVersionRestored` and `VersionSettingsChanged`; downloading a version is logged as `VaultDownloaded`.
- `GET /api/admin/files/{id}/versions`, `GET …/versions/{revision}/content`, `POST …/versions/{revision}/restore`, `GET`/`PUT /api/admin/settings/versions`.

### Changed

- If the previous state cannot be kept (e.g. the disk is full), a save is refused with `507 Insufficient Storage` and the vault stays unchanged, instead of being overwritten without a way back.
- Earlier versions are stored in `/data/vault-versions`, so existing backups of the data folder include them.

## [0.17.0] - 2026-11-26

### Added

- **German and French** for the web vault and the admin console, next to English. Every text, message and tooltip is translated; dates, times and numbers follow the chosen language, and so do "2 minutes ago" and similar times. Texts without a translation fall back to English.
- **Language choice:** a language menu on the sign-in pages, and **Language** in the account settings of the web vault and the admin console ("Automatic" follows the browser). The choice is stored on the account, so it applies on every device; before sign-in the browser remembers it.
- Error messages from the server are shown in the chosen language.
- `PUT /api/auth/language` and `PUT /api/admin/auth/language`; `language` in the account returned by `/me`. Changing it is logged in the audit log as `SettingsChanged`.

## [0.16.0] - 2026-11-26

### Added

- **Audit log** in the admin console under **Logs → Audit log**: who signed in, and who changed users, vaults, permissions, WebDAV app passwords and settings, and when. Every event has an action tag such as `LoginFailed` or `VaultPermissionsChanged`, shown as a coloured badge (failed actions in red); a click on a badge filters by it. Headline counts (all entries, last 24 hours, last 7 days, failed sign-ins in 24 hours), filters for user, action, area, date range, failed actions and free text, paging on the server, and CSV export of the filtered entries.
- Every saved vault revision is logged, from the web vault or a WebDAV app password, as are conflict copies, uploads, downloads, renames, deletions and restores of vaults, and permission changes with before and after (e.g. "anna: none → read-write").
- **Settings → Audit log**: how many days entries are kept (default 365, at most 50,000 entries).
- **Recent sign-ins** in the web vault's account settings: the last 20 successful and failed sign-in attempts on your own account, with browser and IP address.
- `GET /api/admin/logs/audit`, `GET /api/admin/logs/audit.csv`, `GET`/`PUT /api/admin/settings/audit` and `GET /api/auth/sign-ins`.
- DEPLOYMENT.md explains why devices in the home Wi-Fi show your own public IP in the WebDAV log (NAT reflection) and how local DNS fixes it, with a new troubleshooting entry.

### Changed

- **Logs** in the admin sidebar opens the audit log first; the WebDAV logs are the second entry below it.
- The screenshots in the README show the new violet look of 0.15.0.

### Security

- The CSV export protects against formula injection: cells starting with `=`, `+`, `-` or `@` (e.g. a username typed at a failed sign-in) get a leading apostrophe so spreadsheet programs do not run them.

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

[0.27.2]: https://github.com/madcoda9000/KeePort/compare/v0.27.1...v0.27.2
[0.27.1]: https://github.com/madcoda9000/KeePort/compare/v0.27.0...v0.27.1
[0.27.0]: https://github.com/madcoda9000/KeePort/compare/v0.26.1...v0.27.0
[0.26.1]: https://github.com/madcoda9000/KeePort/compare/v0.26.0...v0.26.1
[0.26.0]: https://github.com/madcoda9000/KeePort/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/madcoda9000/KeePort/compare/v0.24.2...v0.25.0
[0.24.2]: https://github.com/madcoda9000/KeePort/compare/v0.24.1...v0.24.2
[0.24.1]: https://github.com/madcoda9000/KeePort/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/madcoda9000/KeePort/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/madcoda9000/KeePort/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/madcoda9000/KeePort/compare/v0.21.2...v0.22.0
[0.21.2]: https://github.com/madcoda9000/KeePort/compare/v0.21.1...v0.21.2
[0.21.1]: https://github.com/madcoda9000/KeePort/compare/v0.21.0...v0.21.1
[0.21.0]: https://github.com/madcoda9000/KeePort/compare/v0.20.1...v0.21.0
[0.20.1]: https://github.com/madcoda9000/KeePort/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/madcoda9000/KeePort/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/madcoda9000/KeePort/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/madcoda9000/KeePort/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/madcoda9000/KeePort/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/madcoda9000/KeePort/compare/v0.15.0...v0.16.0
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
