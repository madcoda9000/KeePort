# Plan: Eigene Felder und KeePass2Android-Vorlagen im Web-Vault

- **Status:** umgesetzt (2026-11-25), Abnahme auf der NAS ausstehend
- **Erstellt:** 2026-11-25
- **Zielversion:** 0.9.0 (neue Funktion, Changelog `## [0.9.0] - <Datum>`)

## Ausgangslage

Der Web-Vault zeigt und bearbeitet nur die Standardfelder Titel, Benutzername, Passwort, URL, Notizen und TOTP (`otp`). Alle anderen Felder eines Eintrags sind unsichtbar. Beim Speichern bleiben sie unverändert erhalten, weil `applyEntryEdits` nur die Standardfelder setzt.

KeePass2Android legt Einträge aus **Vorlagen** an, etwa Kreditkarte, Ausweis, WLAN oder Mitgliedschaft. Deren eigentliche Daten stehen in **eigenen Feldern**. Eine Kreditkarte aus KeePass2Android zeigt im Web-Vault deshalb nur leere Standardfelder (Abnahme Sascha, 2026-11-25). Auch KeePassXC und KeePassium nutzen eigene Felder („Additional attributes“).

## Format der Vorlagen (aus dem Quellcode von KeePass2Android)

Quellen sind `src/Kp2aBusinessLogic/database/edit/AddTemplateEntries.cs` und `src/keepass2android-app/KpEntryTemplatedEdit.cs`. Das Format stammt vom KeePass-Plugin KPEntryTemplates.

- **Vorlagen-Ordner:** `Meta/EntryTemplatesGroup` zeigt auf den Ordner, in KeePass2Android heißt er „Vorlagen“ bzw. „Templates“.
- **Vorlagen-Eintrag:**
  - Er hat das Feld `_etm_template` = `1`.
  - Je Feld gibt es drei Einträge (unten mit `<Name>` für den Feldnamen):
    - `_etm_title_<Name>` mit dem angezeigten Namen
    - `_etm_type_<Name>`, z. B. `Inline`, `Protected Inline` oder `Date Time`; KPEntryTemplates kennt weitere Typen wie `Popout`, `Divider`, `Checkbox` und `Listbox`
    - `_etm_position_<Name>` mit einer Ganzzahl für die Reihenfolge
  - Die eingebauten Vorlagen haben feste UUIDs. Kreditkarte ist z. B. `49DD48DB…`; ihre Felder sind Nummer, CVV (geschützt), PIN (geschützt), Karteninhaber und `@exp_date`.
- **Eintrag aus einer Vorlage:**
  - `_etm_template_uuid` enthält die UUID des Vorlagen-Eintrags als **Hex-Text** (32 Zeichen, ungeschützt).
  - Die Werte stehen unter dem **eigentlichen Feldnamen**, z. B. `Nummer` oder `CVV`. Geschützte Typen werden als geschützter Wert gespeichert.
- **Sondernamen:**
  - `@exp_date` ist kein Feld, sondern das Ablaufdatum des Eintrags (`Times/Expires` und `ExpiryTime`).
  - `@tags` steht für die Tags des Eintrags, `@override` für die Override-URL.
  - Die Typen `Divider` und `@confirm` stehen für keinen Wert.
- **Standardfelder:** KeePass2Android zeigt bei Vorlagen-Einträgen Benutzername, Passwort, URL und Notizen nur, wenn sie einen Wert haben oder die Vorlage sie aufführt. Der Titel wird immer gezeigt.
- **Interne Felder:** `_etm_*` und `KP2A_TemplateId` sind interne Markierungen und werden nie angezeigt.

## Ziel

1. **Eigene Felder sichtbar und bearbeitbar**, bei jedem Eintrag und nicht nur bei Vorlagen:
   - Geschützte Felder sind maskiert, mit „Anzeigen“ und „Kopieren“.
   - Interne Felder (`_etm_*`, `KP2A_*`) bleiben verborgen und unverändert.
2. **Vorlagen-Einträge wie in KeePass2Android:**
   - Vorlagen liefern die Feldnamen, die Reihenfolge und den Schutz.
   - `@exp_date` erscheint als Feld „Expires“ mit Datum. Es wird als Ablaufdatum des Eintrags gespeichert und ist damit auch in KeePassXC sichtbar.
   - Leere Standardfelder, die die Vorlage nicht vorsieht, werden ausgeblendet.
