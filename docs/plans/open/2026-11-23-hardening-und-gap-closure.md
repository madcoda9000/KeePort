# KeePort – Plan: Schließen der Analyse-Lücken (v0.2.0)

- **Status:** open
- **Erstellt:** 2026-11-23 (aus der Code-Analyse des Stands `c49b3a4`)
- **Zielversion:** 0.2.0 (SemVer; alle Pakete werden in der `CHANGELOG.md` unter `## [Unreleased]` → `0.2.0` dokumentiert)

## Hintergrund

Die Analyse vom 2026-11-23 hat ergeben, dass alle Kernanforderungen des Ursprungs-Prompts umgesetzt und verifiziert sind (Backend-Tests 3/3 grün, beide Frontend-Builds kompilieren, keine Inline-Scripts, keine Secrets im Storage). Dieser Plan bündelt die verbleibenden Lücken und Risiken aus der Analyse in umsetzbare Arbeitspakete. Reihenfolge und Umfang sind Vorschläge – offene Fragen stehen am Ende.

## Leitplanken (gelten für alle Pakete)

- Kein Code-Änderungs-Stil, der bestehende Konventionen bricht; minimal-invasiv.
- Sicherheit bleibt Standard: keine Dummy-Krypto, keine TODO-Stubs in sicherheitsrelevanten Pfaden.
- Jedes Paket aktualisiert `CHANGELOG.md` (Keep a Changelog 1.1.0); die Tests in `tests/KeePort.Api.Tests` werden wo sinnvoll erweitert.
- Keine Breaking Changes für bestehende Datenbanken (`/data/keeport.db` muss ohne Migration weiterlaufen).

---

## AP1 – Toter Client-Code entfernen (S)

**Status:** Erledigt. Die ungenutzte `getFile()`-Methode wurde entfernt; der Vault-Build ist grün.

**Befund:** `web/vault/src/lib/api.ts` enthält `getFile()` → `GET /api/vault/files/{id}`, einen Endpoint, den das Backend nicht bereitstellt (nur `GET /api/vault/files` und `GET /api/vault/files/{id}/content`). Die Methode ist ungenutzt.

**Änderung:** `getFile` aus `web/vault/src/lib/api.ts` entfernen (oder – falls die Metadaten-Ansicht geplant ist – den Endpoint im Backend ergänzen; Standard: entfernen).

**Akzeptanz:** `npm run build` in `web/vault` grün; `grep -rn "getFile(" web/vault/src` ohne Treffer.

---

## AP2 – KDBX-Inhaltsvalidierung beim Upload und bei Schreibzugriffen (S)

**Status:** Erledigt. Uploads und Schreibzugriffe prüfen die KDBX-Signatur. Gültige und ungültige Dateisignaturen sind durch API-Tests abgedeckt.

**Befund:** `VaultService.Create` und `VaultService.WriteContentAsync` prüfen nur „nicht leer“ und (beim Anlegen) die `.kdbx`-Endung. Korrupte oder falsche Dateien werden als gültige Revisionen akzeptiert.

**Änderung:** Zentrale Prüfung der KDBX-Signatur-Magic (`0x9AA2D903`, little-endian Bytes `03 D9 A2 9A`) am Dateianfang in `VaultService`; Verstoß → `VaultValidationException` (HTTP 400). Server-seitig nur Signatur prüfen – keine Vollvalidierung (Zero-Knowledge-Prinzip bleibt gewahrt, der Header ist nicht geheim).

**Betroffene Dateien:** `src/KeePort.Api/Services/VaultService.cs`, `tests/KeePort.Api.Tests/KeePortApiTests.cs`.

**Akzeptanz:** Upload/PUT mit Zufallsbytes → 400; gültige KDBX-Datei (Test-Fixture) → weiterhin 200/201; Tests decken beides ab.

---

## AP3 – Konfliktkopie bei Versionskonflikt (M)

**Status:** Erledigt. REST und WebDAV speichern gültige Konfliktkopien ohne ACLs; Tests decken parallele Writes, unverändertes Original, fehlende ETags und Sichtbarkeit ab.

