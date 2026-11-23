# KeePort

KeePort is a self-hosted, open-source all-in-one manager for KeePass `.kdbx` files. It combines a small .NET backend, a zero-knowledge browser vault client, an admin console, and WebDAV sync for KeePass-compatible mobile/desktop clients.

The server stores vault **files** and **metadata**, but never vault secrets. KDBX decryption, editing, and re-encryption happen only in the browser.

## Features

- KeePass KDBX compatibility via [`kdbxweb`](https://github.com/keeweb/kdbxweb) and [`argon2-browser`](https://www.npmjs.com/package/argon2-browser) WASM Argon2.
- KDBX 3.1 and KDBX 4.x read/write support for KeePassXC, KeePassium, KeePassDX, Strongbox-style clients, and other compatible tools.
- Optional key files and attachments handled by the browser crypto stack.
- Strict roles: `Admin` and `User`.
- Per-vault ACLs: `read` and `read-write`, enforced identically in the REST API, Vault webclient, and WebDAV.
- Users cannot create or delete `.kdbx` files; admins manage files, users, ACLs, and WebDAV app passwords.
- ETag/revision preconditions for writes: stale saves return `409`/`412` instead of silently overwriting.
- Atomic vault writes: temp file, flush/fsync, atomic rename.
- First-run setup with a one-time token printed in the container logs.
- Session cookies (`HttpOnly`, `SameSite=Lax`, optional `Secure`), CSRF protection, Argon2id password hashing, and login rate limiting.
- Docker image with persistent `/data` volume and optional separate admin port.

## Quickstart with Docker Compose

Prerequisites: Docker with Compose v2.

```bash
git clone https://github.com/madcoda9000/KeePort.git
cd keeport
cp .env.example .env
docker compose up -d --build
docker compose logs keeport | grep "setup token"
```

The Vault webclient is available at `http://<host>:8080`. WebDAV is available at `http://<host>:8080/webdav`.

The admin UI is bound to `127.0.0.1:8081` by default so it is not exposed to the LAN. Open an SSH tunnel and use the one-time setup token from the logs:

```bash
ssh -L 8081:127.0.0.1:8081 user@your-nas
# then open http://localhost:8081/admin
```

If you intentionally want admin access from LAN/VPN, set `KEEPORT_ADMIN_BIND=0.0.0.0` or a VPN/LAN IP in `.env`, then recreate the container.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for backups, HTTPS reverse proxy setup, admin isolation, and mobile app configuration.

## Local development

Backend:

```bash
dotnet run --project src/KeePort.Api
```

Frontend dev servers:

```bash
cd web/vault && npm install && npm run dev
cd ../admin && npm install && npm run dev
```

To serve the built React apps from the .NET backend locally:

```bash
./scripts/build-web.sh
dotnet run --project src/KeePort.Api
```

The Vault UI is served at `/`, the Admin UI at `/admin`, and WebDAV at `/webdav`.

## Security model

- Master passwords and key files are entered only in the browser and are never sent to the KeePort API.
- The backend stores KDBX files as opaque binary objects; it does not parse vault contents.
- Vault writes require the current ETag (`If-Match` or `X-Expected-ETag`) so concurrent clients cannot overwrite each other silently.
- WebDAV credentials are separate app passwords stored as Argon2id hashes.
- Admin endpoints are hidden unless the request arrives on an admin port when `KeePort:AdminPorts` is configured.

Do not expose the admin port to the public internet. Use HTTPS for any public exposure of the vault client and WebDAV.

## Browser extension (planned)

A browser extension is not part of the initial release, but the backend is already prepared for it:

- `KeePort:CorsOrigins` allows configuring additional CORS origins for extension contexts without code changes.
- Authentication uses session cookies plus CSRF tokens; a token-based flow for extensions is planned on top of the existing session infrastructure.

No extension code ships yet – this section documents the intended basis only.

## Project layout

```text
src/KeePort.Api        ASP.NET Core backend, REST API, WebDAV, SQLite data layer
web/vault              React + TypeScript vault webclient
web/admin              React + TypeScript admin console
tests/KeePort.Api.Tests  xUnit integration/unit tests
docs/DEPLOYMENT.md     NAS/homeserver deployment guide
```

## License

MIT. See [`LICENSE`](LICENSE).
