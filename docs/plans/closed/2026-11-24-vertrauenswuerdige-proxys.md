# Plan: Echte Client-IP hinter Reverse Proxys (vertrauenswürdige Proxys)

- **Status:** closed (2026-11-24). Umgesetzt wie geplant, ohne die optionale Anzeige in Admin → Settings (AP3), entsprechend Entscheidung 1. Tests: 36/36 Backend, 13/13 Frontend. Am laufenden Container geprüft: Eine Anfrage vom Host kommt über das Docker-Gateway `172.18.0.1`, und das Log meldet genau diese Adresse als einzutragenden Proxy. Startabbruch bei `0.0.0.0/0` geprüft.
- **Erstellt:** 2026-11-24
- **Zielversion:** 0.2.0 (neue Einstellung → Minor-Version, Changelog `## [0.2.0] - <Datum>`)

## Problem

KeePort übernimmt `X-Forwarded-For` und `X-Forwarded-Proto` nur von Verbindungen über `127.0.0.1` bzw. `::1`. Das ist der Standard von ASP.NET Core, wenn `KnownProxies`/`KnownNetworks` nicht gesetzt sind (`Program.cs:118`, `ForwardLimit = 1`).

In typischen Installationen kommt der Proxy aber nicht über Loopback:

| Installation | Absender aus Sicht des Containers |
|---|---|
| DSM- oder QTS-Reverse-Proxy auf der NAS → veröffentlichter Port | Gateway des Docker-Netzes (z. B. `172.18.0.1`) |
| Caddy/nginx auf dem Host → veröffentlichter Port | Gateway des Docker-Netzes |
| Caddy/nginx/Traefik als eigener Container | IP des Proxy-Containers |
| Proxy auf einem anderen Rechner im LAN | LAN-IP dieses Rechners |

Folgen:

1. **Rate-Limits:** Alle Clients teilen sich ein Kontingent (Partitionierung nach `RemoteIpAddress`, `Program.cs:212–217`). Mehrere Geräte, die gleichzeitig synchronisieren, können sich gegenseitig `429` einhandeln. Ein Angreifer von außen fällt nicht gezielt auf, sondern blockiert alle.
2. **WebDAV-Logs** (`WebDavEndpoints.cs:85`) und **Sitzungen** (`SessionService.cs:52`) zeigen bzw. speichern für jeden Client die Proxy-Adresse.
3. `Request.Scheme` bleibt `http`, obwohl der Client HTTPS nutzt. Funktional betrifft das derzeit nichts, weil `CookieSecure` über die Konfiguration gesetzt wird.

Die Reihenfolge der Middleware stimmt bereits: `UseForwardedHeaders` läuft vor Rate-Limiter, CORS und WebDAV-Authentifizierung. Es fehlt nur die Konfiguration der vertrauenswürdigen Absender.

## Ziel

Admins können festlegen, welchen Proxys KeePort die weitergereichte Client-IP glaubt. Danach sehen Rate-Limits, WebDAV-Logs und Sitzungen die echte Client-IP. Ohne Konfiguration bleibt alles wie heute. Es gibt **kein** pauschales Vertrauen in beliebige Absender.

## Leitplanken

- **Sicher als Standard:** Ohne Einstellung wird weiterhin nur Loopback vertraut.
- **Kein „vertraue allen“:** `0.0.0.0/0` und `::/0` werden abgelehnt. Wer jedem Absender vertraut, erlaubt jedem Client, seine IP per `X-Forwarded-For` zu fälschen und so Rate-Limits zu umgehen, etwa beim Durchprobieren von WebDAV-Passwörtern.
- **Fail fast:** Ungültige Einträge brechen den Start mit klarer Meldung ab statt still ignoriert zu werden.
- **Keine Geheimnisse in Logs**, wie bisher.

## Arbeitspakete

### AP1 – Konfiguration `KeePort:TrustedProxies` (S)

- Neue Einstellung, kommagetrennt, mit einzelnen IPs und CIDR-Netzen, IPv4 und IPv6. Beispiel: `172.18.0.1, 192.168.1.10, 10.10.0.0/16`.
- Compose: `KeePort__TrustedProxies: ${KEEPORT_TRUSTED_PROXIES:-}`. In `.env.example` kommentiert mit Beispielen.
- Parser als eigene, testbare Klasse (z. B. `Security/TrustedProxyOptions.cs`):
  - Einzel-IP → `KnownProxies`.
  - CIDR → `KnownNetworks` (`Microsoft.AspNetCore.HttpOverrides.IPNetwork`).
  - Loopback bleibt immer vertrauenswürdig (Standardverhalten, `KnownProxies`/`KnownNetworks` werden ergänzt, nicht ersetzt).
  - Leere Einträge und Leerzeichen tolerieren.
  - Ungültige Einträge, Präfixlänge außerhalb des Bereichs, `0.0.0.0/0` und `::/0` → Startabbruch mit Meldung, die den Eintrag nennt.
