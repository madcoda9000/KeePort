# Plan: Ordner (KDBX-Gruppen) im Web-Vault verwalten

- **Status:** open
- **Erstellt:** 2026-11-24
- **Zielversion:** 0.7.0 (neue Funktion, Changelog `## [0.7.0] - <Datum>`)

## Ausgangslage

KDBX-Dateien sind ein Baum aus Gruppen (Ordnern). Die Wurzelgruppe trägt meist den Namen der Datenbank, darunter liegen beliebig tief verschachtelte Gruppen. KeePass-Apps nutzen das aktiv, KeePass2Android legt z. B. den Ordner „Vorlagen“ für Eintragsvorlagen an.

Der Web-Vault kennt Gruppen bisher nur lesend:

- `listEntries` (`web/vault/src/lib/kdbx.ts`) flacht alle Einträge zu einer Liste ab und zeigt den Pfad als Text unter dem Titel (`test.kdbx / Vorlagen`).
- Neue Einträge landen immer in der ersten Gruppe (`createEntry` → `db.groups[0]`).
- Ordner lassen sich nicht anlegen, umbenennen, löschen und Einträge nicht verschieben.
- Der Papierkorb (`db.meta.recycleBinUuid`) wird nicht gesondert behandelt; Einträge darin erscheinen wie normale Einträge.

## Ziel

Nutzer mit **Lesen und Schreiben** verwalten im Web-Vault die Ordner einer KDBX:

1. Ordner **anlegen** (auch als Unterordner), **umbenennen** und **löschen**, Letzteres nur, wenn der Ordner leer ist (keine Einträge, keine Unterordner).
2. Einträge per **Mehrfachauswahl** in einen Ordner **verschieben**, auch von einem Ordner in einen anderen.

Alles bleibt KDBX-konform, sodass KeePass2Android, KeePassium und KeePassXC die Struktur nach dem Sync unverändert sehen. Nutzer mit Nur-Lese-Recht sehen die Ordner, aber keine Bearbeitungsfunktionen.

## Bedienkonzept

- **Ordnerbaum in der Sidebar, unterhalb der Liste „Shared vaults“** (Entscheidung Sascha):
  - Er erscheint **nur, wenn ein Tresor aus der Liste geöffnet (entsperrt) ist**, und verschwindet beim Sperren, beim Wechsel zu einem anderen Tresor und beim Abmelden.
  - Er ist **visuell getrennt**: eigene Sidebar-Gruppe mit Trennlinie (`SidebarSeparator`) und Überschrift mit dem Tresornamen, z. B. „Folders · test.kdbx“.
  - Oberster Eintrag „All entries“, darunter der Baum ab der Wurzelgruppe, Unterordner auf- und zuklappbar (`SidebarMenuSub` und `Collapsible`). Am Ende der Papierkorb mit eigenem Symbol.
  - Die Anzahl der Einträge je Ordner steht als `SidebarMenuBadge` daneben.
  - Ordner-Menü (`SidebarMenuAction` mit `DropdownMenu`): „New subfolder“, „Rename“, „Delete“. „Delete“ ist ausgegraut, solange der Ordner nicht leer ist, mit Tooltip, warum.
  - Ein Knopf „New folder“ in der Überschrift der Gruppe legt im gewählten Ordner an.
  - Auf schmalen Bildschirmen liegt der Baum wie die übrige Sidebar im ausklappbaren Seitenmenü.
- **Liste „Shared vaults“:** Der **geöffnete Tresor wird farbig hervorgehoben**, in der Primärfarbe bzw. mit einem Akzent. Das muss sich deutlich vom normalen Auswahlzustand (`isActive`) unterscheiden, damit man auch beim Durchsehen anderer Tresore erkennt, welcher entsperrt ist.
- **Eintragstabelle:**
  - Zeigt die **eigenen Einträge des gewählten Ordners** (Entscheidung Sascha), bei „All entries“ alle wie heute. Die Suche durchsucht immer alle Ordner und zeigt den Pfad weiter unter dem Titel.
  - Neue erste Spalte mit **Checkboxen** sowie „Alle auf dieser Seite auswählen“ im Kopf.
  - Sind Einträge ausgewählt, erscheint eine Aktionsleiste: „3 selected · **Move to…** · Clear selection“.
  - „Move to…“ öffnet einen Dialog mit dem Ordnerbaum als Ziel. Ordner, in denen alle Ausgewählten schon liegen, sind als „current folder“ markiert.
- **„Add entry“** legt neue Einträge im gewählten Ordner an (bei „All entries“ in der Wurzelgruppe).
- **Kein Drag & Drop** in 0.7.0 (Entscheidung Sascha).

Komponenten ausschließlich aus shadcn/ui: Sidebar-Bausteine (`SidebarGroup`, `SidebarSeparator`, `SidebarMenuSub`, `SidebarMenuAction`, `SidebarMenuBadge`), `Button`, `Badge`, `Dialog`, `AlertDialog`, `Input`, `Tooltip`, `Table` sowie neu im Vault per shadcn-CLI hinzugefügt `Checkbox`, `DropdownMenu` und `Collapsible`.

## Umsetzung

### 1. KDBX-Logik (`web/vault/src/lib/kdbx.ts` bzw. neues `lib/groups.ts`)

