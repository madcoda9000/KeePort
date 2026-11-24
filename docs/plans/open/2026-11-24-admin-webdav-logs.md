# Admin: WebDAV-Logs

**Datum:** 2026-11-24

## Ziel

Admins sehen im Admin-Frontend unter **Logs → WebDAV logs**, welche WebDAV-Anfragen bei KeePort eingegangen sind und wie KeePort geantwortet hat. Anlass: Die Ursache der KeePass2Android-Speicherfehler (temporärer Name `home_tmp_<Ziffern>.kdbx`) war erst über dieses Protokoll sichtbar.

## Umfang

1. **Speicherung:** Jede WebDAV-Anfrage, auch abgewiesene `401`, wird in der SQLite-Tabelle `webdav_request_log` abgelegt. Gespeichert werden Zeitpunkt, Methode, Pfad, Status, Name des WebDAV-Zugangs, Client-IP, Dauer, Größe der Anfrage und die Header `If-Match` (nur ob vorhanden), `Depth`, `Destination` und `Overwrite`.
   - Nie gespeichert werden Passwörter, `Authorization` und Dateiinhalte.
   - Es bleiben die letzten 5000 Einträge erhalten, ältere werden beim Schreiben entfernt.
   - Fehler beim Protokollieren dürfen die WebDAV-Anfrage nicht beeinträchtigen.
   - Die Ausgabe auf der Konsole bleibt erhalten.
2. **API:** `GET /api/admin/logs/webdav` liefert die Einträge, neueste zuerst. Nur für Admins.
3. **Admin-Frontend:**
   - Neuer Sidebar-Menüpunkt „Logs“ mit dem Untermenüpunkt „WebDAV logs“ (shadcn `SidebarMenuSub`).
   - Die Tabelle nutzt die gemeinsame `DataTable` mit Live-Suche, Sortierung per Spaltenkopf und Seiten zu 10, 20 oder 50 Zeilen.
   - Ein Button lädt die Einträge neu.

## Tests

- Backend: WebDAV-Anfragen erscheinen im Log mit richtigem Status und Zugang. `401` wird ohne Zugang protokolliert. Kein Passwort steht in der Antwort. Nicht-Admins erhalten keinen Zugriff.
- Frontend: Build und Lint grün.

## Status

Umgesetzt: Backend-Tests 19/19 grün, Admin-Build fehlerfrei, keine neuen Lint-Warnungen. Offen ist die Sichtprüfung im Browser durch Sascha.
