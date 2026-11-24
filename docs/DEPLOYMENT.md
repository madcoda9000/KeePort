# KeePort deployment guide

This guide is for NAS/home-server deployments with Docker Compose. It assumes Docker and Docker Compose v2 are installed.

## 1. Start KeePort

```bash
git clone https://github.com/YOUR-ORG/keeport.git
cd keeport
cp .env.example .env
docker compose up -d --build
docker compose logs -f keeport
```

On first start with an empty database, KeePort prints a one-time setup token:

```text
KeePort first-run setup required. Open the admin UI and enter this one-time setup token: ...
```

The token is stored in `/data/keeport.db` and is disabled after the first admin account is created.

## 2. Reach the UIs safely

Default compose ports:

- `8080` — Vault webclient and WebDAV. Safe to publish on LAN/VPN.
- `8081` — Admin-only port, bound to `127.0.0.1` on the host by default.

Open the admin UI through an SSH tunnel:

```bash
ssh -L 8081:127.0.0.1:8081 user@your-nas
# browser: http://localhost:8081/admin
```

Enter the setup token, username, email address and password to create the first admin account. The setup token cannot be used again.

Admin accounts are only for the Admin console. Create a separate user account and assign vault permissions to it for the Vault webclient or WebDAV.

To allow admin access from LAN/VPN instead, edit `.env`:

```dotenv
KEEPORT_ADMIN_BIND=0.0.0.0
# or a specific LAN/VPN IP, e.g. 192.168.1.10
```

Then run `docker compose up -d`. Do not expose port `8081` to the public internet.

## 3. Data, permissions, and backups

KeePort stores everything under `/data`:

- `keeport.db` — users, sessions, vault metadata, ACLs, WebDAV credential hashes, and request limit settings.
- `vault/` — encrypted `.kdbx` files.

The container runs as UID/GID `1000:1000`. If you use a bind mount instead of the named volume, make it writable by that user:

```bash
sudo mkdir -p /srv/keeport/data
sudo chown -R 1000:1000 /srv/keeport/data
```

For a consistent backup, stop the container first, then archive the volume:

```bash
docker compose stop keeport
docker run --rm \
  -v keeport_keeport-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine tar czf /backup/keeport-$(date +%F).tgz -C /data .
docker compose start keeport
```

Restore by extracting the archive into a fresh volume while the container is stopped.

## 4. HTTPS and reverse proxy

Use HTTPS before publishing KeePort outside your LAN. A reverse proxy should terminate TLS and forward to the container.

Recommended split:

- Public/LAN vault domain → `127.0.0.1:8080`
- Admin domain/IP-restricted/VPN → `127.0.0.1:8081`

Caddy example:

```caddy
vault.example.com {
    reverse_proxy 127.0.0.1:8080
}

admin-vpn.example.com {
    @not_vpn not remote_ip 192.168.1.0/24 10.0.0.0/8
    respond @not_vpn 404
    reverse_proxy 127.0.0.1:8081
}
```

Nginx example for the vault/WebDAV host:

```nginx
server {
    listen 443 ssl;
    server_name vault.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

When serving over HTTPS, set:

```dotenv
KEEPORT_COOKIE_SECURE=true
```

Keep `/api/admin/*` and `/admin/*` off the public vault domain. If you must share one hostname, route `/admin` and `/api/admin` to the admin backend port and add IP allowlists or VPN-only access at the proxy.

### Request limits

Admin and Vault sign-in and first-run setup share a limit of 10 requests per minute per IP. Session checks (`me`, `csrf`) and sign-out are not part of that quota. WebDAV has a separate limit of 60 requests per minute per IP, including unauthenticated requests. A `429 Too Many Requests` response includes `Retry-After` when the limiter can estimate the wait.

To change the limits, sign in to the Admin console and open **Settings → Rate limits**. Enter positive whole numbers and save. The settings are stored in SQLite and take effect without a restart. Saving a different value starts a new window for that limit only. Upgrades start with the defaults; earlier environment overrides are no longer read.

Clients behind NAT or a proxy may share a quota if KeePort sees the same source IP. Set per-client limits at the proxy if it is the only component that sees individual client addresses.

## 5. WebDAV for mobile/desktop KeePass clients

1. Sign in to the Admin UI.
2. Create or select a user.
3. Open **WebDAV credentials** and create an app password for that user.
4. Give the user the generated WebDAV username and the app password.

Client settings:

- Server/URL: `https://vault.example.com/webdav`
- Username: the generated WebDAV username, not necessarily the login username.
- Password: the WebDAV app password.
- Do not use the master password as the WebDAV password.

Mobile clients to try (compatibility depends on how the client writes):

- iOS: [KeePassium](https://support.keepassium.com/kb/sync-webdav/) offers a direct WebDAV connection. Editing and syncing were verified on a device.
- Android: [KeePassDX](https://github.com/Kunzisoft/KeePassDX/wiki/File-Manager-and-Sync) uses Android's file picker, not a built-in WebDAV client. Configure the endpoint in a storage provider such as [DAVx⁵ WebDAV Mounts](https://manual.davx5.com/webdav_mounts.html), then open the file through that provider.
- Android: KeePass2Android connects directly via WebDAV. Saving, syncing and merging were verified on a device with the default transactional saves. Direct saves without transactional writes are covered by server tests (see below).
- Create one WebDAV app password per device. KeePort remembers which version each app password last downloaded (see below).

WebDAV users can only write files they are allowed to modify. Send the current ETag in `If-Match` for safe writes. Clients that never send `If-Match`, such as KeePass2Android, are checked against the version their app password last downloaded with `GET`. Without such a download and without `If-Match`, KeePort returns `428` and creates no copy. For a stale ETag, KeePort returns `412` and keeps the original unchanged.

Transactional saves are supported: a `PUT` to `<vault>.kdbx.tmp.<suffix>` or `<vault>_tmp_<suffix>.kdbx` (both used by KeePass2Android versions) is held for up to 15 minutes (at most 4 per app password) and only becomes the vault when the client sends `MOVE` onto exactly that vault. Such uploads never appear as separate vaults. `MOVE` cannot rename vaults, and `DELETE` on a vault stays forbidden. The submitted encrypted KDBX is saved as `<name>.conflict-<UTC timestamp>-webdav-<id>.kdbx` without access grants. An administrator can download, share, or delete it from the Admin file list. The Vault REST API follows the same rules but returns `409` for a stale ETag.

KeePort does not enforce server-side WebDAV locks. For authorized requests, `LOCK` returns a token that is not saved and `UNLOCK` returns `204 No Content` without changing any lock state. A lock token is not a substitute for an ETag.

KeePort logs every WebDAV request, including rejected sign-ins, to the container log and to SQLite. Administrators can review the latest 5,000 requests under **Logs → WebDAV logs** in the Admin console. The log shows the method, path, status, credential, client IP, `If-Match`, `Depth`, `Destination`, `Overwrite`, request size and duration. Passwords, the `Authorization` header and file contents are never logged.

## 6. Troubleshooting

- **A KeePass client cannot save**: open **Logs → WebDAV logs** and look at the `PUT` and `MOVE` requests right after the attempt. `404` on a temporary name means an unknown naming pattern. `428` means the client neither sent `If-Match` nor downloaded the vault first. `412` means the vault changed on the server.

- **No setup token in logs**: the admin already exists or setup is complete. Sign in at `/admin` or reset users via the admin UI.
- **Admin UI returns 404 on port 8080**: expected. Use port `8081`/admin bind or the admin reverse-proxy route.
- **Cannot write `/data`**: check volume permissions and UID/GID `1000:1000`.
- **WebDAV `412 Precondition Failed`**: reload the current vault and merge your changes before saving again. Ask an administrator for the conflict copy if you need the submitted version. In KeePass2Android, choose **Merge** when it reports an external change. The app has to download the server version to merge, so the merged save is checked against the current version.
- **WebDAV `428 Precondition Required`**: the client sent no `If-Match` and has not downloaded the vault with this app password yet. Reopen the vault from the server, then save again.
- **`429 Too Many Requests`**: wait for the `Retry-After` interval and check the request limits above if this happens often.

## 7. What the server can and cannot see

KeePort sees encrypted `.kdbx` bytes and file metadata such as names, sizes, revisions, owners, and ACLs. It does not see entry titles, passwords, URLs, or notes because those stay encrypted inside the KDBX container unless the user unlocks the vault in the browser webclient.
