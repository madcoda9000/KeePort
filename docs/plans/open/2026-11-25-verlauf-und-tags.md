# Plan: Eintragsverlauf und Tags im Web-Vault

- **Status:** umgesetzt (2026-11-25), Abnahme auf der NAS ausstehend
- **Erstellt:** 2026-11-25
- **Zielversion:** 0.12.0 (neue Funktionen, Changelog `## [0.12.0] - <Datum>`)
- **Herkunft:** Vorschläge 9 (Verlauf) und 11 (Tags) aus `docs/plans/open/2026-11-25-eintragsliste-spaeter.md`

## Ausgangslage

### Verlauf

- Jede KDBX speichert zu jedem Eintrag frühere Versionen (`entry.history`). Jede Version ist ein vollständiger Schnappschuss: Felder inkl. eigener Felder und TOTP, Anhänge (als Verweis), Tags, Symbol, Ablaufdatum und Zeiten.
- Der Web-Vault legt beim Speichern eine Version an (`applyEntryEdits` → `entry.pushHistory()`). Anzeigen oder wiederherstellen kann man den Verlauf bisher nicht.
- **Gefundener Fehler:**
  - KeePort beachtet die Grenzen der KDBX nicht: `Meta/HistoryMaxItems` (Standard 10) und `Meta/HistoryMaxSize` (Standard 6 MiB). kdbxweb kürzt den Verlauf nicht selbst.
  - KeePass, KeePassXC und KeePass2Android kürzen beim eigenen Speichern. Werden Einträge nur im Web-Vault bearbeitet, wächst der Verlauf aber unbegrenzt und die Datei wird mit der Zeit größer.

### Tags

- Tags werden schon gelesen (`EntryView.tags`) und von der Suche berücksichtigt. Angezeigt, bearbeitet oder gefiltert werden sie nicht.
- KDBX speichert Tags als Text, getrennt durch `;` oder `,` (KeePass trennt beim Lesen an `,`, `;` und `:`). Diese Zeichen dürfen deshalb nicht in einem Tag vorkommen.
- KeePassXC und KeePassium zeigen Tags an, KeePass2Android ebenfalls.

## Ziel

1. **Verlauf ansehen:** Zu jedem Eintrag die früheren Versionen mit Datum und einer Übersicht, was sich geändert hat.
2. **Version wiederherstellen**, wie in KeePass: Der aktuelle Stand wandert dabei selbst in den Verlauf, man verliert also nichts.
3. **Verlauf begrenzen** nach den Einstellungen der KDBX, damit Dateien nicht unbemerkt wachsen.
4. **Tags anzeigen, bearbeiten und filtern**, kompatibel zu KeePass, KeePassXC und KeePass2Android.

## Bedienkonzept

### Verlauf

- **Ort:** Das Eintragsformular bekommt Reiter (`Tabs` per shadcn-CLI): „Details“ wie bisher und „History (n)“. Bei neuen Einträgen gibt es keinen Verlauf-Reiter.
- **Liste:** Die Versionen stehen neueste zuerst, je Version:
  - Datum der Änderung (`times.lastModTime`) und Titel der damaligen Version
  - Was sich gegenüber der nächstneueren Version geändert hat, z. B. „Password, Website, 2 fields“. Werte von Passwort, TOTP und geschützten Feldern erscheinen in dieser Übersicht nie.
  - KDBX speichert nicht, *wer* geändert hat. Das wird nicht vorgetäuscht.
- **Ansehen:** Ein Klick auf eine Version klappt sie auf (`Collapsible`) und zeigt alle Felder schreibgeschützt. Geschützte Werte sind maskiert, mit Anzeigen und Kopieren wie im Formular. Anhänge stehen mit Namen und Größe da und lassen sich herunterladen.
- **Wiederherstellen:**
  - „Restore this version“ mit Bestätigung (`AlertDialog`).
  - Wie KeePass speichert KeePort zuerst den aktuellen Stand als neue Version im Verlauf und übernimmt dann die alte Version.
  - Kennung, Erstellungsdatum und Verlauf bleiben erhalten, das Änderungsdatum wird auf jetzt gesetzt.
  - Gespeichert wird sofort, über den bestehenden Weg mit Rücknahme bei Fehlern.
- **Version löschen:** „Delete version“ entfernt eine einzelne Version (`removeHistory`). Nützlich, wenn z. B. ein altes Passwort nicht mehr im Verlauf stehen soll.
- **Nur-Lese-Nutzer** sehen den Verlauf, können aber nichts wiederherstellen oder löschen.

### Verlauf begrenzen

- Nach jedem Speichern eines Eintrags kürzt KeePort dessen Verlauf wie KeePass:
  - Ist `HistoryMaxItems` ≥ 0, werden die ältesten Versionen entfernt, bis höchstens so viele übrig sind. −1 heißt unbegrenzt.
  - Ist `HistoryMaxSize` ≥ 0, werden die ältesten Versionen entfernt, solange die geschätzte Größe des Verlaufs darüber liegt. Geschätzt wird aus der Länge der Felder plus den Anhängen, die nur in alten Versionen vorkommen.
