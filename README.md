# Arlberg Snow Depth

Snow height at the Lawinenwarndienst Tirol weather stations around St. Anton / Rendl,
with history and a 5-day snowfall forecast.

Live page: https://osk-1.github.io/ski-dashboard/

## How it works

1. A GitHub Actions workflow (`.github/workflows/fetch.yml`) runs `fetch.py` at about 07:10, 12:10 and
   17:10 Vienna time (GitHub can delay scheduled runs by 10–30 min) and commits the results in `data/`:
   - `stations.json`: current readings per station (see below)
   - `forecast.json`: 5-day snowfall and min/max temperature per station
   - `readings.json`: HS per station at every 07/12/17 slot (the history)
2. GitHub Pages serves `index.html`, which reads those three files.

To record now: Actions tab → "Record snow data" → Run workflow.

## Stations

A fixed list (`STATIONS` in `fetch.py`, 6 snow + 5 wind stations: Ulmerhütte, Kapall, Äußere Rendlalpe, Gampberg,
Kartellboden-Damm, Dias, Hochkar, Kappl Kapplerkopf, Lattejoch); a station missing from the feed is warned about on stderr.
Fields per station in `stations.json`: `id, uuid, name, region, type` (`snow`/`wind`), `lon, lat, alt`,
`hs` (snow height cm), `n24` (new snow 24 h cm), `hsd24` (HS change 24 h cm), `lt` (air temp °C),
`wg` (mean wind km/h), `wg_boe` (gust km/h), `wr` (wind direction °), `date`. Missing values are `null`.
`readings.json` records `hs` of snow stations only.

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
