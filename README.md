# Regel-Depot 50/30/20

Persönliche Website für ein regelbasiertes Depot bei Trade Republic: 50 % FTSE All-World (VWCE), 30 % Bitcoin, 20 % Gold-ETC.
Jeder Baustein folgt einer Trendregel auf dem 50-Wochen-Durchschnitt (FTSE 2-Wochen-Regel, Bitcoin 3-%-Band, Gold 4-Wochen-Regel).

- **Website:** `docs/` (GitHub Pages, Quelle: Branch `main`, Ordner `/docs`). Statisch, ohne Framework; Depotdaten liegen nur im Browser (`localStorage`).
- **Updates:** `.github/workflows/update.yml` startet `scripts/update.mjs` zu den Wochenschlüssen (Yahoo Finance, LBMA), rechnet die Regeln,
  schreibt `docs/data/*.json` und verschickt Web-Push-Nachrichten (VAPID, ohne Fremdpakete).
- **Rechenkern:** `docs/js/engine.js` (Browser und Node), Tests in `test/` gegen die Rechenbeispiele des Übergabedokuments: `npm test`.

## Einrichten

1. `node scripts/vapid-keys.mjs` einmal ausführen: trägt den öffentlichen Push-Schlüssel in `docs/data/config.json` ein und zeigt den privaten für das Secret `VAPID_PRIVATE_KEY`.
2. Repo pushen, GitHub Pages auf Branch `main`, Ordner `/docs` stellen.
3. Secrets anlegen (unten), dann Actions → „Regel-Depot Update“ → „Run workflow“ → `all`.

## Secrets (Repo → Settings → Secrets and variables → Actions)

| Name | Inhalt |
|---|---|
| `VAPID_PRIVATE_KEY` | privater VAPID-Schlüssel (der öffentliche steht in `docs/data/config.json`) |
| `PUSH_SUB_1` … `PUSH_SUB_5` | Push-Anmeldung je Gerät (JSON, von der Website unter „Signale“ kopiert) |
| `ALPHAVANTAGE_KEY` | optional, Ersatzquelle für VWRD |

## Manuell starten

Actions → „Regel-Depot Update“ → „Run workflow“ → Schritt wählen (`all` holt alle fälligen Wochenschlüsse, `test-push` schickt eine Testnachricht).

Keine Anlage- oder Steuerberatung. Die Seite führt keine Orders aus und kennt keine Zugangsdaten.
