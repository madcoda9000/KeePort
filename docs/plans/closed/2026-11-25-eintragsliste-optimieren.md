# Plan: Eintragsliste im Web-Vault optimieren

- **Status:** abgeschlossen (2026-11-25), ausgeliefert in 0.11.0; die Vorschläge 9–15 stehen in `docs/plans/open/2026-11-25-eintragsliste-spaeter.md`
- **Erstellt:** 2026-11-25
- **Zielversion:** 0.11.0 (neue Funktionen, Changelog `## [0.11.0] - <Datum>`)

## Ausgangslage

Die Eintragstabelle im Web-Vault zeigt je Zeile ein Schlüsselsymbol, Titel mit Ordnerpfad, Benutzername, maskiertes Passwort und Website. Zum Kopieren muss man den Eintrag öffnen. Ob ein Eintrag TOTP hat, sieht man erst im geöffneten Eintrag.

Wichtige Randbedingungen aus dem Code:

- **CSP:** KeePort setzt `img-src 'self' data:`. Bilder von fremden Servern lädt der Browser nicht. Für Favicons muss die Richtlinie gezielt erweitert oder das Bild anders beschafft werden.
- **Zero-Knowledge:** Der Server sieht keine Tresorinhalte, auch keine URLs. Das soll so bleiben.
- **KDBX-Symbole:** Einträge haben ein Standardsymbol (`icon`, Nummer 0–68) und optional ein eigenes Symbol (`customIcon`, PNG in `Meta/CustomIcons`). KeePassXC speichert heruntergeladene Favicons genau dort.

## Vorschläge von Sascha

### 1. Favicon statt Schlüsselsymbol

Hat ein Eintrag eine URL und lässt sich ein Favicon beziehen, ersetzt es das Schlüsselsymbol in der Tabelle und im Formular. Schlägt das Laden fehl, bleibt das Schlüsselsymbol.

Reihenfolge der Quellen, mit Empfehlung:

1. **Eigenes Symbol aus der KDBX (`customIcon`):** Das kostet nichts an Datenschutz und braucht keinen Netzwerkzugriff. Einträge, für die KeePassXC schon ein Favicon geladen hat, haben es sofort.
2. **Favicon aus dem Netz, optional:** Dafür gibt es drei Wege:
   - **a) Direkt vom Browser** (`https://<host>/favicon.ico`):
     - Jede Website sieht beim Öffnen des Tresors die IP-Adresse des Nutzers und kann daraus schließen, dass er dort ein Konto hat.
     - Die CSP muss `img-src https:` erlauben.
   - **b) Über einen Dienst** wie DuckDuckGo (`icons.duckduckgo.com/ip3/<host>.ico`):
     - Ein einzelner Dritter sieht alle Hosts aus dem Tresor.
     - Die Ergebnisse sind einheitlich und zuverlässig.
   - **c) Über den KeePort-Server als Proxy:**
     - Der Server erfährt die Hostnamen, das bricht das Zero-Knowledge-Prinzip teilweise.
     - Auf der NAS braucht KeePort dafür ausgehenden Internetzugang.
   - **Empfehlung:** a) als **Opt-in je Nutzer** in „Account settings“, standardmäßig aus, mit klarem Hinweis, was die Websites dabei sehen.
     - Der Browser lädt nur `https://<host>/favicon.ico` als `<img>`, also ohne Cookies und ohne JavaScript.
     - Gezeigt wird nur, was tatsächlich lädt.
     - Der Browser-Cache übernimmt das Zwischenspeichern.
     - Die CSP wird nur für den Vault um `img-src https:` erweitert, nicht für die Admin-Konsole.
3. **Später:** „Save favicon as entry icon“ speichert das geladene Favicon als `customIcon` in der KDBX. Dann sehen es auch KeePass2Android und KeePassXC, und der Abruf ist nur einmal nötig.

### 2. Spalte „TOTP“ in der Tabelle

