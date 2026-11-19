# Arlberg Snow Depth

Snow height at the Lawinenwarndienst Tirol weather stations around St. Anton / Rendl,
with history and a 5-day snowfall forecast.

Live page (private claude.ai artifact): https://claude.ai/artifact/DYQWzaKaoTBmZEWfnZs714

## How it works

Artifact pages can't call outside APIs from the browser, so data flows through the artifact's database:

1. A scheduled Claude Code task runs at 07:10, 12:10 and 17:10 (Vienna) and runs `fetch.py` (setup: [SCHEDULE.md](SCHEDULE.md)).
2. `fetch.py` writes JSON docs into `out/`:
   - `stations.json` → db `meta/stations` (current HS per station)
   - `forecast.json` → db `forecast/latest` (5-day snowfall, min/max temp)
   - `readings/<YYYY-MM-DDTHH>.json` → db `readings/<slot>` (HS per station at 07/12/17)
3. The task writes those docs into the artifact database; `index.html` renders them.

## Data sources

| Data | Source |
|---|---|
| Stations, snow height (HS) | `https://static.avalanche.report/weather_stations/stations.geojson` |
| History | hourly archive `https://static.avalanche.report/weather_stations/<UTC YYYY-MM-DD_HH>-00_stations.geojson` |
| Forecast | Open-Meteo (free tier). Falls back to MET Norway when Open-Meteo's shared daily quota is exhausted |

## Run locally

```bash
python3 fetch.py --selftest
python3 fetch.py --days 14   # backfill 14 days of 07/12/17 slots
```