- Gekürzt wird nur der Eintrag, der gerade gespeichert oder wiederhergestellt wird, nicht still der ganze Tresor.
- Die Grenzen selbst bleiben unverändert. KeePort zeigt sie im Verlauf-Reiter an („This vault keeps up to 10 versions per entry“).

### Tags

- **Tabelle:** Unter dem Titel stehen bis zu drei Tags als kleine `Badge`, dazu „+n“, wenn es mehr sind. Ein Klick auf einen Tag filtert die Liste nach ihm.
- **Formular:** Ein Tag-Feld mit Chips:
  - Eingabe plus Enter oder Komma fügt einen Tag hinzu, „×“ entfernt ihn.
  - Darunter stehen Vorschläge aus den Tags, die im Tresor schon vorkommen.
  - Groß-/Kleinschreibung bleibt erhalten, Duplikate werden ohne Rücksicht darauf verhindert.
  - Erlaubt sind 1–64 Zeichen, ohne `,`, `;` und `:`.
- **Sidebar:** Unter den Ordnern steht eine Gruppe „Tags“ mit allen Tags des Tresors und ihrer Anzahl. Sie erscheint nur, wenn es Tags gibt. Ein Klick filtert die Liste über alle Ordner, wie die Ansicht „Expired“. Die Überschrift der Tabelle zeigt dann „Tag: work“.
- **Mehrfachauswahl:** Die Auswahlleiste bekommt „Tags…“. Damit lassen sich bei allen ausgewählten Einträgen ein Tag hinzufügen oder entfernen. Gespeichert wird sofort, mit Rücknahme bei Fehlern.

Komponenten sind ausschließlich shadcn/ui: `Tabs` und bei Bedarf `Popover` kommen neu per CLI hinzu. Dazu kommen die vorhandenen `Badge`, `Collapsible`, `AlertDialog`, `Dialog`, `Input`, `Button` und `Sidebar`-Bausteine.

## Umsetzung

### Logik

- **`lib/history.ts` (neu):**
  - `listHistory(entry)` liefert Versionen neueste zuerst, mit Datum, Titel und `changes`, der Liste der geänderten Bereiche.
  - `describeChanges(older, newer)` vergleicht Standardfelder, TOTP, eigene Felder, Anhänge, Tags, Ablaufdatum und Symbol.
  - `restoreVersion(entry, index)`:
    1. `pushHistory()` sichert den aktuellen Stand.
    2. Uuid, Verlauf und Erstellungszeit werden gemerkt.
    3. `copyFrom(version)` übernimmt die alte Version.
    4. Die gemerkten Werte werden zurückgesetzt und `times.update()` aufgerufen.
    5. Danach wird der Verlauf gekürzt.
  - `deleteVersion(entry, index)` entfernt eine Version über `removeHistory`.
  - `trimHistory(db, entry)` entfernt die ältesten Versionen nach `historyMaxItems` und `historyMaxSize`, ebenfalls über `removeHistory`, damit kdbxweb das beim Zusammenführen berücksichtigt.
- **`applyEntryEdits`** ruft nach `pushHistory()` auch `trimHistory` auf.
- **`lib/tags.ts` (neu):**
  - `normalizeTag(text)` und `tagError(text, existing)` prüfen und bereinigen Tags.
  - `listTags(entries)` liefert alle Tags mit Anzahl, ohne Vorlagen und Papierkorb.
  - `setEntryTags(db, ids, add, remove)` ändert die Tags mehrerer Einträge mit `times.update()` und neuer Verlaufsversion.
- **`EntryEdits`** bekommt `tags`. `applyEntryEdits` und `createEntry` schreiben sie.

### Oberfläche

- Neue Komponenten:
  - `components/entry-history.tsx` für Liste, Aufklappen, Wiederherstellen und Löschen.
  - `components/tag-input.tsx` für Chips mit Vorschlägen.
  - `components/tags-dialog.tsx` für die Mehrfachauswahl.
- In `App.tsx`:
  - Reiter im Formular.
  - Tags in der Tabelle.
  - Tag-Filter als eigene Ansicht wie „Expired“ (Zustand `tagView`).
  - Sidebar-Gruppe „Tags“ in `folder-tree.tsx`, oder eine eigene Komponente `tag-list.tsx`.

## Tests

- **Node-Tests:**
  - Verlauf: Liste und Änderungsübersicht, darin nie die Werte von Passwort oder geschützten Feldern.
  - Wiederherstellen: Der vorherige Stand liegt danach im Verlauf, Uuid und Erstellungszeit bleiben, Anhänge und eigene Felder kommen zurück.
  - Löschen einer Version.
  - Kürzen nach `historyMaxItems` (auch −1 = unbegrenzt) und nach `historyMaxSize`.
  - Speichern und Neuladen erhält alles.
  - Tags: Prüfung (Trennzeichen, Länge, Duplikate), Speichern und Neuladen. Im XML stehen sie im KeePass-Format.
  - Mehrfach hinzufügen und entfernen.