- Die neue Spalte zeigt einen Haken (✓, TOTP eingerichtet) oder ein Kreuz (✗, keins), mit `aria-label` bzw. Screenreader-Text „TOTP configured“ / „No TOTP“.
- Sie ist nach TOTP vorhanden/nicht vorhanden sortierbar.
- Auf schmalen Bildschirmen wird sie wie „Password“ ausgeblendet.

### 3. Kopierknöpfe in der Tabelle

- Vor Benutzername, Passwort und TOTP steht jeweils ein kleiner Kopierknopf (`Button` `size="icon-sm"`) mit `Tooltip` „Copy to clipboard“, genauer „Copy username“, „Copy password“ und „Copy TOTP code“.
- Der Knopf erscheint nur, wenn ein Wert vorhanden ist.
- Der TOTP-Knopf berechnet den aktuellen Code beim Klick (`totpCode`) und kopiert ihn. Ein laufender Countdown je Zeile ist nicht nötig.
- Nach dem Kopieren kommt eine kurze Bestätigung, z. B. ein Haken im Knopf für 1,5 s und die bestehende Meldung „Password copied.“
- Die Knöpfe sind per Tastatur erreichbar und öffnen nicht den Eintrag.
- Auch Nutzer mit Nur-Lese-Recht bekommen sie.

## Weitere Vorschläge (zur Auswahl)

Davon sind 4 bis 9 Lücken oder offene Punkte, 10 bis 15 Komfort.

4. **Einträge löschen:** Das fehlt im Web-Vault bisher ganz.
   - Gelöscht wird in den Papierkorb, wie KeePass es macht (`db.remove`, bei aktiviertem Papierkorb). Im Papierkorb gibt es „Endgültig löschen“ und „Papierkorb leeren“.
   - Geht als Einzelaktion im Formular und als Mehrfachaktion in der Auswahlleiste neben „Move to…“.
5. **Abgelaufene Einträge markieren:** Das wurde in 0.9.0 auf später verschoben. Ein Badge „Expired“ in der Tabelle und ein Filter „Expired“ in der Sidebar.
6. **Kopierte Werte aus der Zwischenablage löschen:**
   - Nach einstellbaren Sekunden (Standard 30) überschreibt KeePort die Zwischenablage mit Leerem, wie KeePass.
   - Einschränkung: Browser erlauben das nur, solange der Tab im Vordergrund ist. Der Hinweis muss das ehrlich sagen.
7. **Passwortgenerator im Formular:** Länge, Zeichengruppen und Passphrasen mit der Web Crypto API, mit Stärkeanzeige.
8. **Website öffnen:** Ein Link-Knopf in der Spalte „Website“ öffnet die URL in einem neuen Tab (`rel="noopener noreferrer"`). Das geht nur für `http(s)`-URLs.
9. **Verlauf eines Eintrags:** Die KDBX speichert frühere Versionen (`entry.history`). Ein Reiter „History“ im Formular zeigt sie mit Datum, und man kann eine Version wiederherstellen.
10. **Spalte „Modified“:** Das Datum der letzten Änderung, sortierbar, damit man „zuletzt geändert“ schnell findet.
11. **Tags:**
    - Tags werden in der Tabelle angezeigt und lassen sich im Formular bearbeiten. Die Daten gibt es schon (`entry.tags`).
    - Ein Klick auf einen Tag filtert die Liste.
12. **Tastaturkürzel:** `/` springt in die Suche, `Esc` schließt das Formular. In der gewählten Zeile kopiert `Ctrl`/`Cmd`+`B` den Benutzernamen und `Ctrl`/`Cmd`+`C` das Passwort, wie in KeePassXC.
13. **Spalten ein- und ausblenden:** Ein `DropdownMenu` mit Checkboxen, gespeichert im Browser (`localStorage`).
14. **Sicherheitsbericht, später:** schwache, mehrfach verwendete und sehr alte Passwörter. Das wird nur lokal im Browser berechnet.
15. **Doppelklick auf eine Zeile:** Ein Doppelklick öffnet den Eintrag, ein Einfachklick wählt die Zeile aus. Das passt zu den Kopierknöpfen und den Tastaturkürzeln.