**Befund:** Bei ETag-Konflikt wird der Schreibzugriff korrekt abgelehnt (409/412), aber verworfene Client-Daten gehen verloren. Der Prompt erlaubte „ablehnen **und/oder** Konfliktkopie“ – eine Kopie ist der sicherere Default.

**Änderung:** Bei Konflikt (nicht bei fehlendem ETag) speichert der Server die eingehende Version als `<name>.conflict-<UTC-Timestamp>-<client>-<id>.kdbx` im Vault-Verzeichnis (gleiches atomisches Schreibmuster). **Entscheidung (2026-11-23, Sascha):** Die Konfliktkopie erscheint als normale Datei in der Admin-Liste – kein extra Datenmodell, kein separater Status; sie erhält keine ACL-Einträge, ist also für normale User unsichtbar und für Admins (implizites read-write) sichtbar und löschbar. Response enthält Hinweis auf die Kopie. WebDAV analog.

**Betroffene Dateien:** `VaultService.cs`, `VaultEndpoints.cs`, `WebDavEndpoints.cs`, Tests. Kein Schema-Change nötig (normale `vault_files`-Zeile ohne `vault_permissions`-Einträge).

**Akzeptanz:** Stale-PUT erzeugt Konfliktkopie bei unverändertem ETag der Originaldatei; Original bleibt auf altem Stand; Tests prüfen Kopie-Erzeugung und atomaren Rename.

---

## AP4 – WebDAV-Client-Kompatibilitätstest (M, extern)

**Status:** Teilweise erledigt. HTTP-Verhalten am 2026-11-24 mit isoliertem Kestrel und zwei echten KDBX-Ständen geprüft: `PROPFIND` (207), übereinstimmende ETags bei Listing, `GET` und `HEAD`, `PUT` ohne ETag (428), mit aktuellem ETag (204) und mit altem ETag (412). Nach dem Konflikt blieb das Original unverändert; genau eine Konfliktkopie erschien im Admin.

**Android (2026-11-24):** Sascha konnte einen nach dem Argon2-Fix neu erstellten Tresor mit KeePass2Android per WebDAV öffnen. Mit deaktiviertem Datenbank-Caching lud die App nach einer Änderung im Web-Vault die Datei neu und zeigte die Änderung an. Mit aktiviertem Caching bot der Konfliktdialog „Überschreiben“ und „Zusammenführen“ an; beide versuchen einen Upload und scheiterten. Das Speichern scheiterte ebenfalls mit `Java.IO.FileNotFoundException`. Der Client-Code von v1.15-r6 lädt beim transaktionalen Speichern zuerst eine temporäre Datei hoch und meldet bei `404` diesen Fehler. Gegen isoliertes KeePort nachgestellt: `PUT` auf den temporären Pfad liefert `404`; ein direktes `PUT` ohne `If-Match` liefert `428`. Kein kompatibler Schreibpfad für diesen Client bestätigt. Ein Android-Schreibtest mit einem anderen Client und die iOS-Abnahme bleiben offen.

**Befund:** KeePort verlangt beim WebDAV-PUT ein aktuelles `If-Match` (428 wenn es fehlt). Die Schreibkompatibilität mit mobilen Clients hängt davon ab, ob sie diesen Header senden.

**Änderung:** Lokalen Container (`docker compose up -d --build`) starten, Test-Tresor anlegen, mit je einem echten iOS-/Android-Client synchronisieren. Auf Fehlverhalten: nur wenn nötig eine dokumentierte Fallback-Option (z. B. `If-Match: *` als explizit dokumentierte unsichere Option pro Credential) – **kein stiller Verzicht auf ETag-Prüfung**.

**Abnahme auf Mobilgeräten:**

