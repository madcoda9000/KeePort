# Plan: Spalten ein- und ausblenden, Favicons in der KDBX speichern, Abgleich mit „Have I Been Pwned“

- **Status:** umgesetzt (2026-11-25), Abnahme auf der NAS ausstehend
- **Erstellt:** 2026-11-25
- **Zielversion:** 0.14.0 (neue Funktionen, Changelog `## [0.14.0] - <Datum>`)
- **Herkunft:** Vorschläge 13, 16 und 18 aus `docs/plans/open/2026-11-25-eintragsliste-spaeter.md`. Sascha hat die Umsetzung direkt beauftragt (2026-11-25), Vorschlag 12 (Tastaturkürzel) ist gestrichen.

## 1. Spalten ein- und ausblenden

- Rechts neben der Suche steht ein Knopf **„Columns“** (`DropdownMenu` mit `DropdownMenuCheckboxItem`). Damit lassen sich Username, Password, TOTP, Modified und Website ein- und ausblenden. Titel und Auswahl-Checkbox bleiben immer sichtbar.
- Die Auswahl gilt je Browser und wird in `localStorage` gespeichert, mit `try`/`catch`. Ohne Speicher gilt der Standard: alle Spalten an.
- Die gemeinsame `DataTable` bekommt dafür einen optionalen Platz für Aktionen neben der Suche (`searchActions`). Die Admin-Tabellen bleiben unverändert.
- Die Ausblendung auf schmalen Bildschirmen (z. B. „Modified“ erst ab `lg`) gilt zusätzlich weiter.

## 2. Favicon dauerhaft in der KDBX speichern

**Hindernis:** Der Browser kann ein fremdes Bild anzeigen, aber nicht auslesen, solange die Website das nicht per CORS erlaubt. Das tun die wenigsten. Auch ein Umweg über `canvas` scheitert, weil das Canvas dann als „tainted“ gilt.

**Lösung:** Holen über den KeePort-Server, nur auf ausdrücklichen Klick.

- **Bedienung:** Im Eintragsformular gibt es neben der Website einen Knopf **„Save website icon“**.
  - Er erscheint nur, wenn der Nutzer „Load website icons“ eingeschaltet hat, Schreibrecht besteht und die URL einen Hostnamen hat.
  - Der Hinweis im Tooltip: „KeePort fetches the icon from <host> once and stores it in the vault. The KeePort server sees the host name for this request.“
- **Endpunkt `GET /api/vault/favicon?host=<hostname>`:**
  - Er braucht eine Vault-Session und ist auf 30 Anfragen pro Minute begrenzt.
  - Er holt `https://<host>/favicon.ico`. Klappt das nicht, sucht er in `https://<host>/` nach `<link rel="icon">`, `<link rel="shortcut icon">` oder `<link rel="apple-touch-icon">` (nur https).
  - Zurück kommen höchstens 256 KB Bilddaten. Der Server liest, speichert und protokolliert keine Tresorinhalte; der Hostname erscheint nur auf Debug-Ebene im Log.
- **SSRF-Schutz** (wichtig, weil KeePort meist im Heimnetz läuft):
  - Nur `https`, Port 443, Hostnamen mit Punkt. IP-Literale und `localhost` werden abgelehnt.
  - Beim Verbindungsaufbau prüft ein `ConnectCallback` **jede** aufgelöste IP-Adresse, auch nach Weiterleitungen. Das schützt auch gegen DNS-Rebinding. Gesperrt sind:
    - Loopback, privat und Link-Local: `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`
    - Carrier-Grade NAT `100.64/10` und `0/8`
    - Multicast und reservierte Bereiche
    - IPv6: `::1`, `fc00::/7`, `fe80::/10`, IPv4-gemappte private Adressen
  - Höchstens 3 Weiterleitungen, Zeitlimit 8 s, Größenlimit wie oben.
  - Der Inhaltstyp muss `image/*` sein, für `.ico` auch `application/octet-stream`. Für die HTML-Suche gilt `text/html`, höchstens 512 KB.
- **Abschalten:** `KEEPORT_FAVICON_DOWNLOAD=false` schaltet den Endpunkt ganz ab, z. B. auf Servern ohne Internetzugang oder bei strengen Datenschutzvorgaben. Standard ist `true`.
- **Im Browser:**
  - Die Bilddaten werden über eine `data:`-URL dekodiert und auf 32×32 Pixel als PNG umgerechnet, wie KeePassXC es speichert.
  - Sie landen in `Meta/CustomIcons` mit Namen und Datum, der Eintrag bekommt `customIcon`.
  - Gleiche Bilder werden wiederverwendet statt doppelt gespeichert.
  - Gespeichert wird sofort, mit Rücknahme bei Fehlern.
  - KeePass2Android, KeePassXC und KeePassium zeigen das Symbol danach auch.

## 3. Abgleich mit „Have I Been Pwned“

