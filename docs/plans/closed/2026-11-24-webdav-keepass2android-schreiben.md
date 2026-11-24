# WebDAV-Schreibkompatibilität mit KeePass2Android

**Datum:** 2026-11-24
**Bezug:** AP4 in `2026-11-23-hardening-und-gap-closure.md`

## Problem

KeePass2Android kann Tresore über WebDAV öffnen, aber nicht speichern (`Java.IO.FileNotFoundException`). Das betrifft auch „Überschreiben“ und „Zusammenführen“ im Konfliktdialog, weil beide hochladen.

Speicherablauf laut Quellcode von KeePass2Android (`WebDavStorage.java`, master):

- **Transaktional (Standard):** `PUT <name>.kdbx.tmp.<8 Ziffern>`, danach `PROPFIND` und `DELETE` auf `<name>.kdbx` (Fehler werden ignoriert), danach `MOVE` mit `Destination` und `Overwrite: T`.
- **Nicht transaktional:** direktes `PUT <name>.kdbx`.
- Es wird **nie** `If-Match` gesendet. Ein `404` wird zu `FileNotFoundException`.

KeePort antwortet derzeit: `PUT` auf den temporären Namen → `404`, `MOVE` → nicht unterstützt, direktes `PUT` ohne `If-Match` → `428`.

## Ziel

KeePass2Android kann speichern. Der Schutz vor versehentlichem Überschreiben (ETag-Prüfung, Konfliktkopie) bleibt erhalten. Die ETag-Prüfung wird nicht stillschweigend abgeschaltet.

## Änderungen

1. **Zuletzt ausgelieferter ETag pro WebDAV-Zugang** (neue Tabelle `webdav_read_state`):
   - Ein `GET` mit Inhalt über WebDAV merkt sich pro Zugang und Tresor den ausgelieferten ETag. `HEAD` und `PROPFIND` tun das nicht.
   - Fehlt beim Schreiben `If-Match`, gilt dieser ETag als erwarteter Stand. Gibt es keinen, bleibt es bei `428`.
   - Hat sich der Tresor seitdem geändert (z. B. im Web-Vault), folgt wie bisher `412` mit Konfliktkopie.
   - Nach erfolgreichem Schreiben wird der neue ETag gemerkt.
2. **Zwischenablage für temporäre Uploads:**
   - `PUT` auf `<vorhandener Tresor>.tmp.<1–64 alphanumerische Zeichen>` oder `<Name ohne .kdbx>_tmp_<Suffix>.kdbx` speichert. Das zweite Muster nutzt die installierte App-Version, gefunden im Serverprotokoll vom 2026-11-24, 09:1x: `PUT /webdav/home_tmp_17643505.kdbx`. Abgelegt wird in `<DataDir>/webdav-staging/` pro Zugang, ohne neuen Tresor anzulegen. Voraussetzung: Schreibrecht auf den Zieltresor und gültige KDBX-Signatur. Antwort `201`.
   - Höchstens 4 Einträge pro Zugang (ältere werden verworfen), Lebensdauer 15 Minuten.
   - `DELETE` auf einen solchen Namen entfernt den Eintrag.
3. **`MOVE`:**
   - Nur von einem temporären Namen auf genau den zugehörigen Tresor. Andere Ziele und das Umbenennen echter Tresore → `403`.
   - `Overwrite: F` → `412`. Fehlender oder ungültiger `Destination`-Header → `400`.
   - Schreiben über denselben Weg wie `PUT` (`WriteContentAsync`, Punkt 1). Der Zwischeneintrag wird danach immer entfernt.
4. `DELETE` auf echte Tresore bleibt `403`. KeePass2Android ignoriert das, und falls das `MOVE` scheitert, bleibt das Original erhalten.
5. `OPTIONS`/`Allow` nennt `MOVE`.

## Bewusste Einschränkungen

- Der gemerkte ETag gilt pro Zugang. Teilen sich mehrere Geräte ein App-Passwort, verwischt der Schutz. Empfehlung: ein App-Passwort pro Gerät.
- Wählt man in KeePass2Android ausdrücklich „Überschreiben“, nachdem die App den aktuellen Serverstand geladen hat, überschreibt die App ihn. Das ist eine Entscheidung im Client und kein stilles Überschreiben.

## Tests

- Transaktionaler Ablauf: GET → PUT tmp (201) → DELETE Ziel (403) → MOVE (204) → GET liefert neuen Stand.
- Direktes PUT ohne `If-Match` nach GET → 204. Ohne vorheriges GET → 428.
- Änderung über REST zwischen GET und MOVE → 412, Original unverändert, Konfliktkopie vorhanden.
- MOVE auf fremdes Ziel bzw. Umbenennen eines echten Tresors → 403. Nur-Lese-Recht → 403 beim tmp-PUT. Ungültige KDBX → 400.

## Abnahme

- Automatisierte Tests grün.
- Sascha speichert auf Android mit KeePass2Android (mit und ohne Datenbank-Caching) und prüft den Stand im Web-Vault. Danach Plan nach `docs/plans/closed` verschieben.

## Status

Erledigt (2026-11-24). Abnahme durch Sascha auf Android mit KeePass2Android und aktiviertem Datenbank-Caching:

- Handy → Server: Eintrag geändert und gespeichert. Im Serverprotokoll erscheint `PUT …_tmp_<n>.kdbx`, danach `MOVE`. Die Änderung ist im Web-Vault sichtbar.
- Server → Handy: Eintrag im Web-Vault geändert, auf dem Handy synchronisiert. Ohne lokale Änderungen lädt die App den Serverstand ohne Nachfrage, die Änderung ist korrekt da.
- Zusammenführen bei gleichzeitigen Änderungen auf Handy und Server: auf dem Gerät erfolgreich.
- Zusätzlich iOS mit KeePassium: Ändern und Synchronisieren erfolgreich.