1. Separaten Testtresor mit Schreibrecht und temporärem WebDAV-App-Passwort bereitstellen (HTTPS im LAN/VPN).
2. iOS: KeePassium direkt per WebDAV verbinden. Android: KeePassDX über einen Android-Dateianbieter wie DAVx⁵ WebDAV Mounts verbinden. App-, Anbieter- und OS-Version notieren.
3. Testtresor auflisten, öffnen, einen Testeintrag speichern und nach erneutem Download prüfen. Für den Konflikttest den Tresor in zwei Clients öffnen, im ersten speichern, danach im zweiten ohne Neuladen speichern.
4. Je Client HTTP-Status und vorhandenes `If-Match` protokollieren, keine Zugangsdaten. `428` heißt fehlendes `If-Match`; bei `412` darf das Original nicht überschrieben werden, und die Konfliktkopie muss im Admin erscheinen. Falls der Client selbst neu lädt, dieses Verhalten festhalten.

---

## AP5 – LOCK/UNLOCK: dokumentierte No-Locks-Entscheidung (S)

**Status:** Erledigt. README und Deployment-Doku beschreiben das Verhalten und verweisen auf ETags als Konfliktschutz.

**Befund:** `LOCK` gibt einen Token zurück, ohne ihn zu persistieren; `UNLOCK` ist immer 204. Das ist ein Stub, der „sauberes Handling“ nur minimal erfüllt.

**Entscheidung (2026-11-23, Sascha): Option B** – KeePort führt absichtlich keine serverseitigen WebDAV-Locks. Begründung: KeePass-Clients (KeePassXC, KeePassium, KeePassDX, Strongbox) brauchen echte Locks praktisch nie; ETag/`If-Match` ist das wirksame Konfliktschutzmittel.

**Änderung:** Doku in `docs/DEPLOYMENT.md` und README: LOCK/UNLOCK-Verhalten dokumentieren (Token ohne Persistierung, UNLOCK immer 204) und Clients darauf verweisen, dass serverseitige Locks nicht garantiert sind.

**Akzeptanz:** Doku-Abschnitt vorhanden; `CHANGELOG.md`-Eintrag; kein Code-Umbau.

---

## AP6 – Rate-Limiting differenzieren (S)

**Status:** Erledigt. Kontingente für Login/Setup und WebDAV sind über die Admin-Einstellungen änderbar, in SQLite gespeichert und sofort wirksam. Session-Endpunkte sind vom Login-Kontingent ausgenommen.

**Befund:** Das Limit (10/Min/IP) gilt für **alle** `/api/auth`-Endpoints inkl. `GET /me`, `GET /csrf`, `POST /logout` – hinter NAT können legitime Nutzer blockiert werden. WebDAV-Basic-Auth hat gar kein Limit.

**Änderung:** Limit nur auf mutierende Auth-Endpunkte (`setup`, `login`); Session-Endpunkte (`me`, `csrf`, `logout`) ausnehmen oder höheres Limit. Zusätzlich eine eigene, großzügigere Rate-Limit-Policy für `/webdav` (z. B. 60/Min/IP) gegen Brute-Force auf App-Passwörter.

**Betroffene Dateien:** `src/KeePort.Api/Program.cs` (Policies), ggf. `AuthEndpoints.cs` (Policy-Zuordnung), Tests.

**Akzeptanz:** Nach 10 Login-/Setup-Anfragen im selben Zeitfenster folgt für weitere Anfragen HTTP 429; parallele `/me`-Aufrufe sind nicht betroffen; das separate WebDAV-Limit ist vor Authentifizierung aktiv und konfigurierbar.

---

## AP7 – GitHub-Repository anlegen und pushen (S)

**Status:** Offen bis zum ersten Release. Der README-Platzhalter ist bereits in AP8 entfernt worden.

**Befund:** Prompt verlangt ein GitHub-Repository; aktuell nur lokaler `main` ohne Remote.

**Entscheidung (2026-11-23, Sascha):** Repo wird **https://github.com/madcoda9000/KeePort**, **öffentlich**, angelegt **zum ersten Release** (nicht vorher). AP7 bleibt bis dahin offen.

**Änderung:** Repo anlegen (public), `git remote add origin …`, pushen; README-Platzhalter `YOUR-ORG` durch `madcoda9000` ersetzen; Tag `v0.1.0` (bzw. erste Release-Version).

**Akzeptanz:** `git ls-remote origin` erfolgreich; README-Links funktionsfähig; LICENSE/CHANGELOG auf GitHub sichtbar.

