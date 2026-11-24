# Plan: Anzeigen, wo KeePort seine Daten ablegt

- **Status:** umgesetzt, Abnahme auf der NAS offen. Geprüft:
  - Tests: 67/67 Backend, 13/13 Frontend, `bash -n` für das Update-Skript.
  - Docker-Image mit Volume: Warnung im Startlog, Banner auf allen Admin-Seiten, Karte in Settings mit „Docker volume“.
  - Mit eingebundenem Ordner: Info-Zeile „host folder“.
  - Ohne Einbindung: Warnung „not mounted“.
- **Erstellt:** 2026-11-24
- **Zielversion:** 0.6.0 (neue Funktion, Changelog `## [0.6.0] - <Datum>`)

## Problem

Ohne `KEEPORT_DATA` in der `.env` legt KeePort alles im Docker-Volume `keeport_keeport-data` ab. Das passiert still. Auf der Synology lagen die Daten dadurch unter `/volume1/@docker/volumes/…`. File Station zeigt diesen Ordner nicht, Hyper Backup sichert ihn nicht, und der vorgesehene Ordner `keeport-data` blieb leer. Aufgefallen ist das nur zufällig (2026-11-24).

Ein Tippfehler oder eine vergessene Zeile in der `.env` führt so zu einer Installation ohne Sicherung, ohne dass es jemand merkt.

## Erkennung (geprüft am 2026-11-24)

Der Container kann aus `/proc/self/mountinfo` ablesen, woher `/data` kommt. Das vierte Feld ist der Pfad der Quelle auf ihrem Dateisystem:

| Fall | Feld 4 für `/data` (Beispiel) |
|---|---|
| Docker-Volume | `/var/lib/docker/volumes/keeport_keeport-data/_data` (Synology: `/@docker/volumes/…/_data`) |
| Eingebundener Ordner | `/srv/keeport/data` (Synology: `/docker/keeport-data`, relativ zu `/volume1`) |
| Nicht eingebunden | kein Eintrag (Daten liegen im Container und gehen beim Neuerstellen verloren) |

Regel: Enthält der Pfad `/volumes/<name>/_data`, ist es ein Docker-Volume. Sonst ist es ein eingebundener Ordner. Ohne Eintrag ist das Verzeichnis nicht eingebunden. Läuft KeePort außerhalb von Docker (`dotnet run`) oder ist die Datei nicht lesbar, lautet das Ergebnis „unbekannt“, und es gibt keine Warnung.

Auf der Synology ist der Pfad eines eingebundenen Ordners relativ zum Speichervolume (`/docker/keeport-data` statt `/volume1/docker/keeport-data`). Die Anzeige sagt das dazu.

## Umsetzung

1. **Erkennung** als testbare Funktion `DataLocation.Detect(mountinfo, dataDir)`. Sie liefert die Art (Docker-Volume, eingebundener Ordner, nicht eingebunden, unbekannt), den Quellpfad und bei Volumes den Namen.
2. **Startlog:**
   - Eingebundener Ordner: Info-Zeile, z. B. `Data directory /data is the host folder /docker/keeport-data.`
   - Docker-Volume: **Warnung**, z. B. `Data is stored in the Docker volume keeport_keeport-data … NAS backup tools such as Hyper Backup or Hybrid Backup Sync don't include it. Set KEEPORT_DATA to a folder to back it up with them (see DEPLOYMENT.md → Backup & restore).`
   - Nicht eingebunden: **Warnung**, dass die Daten beim Neuerstellen des Containers verloren gehen.
3. **Admin → Settings:** eine neue Karte „Data storage“ (shadcn `Card`, `Badge`, `Alert`) mit Art und Pfad der Datenablage. Bei Docker-Volume oder fehlender Einbindung steht dort ein Hinweis mit Link zur Anleitung. Die Daten kommen über einen neuen Admin-Endpunkt `GET /api/admin/settings/storage`.
4. **Doku:**
   - DEPLOYMENT.md, „Backup & restore“: wo man die Anzeige findet, und ein Abschnitt „Move data from the Docker volume to a folder“ mit den am 2026-11-24 auf der Synology erprobten Befehlen (stoppen, Volume in den Ordner kopieren, `chown 1000:1000`, `KEEPORT_DATA` setzen, starten, mit `docker inspect` prüfen, altes Volume erst danach löschen).
   - Synology- und QNAP-Anleitung: ein Prüfschritt nach der Installation („Admin → Settings zeigt *Host folder*“).
   - Klarstellen, dass `./…` relativ zum Ordner mit der `docker-compose.yml` ist und damit **im** Programmordner landet. Empfohlen wird ein absoluter Pfad außerhalb.
5. **Tests:** Unit-Tests für die Erkennung mit echten Beispielzeilen (Linux-Volume, Synology-Volume, eingebundener Ordner, nicht eingebunden, leere oder unlesbare Datei), dazu ein API-Test für den Endpunkt (nur Admins).

## Nicht im Umfang

- Automatischer Umzug der Daten. Das wäre fehleranfällig, und die Befehle stehen in der Doku.
- Freien Speicherplatz anzeigen.

## Entscheidungen (2026-11-24, Sascha)

1. **Zusätzlich ein Banner über allen Seiten der Admin-Konsole**, solange die Daten im Docker-Volume liegen oder nicht eingebunden sind. Das Banner verlinkt auf die Karte in Settings und auf die Anleitung.
2. **Das Update-Skript kommt ins Repository** als `scripts/keeport-update.sh`, wird in DEPLOYMENT.md beschrieben und warnt ebenfalls, wenn die Daten im Docker-Volume liegen. Es wird mit diesem Plan in 0.6.0 ausgeliefert.

## Ursprünglich offene Fragen

1. **Warnung zusätzlich prominent in der Admin-Konsole**, etwa als Banner über allen Seiten, solange die Daten im Docker-Volume liegen? Empfehlung: nein. Die Karte in Settings und das Startlog reichen. Ein Docker-Volume ist kein Fehler, nur für NAS-Sicherungen ungünstig.
2. **Sollte das Update-Skript** künftig ins Repository (z. B. `scripts/keeport-update.sh`) und dabei die Datenablage ebenfalls anzeigen? Empfehlung: ja, als eigenes kleines Thema.
