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

Enter the setup token and create the first admin account. The setup token cannot be used again.

To allow admin access from LAN/VPN instead, edit `.env`:

```dotenv
KEEPORT_ADMIN_BIND=0.0.0.0
# or a specific LAN/VPN IP, e.g. 192.168.1.10
```

Then run `docker compose up -d`. Do not expose port `8081` to the public internet.

## 3. Data, permissions, and backups

KeePort stores everything under `/data`:

- `keeport.db` — users, sessions, vault metadata, ACLs, WebDAV credential hashes.
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

Mobile examples:

- iOS: KeePassium supports WebDAV sync. Add the WebDAV URL above and the generated credentials.
- Android: KeePassDX supports WebDAV sync. Use the same URL/credentials.
- Other clients: any KeePass-compatible client with WebDAV support can use the same endpoint.

WebDAV users can only write files they are allowed to modify. KeePass clients should send `If-Match`/ETag for safe writes; KeePort returns `412` on stale versions instead of overwriting silently.

## 6. Troubleshooting

- **No setup token in logs**: the admin already exists or setup is complete. Sign in at `/admin` or reset users via the admin UI.
- **Admin UI returns 404 on port 8080**: expected. Use port `8081`/admin bind or the admin reverse-proxy route.
- **Cannot write `/data`**: check volume permissions and UID/GID `1000:1000`.
- **WebDAV `412 Precondition Failed`**: the vault changed elsewhere. Re-download/reload in the client and retry.
- **Login rate limited**: auth endpoints allow 10 requests per minute per IP by default.

## 7. What the server can and cannot see

KeePort sees encrypted `.kdbx` bytes and file metadata such as names, sizes, revisions, owners, and ACLs. It does not see entry titles, passwords, URLs, or notes because those stay encrypted inside the KDBX container unless the user unlocks the vault in the browser webclient.