- `listGroups(db)`: Baum mit Id, Name, Pfad, Eltern-Id, Tiefe, direkter und gesamter Eintragsanzahl sowie den Markierungen „Wurzel“, „Papierkorb“ und „Vorlagen“ (`db.meta.entryTemplatesGroup`).
- `EntryView` bekommt `groupId`. Gefiltert wird im Frontend.
- `createGroup(db, parentId, name)` über `db.createGroup(parent, name)`.
- `renameGroup(db, groupId, name)`: setzt `group.name` und aktualisiert `times`.
- `deleteGroup(db, groupId)`: nur bei leerem Ordner. Entfernt endgültig über `db.move(group, null)`, wodurch kdbxweb ihn in `deletedObjects` vermerkt. So übernehmen andere Clients das Löschen beim Zusammenführen, statt den Ordner wieder anzulegen. Ein leerer Ordner im Papierkorb wäre nur Ballast.
- `moveEntries(db, entryIds, targetGroupId)` über `db.move(entry, target)`. Das setzt `locationChanged`, damit KeePass-Merges die neue Position übernehmen.
- **Validierung:** Name nicht leer, keine reinen Leerzeichen, höchstens 255 Zeichen. Doppelte Namen unter demselben Elternordner sind in KDBX erlaubt, KeePort warnt aber und verhindert sie standardmäßig. Wurzel und Papierkorb lassen sich nicht umbenennen, löschen oder als Unterordner-Ziel wählen. Einträge lassen sich aus dem Papierkorb heraus verschieben, das ist eine Wiederherstellung.

### 2. Speichern

- Jede Ordneraktion und jedes Verschieben speichert sofort über den bestehenden Weg (verschlüsseln → `PUT` mit ETag → bei Konflikt Hinweis und Konfliktkopie wie bisher).
- **Rücknahme bei Fehlern:** Wie `saveEntryUpdate` macht ein abgelehnter Speichervorgang die Änderung im geöffneten Tresor rückgängig. Allgemein umgesetzt: Vor der Änderung werden die zuletzt gespeicherten verschlüsselten Bytes gemerkt. Scheitert das Speichern, wird der Tresor daraus mit denselben Zugangsdaten neu geladen, sodass Anzeige und Server übereinstimmen.

### 3. Oberfläche (`web/vault/src/App.tsx`, neue Komponenten `components/folder-tree.tsx` für die Sidebar, `components/move-entries-dialog.tsx`)

- Zustand: gewählter Ordner, Auswahl als `Set<entryId>`. Die Auswahl wird beim Ordnerwechsel, nach dem Verschieben und beim Sperren geleert.
- Die Mehrfachauswahl wirkt auf die gefilterten Einträge. „Alle auswählen“ betrifft die aktuelle Seite, ein Hinweis bietet „Alle N Treffer auswählen“ an.
- Bei Nur-Lese-Tresoren werden Checkboxen, Aktionsleiste und Ordner-Menüs nicht angezeigt.
- Barrierefreiheit: Der Baum ist mit der Tastatur bedienbar, die Checkboxen haben Beschriftungen, und Dialoge setzen den Fokus.

### 4. Tests

- `lib`-Tests (Node, kdbxweb, wie `attachments.test.mjs`):
  - Ordner anlegen, verschachtelt anlegen und umbenennen.
  - Ein leerer Ordner wird gelöscht und in `deletedObjects` vermerkt, ein nicht leerer Ordner wird abgelehnt.
  - Mehrere Einträge werden verschoben, `locationChanged` ändert sich.
  - Wurzel und Papierkorb sind geschützt.
  - Speichern und Neuladen erhält die Struktur.
  - Rücknahme bei abgelehntem Speichern.
- Kompatibilität: Die gespeicherte Datei mit `keepassxc-cli ls -R` prüfen, wenn verfügbar, sonst Abnahme durch Sascha mit KeePassXC und KeePass2Android.
- Browser-Prüfung in einer Testinstanz mit Demo-Daten (Ordner anlegen, umbenennen, verschieben, löschen, Nur-Lese-Ansicht).

### 5. Doku und Changelog

- README: Funktionsliste.
- Abschnitt im Changelog 0.7.0.
- Die README-Screenshots bei Gelegenheit mit Ordnerbaum neu aufnehmen.

## Entscheidungen (2026-11-24, Sascha)

1. **Ordnerbaum links**, und zwar in der Sidebar unterhalb von „Shared vaults“, getrennt dargestellt und nur bei geöffnetem Tresor. Der geöffnete Tresor ist in der Liste farbig hervorgehoben.
2. **Ein gewählter Ordner zeigt nur seine eigenen Einträge.**
3. **Papierkorb als geschützter Ordner** am Ende des Baums. Einträge lassen sich herausverschieben (wiederherstellen).
4. **Kein Drag & Drop** in 0.7.0.
5. Der Cache-Fix für `index.html` (veraltete Oberfläche nach Updates) wird vorgezogen und separat als 0.6.1 umgesetzt.

## Ursprünglich offene Fragen

1. **Ordnerbaum links neben der Tabelle** (Empfehlung, wie in KeePassXC) oder ein **Datei-Explorer-Stil**, bei dem Unterordner als Zeilen über den Einträgen erscheinen und man sich mit einem Brotkrumenpfad durchklickt?
2. **Was zeigt ein gewählter Ordner:** nur seine eigenen Einträge (Empfehlung, wie KeePass) oder auch die aller Unterordner?
3. **Papierkorb:** als eigener, geschützter Ordner mit Papierkorb-Symbol am Ende des Baums anzeigen, aus dem man Einträge herausverschieben kann (Empfehlung)? Oder ausblenden?
4. **Drag & Drop** (Einträge auf einen Ordner ziehen) zusätzlich zu „Verschieben nach…“? Empfehlung: nicht in 0.7.0, später ergänzbar.