3. Alles bleibt KDBX-konform. KeePass2Android, KeePassium und KeePassXC sehen nach dem Sync dieselben Werte.

## Umsetzung

### 1. Logik (`web/vault/src/lib/fields.ts`, neu)

- `readCustomFields(entry)` liefert alle Nicht-Standardfelder ohne interne Felder, jeweils mit Name, Wert und Schutzstatus.
- `findTemplate(db, entry)` löst `_etm_template_uuid` (Hex) zu einem Vorlagen-Eintrag auf und liest daraus die Felddefinitionen mit Name, Titel, Typ, Position und Schutz.
- `entryLayout(db, entry)` bestimmt die Reihenfolge der Felder im Formular:
  - Bei Einträgen mit Vorlage gilt die Reihenfolge der Vorlage, übrige eigene Felder folgen am Ende.
  - Ohne Vorlage folgen die eigenen Felder nach den Standardfeldern, alphabetisch.
- `EntryEdits` bekommt `customFields` und `expires` (Datum oder null).
  - `applyEntryEdits` und `createEntry` schreiben die Felder: geschützt bleibt geschützt, und gelöschte Felder werden entfernt.
  - Ist das Ablaufdatum gesetzt, schreiben sie `times.expires = true` und `expiryTime`, sonst `false`.
- Der Verlauf funktioniert wie bisher über `pushHistory()`.

### 2. Oberfläche (`EntrySheet` in `App.tsx`, neue Komponente `components/entry-fields.tsx`)

- Unter den Standardfeldern gibt es den Abschnitt „Fields“ mit den eigenen Feldern im passenden `Input`:
  - Geschützte Felder werden maskiert, mit „Anzeigen“ und „Kopieren“.
  - „Expires“ ist ein `Input type="date"`.
- Bei Einträgen mit Vorlage zeigt ein Badge den Namen der Vorlage, z. B. „Kreditkarte“. Leere Standardfelder, die die Vorlage nicht vorsieht, sind eingeklappt und lassen sich über „Show all fields“ einblenden.
- Bei Schreibrecht gibt es **„Add field“** mit Name, Wert und Schalter „Protected“ sowie „Remove“ je Feld. Namen müssen eindeutig sein und dürfen nicht mit Standardfeldern oder internen Namen kollidieren.
- Bei Nur-Lese-Recht werden die Felder nur angezeigt und können kopiert werden.
- Die Vorlagen-Einträge im Ordner „Vorlagen“ selbst zeigen ihre Feldliste nur lesend, mit dem Hinweis, dass sie in KeePass2Android bearbeitet werden.
- Die Suche durchsucht auch eigene Felder, die nicht geschützt sind. Geschützte Felder bleiben wie Passwörter außen vor.

### 3. Optional: Neuer Eintrag aus Vorlage (siehe offene Fragen)

- Neben „Add entry“ gibt es ein Menü (`DropdownMenu`) mit den Vorlagen des Tresors.
- Der neue Eintrag übernimmt Symbol und Felder der Vorlage und bekommt `_etm_template_uuid`.

## Tests

- Node-Tests mit kdbxweb:
  - Ein Eintrag mit Kreditkarten-Vorlage, nachgebaut wie KeePass2Android: Felder, Reihenfolge, Schutz und `@exp_date` werden richtig gelesen.
  - Bearbeiten und Speichern erhält Schutzstatus und interne Felder.
  - Eigene Felder lassen sich hinzufügen und entfernen.
  - Das Ablaufdatum wird gesetzt und gelöscht.
- Browser-Prüfung in einer Testinstanz mit einem Demo-Tresor mit Vorlagen.
- Abnahme durch Sascha: Kreditkarte in KeePass2Android anlegen, im Web-Vault ansehen und ändern, in KeePass2Android prüfen.

## Doku

- README-Funktionsliste und Changelog 0.9.0.

## Entscheidungen (2026-11-25, Sascha)

