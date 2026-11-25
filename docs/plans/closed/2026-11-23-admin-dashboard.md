# KeePort – Plan: Admin-Dashboard

- **Datum:** 2026-11-23
- **Status:** abgeschlossen (2026-11-25), ausgeliefert in 0.10.0
- **Ziel:** Nach dem Admin-Login auf einen Blick sehen, ob KeePort erreichbar ist, welcher Build läuft und wie viele Tresore, Nutzerkonten und fehlgeschlagene Anmeldungen es gibt.

## Ausgangslage

Die Admin-Oberfläche startet auf der Tresorliste. KeePort speichert Konten, KDBX-Dateimetadaten und die letzte erfolgreiche Anmeldung je Konto in SQLite. Fehlgeschlagene Anmeldungen werden nicht dauerhaft gezählt. Docker prüft bereits `/api/health`; der Endpunkt liefert derzeit nur den Status des laufenden Dienstes und die Uhrzeit. Der Container hat keinen Zugriff auf den Docker-Daemon.

## Anzeigen für die erste Version

| Bereich | Anzeige | Bedeutung / Datenquelle |
|---|---|---|
| Dienststatus | KeePort-Anwendung verfügbar bzw. Daten nicht abrufbar; Startzeit und Laufzeit | Antwort des Admin-Backends; kein Rückschluss auf den Zustand des gesamten Docker-Hosts |
| Version | KeePort-Version, optional Build-Commit, .NET-Runtime und Betriebssystem/Architektur | Version aus den Build-Metadaten, nicht aus einem veränderlichen Image-Tag wie `latest`; unbekannte Werte ausweisen |
| Netzwerk | Lokale IP-Adresse(n) und Ports der KeePort-Instanz; optional konfigurierte öffentliche URL | Unter Docker ausdrücklich als Container-IP kennzeichnen. Bei lokaler Ausführung die Adresse der Instanz anzeigen. Keine Host-, WAN- oder Proxy-IP erraten |
| Tresore (Stores) | Anzahl nicht gelöschter KDBX-Tresore; gelöschte optional separat | SQLite-Metadaten; keine Tresorinhalte lesen oder entschlüsseln |
| Konten | Gesamtzahl, aktive und deaktivierte Konten; Aufteilung nach Benutzer- und Admin-Rolle | SQLite; „aktiv“ bedeutet nicht deaktiviert, nicht aktuell online |
| Anmeldungen | Erfolgreiche und fehlgeschlagene Anmeldungen in 24 Stunden und 7 Tagen, getrennt nach Admin und Vault | Neue, datensparsame Zähler. Eine Ablehnung durch das Rate-Limit (HTTP 429) kann später separat erscheinen, zählt aber nicht als falsche Anmeldung |

### Ergänzungen (2026-11-25)

Seit dem Plan sind mehrere Funktionen dazugekommen, deren Zustand auf das Dashboard gehört:

| Bereich | Anzeige | Datenquelle |
|---|---|---|
| Datenablage | Host-Ordner, Docker-Volume oder nicht eingebunden, mit Warnung | vorhandene Erkennung `DataStorageInfo` (0.6.0) |
| Admin-Zugang | HTTPS an oder aus, Fingerabdruck und Ablaufdatum des selbstsignierten Zertifikats, Admin-Ports | Startkonfiguration (0.5.0) |
| Proxys | vertrauenswürdige Proxys, wie im Startprotokoll | `TrustedProxyList.Describe()` (0.4.0) |
| WebDAV | Anfragen und Fehler (Status ≥ 400) in 24 Stunden, abgelehnte veraltete Schreibvorgänge (412), letzte Anfrage, aktive App-Passwörter | `webdav_request_log` (letzte 5000 Einträge) und `webdav_credentials` |
| Konfliktkopien | Anzahl offener Konfliktkopien, die ein Admin prüfen sollte | `vault_files` mit `.conflict-` im Namen |

Ports werden als Ports **im Container** beschriftet. Die Host-Ports aus der `.env` kennt KeePort nicht.