## Umsetzung (Skizze für 1–3)

- `web/vault/src/lib/icons.ts` (neu):
  - `entryIconSource(db, entry, settings)` liefert ein `data:`-URL aus `customIcon` oder, wenn erlaubt, `https://<host>/favicon.ico`.
  - Der Host stammt aus der Eintrags-URL über `new URL()`, nur `http`/`https`.
  - Komponente `EntryIcon` mit `onError`-Rückfall auf das Schlüsselsymbol.
- **Einstellung „Show website icons“:**
  - Sie liegt beim Nutzerkonto (Server, wie das Auto-Lock), damit sie auf allen Geräten gilt. Dazu kommt eine neue Spalte `users.show_favicons` mit dem Standard aus.
- **CSP:** Für Vault-Seiten kommt `img-src 'self' data: https:` dazu. Die Admin-Konsole bleibt unverändert. Ein Test prüft das.
- **Tabelle:** Die Spalte „TOTP“ kommt in `ENTRY_COLUMNS`. Die Kopierknöpfe mit `Tooltip` kommen in die Zeilen von `App.tsx`, gern als kleine Komponente `CopyButton`.
- **Kein Server-Proxy:** Der Server bekommt keinen Zugriff auf URLs.

## Tests

- **Node-Tests:**
  - Hostname aus URLs: gültig, ohne Schema, `javascript:`, IP-Adressen.
  - Rangfolge `customIcon` vor Favicon vor Schlüsselsymbol.
  - TOTP-Erkennung für die Spalte.
- **Backend-Tests:** Die CSP des Vaults enthält `https:` bei `img-src`, die der Admin-Konsole nicht. Die Einstellung wird gespeichert.
- **Browser-Prüfung:**
  - Kopierknöpfe kopieren den richtigen Wert, Tooltips erscheinen, der Klick öffnet nicht den Eintrag.
  - TOTP-Spalte.
  - Favicons erscheinen nur bei aktivierter Einstellung, ein fehlgeschlagenes Favicon fällt aufs Schlüsselsymbol zurück.
  - Hell und dunkel, mobil.

## Entscheidungen (2026-11-25, Sascha)

1. **Favicons:** Eigene Symbole aus der KDBX (`customIcon`) werden immer angezeigt. Dazu kommt optional das Laden **direkt von der Website** (Variante a) als Opt-in, standardmäßig aus. Es gibt keinen Dienst eines Dritten und keinen Server-Proxy.
2. **Das Opt-in gilt je Nutzer**, gespeichert beim Konto. Eine globale Sperre durch den Admin gibt es in 0.11.0 nicht.
3. **Umfang von 0.11.0:**
   - Die Vorschläge 1–3 (Favicons, Spalte TOTP, Kopierknöpfe)
   - 4: Einträge löschen in den Papierkorb, mit endgültigem Löschen und „Papierkorb leeren“
   - 5: Abgelaufene Einträge markieren und filtern
   - 6: Zwischenablage nach einstellbarer Zeit leeren
   - 7: Passwortgenerator
   - 8: Website öffnen
   - **Später:** 9–15 (Verlauf, Spalte „Modified“, Tags, Tastaturkürzel, Spalten ein- und ausblenden, Sicherheitsbericht, Doppelklick)

## Umsetzung (2026-11-25)

- Backend:
  - Die Spalten `users.show_favicons` (Standard 0) und `users.clipboard_clear_seconds` (null = 30 s) sind neu. `PUT /api/auth/settings` nimmt Teilangaben an.
  - Die CSP steht in `Security/ContentSecurity.cs`. `img-src https:` ist nur für Vault-Seiten erlaubt, Admin und API bleiben strikt.
