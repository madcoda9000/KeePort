# Plan: Weitere Verbesserungen der Eintragsliste (später)

- **Status:** open, gesammelt, noch nicht entschieden
- **Erstellt:** 2026-11-25
- **Herkunft:** Vorschläge 9–15 aus `docs/plans/closed/2026-11-25-eintragsliste-optimieren.md`, auf später verschoben (Entscheidung Sascha, 2026-11-25)

## Vorschläge

9. **Verlauf eines Eintrags** (erledigt in 0.12.0, siehe `docs/plans/closed/2026-11-25-verlauf-und-tags.md`): Die KDBX speichert frühere Versionen (`entry.history`). Ein Reiter „History“ im Formular zeigt sie mit Datum, und man kann eine Version wiederherstellen.
10. **Spalte „Modified“** (erledigt in 0.13.0, siehe `docs/plans/closed/2026-11-25-liste-sicherheit-passphrasen.md`): Das Datum der letzten Änderung, sortierbar, damit man „zuletzt geändert“ schnell findet.
11. **Tags** (erledigt in 0.12.0, siehe `docs/plans/closed/2026-11-25-verlauf-und-tags.md`):
    - Tags werden in der Tabelle angezeigt und lassen sich im Formular bearbeiten (`entry.tags`).
    - Ein Klick auf einen Tag filtert die Liste.
12. **Tastaturkürzel:**
    - `/` springt in die Suche, `Esc` schließt das Formular.
    - In der gewählten Zeile kopiert `Ctrl`/`Cmd`+`B` den Benutzernamen und `Ctrl`/`Cmd`+`C` das Passwort, wie in KeePassXC.
13. **Spalten ein- und ausblenden:** Ein `DropdownMenu` mit Checkboxen, gespeichert im Browser (`localStorage`).
14. **Sicherheitsbericht** (erledigt in 0.13.0, siehe `docs/plans/closed/2026-11-25-liste-sicherheit-passphrasen.md`): schwache, mehrfach verwendete und sehr alte Passwörter. Er wird nur lokal im Browser berechnet.
15. **Doppelklick auf eine Zeile** (erledigt in 0.13.0, siehe `docs/plans/closed/2026-11-25-liste-sicherheit-passphrasen.md`): Ein Doppelklick öffnet den Eintrag, ein Einfachklick wählt die Zeile aus. Das passt zu den Kopierknöpfen und den Tastaturkürzeln.

Weitere Ideen aus der Umsetzung von 0.11.0:

16. **Favicon dauerhaft speichern:** „Save website icon“ speichert ein geladenes Favicon als eigenes Symbol (`customIcon`) in der KDBX. Dann sehen es auch KeePass2Android und KeePassXC, und der Abruf aus dem Netz entfällt.
17. **Passphrasen im Generator** (erledigt in 0.13.0, siehe `docs/plans/closed/2026-11-25-liste-sicherheit-passphrasen.md`): Wörter statt Zeichen, z. B. mit der EFF-Wortliste. Die Liste macht die Vault-Seite um etwa 60 KB größer.

18. **Abgleich mit „Have I Been Pwned“** (Entscheidung Sascha, 2026-11-25: für später vormerken):
    - Prüft, ob Passwörter in bekannten Datenlecks vorkommen, über das k-Anonymity-Verfahren. Der Browser schickt nur die ersten 5 Zeichen des SHA-1-Hashs an `api.pwnedpasswords.com` und vergleicht den Rest lokal.
    - Das Passwort selbst verlässt den Browser nie. Der Dienst sieht aber, dass jemand von dieser IP-Adresse prüft.
    - Gedacht als Opt-in je Nutzer, wie „Load website icons“. Dafür braucht es eine CSP-Ausnahme `connect-src https://api.pwnedpasswords.com` nur für Vault-Seiten.

## Offene Fragen

- Welche Punkte als Nächstes, in welcher Reihenfolge?