**Docker-Grenze:** Ohne Host-Integration zeigt das Dashboard den Status der KeePort-Anwendung, nicht `docker ps`, den Docker-Healthcheck-Status oder die Docker-Engine-Version. Für diese Felder steht in der Standardinstallation „Nicht verfügbar“. Falls echte Docker-Werte gebraucht werden, ist eine getrennte, optionale Host-Integration zu planen, die nur die benötigten Statuswerte und die Engine-Version bereitstellt. Kein Docker-Socket im KeePort-Container (auch nicht `:ro`), keine erhöhten Rechte. Ob der Container komplett ausgefallen ist, kann nur ein externer Monitor zuverlässig anzeigen.

## AP1 – Systemdaten und Bestandszahlen bereitstellen

- Read-only-Endpunkt `GET /api/admin/dashboard` unter der bestehenden Admin-Port-Sperre und mit gültiger Admin-Session; öffentliche `/api/health` unverändert lassen.
- Startzeit beim Prozessstart erfassen und Versionsinformationen bereits beim Build setzen. Laufzeit, lokale Adressen und Versionsinformationen getrennt von den SQLite-Zahlen ermitteln. Nicht ermittelbare Werte als solche zurückgeben.
- Bestandszahlen per aggregierter SQL-Abfrage lesen, ohne vollständige Konto- oder Dateilisten zu laden. Soft-gelöschte Tresore separat zählen.

## AP2 – Anmeldeergebnisse datensparsam zählen

- In beiden Web-Login-Endpunkten erfolgreiche Anmeldungen sowie vom Handler abgelehnte Anmeldungen zählen; Setup, Logout, WebDAV und KDBX-Entsperrung nicht einbeziehen. Einheitliche generische Fehlermeldung bei abgelehnter Anmeldung beibehalten.
- SQLite-Migration mit UTC-Zeitfenstern und atomarer Zählererhöhung nach Kanal und Ergebnis; Zeitfenster für Anzeige und Tests eindeutig festlegen. Automatische Bereinigung nach vorgeschlagenen 30 Tagen, keine personenbezogenen Einzelereignisse speichern (keine IP, keine Benutzernamen, keine Kennwörter oder Tokens).
- Kennzeichnen, seit wann Daten erfasst werden. Fehler beim Zählen dürfen die Anmeldeentscheidung nicht ändern; unvollständige oder nicht abrufbare Daten nicht als null Fehlversuche ausgeben. Rate-Limit-Metriken erst zusammen mit der Rate-Limit-Differenzierung aus dem Hardening-Plan ergänzen.

## AP3 – Dashboard in die Admin-Oberfläche einbauen

- Das `Dashboard` ersetzt die Tresorliste als Standard-Startseite von `/admin/` und öffnet sich unmittelbar nach erfolgreicher Admin-Anmeldung ohne weiteren Klick. Es steht an erster Stelle in der Sidebar.
- Vorhandene shadcn/ui-Komponenten für Status, Systemdaten, Tresore, Konten und Anmeldungen verwenden; keine Charts für die erste Version nötig.
- Hell-/Dunkelmodus und mobiles Layout beibehalten. Manuelle Aktualisierung und Zeitpunkt der letzten erfolgreichen Abfrage anzeigen. Ladezustand, fehlende Historie und Fehler von einem echten Nullwert unterscheiden.

## AP4 – Abnahme und Dokumentation

- Nach erfolgreicher Anmeldung unter `/admin/` ist das Dashboard die erste Ansicht und in der Sidebar ausgewählt; die Tresorliste öffnet sich erst bei Auswahl ihres Menüeintrags.
- Anonyme Anfragen und Vault-Konten erhalten keine Dashboard-Daten. Auf dem Vault-Port bleiben die Admin-Routen verborgen.
- Leere und befüllte Datenbank, Soft-Delete, Rollen und deaktivierte Konten liefern die erwarteten Summen. Anmeldezähler bleiben nach einem Neustart erhalten; Zeitfenster und Bereinigung sind getestet.
- Docker und Betrieb ohne Docker: Status, Version und IP-Angaben sind korrekt beschriftet; kein Zugriff auf Docker-Socket oder Host-Dateien nötig. Nicht abrufbare Daten werden sichtbar als solche markiert. Keine Secrets oder entschlüsselten Daten in Antwort oder Zählern.
- API-Integrationstests und Admin-Frontend-Build/Lint ausführen. Betriebsdokumentation und `CHANGELOG.md` bei der Implementierung aktualisieren; nach Abnahme diesen Plan nach `docs/plans/closed` verschieben.

