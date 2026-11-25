# Plan: Geöffneten Tresor im Web-Vault neu laden

- **Status:** abgeschlossen (2026-11-25), ausgeliefert in 0.8.0
- **Erstellt:** 2026-11-25
- **Zielversion:** 0.8.0 (neue Funktion, Changelog `## [0.8.0] - <Datum>`)

## Ausgangslage

Ändert eine KeePass-App (z. B. KeePass2Android über WebDAV) den Tresor, während er im Web-Vault geöffnet ist, sieht man die Änderung erst nach Sperren und erneutem Entsperren oder nach F5, jeweils mit erneuter Eingabe des Master-Passworts. Bei der Abnahme der Ordner (2026-11-25) hat Sascha dafür einen Aktualisieren-Knopf vorgeschlagen.

## Ziel

Ein Knopf **„Reload“** neben „Lock vault“ holt die aktuelle Datei vom Server und öffnet sie mit den Zugangsdaten, die noch im Browser sind. Eine erneute Passworteingabe ist nicht nötig.

## Umsetzung

- `reopenVault(bytes, credentials)` in `web/vault/src/lib/kdbx.ts` lädt KDBX-Bytes mit den vorhandenen `KdbxCredentials` des geöffneten Tresors. Das sind nur die abgeleiteten Hashes, nicht das Passwort im Klartext.
- In `App.tsx`:
  - Datei laden, neu öffnen, ETag und die zuletzt gespeicherten Bytes (`savedBytes`) übernehmen.
  - Die Dateiliste mit Revision und Zeitpunkt aktualisieren.
  - Der gewählte Ordner bleibt erhalten, solange er existiert. Die Auswahl wird auf noch vorhandene Einträge reduziert.
  - Der Hinweis „Vault reloaded …“ erscheint, bei unveränderter Datei „already up to date“.
- Während des Ladens sind Knopf, Speichern und Ordneraktionen gesperrt, und das Symbol dreht sich.
- Wird der Tresor währenddessen gesperrt, verwirft KeePort das Ergebnis (Generationszähler wie beim Speichern).
- Schlägt das Laden fehl, etwa wegen eines Netzwerkfehlers oder weil die Datei mit einem neuen Master-Passwort gespeichert wurde, bleibt der bisherige Stand geöffnet und eine Fehlermeldung erscheint. Bei geänderten Zugangsdaten lautet der Hinweis, den Tresor zu sperren und neu zu entsperren.
- Ein offenes Eintragsformular wird nicht angefasst. Der Knopf liegt hinter dem Formular und ist erst nach dem Schließen erreichbar.

## Tests

- Node-Test: Mit `reopenVault` und den Zugangsdaten eines geöffneten Tresors lässt sich eine von außen geänderte Datei laden. Falsche Zugangsdaten werden abgelehnt.
- Browser-Prüfung in einer Testinstanz: Tresor öffnen, die Datei über WebDAV wie eine KeePass-App ändern, „Reload“ drücken, die Änderung erscheint ohne Passworteingabe.

## Doku

- Changelog 0.8.0.

## Umsetzung (2026-11-25)

- `reopenVault` in `lib/kdbx.ts` meldet bei geänderten Zugangsdaten (`InvalidKey`) einen verständlichen Hinweis. `handleReload` in `App.tsx` lädt neu.
- Ist der ETag unverändert, lädt KeePort nicht neu und meldet „already up to date“.
- Der Knopf steht auch Nutzern mit Nur-Lese-Recht zur Verfügung.
- Geprüft:
  - Node-Test: Neuöffnen mit vorhandenen Zugangsdaten klappt, fremde Zugangsdaten werden abgelehnt.
  - Browser: Eine zweite Sitzung ändert den Tresor, „Reload“ zeigt die Änderung ohne Passwort, der Ordner bleibt gewählt, und das anschließende Speichern läuft ohne Konflikt.

## Abnahme (2026-11-25, Sascha, NAS mit 0.8.0)

- Reload-Test erfolgreich: Eine in KeePass2Android synchronisierte Änderung erscheint nach „Reload“ ohne Passworteingabe.