1. **Ja:** Neue Einträge aus Vorlagen lassen sich im Web-Vault anlegen, schon in 0.9.0.
2. **Ja:** Bei allen Einträgen lassen sich eigene Felder hinzufügen und entfernen.
3. **Ja:** Das Feld „Expires“ gibt es auch bei Einträgen ohne Vorlage. Die Markierung abgelaufener Einträge folgt später.
4. **Nein:** In der Tabellenspalte „Username“ ändert sich nichts. Unter dem Titel zeigt nur ein Badge mit dem Vorlagennamen, dass es eine Kreditkarte o. Ä. ist.

## Umsetzung (2026-11-25)

- Logik in `web/vault/src/lib/fields.ts`:
  - Funktionen `readCustomFields`, `writeCustomFields`, `listTemplates`, `findTemplate`, `readTemplate`, `readExpiry`, `writeExpiry`, `linkTemplate`, `templateStartFields`, `withTemplateProtection` und `customFieldNameError`.
  - `EntryView` und `EntryEdits` in `lib/kdbx.ts` sind um eigene Felder, Ablaufdatum und Vorlage erweitert.
  - Tests stehen in `fields.test.mjs`.
- Oberfläche:
  - `components/entry-fields.tsx` zeigt die Felder und enthält das Formular „Add field“.
  - Im Formular in `App.tsx` gibt es „Show all fields“, das Ablaufdatum unter den eigenen Feldern, das Vorlagen-Menü an „Add entry“ und das Badge in der Tabelle.
- Präzisierungen gegenüber dem Plan:
  - **Schutz laut Vorlage:** Der Schutz eines Felds richtet sich auch nach der Vorlage. kdbxweb speichert leere geschützte Werte als Klartext, ein später eingetragenes CVV wäre sonst ungeschützt.
  - **Felder der Vorlage lassen sich nicht entfernen**, nur leeren, wie in KeePass2Android. Eigene Zusatzfelder lassen sich entfernen.
  - **Das Ablaufdatum** wird als lokales Datum um 0:00 Uhr gespeichert.
- Nebenbei gefundener Fehler, schon seit 0.1:
  - **Ursache:** `PUT /api/vault/files/{id}/content` lieferte `permission: "none"`.
  - **Folge:** Nach Speichern, Sperren und Entsperren war der Tresor bis zum Neuladen der Seite schreibgeschützt.
  - **Behebung:** Der Server liefert die echte Berechtigung, der Web-Vault übernimmt sie nicht mehr aus der Speicherantwort.
  - **Test:** Ein Backend-Test prüft das.
- Geprüft:
  - Browser-Test in einer Testinstanz mit einer nachgebauten Kreditkarten-Vorlage von KeePass2Android:
    - Felder in Vorlagen-Reihenfolge, maskiertes CVV und Ablaufdatum
    - Bearbeiten, Feld hinzufügen und entfernen, Speichern und Neu-Entsperren
    - Neuer Eintrag aus der Vorlage
    - Zusatzfelder eines normalen Eintrags und die Suche
    - Vorlagen nur lesend, Nur-Lese-Nutzer
  - Alle Browser-Tests der Ordner, des Reload-Knopfs und der Duplikat-Prüfung laufen weiter.
  - Die gespeicherte Datei mit kdbxweb gelesen: `_etm_template_uuid` ist als Hex gesetzt wie bei KeePass2Android, CVV und PIN sind geschützt, Symbol und Ablaufdatum gesetzt.

## Ursprünglich offene Fragen

1. **Neue Einträge aus Vorlagen** auch im Web-Vault anlegen (Abschnitt 3)? Empfehlung: ja, gleich in 0.9.0, sonst lassen sich Kreditkarten nur in der App anlegen.
2. **Eigene Felder hinzufügen und entfernen** bei normalen Einträgen, wie die „Additional attributes“ in KeePassXC? Empfehlung: ja.
3. **Ablaufdatum allgemein:** Auch bei Einträgen ohne Vorlage ein Feld „Expires“ anbieten und abgelaufene Einträge in der Tabelle markieren? Empfehlung: Das Feld ja, die Markierung erst später.
4. **Tabelle:** Soll für Vorlagen-Einträge in der Spalte „Username“ statt „—“ z. B. die Kartennummer stehen? Empfehlung: nein. Stattdessen zeigt ein kleines Badge mit dem Vorlagennamen unter dem Titel, dass es eine Kreditkarte ist.