---

## AP8 – Cleanups (S)

**Status:** Erledigt. CS1998-Warnungen sind behoben, die README-URL ist aktualisiert und der Ansatz für die Browser-Erweiterung ist dokumentiert.

- 6× CS1998-Warnings (`AuthEndpoints`, `VaultEndpoints`, `WebDavEndpoints`) durch Entfernen unnötiger `async`/`await` beseitigen.
- README: `YOUR-ORG`-Platzhalter entfernen (abhängig von AP7).
- Browser-Erweiterungs-Basis (`KeePort:CorsOrigins` + Token-Ansatz) als kurzer Abschnitt in README oder `docs/` dokumentieren – **Entscheidung (2026-11-23, Sascha): nur Doku, keine substanzielle Token-/CORS-Vorbereitung.**

**Akzeptanz:** `dotnet build` ohne CS1998-Warnings; README ohne Platzhalter.

---

## AP9 – CHANGELOG- und Plan-Pflege (laufend)

**Status:** Teilweise erledigt. Die abgeschlossenen Änderungen sind unter `## [Unreleased]` dokumentiert. Versionseintrag und Planabschluss bleiben bis zum Release offen.

Nach jedem Paket: `CHANGELOG.md`-Eintrag unter `## [Unreleased]` (Sektionen `Added`/`Changed`/`Fixed`/`Security`); bei Abschluss des Plans Eintrag `## [0.2.0] - <Datum>` und Plan-Status auf `done` setzen.

---

## AP10 – TOTP-Unterstützung im Vault-Client (M, Muss laut Sascha 2026-11-23)

**Status:** Erledigt. Der Vault kopiert Code und `otpauth://`-URI. Vorhandene URIs bleiben unverändert; für rohe Base32-Secrets wird die URI mit Standardparametern erzeugt. Am 2026-11-24 mit KeePassXC 2.7.6 im gleichen Zeitfenster und gegen die RFC-6238-SHA-1-Testvektoren verglichen; KDBX-Roundtrip erhält das `otp`-Feld.

