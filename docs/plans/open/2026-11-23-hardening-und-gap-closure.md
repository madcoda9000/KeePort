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

**Befund:** `web/vault/src/lib/api.ts` enthält `getFile()` → `GET /api/vault/files/{id}`, einen Endpoint, den das Backend nicht bereitstellt (nur `GET /api/vault/files` und `GET /api/vault/files/{id}/content`). Die Methode ist ungenutzt.

**Änderung:** `getFile` aus `web/vault/src/lib/api.ts` entfernen (oder – falls die Metadaten-Ansicht geplant ist – den Endpoint im Backend ergänzen; Standard: entfernen).

**Akzeptanz:** `npm run build` in `web/vault` grün; `grep -rn "getFile(" web/vault/src` ohne Treffer.

---

## AP2 – KDBX-Inhaltsvalidierung beim Upload und bei Schreibzugriffen (S)

**Befund:** `VaultService.Create` und `VaultService.WriteContentAsync` prüfen nur „nicht leer“ und (beim Anlegen) die `.kdbx`-Endung. Korrupte oder falsche Dateien werden als gültige Revisionen akzeptiert.

**Änderung:** Zentrale Prüfung der KDBX-Signatur-Magic (`0x9AA2D903`, little-endian Bytes `03 D9 A2 9A`) am Dateianfang in `VaultService`; Verstoß → `VaultValidationException` (HTTP 400). Server-seitig nur Signatur prüfen – keine Vollvalidierung (Zero-Knowledge-Prinzip bleibt gewahrt, der Header ist nicht geheim).

**Betroffene Dateien:** `src/KeePort.Api/Services/VaultService.cs`, `tests/KeePort.Api.Tests/KeePortApiTests.cs`.

**Akzeptanz:** Upload/PUT mit Zufallsbytes → 400; gültige KDBX-Datei (Test-Fixture) → weiterhin 200/201; Tests decken beides ab.

---

## AP3 – Konfliktkopie bei Versionskonflikt (M)

**Befund:** Bei ETag-Konflikt wird der Schreibzugriff korrekt abgelehnt (409/412), aber verworfene Client-Daten gehen verloren. Der Prompt erlaubte „ablehnen **und/oder** Konfliktkopie“ – eine Kopie ist der sicherere Default.

**Änderung:** Bei Konflikt (nicht bei fehlendem ETag) speichert der Server die eingehende Version als `<name>.conflict-<UTC-Timestamp>-<client>.kdbx` im Vault-Verzeichnis (gleiches atomisches Schreibmuster, als Konflikt markiert, nicht in normalen ACL-Listen sichtbar). Response enthält Hinweis auf die Kopie. WebDAV analog.

**Betroffene Dateien:** `VaultService.cs`, `KeePortDb.cs` (Status/Spalte oder separates Flag), `VaultEndpoints.cs`, `WebDavEndpoints.cs`, Admin-UI (Anzeige/Löschen von Konfliktkopien), Tests.

**Akzeptanz:** Stale-PUT erzeugt Konfliktkopie bei unverändertem ETag der Originaldatei; Original bleibt auf altem Stand; Tests prüfen Kopie-Erzeugung und atomaren Rename.

---

## AP4 – WebDAV-Client-Kompatibilitätstest (M, extern)

**Befund:** WebDAV-PUT verlangt zwingend `If-Match` (428 sonst). Das ist spec-konform, aber reale KeePass-Clients (KeePassium, KeePassDX, Strongbox) müssen in der Praxis verifiziert werden.

**Änderung:** Lokalen Container (`docker compose up -d --build`) starten, Test-Tresor anlegen, mit je einem echten iOS-/Android-Client synchronisieren. Auf Fehlverhalten: nur wenn nötig eine dokumentierte Fallback-Option (z. B. `If-Match: *` als explizit dokumentierte unsichere Option pro Credential) – **kein stiller Verzicht auf ETag-Prüfung**.

**Akzeptanz:** Ergebnisprotokoll (welche Clients mit welchen Headern erfolgreich sind) in diesem Plan-Doc nachgezogen; ggf. Follow-up-Aufgabe.

---

## AP5 – LOCK/UNLOCK sauber definieren (S–M)

**Befund:** `LOCK` gibt einen Token zurück, ohne ihn zu persistieren; `UNLOCK` ist immer 204. Das ist ein Stub, der „sauberes Handling“ nur minimal erfüllt.

**Änderung (Option A, bevorzugt):** Minimal-invasiv: LOCK/UNLOCK mit korrektem Protokollverhalten (Lock-Token persistieren, Refresh/Timeout, `423 Locked` wo nötig) oder
**Option B:** Explizit dokumentieren, dass KeePort absichtlich keine Server-Locks führt (WebDAV-Locks sind optional), und Clients darauf verweisen. Entscheidung in AP5-Umsetzung festhalten.