- Neue Logik:
  - `lib/icons.ts`: `customIconUrl`, `faviconUrl`, `openableUrl`
  - `lib/entry-actions.ts`: `deleteEntries`, `emptyRecycleBin`, `isExpired`
  - `lib/password.ts`: Generator mit Rejection Sampling über `crypto.getRandomValues`
  - Tests stehen in `entry-actions.test.mjs`.
- Neue Komponenten: `entry-icon.tsx`, `copy-button.tsx`, `password-generator.tsx`, dazu `ui/slider.tsx` per shadcn-CLI.
- Präzisierungen gegenüber dem Plan:
  - **Favicons:**
    - Favicons gibt es nur für Hostnamen mit Punkt, nicht für IP-Adressen oder einzelne Namen wie `nas`. Dort gäbe es kaum gültige Zertifikate.
    - Abgerufen wird immer über HTTPS, mit `referrerPolicy="no-referrer"` und `loading="lazy"`, also nur für sichtbare Zeilen.
  - **Löschen** folgt KeePass:
    - Einträge außerhalb des Papierkorbs wandern hinein.
    - Einträge im Papierkorb werden endgültig gelöscht und als `DeletedObject` vermerkt. Dasselbe gilt für alle Einträge in Tresoren mit abgeschaltetem Papierkorb, dort entsteht auch kein neuer Papierkorb.
  - **Zwischenablage:** Sie wird auch beim Sperren sofort geleert, sofern noch eine Löschung aussteht.
  - **Passwort im Formular:** Es gibt einen Knopf zum Ein- und Ausblenden, damit man ein generiertes Passwort sieht.
- Geprüft:
  - Node-Tests:
    - Löschen in den Papierkorb, endgültig und ohne Papierkorb
    - Papierkorb leeren mit Unterordnern
    - Ablauf
    - Favicon- und Link-Adressen
    - eigene Symbole
    - Generator: Länge, Gruppen, Verwechslungsschutz, Stärke
  - Backend-Tests: Einstellungen je Nutzer, Validierung, CSP je Pfad.
  - Browser-Test in einer Testinstanz:
    - eigenes KDBX-Symbol
    - keine Favicon-Anfrage ohne Opt-in; nach dem Opt-in angefragt (Testhost `.invalid`, kein Internetverkehr), Rückfall aufs Schlüsselsymbol
    - Kopierknöpfe mit Tooltips, Klick öffnet nicht den Eintrag
    - TOTP-Spalte und Website-Link
    - Ansicht „Expired“
    - Zwischenablage nach 2 s geleert
    - Generator und Passwort einblenden
    - Löschen in den Papierkorb, endgültig, Papierkorb leeren
    - Bestand nach Reload
  - Alle früheren Browser-Tests laufen weiter.

## Abnahme (2026-11-25, Sascha, NAS mit 0.11.0)

- Update eingespielt, Test erfolgreich.

## Ursprünglich offene Fragen

1. **Favicon-Quelle:** Erst nur die eigenen Symbole aus der KDBX, ohne Netz? Oder zusätzlich das Laden aus dem Netz als Opt-in (Variante a)? Oder ein Dienst wie DuckDuckGo (Variante b)? Empfehlung: KDBX-Symbole immer, a) als Opt-in, standardmäßig aus.
2. **Opt-in je Nutzer oder global?** Empfehlung: je Nutzer, weil es um die eigene IP-Adresse geht. Optional dazu ein globaler Schalter für Admins, mit dem sie die Funktion ganz sperren können.
3. **Welche der weiteren Vorschläge 4–15 sollen in 0.11.0 mit?** Empfehlung: 4 (Löschen) und 5 (Abgelaufene) in 0.11.0, weil sie Lücken schließen; 6, 7 und 8 als kleine Komfort-Pakete gleich mit; 9–15 später.
