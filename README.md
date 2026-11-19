# Arlberg Snow Depth

Snow height at the Lawinenwarndienst Tirol (plus two GeoSphere Austria) weather stations around St. Anton / Rendl,
with history and a 5-day snowfall forecast.

Live page: https://osk-1.github.io/ski-dashboard/

## How it works

1. A GitHub Actions workflow (`.github/workflows/fetch.yml`) runs `fetch.py` at about 07:10, 12:10 and
   17:10 Vienna time (GitHub can delay scheduled runs by 10–30 min) and commits the results in `data/`:
   - `stations.json`: current readings per station (see below)
   - `forecast.json`: 5-day snowfall and min/max temperature per station
   - `readings.json`: HS per station at every 07/12/17 slot (the history)
   - `danger.json`: avalanche danger per region (`AT-07-07`, `AT-07-10`, `AT-07-11`): `ratings` (`level` 0–5, `bound` above/below/null, `elevation`, `period`), `problems`, `valid_start`/`valid_end`. Outside the season it holds the last bulletin of the previous winter; the page marks that as not current
2. GitHub Pages serves `index.html`, which reads those files.

To record now: Actions tab → "Record snow data" → Run workflow.

## Stations

A fixed list (`STATIONS` in `fetch.py`, 6 snow + 5 wind stations: Ulmerhütte, Kapall, Äußere Rendlalpe, Gampberg,
Kartellboden-Damm, Dias, Hochkar, Kappl Kapplerkopf, Lattejoch); a station missing from the feed is warned about on stderr.
St. Anton (Tal) and Galzig come from GeoSphere TAWES instead (`id` `TAWES-<id>`, `region` null; Galzig is wind-only, no snow gauge).
Fields per station in `stations.json`: `id, uuid, name, region, type` (`snow`/`wind`), `lon, lat, alt`,
`hs` (snow height cm), `n24` (new snow 24 h cm), `hsd24` (HS change 24 h cm), `lt` (air temp °C),
`wg` (mean wind km/h), `wg_boe` (gust km/h), `wr` (wind direction °), `date`. Missing values are `null`.
`readings.json` records `hs` of snow stations only.

## Data sources

| Data | Source |
|---|---|
| Stations, snow height (HS) | `https://static.avalanche.report/weather_stations/stations.geojson` |
| History | hourly archive `https://static.avalanche.report/weather_stations/<UTC YYYY-MM-DD_HH>-00_stations.geojson` |
| St. Anton valley (TAWES 11311, snow + wind) and Galzig (TAWES 11110, wind/temperature only, no snow gauge) | GeoSphere Austria Data Hub `https://dataset.api.hub.geosphere.at/v1/station/{current,historical}/tawes-v1-10min` (CC BY 4.0); ids `TAWES-<id>`, m/s converted to km/h; snow history of the slots comes from the historical endpoint |
| Avalanche danger | Euregio CAAMLv6 bulletin `https://static.avalanche.report/bulletins/latest/EUREGIO_en_CAAMLv6.json` |
| Map relief | Leaflet 1.9.4 (cdnjs) with Esri World Hillshade tiles `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer` (loaded in the browser; the map falls back to flat if they fail) |
| Map place and peak coordinates (`PLACES`, `PEAKS` in `index.html`) | OpenStreetMap via Nominatim, checked 2026-11. St. Christoph uses its village node; Valluga is the OSM peak node; St. Anton, Pettneu and Ischgl keep their hand-entered values, because Nominatim only has municipality centroids for them (80–470 m away) |
| Forecast | Open-Meteo (free tier). Falls back to MET Norway when Open-Meteo's shared daily quota is exhausted |

## Run locally

```bash
python3 fetch.py --selftest
python3 fetch.py --days 14   # backfill 14 days of 07/12/17 slots
```
