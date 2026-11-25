# Plan: Weitere Verbesserungen der Eintragsliste (später)

- **Status:** open, gesammelt, noch nicht entschieden
- **Erstellt:** 2026-11-25
- **Herkunft:** Vorschläge 9–15 aus `docs/plans/closed/2026-11-25-eintragsliste-optimieren.md`, auf später verschoben (Entscheidung Sascha, 2026-11-25)

## Vorschläge

9. **Verlauf eines Eintrags:** Die KDBX speichert frühere Versionen (`entry.history`). Ein Reiter „History“ im Formular zeigt sie mit Datum, und man kann eine Version wiederherstellen.
10. **Spalte „Modified“:** Das Datum der letzten Änderung, sortierbar, damit man „zuletzt geändert“ schnell findet.
11. **Tags:**
    - Tags werden in der Tabelle angezeigt und lassen sich im Formular bearbeiten (`entry.tags`).
    - Ein Klick auf einen Tag filtert die Liste.
12. **Tastaturkürzel:**
    - `/` springt in die Suche, `Esc` schließt das Formular.
    - In der gewählten Zeile kopiert `Ctrl`/`Cmd`+`B` den Benutzernamen und `Ctrl`/`Cmd`+`C` das Passwort, wie in KeePassXC.
13. **Spalten ein- und ausblenden:** Ein `DropdownMenu` mit Checkboxen, gespeichert im Browser (`localStorage`).
14. **Sicherheitsbericht:** schwache, mehrfach verwendete und sehr alte Passwörter. Er wird nur lokal im Browser berechnet.
15. **Doppelklick auf eine Zeile:** Ein Doppelklick öffnet den Eintrag, ein Einfachklick wählt die Zeile aus. Das passt zu den Kopierknöpfen und den Tastaturkürzeln.

Weitere Ideen aus der Umsetzung von 0.11.0:

16. **Favicon dauerhaft speichern:** „Save website icon“ speichert ein geladenes Favicon als eigenes Symbol (`customIcon`) in der KDBX. Dann sehen es auch KeePass2Android und KeePassXC, und der Abruf aus dem Netz entfällt.
17. **Passphrasen im Generator:** Wörter statt Zeichen, z. B. mit der EFF-Wortliste. Die Liste macht die Vault-Seite um etwa 60 KB größer.

## Offene Fragen

- Welche Punkte als Nächstes, in welcher Reihenfolge?