- **Opt-in je Nutzer** in den Kontoeinstellungen: „Check passwords against Have I Been Pwned“, standardmäßig aus. Dazu kommt die neue Spalte `users.check_breaches`.
- **Verfahren (k-Anonymity):**
  - Der Browser berechnet SHA-1 des Passworts mit `crypto.subtle` und schickt nur die ersten 5 Hex-Zeichen an `https://api.pwnedpasswords.com/range/<prefix>`, mit dem Header `Add-Padding: true`, damit auch die Antwortgröße nichts verrät. Den Rest vergleicht er lokal.
  - Das Passwort und der vollständige Hash verlassen den Browser nie. Der Dienst sieht die IP-Adresse und den Hash-Anfang.
- **Wann:** Beim Öffnen des Sicherheitsberichts, wenn das Opt-in an ist, für alle unterschiedlichen Passwörter.
  - Höchstens 4 Anfragen laufen gleichzeitig, mit Fortschrittsanzeige.
  - Die Ergebnisse gelten nur für diese Sitzung und werden beim Sperren verworfen.
  - Ein Knopf „Check again“ wiederholt die Prüfung.
- **Anzeige:**
  - Eine neue Kachel **„Breached“**.
  - In der Liste bekommt das Passwort das Warnsymbol mit „Found in data breaches (n times)“.
  - Ist das Opt-in aus, zeigt die Kachel einen Hinweis mit Link zu den Einstellungen.
- **CSP:** Für Vault-Seiten gilt `connect-src 'self' https://api.pwnedpasswords.com`, für Admin und API unverändert.

## Tests

- **Backend:**
  - Hostname-Prüfung: IP-Literale, `localhost`, ohne Punkt, Sonderzeichen
  - IP-Sperrliste für IPv4, IPv6 und gemappte Adressen
  - Endpunkt: ohne Session 401, abgeschaltet 404, ungültiger Host 400
  - HTML-Suche nach Icon-Links
  - CSP mit `connect-src` nur für Vault-Seiten
  - Einstellung `checkBreaches`
- **Node:**
  - k-Anonymity-Abfrage mit nachgebildetem Dienst: nur der Präfix wird gesendet, Padding-Einträge mit 0 werden ignoriert, Treffer und Anzahl stimmen
  - Icon-Speicherung: Wiederverwendung gleicher Bilder, `customIcon` gesetzt
  - Spalten-Auswahl: Lesen und Schreiben, auch ohne `localStorage`
- **Browser:**
  - Spalten ein- und ausblenden, auch nach dem Neuladen
  - „Save website icon“ mit einem lokalen Test-Icon-Server
  - HIBP-Abgleich mit abgefangener API (kein echter Internetverkehr)

## Umsetzung (2026-11-25)

- **Backend:**
  - `Services/FaviconFetcher.cs` mit `IsValidHost`, `IsPublicAddress` und `FindIconLinks`; `ConnectCallback` mit IP-Prüfung, `UseProxy=false`
  - Endpunkt `GET /api/vault/favicon` mit Rate-Limit-Policy `favicon` (30/min) und Schalter `KeePort:FaviconDownload` / `KEEPORT_FAVICON_DOWNLOAD`
  - Spalte `users.check_breaches`
  - CSP mit `connect-src` für die HIBP-API, nur für Vault-Seiten
  - Tests in `FaviconFetcherTests.cs` sowie Endpunkt-, Einstellungs- und CSP-Tests
- **Frontend:**
  - Logik: `lib/breach.ts`, `lib/column-prefs.ts`, `lib/icon-image.ts`, `storeEntryIcon` in `lib/icons.ts`; Kachel „Breached“ in `security-report.tsx`
  - Gemeinsame `DataTable` mit `searchActions`
  - Tests in `breach.test.mjs`
- **Präzisierungen gegenüber dem Plan:**
  - **HIBP-Abgleich:** Er prüft beim erneuten Öffnen nur neue Passwörter. „Check again“ prüft alle.
  - **Proxys:** Der Favicon-Abruf ignoriert Proxy-Umgebungsvariablen, weil die IP-Prüfung sonst nur den Proxy sähe.
  - **Symbol im Formular:** Es erscheint jetzt im Titel des Eintragsformulars, damit man das gespeicherte Icon sofort sieht.
- **Geprüft:**
  - Backend: 130 Tests
  - Frontend: 41 Tests
  - Browser-Test in einer Testinstanz:
    - Spalten aus- und einblenden, auch nach dem Neuladen
    - HIBP-Abgleich gegen eine abgefangene API: nur 5-stellige Präfixe mit Padding, Kachel und Warnung
    - „Save website icon“ mit echtem Abruf von github.com über den Testserver; das Symbol steht danach in der KDBX
    - Lokale Adresse abgelehnt
  - Alle früheren Browser-Tests laufen weiter.
