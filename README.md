# Regel-Depot 50/30/20

Persönliche Website für ein regelbasiertes Depot bei Trade Republic: 50 % FTSE All-World (VWCE), 30 % Bitcoin, 20 % Gold-ETC.
Jeder Baustein folgt einer Trendregel auf dem 50-Wochen-Durchschnitt (FTSE 2-Wochen-Regel, Bitcoin 3-%-Band, Gold 4-Wochen-Regel).

- **Website:** `docs/` (GitHub Pages, Quelle: Branch `main`, Ordner `/docs`). Statisch, ohne Framework; Depotdaten liegen nur im Browser (`localStorage`). Vor Import, „Alles löschen“ und Wiederherstellen legt die Seite den bisherigen Stand im Browser ab (die letzten drei, Einstellungen → „Frühere Stände“); ein unlesbarer Stand wird aufgehoben und nicht überschrieben.
- **Updates:** `.github/workflows/update.yml` startet `scripts/update.mjs` zu den Wochenschlüssen (Alpha Vantage als Hauptquelle und EODHD als Ersatz und für den Freitagsschluss beim FTSE, Coinbase für Bitcoin, LBMA-Nachmittagsfixing für Gold; Euro-Kurse von Lang & Schwarz, Coinbase und EZB; Kraken, Alpha Vantage und Yahoo Finance als weitere Ersatzquellen), rechnet die Regeln,
  schreibt `docs/data/*.json` und verschickt Web-Push-Nachrichten (VAPID, ohne Fremdpakete). Node 24.
- **Handelskalender:** Feiertage in London (Ostern, Bank Holidays mit Ersatztagen) rechnet `docs/js/engine.js` selbst aus; kein LBMA-Nachmittagsfixing am letzten Geschäftstag vor Weihnachten und vor Neujahr (meist 24.12. und 31.12., am Wochenende der Freitag davor). Sonderfeiertage (etwa ein zusätzlicher Bank Holiday) kommen in `docs/data/config.json` unter `holidays.extra`, ein gestrichener unter `holidays.notHolidays`.
- **Rebalancing:** quartalsweise zum Quartalsende (31.03., 30.06., 30.09., 30.12.; Wochenende oder Feiertag: der Handelstag davor), erstmals am 30.12.2026 (bis dahin jährlich am 30.12.). Am Stichtag und bis 7 Tage danach trägt der Knopf „Vorgeschlagenes Rebalancing umgesetzt“ die Orders des gewählten Vorschlags ein (vorausgefüllt, änderbar) und bucht das Cash zwischen den Bausteinen als Umbuchung; eine Umbuchung lässt sich auch einzeln im Buchungsformular eintragen.
- **Depotentwicklung:** „Gewinn“ und „Wert“ zeigen das Depot und die Bausteine in Euro; „Vergleich“ zeigt ab dem letzten Wochenschluss vor dem Regelstart (27.09.2026; Regelstart 28.09.2026) dein Depot in Prozent (durchgehend, zeitgewichtet, also ohne Sprünge durch Ein- und Auszahlungen) gegen die reine Regel („Regel pur“, lila: Start mit dem Gesamtwert deines Depots genau 50/30/20, je Baustein investiert oder Cash nach Regel, Kauf und Verkauf zum Wochenschluss mit dem Signal, Einzahlungen 50/30/20, Auszahlungen anteilig, an jedem Rebalancing-Stichtag (quartalsweise) zurück auf 50/30/20, Cash mit dem Zins aus den Einstellungen, nur Bitcoin im Krypto-Baustein, ohne Gebühren und Steuern) und gegen ein Buy-&-Hold-Depot 50/30/20 aus VWCE, Bitcoin und WisdomTree Physical Swiss Gold (gestrichelt; Start mit dem Gesamtwert deines Depots zum Wochenschluss am 27.09., VWCE und Gold-ETC mit dem Schlusskurs ihres letzten Handelstags, an jedem Rebalancing-Stichtag (quartalsweise) zurück auf 50/30/20, dieselben Ein- und Auszahlungen, ohne Gebühren und Steuern), mit Tagespunkten; darunter der Drawdown aller Linien mit Max DD, Hoch → Tief und aktuellem Rückgang, dann der Abstand deines Depots zur reinen Regel mit den Gründen (Aufteilung der Bausteine, Zeitpunkt und Kurs deiner Orders, Cash und Positionen anders als die Regel, Gebühren, Beimischung ETH/SOL) in Prozentpunkten und Euro und zum Ausklappen jede Order der Regel neben deiner Order. Die Zeitraum-Knöpfe (1 M, 1 J, laufendes Jahr, Alles) gelten auch hier: Ein Zeitraum startet für alle Linien bei 0 %, Max DD, Rückgang und Gründe gelten dann nur für diesen Zeitraum.
- **Rechenkern:** `docs/js/engine.js` (Browser und Node), Tests in `test/` gegen die Rechenbeispiele des Übergabedokuments mit festen Testdaten (`test/fixtures`): `npm test`.