- IPv4-Adressen auch in der IPv6-Schreibweise (`::ffff:a.b.c.d`) berücksichtigen, da Kestrel Dual-Stack-Sockets nutzt.

### AP2 – Einheitliche Darstellung der Client-IP (S)

- Hilfsfunktion `ClientIp.Format(IPAddress?)`, die IPv4-in-IPv6 in reines IPv4 umwandelt (bisher nur in `WebDavEndpoints.FormatRemoteIp`).
- Verwenden in Rate-Limit-Partition, WebDAV-Log und Sitzung. So zählen `::ffff:192.168.1.5` und `192.168.1.5` als derselbe Client.

### AP3 – Diagnose für Admins (S)

- Beim Start eine Log-Zeile mit den vertrauenswürdigen Proxys (bzw. „only loopback“).
- Hinweis, wenn eine Anfrage `X-Forwarded-For` trägt, der Absender aber nicht vertraut ist. Höchstens einmal pro Absender-IP und Stunde loggen, damit das Log nicht volläuft. Der Text nennt die Absender-IP und `KEEPORT_TRUSTED_PROXIES`.
- Optional, nach Rückmeldung: Diese Information auch in **Admin → Settings** anzeigen („Requests with X-Forwarded-For from untrusted address 172.18.0.1 – add it to KEEPORT_TRUSTED_PROXIES“).

### AP4 – Tests (M)

Integrationstests über `TestServer.SendAsync`, das `Connection.RemoteIpAddress` setzen kann:

- Ohne Konfiguration: `X-Forwarded-For` von `172.18.0.1` wird ignoriert, das WebDAV-Log zeigt `172.18.0.1`.
- Mit `TrustedProxies=172.18.0.1`: Das Log zeigt die IP aus `X-Forwarded-For`, und zwei Clients mit unterschiedlicher IP haben getrennte WebDAV-Kontingente (der eine erhält `429`, der andere nicht).
- CIDR-Eintrag wirkt für eine Adresse im Netz und nicht außerhalb.
- Gefälschte Kette `X-Forwarded-For: 1.2.3.4, 5.6.7.8` von einem vertrauenswürdigen Proxy: Bei `ForwardLimit = 1` zählt nur der letzte Eintrag.
- Parser-Unit-Tests: gültige und ungültige Einträge, `0.0.0.0/0` und `::/0` abgelehnt, IPv6.

### AP5 – Doku und Changelog (S)

- DEPLOYMENT.md:
  - Konfigurationstabelle um `KEEPORT_TRUSTED_PROXIES` erweitern.
  - In den Abschnitten zu Synology, QNAP und Linux-Server je ein Schritt: „Nach dem Einrichten des Reverse Proxys in **Logs → WebDAV logs** die Client-IP ablesen (das ist der Proxy) und in `KEEPORT_TRUSTED_PROXIES` eintragen“.
  - Den bisherigen Hinweis zur Einschränkung durch die neue Anleitung ersetzen und erklären, warum man nicht ganze private Netze freigeben sollte.
- README: Zeile in der Konfigurationstabelle.
- CHANGELOG: `## [0.2.0] - <Datum>` mit Added/Changed.

## Entscheidungen (2026-11-24, Sascha)

1. **Konfiguration nur per `.env`**, nicht in Admin → Settings. Infrastruktur-Konfiguration steht beim Start fest.
2. **Mehrstufige Proxys** (z. B. Cloudflare → DSM → KeePort): **erst einmal nicht**. `ForwardLimit` bleibt 1.
3. **Keine Abkürzung für Docker-Netze**. Admins tragen die konkrete Adresse aus dem WebDAV-Log ein.
4. **Zusätzlich (Doku):** DEPLOYMENT.md erklärt, was `KEEPORT_ADMIN_BIND=0.0.0.0` bedeutet: Die Admin-Konsole ist dann auf allen Netzwerkschnittstellen des Hosts erreichbar, also im ganzen Subnetz, in VPN- und Docker-Netzen und bei Portweiterleitung oder öffentlicher IP auch aus dem Internet. Docker-Portfreigaben umgehen Host-Firewalls wie `ufw`.

## Risiken

- **Falsch konfiguriertes Vertrauen** (z. B. ganzes LAN-Netz) erlaubt IP-Fälschung über `X-Forwarded-For` und damit das Umgehen der Rate-Limits. Gegenmaßnahmen: kein Wildcard-Eintrag, klare Doku, Startlog.
- **Wechselnde Docker-Gateway-Adressen:** Wird das Compose-Netz neu angelegt, kann sich die Gateway-IP ändern, und die Einstellung passt nicht mehr. Dann sieht KeePort wieder die Proxy-Adresse, und AP3 macht das im Log sichtbar. Optional: festes Subnetz in der Compose-Datei dokumentieren.
- **Bestehende Installationen:** Ohne neue Einstellung ändert sich nichts.

## Reihenfolge

AP1 → AP2 → AP4 (parallel zu AP3) → AP5.
