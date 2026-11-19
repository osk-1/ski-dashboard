# Arlberg Snow Depth

Snow height at the Lawinenwarndienst Tirol weather stations around St. Anton / Rendl,
with history and a 5-day snowfall forecast.

Live page: https://osk-1.github.io/ski-dashboard/

## How it works

1. A GitHub Actions workflow (`.github/workflows/fetch.yml`) runs `fetch.py` at about 07:10, 12:10 and
   17:10 Vienna time (GitHub can delay scheduled runs by 10–30 min) and commits the results in `data/`:
   - `stations.json`: current snow height (HS) per station
   - `forecast.json`: 5-day snowfall and min/max temperature per station
   - `readings.json`: HS per station at every 07/12/17 slot (the history)
2. GitHub Pages serves `index.html`, which reads those three files.

To record now: Actions tab → "Record snow data" → Run workflow.

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