## Zeitplan (Berliner Zeit, im Sommer wie im Winter)

GitHub-Cron kennt nur UTC. Deshalb stehen die meisten Zeiten doppelt im Workflow (Sommer- und Winterzeit); ein kleiner Vorab-Job lässt den Lauf der anderen Jahreszeit aus. GitHub startet geplante Läufe oft einige Minuten später.

| Wann | Schritt |
|---|---|
| Fr 15:17 | Vorwarnung FTSE und Gold |
| Fr ab 16:07 (stündlicher Kurs-Ticker, 15:07 London) | Gold vorläufig: der Spotpreis gleich nach dem LBMA-Nachmittagsfixing gilt sofort als Wochenschluss, Push sofort; das Fixing ersetzt ihn, sobald die LBMA es veröffentlicht (meist spät abends), mit Korrektur nur, wenn sich die Regel ändert |
| Fr 18:47 | Wochenschluss FTSE, Gold (falls das Fixing schon da ist), Euro-Kurse |
| Fr 20:23, 22:23, Sa 1:37, Sa 9:23 | Wiederholungen für fehlende Schlüsse |
| So 21:17 | Vorwarnung Bitcoin |
| Start So 23:31 und 23:46 UTC, gebucht Mo 0:00:40 UTC | Wochenschluss Bitcoin pünktlich (die Bitcoin-Woche endet So 24 Uhr UTC): Der Lauf wartet bis kurz nach Mitternacht UTC, holt die Tageskerze (Coinbase, bei einem Fehlschlag sofort Kraken, Yahoo, Alpha Vantage; notfalls vorläufig der Live-Kurs) und schickt die Nachricht sofort, auch nachts |
| Mo 0:07 UTC, 2:23 UTC | Nachfassen Bitcoin, falls der pünktliche Lauf ausfiel |
| Mo 7:53 | Wochenübersicht und die übrigen Nachrichten der Nacht zum Montag (Bitcoin-Nachrichten kommen sofort) |
| Mo–Do 19:37 und 23:37 | Euro-Kurse, FTSE-Tagesschluss |
| stündlich (7 Minuten nach, 5–21 Uhr UTC) | Kurs-Ticker; trägt einmal am Tag den Krypto-Tagesschluss vom Vortag nach; montags holt er die Wochenübersicht nach, falls der 7:53-Lauf ausfiel |
| Mo–Do 15:17 und 18:47 | nur wenn die Woche vor dem Freitag endet (Gründonnerstag, Gold vor Weihnachten und Neujahr): Vorwarnung und vorgezogener Wochenschluss am letzten Handelstag |
| Mo–Fr im Dezember 11:17 und 14:47 | nur an FTSE-Halbtagen (London schließt am letzten Geschäftstag vor Weihnachten und vor Neujahr um 12:30 Uhr) |

Alle anderen Nachrichten (Signale, Korrekturen, Fehler) gehen sofort hinaus, auch nachts. Die Feiertagsläufe enden an allen anderen Tagen sofort, ohne etwas zu schreiben (kein Commit).

## Einrichten

1. `node scripts/vapid-keys.mjs` einmal ausführen: trägt den öffentlichen Push-Schlüssel in `docs/data/config.json` ein und zeigt den privaten für das Secret `VAPID_PRIVATE_KEY`.
2. Repo pushen, GitHub Pages auf Branch `main`, Ordner `/docs` stellen.
3. Secrets anlegen (unten), dann Actions → „Regel-Depot Update“ → „Run workflow“ → `all`.

## Secrets (Repo → Settings → Secrets and variables → Actions)

| Name | Inhalt |
|---|---|
| `VAPID_PRIVATE_KEY` | privater VAPID-Schlüssel (der öffentliche steht in `docs/data/config.json`) |
| `PUSH_SUB_1` … `PUSH_SUB_5` | Push-Anmeldung je Gerät (JSON, von der Website unter „Signale“ kopiert) |
| `ALPHAVANTAGE_KEY` | Alpha Vantage, Hauptquelle für den FTSE-Wochenschluss (VWRD.LON) |
| `EODHD_KEY` | EODHD, Ersatzquelle für den FTSE und Freitagsschluss (VWRD.LSE) |

Die Schlüssel stehen nur in den Secrets. Fehlermeldungen der Quellen werden vor dem Speichern maskiert, damit kein Schlüssel in `docs/data` oder in Commit-Nachrichten landet.

## Manuell starten

Actions → „Regel-Depot Update“ → „Run workflow“ → Schritt wählen (`all` holt alle fälligen Wochenschlüsse, `test-sources` prüft alle Quellen, `test-push` schickt eine Testnachricht).

Keine Anlage- oder Steuerberatung. Die Seite führt keine Orders aus und kennt keine Zugangsdaten.
