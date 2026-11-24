# Plan: Admin-Konsole standardmäßig über HTTPS mit selbstsigniertem Zertifikat

- **Status:** umgesetzt, Abnahme auf der NAS offen. Geprüft:
  - Tests: 61/61 Backend, 13/13 Frontend.
  - Browser: „Create KDBX“ über `https://<IP>` mit selbstsigniertem Zertifikat funktioniert, die Anmeldeseite des Web-Vaults warnt über `http://<IP>`.
  - Docker-Image (Alpine): HTTPS-Admin-Port `200`, reines HTTP dorthin scheitert, Fingerabdruck im Log stimmt mit `openssl` überein, Zertifikatsdatei mit Rechten `600`, Container „healthy“.
- **Erstellt:** 2026-11-24
- **Zielversion:** 0.5.0 (neue Funktion, Changelog `## [0.5.0] - <Datum>`)

## Problem

„Create KDBX“ braucht die Web-Crypto-API des Browsers, die es nur in einem sicheren Kontext gibt (HTTPS oder `http://localhost`). Die Admin-Konsole läuft bisher über reines HTTP auf Port 8081. Für NAS-Nutzer bleiben deshalb nur umständliche Wege:

- **SSH-Tunnel:** Auf Synology muss dafür `AllowTcpForwarding` in `sshd_config` freigeschaltet werden, und DSM-Updates können das zurücksetzen.
- **Reverse Proxy mit Zugriffskontrollprofil:** scheitert ohne Hosts-Eintrag oder lokalen DNS am NAT-Loopback.
- **Tresor in KeePassXC anlegen und hochladen.**

Getestet am 2026-11-24: Chrome stellt über HTTPS mit selbstsigniertem Zertifikat, nach bestätigter Warnung, `window.isSecureContext = true` und `crypto.subtle` bereit. Über `http://<IP>` gibt es beides nicht.

## Ziel

Die Admin-Konsole ist ohne Zusatzwerkzeuge im LAN unter `https://<NAS-IP>:<Admin-Port>/admin` voll nutzbar. Der Browser warnt einmal vor dem selbstsignierten Zertifikat, danach funktioniert auch „Create KDBX“.

## Umsetzung

1. **HTTPS auf dem Admin-Port (Standard: an)**
   - Kestrel bedient Port 8081 über HTTPS, Port 8080 bleibt HTTP für Web-Vault und WebDAV hinter dem Reverse Proxy.
   - Abschalten mit `KEEPORT_ADMIN_HTTPS=false`, etwa wenn ein Reverse Proxy TLS übernimmt und intern per HTTP weiterleitet.
2. **Zertifikat**
   - Beim ersten Start erzeugt und in `/data/tls/admin.pfx` gespeichert. Es ist damit in Sicherungen enthalten und bleibt über Updates gleich, die Browser-Ausnahme muss also nicht neu bestätigt werden.
   - Selbstsigniert, ECDSA P-256, 5 Jahre gültig. Abgelaufene Zertifikate werden beim Start erneuert.
   - Subject Alternative Names: `localhost`, `127.0.0.1`, plus optional `KEEPORT_ADMIN_TLS_HOSTS` (z. B. NAS-IP und -Name). Damit stimmt wenigstens der Name, die Warnung wegen fehlender Vertrauenskette bleibt.
   - Der SHA-256-Fingerabdruck steht beim Start im Log. Vorsichtige Nutzer können ihn mit der Anzeige im Browser vergleichen.
3. **Cookies:** Admin-Sitzungscookies werden über HTTPS immer mit `Secure` gesetzt, unabhängig von `KEEPORT_COOKIE_SECURE`.
4. **Healthcheck:** bleibt auf Port 8080 per HTTP und ist nicht betroffen.
5. **Doku:** Die Anleitungen für Synology, QNAP und Linux-Server öffnen die Admin-Konsole unter `https://<IP>:<Port>/admin`. Ein Abschnitt erklärt die Browser-Warnung und den Fingerabdruck. SSH-Tunnel, Hosts-Eintrag und das Zugriffskontrollprofil entfallen als Empfehlung. Der Hinweis „Admin-Port nie ins Internet freigeben“ bleibt deutlich.
6. **Tests:**
   - Das Zertifikat wird erzeugt, wiederverwendet und erneuert.
   - Der Admin-Port antwortet per HTTPS und `KEEPORT_ADMIN_HTTPS=false` schaltet es ab.
   - Die Admin-Cookies tragen `Secure`.
   - Im Browser (Chrome mit akzeptiertem Zertifikat) funktioniert „Create KDBX“.

## Auswirkungen auf bestehende Installationen

- **Wer die Admin-Konsole bisher per `http://…:8081` öffnet, muss auf `https://` wechseln.** Ein Aufruf per HTTP auf den HTTPS-Port scheitert. Changelog und Startlog weisen darauf hin.
- **Ein Reverse Proxy, der intern per `http://localhost:<Admin-Port>` an die Admin-Konsole weiterleitet,** muss auf `https://` umgestellt werden (DSM prüft das Zertifikat des Ziels nicht), oder man setzt `KEEPORT_ADMIN_HTTPS=false`.

## Entscheidungen (2026-11-24, Sascha)

1. **HTTPS auf dem Admin-Port standardmäßig an.**
2. **`KEEPORT_ADMIN_BIND` Standard `0.0.0.0`**, mit deutlichem Hinweis, dass der Admin-Port nicht ins Internet gehört. Auf einem VPS setzt man `127.0.0.1` oder eine VPN-IP.
3. **Kein HTTPS für den Web-Vault**, den veröffentlichen Nutzer per Reverse Proxy. Was über reines HTTP nicht geht (Tresor entsperren), muss in der Oberfläche als Warnung sichtbar sein (Anmeldeseite und „Unlock vault“) und in der Doku stehen.

## Ursprünglich offene Fragen

1. **Standardmäßig an?** Empfehlung: ja. Es löst das Problem für Einsteiger, und wer TLS selbst macht, schaltet es mit einer Zeile ab.
2. **Standard für `KEEPORT_ADMIN_BIND`:** Bisher `127.0.0.1`, also nur per SSH-Tunnel erreichbar. Optionen:
   - a) So lassen, die NAS-Anleitungen setzen die LAN-IP (heutiger Stand).
   - b) `0.0.0.0` als Standard plus deutlichem Hinweis. Das ist einfacher, öffnet die Konsole aber auf jedem Netz des Hosts, auf einem VPS also im Internet, und Docker umgeht dabei Host-Firewalls.
   - Empfehlung: a). Für einen VPS wäre b) gefährlich, und das Setzen der LAN-IP ist in den NAS-Anleitungen ein einziger, schon beschriebener Schritt.
3. **Web-Vault (Port 8080) ebenfalls optional per HTTPS?** Bisher öffnen Nutzer den Web-Vault über ihre Domain mit echtem Zertifikat. Empfehlung: nicht in diesem Schritt.