## Umsetzung (2026-11-25)

- Anmeldezähler: Tabelle `login_counters` mit stündlichen UTC-Buckets (`bucket`, `channel` admin/vault, `outcome` success/failure, `count`). Bucket-Einträge älter als 30 Tage werden beim Schreiben entfernt. `app_state.login_stats_since` hält den Beginn der Erfassung fest. Die Fenster sind „letzte 24 Stunden“ = die aktuelle und die 23 vorherigen vollen Stunden und „letzte 7 Tage“ = 168 Stunden.
- Systemdaten: `ServerInfo` wird beim Start erfasst. Es enthält Startzeit, Version, .NET, Betriebssystem und Architektur, Docker ja/nein, Admin-Ports, HTTPS, Zertifikat und Proxys. Die IP-Adressen werden bei jeder Abfrage aus den Netzwerkschnittstellen gelesen.
- Endpunkt `GET /api/admin/dashboard`:
  - Er liefert Systemdaten, Datenablage, Summen und Anmeldezähler.
  - Teile, die sich nicht lesen lassen, kommen als `null` zurück und werden in `errors` benannt.
  - Er funktioniert nur mit Admin-Session. Auf dem Vault-Port ist er wie alle Admin-Routen verborgen (404).
- Oberfläche:
  - `web/admin/src/components/dashboard.tsx` ist die Startseite und steht in der Sidebar an erster Stelle. Nach jeder Anmeldung öffnet sich wieder das Dashboard.
  - Es gibt einen Knopf „Refresh“ mit Zeitpunkt der letzten Abfrage, Ladeplatzhalter und den Kasten „Needs attention“ mit Links in die passenden Bereiche.
- Präzisierungen gegenüber dem Plan:
  - **WebDAV-Fehler ohne 401:** Der normale 401-Anmeldeaufruf jeder KeePass-App zählt nicht als WebDAV-Fehler.
  - **Zeitfenster mit Obergrenze:** Die Zeitfenster enden bei der aktuellen Stunde, damit Zähler aus der „Zukunft“ nach einer Uhrumstellung nicht mitgezählt werden.
  - **Build-Commit:** Er erscheint nur, wenn das SDK ihn beim Bauen kennt. Das Docker-Image wird ohne `.git` gebaut und zeigt ihn nicht.
- Geprüft:
  - Backend-Tests: Summen mit gelöschtem Tresor, Konfliktkopie und deaktiviertem Konto; Anmeldezähler je Kanal und Ergebnis; Zugriff anonym und als Vault-Nutzer abgelehnt; keine Passwörter in der Antwort; Zeitfenster 24 h und 7 Tage an den Grenzen; Bereinigung nach 30 Tagen; Zähler überstehen den Neustart.
  - Browser-Test in einer Testinstanz: Das Dashboard öffnet als Erstes und ist in der Sidebar gewählt. Zähler, System- und Zugangsdaten werden angezeigt, Refresh und Navigation funktionieren, hell und dunkel, mobil ohne waagrechtes Scrollen.

## Abnahme (2026-11-25, Sascha, Synology mit 0.10.0)

- Nach der Anmeldung öffnet sich das Dashboard und ist in der Sidebar gewählt.
- Die Anzeige stimmt:
  - Docker erkannt, Alpine Linux, .NET 8.0.34
  - Container-IP 172.22.0.2, Ports 8080/8081
  - Admin-HTTPS mit Fingerabdruck und Ablaufdatum
  - Proxys „loopback, 172.22.0.1 (gateway)“
- Eine fehlgeschlagene Admin-Anmeldung wird gezählt und unter „Needs attention“ gemeldet.
- 62 WebDAV-Anfragen von KeePass2Android, 0 Fehler. Die 401-Anmeldeaufrufe zählen nicht als Fehler.
