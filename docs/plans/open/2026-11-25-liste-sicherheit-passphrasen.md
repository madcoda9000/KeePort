# Plan: Doppelklick, Spalte „Modified“, Sicherheitsbericht und Passphrasen

- **Status:** umgesetzt (2026-11-25), Abnahme auf der NAS ausstehend
- **Erstellt:** 2026-11-25
- **Zielversion:** 0.13.0 (neue Funktionen, Changelog `## [0.13.0] - <Datum>`)
- **Herkunft:** Vorschläge 10, 14, 15 und 17 aus `docs/plans/open/2026-11-25-eintragsliste-spaeter.md`

## Ausgangslage

- **Zeilen:** In der Eintragstabelle öffnet nur der Titel-Knopf den Eintrag. Ein Klick auf den Rest der Zeile bewirkt nichts.
- **Zeitstempel:** Jeder Eintrag hat `times.lastModTime` (letzte Änderung) und `times.creationTime`, auch von KeePass2Android, KeePassXC und KeePassium gesetzt. Angezeigt wird beides nicht.
- **Passwortqualität:** Wie gut die Passwörter eines Tresors sind, sieht man nirgends.
- **Generator:** Der Passwortgenerator (0.11.0) erzeugt nur Zeichenpasswörter.

## Ziel und Bedienkonzept

### 1. Doppelklick öffnet den Eintrag

- Ein **Doppelklick irgendwo auf die Zeile** öffnet den Eintrag, wie in KeePass und KeePassXC.
- Ein **Einfachklick auf die Zeile** markiert sie, z. B. als Ziel für spätere Tastaturkürzel (Vorschlag 12). Bei Schreibrecht setzt er zusätzlich das Häkchen der Auswahl. Siehe offene Frage 1.
- Klicks auf Knöpfe in der Zeile bleiben wie sie sind und lösen keinen Doppelklick aus: Kopieren, Website öffnen, Tag, Checkbox. Ein Klick auf den Titel öffnet den Eintrag weiter sofort.
- Auf Touch-Geräten gibt es keinen Doppelklick. Dort öffnet der Titel wie bisher.
- Die Zeile bekommt einen Hinweis im `title` und eine Hover-Hervorhebung. Mit der Tastatur bleibt der Titel-Knopf der Weg, einen Eintrag zu öffnen.

### 2. Spalte „Modified“

- Die neue Spalte zeigt das Datum der letzten Änderung (`lastModTime`) relativ an, z. B. „3 days ago“ oder „2 years ago“. Das genaue Datum mit Uhrzeit steht im Tooltip.
- Sie ist sortierbar, nach Zeitstempel und nicht nach dem Text.
- Auf schmalen Bildschirmen wird sie ausgeblendet (`hidden lg:table-cell`).
- Das Formular zeigt unter dem Titel „Created … · Modified …“.

### 3. Sicherheitsbericht

- Ein neuer Eintrag **„Security“** in der Sidebar unter „Expired“. Er erscheint nur bei entsperrtem Tresor und zeigt die Anzahl der Funde.
- Die Ansicht hat oben Kacheln für jede Prüfung mit Anzahl. Ein Klick auf eine Kachel filtert die Tabelle auf die betroffenen Einträge. Die Kopierknöpfe und die Mehrfachauswahl gelten dort wie gewohnt.
- **Prüfungen, nur lokal im Browser** (nichts verlässt den Browser, nichts wird gespeichert):
  - **Weak:** Die geschätzte Stärke liegt unter 60 Bit, oder das Passwort steht in einer Liste häufiger Passwörter, siehe offene Frage 3.
    - Die Schätzung berücksichtigt Länge, Zeichengruppen, Wiederholungen, Folgen wie `abc` oder `123`, Tastaturmuster wie `qwerty` und Jahreszahlen.
    - Schwache Passwörter erkennt KeePort zuverlässig. Für starke gibt die Schätzung keine Garantie.
  - **Reused:** Dasselbe Passwort steht in mehreren Einträgen. Verglichen wird im Speicher. Angezeigt werden die betroffenen Einträge, nie das Passwort.
  - **Old:** Das Passwort wurde seit mehr als einem Jahr nicht geändert. Der Zeitpunkt der Passwortänderung wird aus dem Verlauf ermittelt, und nicht aus dem Datum der letzten Änderung, das auch bei einer Änderung der Notizen springt. Die Schwelle ist einstellbar (offene Frage 4).
  - **Empty:** Einträge mit Benutzername, aber ohne Passwort.
  - **Expired:** Das sind die abgelaufenen Einträge aus 0.11.0, im Bericht mit aufgeführt.