- **Browser-Test in einer Testinstanz:**
  - Mehrfach bearbeiten, dann Verlauf ansehen, eine Version wiederherstellen und eine löschen.
  - Nach dem Neuladen ist alles erhalten.
  - Tags anlegen mit Vorschlägen, Filter über Tabelle und Sidebar, Mehrfach-Tagging.
  - Nur-Lese-Ansicht.
- **Abnahme durch Sascha:**
  - Ein im Web-Vault wiederhergestellter Eintrag erscheint in KeePass2Android mit korrektem Verlauf.
  - Tags sind in KeePass2Android, KeePassXC und KeePassium sichtbar.

## Entscheidungen (2026-11-25, Sascha)

1. **Der Verlauf ist ein Reiter „History“ im Eintragsformular.**
2. **Passwort und geschützte Felder alter Versionen** lassen sich anzeigen und kopieren, maskiert wie im aktuellen Eintrag.
3. **Einzelne Versionen lassen sich in 0.12.0 löschen.** „Ganzen Verlauf leeren“ kommt später.
4. **Nach Tags filtert man über die Sidebar-Gruppe „Tags“ und per Klick auf einen Tag in der Tabelle.**
5. **Tags für mehrere Einträge** gibt es in 0.12.0 über „Tags…“ in der Auswahlleiste.

## Umsetzung (2026-11-25)

- Logik:
  - `lib/history.ts`: `listHistory`, `describeChanges`, `restoreVersion`, `deleteVersion`, `trimHistory`, `backupEntry`, `requireEntry`
  - `lib/tags.ts`: `normalizeTag`, `tagError`, `listTags`, `hasTag`, `setEntryTags`
  - `applyEntryEdits` sichert und kürzt über `backupEntry`. `saveEntryUpdate` nimmt bei einem Fehler jetzt auch die Tags zurück.
  - Tests stehen in `history.test.mjs`.
- Oberfläche:
  - Komponenten `entry-history.tsx`, `tag-input.tsx`, `tags-dialog.tsx`, dazu `ui/tabs.tsx` per shadcn-CLI
  - Reiter „Details“ und „History (n)“ im Formular
  - Tags in der Tabelle und in der Sidebar-Gruppe „Tags“
  - „Tags…“ in der Auswahlleiste
- Präzisierungen gegenüber dem Plan:
  - **Meldungen im Formular** stehen jetzt über den Reitern. Vorher waren sie nur im Reiter „Details“ zu sehen und gingen auf „History“ verloren; das fiel beim Test auf.
  - **Barrierefreiheit:** Die Sidebar-Gruppen (Ordner, Tags) haben `role="group"`, damit ihr `aria-label` für Screenreader zählt.
  - **Tag-Änderungen über die Auswahlleiste** legen eine Verlaufsversion an wie jede andere Bearbeitung.
  - **Ein Popover war nicht nötig.** Die Vorschläge stehen als Knöpfe unter dem Tag-Feld.
- Geprüft:
  - Node-Tests:
    - Verlauf mit Änderungsübersicht ohne Werte
    - Wiederherstellen samt Anhang, Uuid, Erstellungszeit und Neuladen
    - Version löschen
    - Kürzen nach Anzahl, unbegrenzt und nach Größe
    - Tags: Prüfung, Zählung, Mehrfach-Änderung, Neuladen
  - Browser-Test in einer Testinstanz:
    - Verlauf mit zwei Versionen, alter Wert per „Show“
    - Wiederherstellen und Version löschen
    - Tag im Formular, ungültiger Tag abgelehnt
    - Tags für mehrere Einträge, Filter über Sidebar und Tabelle, Tag entfernen
    - Bestand nach Sperren und Entsperren
    - Nur-Lese-Ansicht
  - Alle früheren Browser-Tests laufen weiter.

## Ursprünglich offene Fragen

1. **Ort des Verlaufs:** Als Reiter „History“ im Eintragsformular (Empfehlung)? Oder als eigener Dialog über einen Knopf „History“?
2. **Alte Werte:** Sollen Passwort und geschützte Felder alter Versionen per „Anzeigen“ sichtbar und kopierbar sein? Empfehlung: ja, maskiert, wie im aktuellen Eintrag; wer den Eintrag sehen darf, sieht auch seine Geschichte.
3. **Einzelne Versionen löschen** in 0.12.0? Empfehlung: ja. „Ganzen Verlauf leeren“ kommt erst später.
4. **Tag-Filter:** Sidebar-Gruppe „Tags“ plus Klick auf einen Tag in der Tabelle (Empfehlung)? Oder nur über die Suche?
5. **Tags für mehrere Einträge** über die Auswahlleiste („Tags…“) schon in 0.12.0? Empfehlung: ja, das passt zu „Move to…“.
