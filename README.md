# Arlberg Snow Depth

Snow height at the Lawinenwarndienst Tirol and Vorarlberg (plus three GeoSphere Austria) weather stations around St. Anton / Rendl and Lech / Zürs,
with history and a 5-day snowfall forecast.

Live page: https://osk-1.github.io/ski-dashboard/

## How it works

1. A GitHub Actions workflow (`.github/workflows/fetch.yml`) runs `fetch.py` at about 07:10, 12:10 and
   17:10 Vienna time (GitHub can delay scheduled runs by 10–30 min) and commits the results in `data/`:
   - `stations.json`: current readings per station (see below)
   - `forecast.json`: 5-day snowfall and min/max temperature per station
   - `readings.json`: HS per station at every 07/12/17 slot (the history, last 60 days)
   - `danger.json`: avalanche danger per region (`AT-07-07`, `AT-07-10`, `AT-07-11`, and from the Vorarlberg bulletin `AT-08-03-01`, `AT-08-03-02`, `AT-08-04`): `ratings` (`level` 0–5, `bound` above/below/null, `elevation`, `period`), `problems`, `valid_start`/`valid_end`. Outside the season it holds the last bulletin of the previous winter; the page marks that as not current. The Vorarlberg bulletin 404s until its first bulletin of the season (usually early December); a bulletin that fails keeps its regions from the last run
2. GitHub Pages serves `index.html`, which reads those files.

To record now: Actions tab → "Record snow data" → Run workflow.

## Stations

A fixed list (`STATIONS` in `fetch.py`, 6 snow + 5 wind stations: Ulmerhütte, Kapall, Äußere Rendlalpe, Gampberg,
Kartellboden-Damm, Dias, Hochkar, Kappl Kapplerkopf, Lattejoch); a station missing from the feed is warned about on stderr.
St. Anton (Tal), Galzig and Langen/Arlberg come from GeoSphere TAWES instead (`id` `TAWES-<id>`, `region` null; Galzig is wind-only, no snow gauge).
Zürs Hexenboden, Lech/Arlberg, Lech Kriegerhorn, Langen Blasegg, Albona (snow) and Valluga (wind) come from LWD Vorarlberg (`VOR_IDS`, `id` `VOR-<shortName>`, `region` = micro-region such as `AT-08-03-01`; `n24` is always null).
Fields per station in `stations.json`: `id, uuid, name, region, type` (`snow`/`wind`), `lon, lat, alt`,
`hs` (snow height cm), `n24` (new snow 24 h cm), `hsd24` (HS change 24 h cm), `lt` (air temp °C),
`wg` (mean wind km/h), `wg_boe` (gust km/h), `wr` (wind direction °), `date`. Missing values are `null`.
`readings.json` records `hs` of snow stations only.

## Data sources

| Data | Source |
|---|---|
| Stations, snow height (HS) | `https://static.avalanche.report/weather_stations/stations.geojson` |
| History | hourly archive `https://static.avalanche.report/weather_stations/<UTC YYYY-MM-DD_HH>-00_stations.geojson` |
| St. Anton valley (TAWES 11311, snow + wind), Langen/Arlberg (TAWES 11307, snow + wind) and Galzig (TAWES 11110, wind/temperature only, no snow gauge) | GeoSphere Austria Data Hub `https://dataset.api.hub.geosphere.at/v1/station/{current,historical}/tawes-v1-10min` (CC BY 4.0); ids `TAWES-<id>`, m/s converted to km/h; snow history of the slots comes from the historical endpoint |
| Lech / Zürs stations (Vorarlberg) | LWD Vorarlberg `https://lawinen.at/smet/vor/stations_vor.geojson` (the feed the station map at at-08.lawinen-warnung.eu reads; HS m, TA K, VW m/s, converted to cm/°C/km/h); slot history from the weekly SMET files `https://lawinen.at/smet/vor/woche/<shortName>.smet.gz` (7 days of 5-min values, so `--days` beyond 7 adds nothing for these). No licence is stated; the page credits the LWD Vorarlberg |
| Avalanche danger | Euregio CAAMLv6 bulletin `https://static.avalanche.report/bulletins/latest/EUREGIO_en_CAAMLv6.json` and LWD Vorarlberg `https://static.lawinen-warnung.eu/bulletins/latest/AT-08_en_CAAMLv6.json` (same format) |
| Map relief | Leaflet 1.9.4 (cdnjs) with Esri World Hillshade tiles `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer` (loaded in the browser; the map falls back to flat if they fail) |
| Map place and peak coordinates (`PLACES`, `PEAKS` in `index.html`) | OpenStreetMap via Nominatim, checked 2026-11. St. Christoph uses its village node; Valluga is the OSM peak node; St. Anton, Pettneu and Ischgl keep their hand-entered values, because Nominatim only has municipality centroids for them (80–470 m away) |
| Forecast | Open-Meteo (free tier). Falls back to MET Norway when Open-Meteo's shared daily quota is exhausted |

## Run locally

```bash
python3 fetch.py --selftest
python3 fetch.py --days 14   # backfill 14 days of 07/12/17 slots
```