**Akzeptanz:** Entweder persistierte Locks mit Test oder klare Doku-Entscheidung im `docs/DEPLOYMENT.md`/README.

---

## AP6 – Rate-Limiting differenzieren (S)

**Befund:** Das Limit (10/Min/IP) gilt für **alle** `/api/auth`-Endpoints inkl. `GET /me`, `GET /csrf`, `POST /logout` – hinter NAT können legitime Nutzer blockiert werden. WebDAV-Basic-Auth hat gar kein Limit.

**Änderung:** Limit nur auf mutierende Auth-Endpunkte (`setup`, `login`); Session-Endpunkte (`me`, `csrf`, `logout`) ausnehmen oder höheres Limit. Zusätzlich eine eigene, großzügigere Rate-Limit-Policy für `/webdav` (z. B. 60/Min/IP) gegen Brute-Force auf App-Passwörter.

**Betroffene Dateien:** `src/KeePort.Api/Program.cs` (Policies), ggf. `AuthEndpoints.cs` (Policy-Zuordnung), Tests.

**Akzeptanz:** 10 Fehl-Logins/Min → 429; parallele `/me`-Aufrufe nicht betroffen; WebDAV-Limit aktiv und konfigurierbar.

---

## AP7 – GitHub-Repository anlegen und pushen (S, braucht Entscheidung)

**Befund:** Prompt verlangt ein GitHub-Repository; aktuell nur lokaler `main` ohne Remote.

**Änderung:** Repo auf GitHub anlegen (Owner/Name klären, Vorschlag: `KeePort`), `git remote add origin …`, pushen; README-Platzhalter `YOUR-ORG` durch echten Org-Namen ersetzen; ggf. Tag `v0.1.0`.

**Akzeptanz:** `git ls-remote origin` erfolgreich; README-Links funktionsfähig; LICENSE/CHANGELOG auf GitHub sichtbar.

---

## AP8 – Cleanups (S)

- 6× CS1998-Warnings (`AuthEndpoints`, `VaultEndpoints`, `WebDavEndpoints`) durch Entfernen unnötiger `async`/`await` beseitigen.
- README: `YOUR-ORG`-Platzhalter entfernen (abhängig von AP7).
- Optional: Dokumentation der Browser-Erweiterungs-Basis (`KeePort:CorsOrigins` + Token-Ansatz) als kurzer Abschnitt in README oder `docs/` – nur Doku, kein Code.

**Akzeptanz:** `dotnet build` ohne CS1998-Warnings; README ohne Platzhalter.

---

## AP9 – CHANGELOG- und Plan-Pflege (laufend)

Nach jedem Paket: `CHANGELOG.md`-Eintrag unter `## [Unreleased]` (Sektionen `Added`/`Changed`/`Fixed`/`Security`); bei Abschluss des Plans Eintrag `## [0.2.0] - <Datum>` und Plan-Status auf `done` setzen.

---

## Vorschlag Reihenfolge

1. **AP1, AP2, AP8** (klein, risikoarm, sofort umsetzbar)
2. **AP6** (Rate-Limiting, klein, sicherheitsrelevant)
3. **AP7** (Repo anlegen – braucht deine Entscheidung zu Owner/Name)
4. **AP3, AP5** (mittelaufwändig, Design-Entscheidungen nötig)
5. **AP4** (externer Client-Test, nach AP3 sinnvoll)

## Offene Fragen

1. **GitHub-Owner/Repo-Name** für AP7? (privat oder public?)
2. **Konfliktkopie (AP3):** Soll die Kopie als normale Datei in der Admin-Liste auftauchen, oder als separater, gekennzeichneter Status?
3. **LOCK/UNLOCK (AP5):** Option A (echte Locks) oder Option B (dokumentiert keine Locks)?
4. **Attachments-UI:** Attachments bleiben beim Speichern erhalten, aber es gibt keine Verwaltungs-UI – jetzt Theme oder bewusst weglassen?
5. **Browser-Erweiterung:** Nur Doku (AP8) oder soll die Token-/CORS-Basis jetzt schon substantiell vorbereitet werden?

## Risiken

- **AP3** berührt das Datenmodell (SQLite) – Migration muss abwärtskompatibel sein, bestehende `/data`-Volumes dürfen nicht brechen.
- **AP4** kann nicht rein code-seitig abgeschlossen werden (braucht reale Geräte).
- **AP5** Option A erhöht Komplexität im WebDAV-Pfad; Option B ist der pragmatische Default für KeePass-Clients.