- **Ausgenommen** sind Vorlagen, der Papierkorb und Einträge ohne Passwort bei „Weak“ und „Reused“.
- Die Tabelle zeigt auf Wunsch ein kleines Warnsymbol am Passwort mit Tooltip, z. B. „Used in 3 entries“ (offene Frage 5).
- **Optional, nicht in 0.13.0:**
  - Ein Abgleich mit „Have I Been Pwned“ über das k-Anonymity-Verfahren. Dabei gehen nur die ersten 5 Zeichen des SHA-1-Hashs an den Dienst.
  - Das ist ein Datenschutzthema wie die Favicons und wäre ein Opt-in je Nutzer.

### 4. Passphrasen im Generator

- Der Generator bekommt zwei Modi, „Password“ und „Passphrase“ (`Tabs`).
- **Passphrase:**
  - 4–10 Wörter, Standard 6
  - Trennzeichen: Bindestrich, Leerzeichen, Punkt, Unterstrich, keines
  - „Capitalize words“ (Großschreibung am Wortanfang)
  - „Add a number“ (eine Ziffer an zufälliger Stelle), damit Regeln wie „mindestens eine Ziffer“ erfüllt werden
- **Wortliste:** die **EFF Large Wordlist**, 7776 englische Wörter, 12,9 Bit je Wort. Sechs Wörter ergeben etwa 77 Bit.
  - Lizenz CC BY 3.0, die Quelle wird in README und `THIRD-PARTY-NOTICES` genannt.
  - Sie wird **erst geladen, wenn der Modus „Passphrase“ gewählt wird**, als eigener Vite-Chunk von etwa 60 KB. Die Vault-Seite wird dadurch nicht größer.
- Die Zufallswahl läuft wie beim Passwort über `crypto.getRandomValues` mit Rejection Sampling. Die Stärkeanzeige rechnet mit `Wörter × log2(7776)` und den Zusätzen.

## Umsetzung

- **`lib/strength.ts` (neu):**
  - `estimateStrength(password)` liefert Bits und Hinweise wie „Too short“, „Common password“ oder „Sequence“.
  - Dazu kommt eine kleine Liste häufiger Passwörter, z. B. die 1000 häufigsten aus SecLists (MIT), etwa 8 KB.
- **`lib/security-report.ts` (neu):**
  - `buildReport(entries, now)` liefert die Gruppen `weak`, `reused`, `old`, `empty` und `expired` mit Eintrags-IDs.
  - `passwordChangedAt(entry)` sucht im Verlauf die letzte Version mit anderem Passwort.
- **`lib/passphrase.ts` (neu):** `generatePassphrase(options)`. Die Wortliste kommt aus `lib/wordlists/eff-large.ts` per `import()`.
- **Oberfläche:**
  - Doppelklick über `onDoubleClick` auf `TableRow`. Ausgenommen sind Klicks auf `button`, `a`, `input` und `[role=checkbox]`.
  - Spalte „Modified“ in `ENTRY_COLUMNS`.
  - Neue Komponente `components/security-report.tsx` mit Kacheln und Filter.
  - Sidebar-Eintrag in `folder-tree.tsx`.
  - Generator um die Reiter erweitern.
- **`EntryView`** bekommt `modified`, `created` und `passwordChanged`.

## Tests

- **Node-Tests:**
  - Stärkeschätzung: kurze, häufige und gemusterte Passwörter gelten als schwach, generierte als stark.
  - Bericht:
    - Wiederverwendung über mehrere Einträge, auch zwischen Ordnern
    - „Old“ nach dem Verlauf: eine Notizänderung setzt die Uhr nicht zurück
    - Ausnahmen für Vorlagen und Papierkorb
  - Passphrase: Wortanzahl, Trennzeichen, Großschreibung, Ziffer, Entropie, und alle Wörter stammen aus der Liste.
  - Die Wortliste hat genau 7776 Einträge, eindeutig und klein geschrieben.
- **Browser-Test in einer Testinstanz:**
  - Doppelklick öffnet, Klick auf die Kopierknöpfe öffnet nicht.
  - Spalte „Modified“ sortiert richtig.
  - Bericht mit Demo-Daten: schwaches, mehrfach genutztes und altes Passwort; der Filter je Kachel greift.
  - Passphrase-Modus lädt die Liste nach und übernimmt die Passphrase.
- **Barrierefreiheit:** Der Bericht ist per Tastatur bedienbar, und die Kacheln sind Knöpfe mit Beschriftung.

## Entscheidungen (2026-11-25, Sascha)