**Befund:** KeePort ist ein Passwortmanager – TOTP (2FA) ist ein Kernfeature von KeePass. Aktuell werden nur Title/UserName/Password/URL/Notes gelesen und bearbeitet; das KeePass-`otp`-Feld (otpauth://-URL, KeePassXC-Konvention) wird weder angezeigt noch gepflegt.

**Änderung:**
- **Anzeigen:** `otp`-Feld im Entry-Detail auswerten; aktuellen 6-stelligen Code mit Countdown rendern; Copy-Buttons (Code, otpauth-URL).
- **Pflegen:** Im Bearbeiten-Formular ein TOTP-Feld (Secret oder otpauth://-URL) pflegen; wird als `otp`-Custom-Field gespeichert.
- **Krypto:** TOTP-Berechnung ausschließlich im Browser (zero-knowledge: Secret verlässt den Browser nie). Etablierte Bibliothek (z. B. `otpauth`) oder kleine WebCrypto-Implementierung (HMAC-SHA1, Base32) – Entscheidung in der Umsetzung, kein eigenes Crypto-Raten.
- Optional: Badge „hat TOTP" in der Entry-Liste (rein clientseitig).

**Betroffene Dateien:** `web/vault/src/lib/kdbx.ts`, `web/vault/src/lib/totp.ts` (neu), `web/vault/src/App.tsx`, ggf. `web/vault/package.json`, `CHANGELOG.md`.

**Akzeptanz:** Code aus Test-Eintrag stimmt mit KeePassXC bzw. unabhängiger TOTP-App überein; Bearbeiten/Speichern erhält das `otp`-Feld; `npm run build` grün.

---

## AP11 – Attachments-Verwaltung im Vault-Client (M)

**Status:** Erledigt. Sascha hat am 2026-11-24 bestätigt, dass die Anhangsverwaltung im Vault funktioniert. Name, Größe und Download sind auch im Lesemodus verfügbar. Schreibberechtigte können Dateien bis 10 MiB hinzufügen und nach Bestätigung aus dem aktuellen Eintrag entfernen; gespeichert wird verschlüsselt mit ETag. Alte Eintragsstände können Anhänge weiter enthalten. KDBX-Roundtrip, Download und Rücknahme nach abgelehntem Speichern sind automatisiert geprüft. KeePassXC 2.7.6 exportierte den gespeicherten Anhang bytegenau und fand ihn nach dem Entfernen nicht mehr im aktuellen Eintrag.

**Befund:** Attachments bleiben beim Speichern erhalten (`entry.binaries` wird von kdbxweb mitgeschrieben), aber es gibt keine UI: Weder Ansehen/Download noch Hinzufügen/Löschen. Nutzerfrage (2026-11-23): „Wie kann der User Attachments bearbeiten (löschen oder neue hinzufügen)?“

**Antwort:** Mit kdbxweb ist das sauber machbar – `entry.binaries` (Map Name → Binary/Ref), `db.createBinary()` für neue Anhänge, `entry.binaries.delete(name)` zum Entfernen. Alles clientseitig, zero-knowledge bleibt gewahrt.

**Änderung (Vorschlag):** Im Entry-Detail eine Attachment-Sektion: Liste (Name, Größe), Download (Blob-URL), Hinzufügen (File-Picker → `db.createBinary`), Löschen (mit Bestätigung). Größenlimit (z. B. 10 MB/Anhang) und Hinweis auf KDBX-Größenwachstum. Read-only-Modus: nur Download.

**Betroffene Dateien:** `web/vault/src/lib/kdbx.ts`, `web/vault/src/App.tsx` (+ CSS), `CHANGELOG.md`.

**Akzeptanz:** Anhang in Test-Tresor hinzufügen → in KeePassXC sichtbar; Download/Öffnen im Browser; Löschen funktioniert; Speichern mit ETag-Precondition; Read-only-User kann nur herunterladen.

---

## Vorschlag Reihenfolge

1. **AP1, AP2, AP8** (klein, risikoarm, sofort umsetzbar)
2. **AP10** (TOTP – Muss-Feature, nur Frontend)
3. **AP6** (Rate-Limiting, klein, sicherheitsrelevant)
4. **AP3, AP5** (Konfliktkopie + No-Locks-Doku; Entscheidungen getroffen)
5. **AP11** (Attachments-UI)
6. **AP7** (GitHub-Repo – erst zum ersten Release, geo. `madcoda9000/KeePort` public)
7. **AP4** (externer Client-Test, nach AP3 sinnvoll)

## Entscheidungen (2026-11-23, Sascha)

1. **GitHub (AP7):** Wird zum ersten Release angelegt als **https://github.com/madcoda9000/KeePort**, **öffentlich**.
2. **Konfliktkopie (AP3):** Normale Datei in der Admin-Liste (kein extra Datenmodell/Status).
3. **LOCK/UNLOCK (AP5):** Option B – dokumentiert keine serverseitigen Locks.
4. **Attachments-UI (AP11):** Download, Hinzufügen und Löschen wie in AP11 beschrieben.
5. **Browser-Erweiterung:** Nur Doku (AP8), keine substanzielle Token-/CORS-Vorbereitung.
6. **Neu (Muss):** TOTP-Unterstützung im Vault-Client → AP10.

## Noch offen

- **AP4:** Android-Schreibtest mit kompatiblem WebDAV-Client und iOS-Abnahme durchführen, einschließlich Konfliktverhalten.
- **AP7 / AP9:** Beim freigegebenen ersten Release das öffentliche Repository und den Release-Tag anlegen, den Changelog versionieren und den Plan nach `docs/plans/closed` verschieben.

## Risiken

- **AP3** berührt die Dateiverwaltung (neue `vault_files`-Zeilen für Konfliktkopien) – bestehende `/data`-Volumes dürfen nicht brechen.
- **AP4** kann nicht rein code-seitig abgeschlossen werden (braucht reale Geräte).
- **AP5** ist mit Option B nur noch Doku-Aufwand; kein Lock-Komplexität im WebDAV-Pfad.
