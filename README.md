<div align="center">

# 🔐 KeePort

**Your KeePass vaults, self-hosted. Open them in the browser, sync them to your phone, share them with your family or team — without the server ever seeing a single password.**

[![Release](https://img.shields.io/github/v/release/madcoda9000/KeePort?include_prereleases&label=release&color=2ea44f)](https://github.com/madcoda9000/KeePort/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![.NET 8](https://img.shields.io/badge/.NET-8.0-512BD4?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#-quickstart)
[![KDBX 3.1 / 4](https://img.shields.io/badge/KDBX-3.1%20%2F%204-6c757d)](#-compatibility)

[Quickstart](#-quickstart) · [Features](#-features) · [Screenshots](#-screenshots) · [How it works](#-how-it-works) · [Deployment guide](docs/DEPLOYMENT.md) · [Changelog](CHANGELOG.md)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/vault-entries-dark.webp">
  <img src="docs/images/vault-entries-light.webp" alt="KeePort web vault with the unlocked family.kdbx, its folder tree and entries" width="100%">
</picture>

</div>

> [!NOTE]
> KeePort is in **beta** (`v0.11.0`). Keep regular backups of your `.kdbx` files and of the `/data` volume.

---

## ✨ Why KeePort?

KeePass files are great: open format, strong encryption, dozens of apps. Keeping them in sync across browser, phone and several people is not. KeePort is the missing piece in the middle:

- **One place for your `.kdbx` files** on your own NAS or server.
- **A web vault** that opens them in any modern browser — decryption happens on your device only.
- **WebDAV sync** for the KeePass apps you already use on Android, iOS and desktop.
- **Sharing with permissions** — give each person read or read-write access per vault.

## 🚀 Features

| | |
|---|---|
| 🧠 **Zero-knowledge web vault** | Unlock, search, edit and save KDBX files in the browser. Copy usernames, passwords and TOTP codes with one click, generate passwords, delete to the recycle bin and spot expired entries. Master passwords and key files never leave your device. |
| 🕘 **History & tags** | See every earlier version of an entry, restore one or delete old versions; tag entries and filter by tag — compatible with KeePass2Android, KeePassXC and KeePassium. |
| 📁 **Folders** | Browse the KDBX folder tree, create, rename and delete folders, and move several entries at once — the structure stays the same in KeePassXC, KeePass2Android and KeePassium. |
| 🧾 **Templates & custom fields** | Credit cards, IDs and other KeePass2Android templates show their own fields; add, edit and protect custom fields on any entry and set expiry dates. |
| 🔑 **Full KDBX support** | KDBX 3.1 and 4.x, Argon2id/AES-KDF, optional key files, attachments up to 10 MiB, and TOTP codes with live countdown. |
| 📱 **WebDAV for mobile apps** | Works with KeePass2Android and KeePassium, including transactional saves, conflict-safe sync and merging. |
| 👥 **Users & per-vault ACLs** | `read` or `read-write` per vault, enforced the same way in the API, web vault and WebDAV. |
| 🛡️ **No silent overwrites** | Every write is checked against the version the client last saw. Stale saves are kept as admin-only conflict copies. |
| 🧰 **Admin console** | A dashboard with status, storage, sign-ins and sync activity; manage vault files, users, permissions, WebDAV app passwords and rate limits; inspect WebDAV request logs. |
| 💾 **Crash-safe storage** | Atomic writes (temp file → fsync → rename), soft delete with restore, plain files on a Docker volume. |
| 🐳 **One container** | Single Docker image with a persistent `/data` volume and an optional, separately bound admin port. |

## 📸 Screenshots

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/vault-entry-dark.webp">
        <img src="docs/images/vault-entry-light.webp" alt="Entry details with live TOTP code, decrypted only in the browser">
      </picture>
      <p align="center"><b>Entry details & TOTP</b><br><sub>Edit entries and copy one-time codes — decrypted only in your browser.</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/vault-card-dark.webp">
        <img src="docs/images/vault-card-light.webp" alt="A KeePass2Android credit card with its template fields">
      </picture>
      <p align="center"><b>Templates & custom fields</b><br><sub>Credit cards and other KeePass2Android templates show their own fields.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-dashboard-dark.webp">
        <img src="docs/images/admin-dashboard-light.webp" alt="Admin dashboard with status, sign-ins and WebDAV activity">
      </picture>
      <p align="center"><b>Admin dashboard</b><br><sub>Status, storage, sign-ins and sync activity at a glance.</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-vaults-dark.webp">
        <img src="docs/images/admin-vaults-light.webp" alt="Admin console listing stored vault files">
      </picture>
      <p align="center"><b>Vault files</b><br><sub>Create, upload, rename, restore and download KDBX files.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-permissions-dark.webp">
        <img src="docs/images/admin-permissions-light.webp" alt="Per-user vault permissions in the admin console">
      </picture>
      <p align="center"><b>Per-vault permissions</b><br><sub>Read only or read and write, per user and vault.</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-webdav-logs-dark.webp">
        <img src="docs/images/admin-webdav-logs-light.webp" alt="WebDAV request log with a KeePass2Android-style save">
      </picture>
      <p align="center"><b>WebDAV logs</b><br><sub>See exactly what each KeePass app sends when syncing.</sub></p>
    </td>
  </tr>
</table>

<sub>Screenshots use fictional demo data. Light and dark versions follow your GitHub theme.</sub>

## ⚡ Quickstart

> [!TIP]
> **Running a Synology or QNAP NAS?** Follow the step-by-step guides for [Synology DSM](docs/DEPLOYMENT.md#-synology-dsm) and [QNAP](docs/DEPLOYMENT.md#-qnap-qts--quts-hero), including HTTPS with the NAS's built-in reverse proxy and backups.

**Requirements:** Docker with Compose v2.

```bash
# Check out the latest release (not the development branch)
git clone --branch v0.11.0 https://github.com/madcoda9000/KeePort.git
cd KeePort

cp .env.example .env
docker compose up -d --build

# One-time token for creating the first administrator
docker compose logs keeport | grep -i "setup token"
```

| What | Where |
|---|---|
| 🌐 Web vault | `http://<host>:8080` — use HTTPS via your reverse proxy to unlock vaults |
| 📂 WebDAV | `http://<host>:8080/webdav` |
| 🛠️ Admin console | **`https://<host>:8081/admin`** (self-signed certificate, LAN only) |

Open the admin console with **`https://`**. Your browser warns once about the self-signed certificate — accept it ([details](docs/DEPLOYMENT.md#the-admin-certificate-warning)). HTTPS is what lets the browser create encrypted vaults.

**First steps in the admin console:** create the administrator → create a user → create or upload a vault and grant access → create a WebDAV app password per device.

> [!CAUTION]
> The admin console listens on every network of the host by default — fine for a NAS behind your home router, but **never forward port `8081` or publish it through a reverse proxy**. On a server with a public IP (VPS), set `KEEPORT_ADMIN_BIND=127.0.0.1` in `.env` and use an SSH tunnel (`ssh -L 8081:127.0.0.1:8081 user@server`, then `https://localhost:8081/admin`) — Docker publishes ports past host firewalls such as `ufw` ([details](docs/DEPLOYMENT.md#who-can-reach-the-admin-console)).

> [!NOTE]
> Unlocking vaults in the web vault needs HTTPS (or `http://localhost`), because browsers only offer their encryption functions there. Publish the web vault through a reverse proxy with HTTPS; over plain `http://<ip>` KeePort shows a warning instead ([details](docs/DEPLOYMENT.md#-secure-connection-required)).

### Updating to a new release

```bash
cd KeePort
git fetch --tags
git checkout v0.12.0          # the release you want, see the Releases page
docker compose up -d --build
```

On a NAS, the update script does all of this for you, including a backup and an automatic rollback: `sudo bash keeport/scripts/keeport-update.sh` ([details](docs/DEPLOYMENT.md#-updating)).

Your data stays in the `keeport-data` volume (or the folder set in `KEEPORT_DATA`; **Admin → Settings → Data storage** shows which). Read the [changelog](CHANGELOG.md) before updating and [make a backup](docs/DEPLOYMENT.md#-backup--restore) first. NAS update steps are in the [deployment guide](docs/DEPLOYMENT.md#-updating).

## 🧩 How it works

```mermaid
flowchart LR
    subgraph Devices["Your devices"]
        B["🌐 Browser<br/>KeePort web vault<br/><i>decrypts locally</i>"]
        M["📱 KeePass apps<br/>KeePass2Android, KeePassium"]
    end

    subgraph Server["KeePort container"]
        API["ASP.NET Core<br/>REST API · WebDAV · Admin"]
        DB[("SQLite<br/>users, ACLs, metadata")]
        FS[("/data/vault<br/>encrypted .kdbx files")]
    end

    B -- "encrypted KDBX + ETag" --> API
    M -- "WebDAV (Basic auth, app password)" --> API
    API --> DB
    API --> FS
```

- The server stores `.kdbx` files as **opaque encrypted blobs**. It never parses vault contents and never receives a master password or key file.
- Every vault has a **revision and an ETag**. A write is only accepted if it is based on the current version; otherwise the original stays untouched and the submitted file becomes a **conflict copy** for an administrator.
- WebDAV clients that do not send `If-Match` (such as KeePass2Android) are checked against the version their app password **last downloaded**, so they get the same protection.
- Website icons are **off by default**. Icons stored in the vault (for example by KeePassXC) are always shown. Users who switch on "Load website icons" let their browser fetch each site's favicon directly; the site then sees their IP address. The KeePort server never sees the URLs.

## 📱 Compatibility

| Client | Platform | Connection | Status |
|---|---|---|---|
| KeePort web vault | Any modern browser | Built in | ✅ Open, edit, save, delete, folders, tags, history, templates, custom fields, attachments, TOTP |
| [KeePass2Android](https://github.com/PhilippC/keepass2android) | Android | WebDAV | ✅ Save, sync and merge verified on a device |
| [KeePassium](https://keepassium.com/) | iOS / iPadOS | WebDAV | ✅ Edit and sync verified on a device |
| [KeePassXC](https://keepassxc.org/) | Desktop | File (download/upload) | ✅ KDBX files, TOTP and attachments verified with 2.7.6 |
| [KeePassDX](https://www.keepassdx.com/) | Android | WebDAV via a storage provider such as DAVx⁵ | ⚪ Expected to work, not yet verified |

Setup instructions per client are in the [deployment guide](docs/DEPLOYMENT.md#-connect-keepass-apps). If a client cannot save, **Admin → Logs → WebDAV logs** shows exactly which requests it sent.

## 🔒 Security model

- **Zero knowledge:** decryption, editing and re-encryption happen only in the browser or KeePass app.
- **Separate roles:** admin accounts can only use the admin console; the web vault and WebDAV require a regular user account.
- **Separate WebDAV credentials:** one app password per device, stored as an Argon2id hash and revocable at any time.
- **Hardened sessions:** `HttpOnly`/`SameSite` cookies, CSRF tokens, Argon2id password hashing and configurable per-IP rate limits for sign-in and WebDAV.
- **Explicit proxy trust:** client addresses from `X-Forwarded-For` are only accepted from reverse proxies you list; catch-all entries are refused.
- **Admin isolation:** admin endpoints only answer on the admin port, which is served over HTTPS with a self-signed certificate created on first start.
- **Privacy-aware logging:** WebDAV logs record method, path, status and headers such as `If-Match` — never passwords or file contents.

Use HTTPS (for example behind a reverse proxy) before exposing the web vault or WebDAV beyond your LAN. The [deployment guide](docs/DEPLOYMENT.md) covers HTTPS with the Synology and QNAP reverse proxies as well as Caddy and nginx.

## ⚙️ Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Purpose |
|---|---|---|
| `KEEPORT_HTTP_HOST_PORT` | `8080` | Host port of the web vault and WebDAV (e.g. `8090` on QNAP, where QTS uses 8080). |
| `KEEPORT_DATA` | `keeport-data` | Docker volume name, or a folder path for a bind mount owned by UID 1000. |
| `KEEPORT_ADMIN_BIND` | `0.0.0.0` | Host address the admin port is published on; `127.0.0.1` on a VPS. |
| `KEEPORT_ADMIN_HTTPS` | `true` | HTTPS with a self-signed certificate for the admin console; `false` if a reverse proxy does TLS. |
| `KEEPORT_ADMIN_TLS_HOSTS` | *(empty)* | Extra names/IPs for the admin certificate, e.g. `192.168.1.20, nas.local`. |
| `KEEPORT_ADMIN_HOST_PORT` | `8081` | Host port of the admin console (the container side is always `8081`). |
| `KEEPORT_COOKIE_SECURE` | `false` | Set to `true` when KeePort is served over HTTPS. |
| `KEEPORT_TRUSTED_PROXIES` | *(empty)* | `gateway` for a reverse proxy on the same host (NAS proxy, Caddy, nginx), or the proxy's IP/network, so KeePort sees each device's own address ([details](docs/DEPLOYMENT.md#-trust-your-reverse-proxy)). |

Sign-in and WebDAV rate limits are changed at runtime in **Admin → Settings**. Everything else — NAS setup, backups, reverse proxy examples, troubleshooting — is in the [deployment guide](docs/DEPLOYMENT.md).

## 🛠️ Development

```bash
# Backend with a local data directory (the default /data is meant for the container)
export KeePort__DataDir="$PWD/.data" KeePort__CookieSecure=false
dotnet run --project src/KeePort.Api

# Frontend dev servers
cd web/vault && npm install && npm run dev
cd web/admin && npm install && npm run dev

# Serve the built frontends from the backend
./scripts/build-web.sh
dotnet run --project src/KeePort.Api

# Tests
dotnet test
```

The web vault is served at `/`, the admin console at `/admin` and WebDAV at `/webdav`.

```text
src/KeePort.Api           ASP.NET Core backend: REST API, WebDAV, SQLite data layer
web/vault                 React + TypeScript web vault (shadcn/ui)
web/admin                 React + TypeScript admin console (shadcn/ui)
web/shared                Shared table components and helpers
tests/KeePort.Api.Tests   xUnit integration tests
docs/                     Deployment guide and project plans
```

## 🗺️ Roadmap

- **Browser extension** — the backend already supports extra CORS origins via `KeePort:CorsOrigins`; a token-based sign-in for extensions is planned on top of the existing sessions.

Ideas and bug reports are welcome in the [issue tracker](https://github.com/madcoda9000/KeePort/issues).

## 📄 License

KeePort is released under the [MIT License](LICENSE).