1. **Ein Einfachklick auf die Zeile markiert sie nur.** Die Auswahl-Checkbox bleibt davon unberührt.
2. **Der Sicherheitsbericht ist eine Sidebar-Ansicht „Security“ mit Kacheln.**
3. **Die Liste häufiger Passwörter wird mitgeliefert** (ca. 8 KB).
4. **Die Schwelle für „Old“ ist fest 1 Jahr.**
5. **Das Warnsymbol am Passwort erscheint auch in der normalen Tabelle**, dezent und mit Tooltip.
6. **Passphrasen gibt es nur auf Englisch** (EFF Large Wordlist).
7. **Der Abgleich mit „Have I Been Pwned“** ist für später vorgemerkt, als Opt-in je Nutzer. Er steht im Sammelplan `2026-11-25-eintragsliste-spaeter.md`, Punkt 18.

## Umsetzung (2026-11-25)

- Logik:
  - `lib/strength.ts` (`estimateStrength`, Schwelle 60 Bit)
  - `lib/security-report.ts` (`buildReport`, `passwordChangedAt`)
  - `lib/passphrase.ts` (`generatePassphrase`, `loadWordlist`, `passphraseEntropyBits`)
  - Listen in `lib/wordlists/`: EFF Large Wordlist, 7776 Wörter, als eigener Chunk von 62 KB; SecLists, die 1000 häufigsten Passwörter
  - Tests stehen in `security.test.mjs`.
- Oberfläche:
  - `components/security-report.tsx` (Kacheln)
  - Sidebar-Eintrag „Security“
  - Zeilen markieren und Doppelklick über `onClick`/`onDoubleClick` auf `TableRow`, ohne Steuerelemente
  - Spalte „Modified“ und „Created … · Modified …“ im Formular
  - Generator mit Reitern „Password“ und „Passphrase“
- Lizenzen: `THIRD-PARTY-NOTICES.md` ist neu, der README-Abschnitt „License“ verweist darauf.
- Präzisierungen gegenüber dem Plan:
  - **Stärkeanzeige im Generator:** Sie bewertet zufällige Geheimnisse jetzt realistischer: Weak < 50, Fair < 64, Strong < 100 Bit. Sechs Wörter (77 Bit) galten sonst nur als „Fair“. Der Bericht bleibt für gewählte Passwörter bei 60 Bit.
  - **Veraltete Optionen im Generator behoben:** Wurden Optionen geändert, während die Wortliste noch lud, erzeugte der Generator die erste Passphrase mit den alten Optionen. Das fiel im Browser-Test auf.
  - **Warnsymbol:** Es zeigt „Weak“ und „Used in n entries“. „Old“ erscheint nur im Bericht, damit die Liste ruhig bleibt.
  - **Zeitbezug:** Der Zeitpunkt für den Bericht und die relativen Datumsangaben wird beim Neuaufbau der Liste gespeichert, nicht bei jedem Rendern.
- Geprüft:
  - Node-Tests:
    - Stärke: häufige, kurze und gemusterte Passwörter sind schwach, generierte stark
    - Passphrasen: Liste mit 7776 eindeutigen Wörtern, Trennzeichen, Großschreibung, Ziffer, Entropie
    - Bericht: Wiederverwendung über Ordner, „Old“ aus dem Verlauf trotz späterer Notizänderung, Ausnahme Papierkorb, „Empty“, „Expired“
  - Browser-Test in einer Testinstanz:
    - Einfachklick markiert, Doppelklick öffnet, Doppelklick auf einen Kopierknopf öffnet nicht
    - Spalte „Modified“
    - Warnsymbol mit Tooltip
    - Berichtskacheln filtern
    - Passphrase mit Leerzeichen übernommen, danach verschwindet die Warnung
  - Alle früheren Browser-Tests laufen weiter.

## Ursprünglich offene Fragen

1. **Einfachklick auf die Zeile:** nur markieren (Empfehlung)? Oder bei Schreibrecht zusätzlich die Checkbox der Mehrfachauswahl umschalten? Das ginge schneller, man wählt aber auch leichter versehentlich aus.
2. **Sicherheitsbericht:** als eigene Sidebar-Ansicht „Security“ mit Kacheln (Empfehlung)? Oder als Dialog „Security report“ über einen Knopf in der Kopfzeile?
3. **Liste häufiger Passwörter (ca. 8 KB) mitliefern?** Empfehlung: ja. Ohne sie gälte z. B. `Passwort2024!` rechnerisch als mittelstark.
4. **Schwelle für „Old“:** fest 1 Jahr (Empfehlung) oder in den Kontoeinstellungen wählbar?
5. **Warnsymbol am Passwort in der Tabelle** auch außerhalb des Berichts? Empfehlung: ja, dezent mit Tooltip.
6. **Passphrasen-Sprache:** nur die englische EFF-Liste (Empfehlung)? Oder zusätzlich eine deutsche Liste? Dafür müsste erst eine mit klarer Lizenz gefunden werden.
7. **„Have I Been Pwned“-Abgleich** als Opt-in vormerken für später?
