# Arlberg Snow Depth

Snow height at the Lawinenwarndienst Tirol and Vorarlberg (plus three GeoSphere Austria) weather stations around St. Anton / Rendl and Lech / Zürs,
with history and a 5-day snowfall forecast.

Live page: https://osk-1.github.io/ski-dashboard/

## How it works

1. A GitHub Actions workflow (`.github/workflows/fetch.yml`) runs `fetch.py` and publishes the results in `data/` to GitHub Pages (no data commits). Schedule, Vienna time: hourly 06–08, every 30 min 08–15, hourly 15–20, none 20–06. An external scheduler triggers it; GitHub's own cron (`:07`/`:37`) is the backup. A gate step exits early outside 06:00–19:59 or if the live data is under 20 min old. The run first downloads the live `data/*.json` and fails without publishing if that is missing or empty (so history is never reset). Files:
   - `stations.json`: `updated` (time of the run) and `stations`, the current readings per station (see below)
   - `forecast.json`: `source`, `generated`, `days` and `points` (`{stationId: {snowfall, tmin, tmax, depth}}`: 5-day snowfall cm, min/max temperature °C, modelled snow depth cm)
   - `readings.json`: `{slot: {t, hs, lt, wg, wg_boe, wr}}` at every 07/12/17 slot (the history, last 60 days), each a `{stationId: value}` map for all stations including wind-only ones; units as above, null values omitted
   - `danger.json`: `source`, `generated` and `regions`, the avalanche danger per region (`AT-07-07`, `AT-07-10`, `AT-07-11`, and from the Vorarlberg bulletin `AT-08-03-01`, `AT-08-03-02`, `AT-08-04`): `ratings` (`level` 0–5, `bound` above/below/null, `elevation`, `period`), `problems` (`type`, `elevation`, `aspects`), `name`, `published`, `valid_start`/`valid_end`. Outside the season it holds the last bulletin of the previous winter; the page marks that as not current. The Vorarlberg bulletin 404s until its first bulletin of the season (usually early December); a bulletin that fails keeps its regions from the last run
2. GitHub Pages serves `index.html`, which reads those files.

To record now: Actions tab → "Record snow data" → Run workflow, tick `force`.

### Setup (repo owner)

1. Settings → Pages → Source: **GitHub Actions**.
2. Fine-grained personal access token: repository access only `osk-1/ski-dashboard`, permission Actions: Read and write, with an expiry (note the renewal date).
3. External scheduler (e.g. cron-job.org, timezone Europe/Vienna) jobs `0 6,7 * * *`, `0,30 8-14 * * *`, `0 15-19 * * *`, each `POST https://api.github.com/repos/osk-1/ski-dashboard/actions/workflows/fetch.yml/dispatches` with headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` and body `{"ref":"main"}`.
4. After the first successful deploy: `git rm -r --cached data`, add `data/` to `.gitignore`, commit. (Until then `data/` in `main` seeds the first run.)

## Stations

A fixed list (`STATIONS` in `fetch.py`, 11 snow + 9 wind stations: Ulmerhütte, Kapall, Äußere Rendlalpe, Gampberg,
Kartellboden-Damm, Dias, Rendl Riffel 1, Kappl Sinsenergampen, Kappl Spidur Alpe, Pischgraben, Ganatschalm (snow);
Kapall, Gampberg, Hochkar, Kappl Kapplerkopf, Lattejoch, Osthangbahn Young, Salzboden, Kappl Großgfallkopf, Madleinkopf (wind); Kaisers, Zürs village, Gauderkopf and Albonagrat are not shown); a station missing from the feed is warned about on stderr.
St. Anton (Tal), Galzig and Langen/Arlberg come from GeoSphere TAWES instead (`id` `TAWES-<id>`, `region` null; Galzig is wind-only, no snow gauge).
Zürs Hexenboden, Lech/Arlberg, Lech Kriegerhorn, Langen Blasegg, Albona (snow) and Valluga (wind) come from LWD Vorarlberg (`VOR_IDS`, `id` `VOR-<shortName>`, `region` = micro-region such as `AT-08-03-01`; `n24` is always null).
Fields per station in `stations.json`: `id, uuid, name, region, type` (`snow`/`wind`), `lon, lat, alt`,
`hs` (snow height cm), `n24` (new snow 24 h cm), `hsd24` (HS change 24 h cm), `lt` (air temp °C),
`wg` (mean wind km/h), `wg_boe` (gust km/h), `wr` (wind direction °), `date`. Missing values are `null`.
`readings.json` slots recorded before the temperature/wind fields were added lack `lt`/`wg`/`wg_boe`/`wr`, and the Vorarlberg backfill reaches back only about 7 days; run `--days N` to backfill lt/wg/wg_boe/wr for Tirol and TAWES stations.

## Data sources

| Data | Source |
|---|---|
| Stations, snow height (HS) | `https://static.avalanche.report/weather_stations/stations.geojson` |
| History | hourly archive `https://static.avalanche.report/weather_stations/<UTC YYYY-MM-DD_HH>-00_stations.geojson` |
| St. Anton valley (TAWES 11311, snow + wind), Langen/Arlberg (TAWES 11307, snow + wind) and Galzig (TAWES 11110, wind/temperature only, no snow gauge) | GeoSphere Austria Data Hub `https://dataset.api.hub.geosphere.at/v1/station/{current,historical}/tawes-v1-10min` (CC BY 4.0); ids `TAWES-<id>`, m/s converted to km/h; snow history of the slots comes from the historical endpoint |
| Lech / Zürs stations (Vorarlberg) | LWD Vorarlberg `https://lawinen.at/smet/vor/stations_vor.geojson` (the feed the station map at at-08.lawinen-warnung.eu reads; HS m, TA K, VW m/s, converted to cm/°C/km/h); slot history from the weekly SMET files `https://lawinen.at/smet/vor/woche/<shortName>.smet.gz` (7 days of 5-min values, so `--days` beyond 7 adds nothing for these). No licence is stated; the page credits the LWD Vorarlberg |
| Avalanche danger | Euregio CAAMLv6 bulletin `https://static.avalanche.report/bulletins/latest/EUREGIO_en_CAAMLv6.json` and LWD Vorarlberg `https://static.lawinen-warnung.eu/bulletins/latest/AT-08_en_CAAMLv6.json` (same format) |
| Map relief | Leaflet 1.9.4 (cdnjs) with Esri World Hillshade tiles `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer` (loaded in the browser; the map falls back to flat if they fail) |
| Modelled new snow (map overlay) | GeoSphere Austria model output as published by avalanche.report: `https://static.avalanche.report/zamg_meteo/overlays/new-snow/config.json` and `…/{YYYY}/{YYYY-MM-DD}/{YYYY-MM-DD}_{HH}-00_new-snow_{6h…72h}.gif` (Austria Lambert EPSG:31287, reprojected in the browser; `.png` alongside = cm per 1 km pixel). Loaded in the browser only when the layer is on. Licence not stated; the page credits GeoSphere Austria / avalanche.report |
| Map place and peak coordinates (`PLACES`, `PEAKS` in `index.html`) | OpenStreetMap via Nominatim, checked 2026-11. St. Christoph uses its village node; Valluga is the OSM peak node; St. Anton, Pettneu and Ischgl keep their hand-entered values, because Nominatim only has municipality centroids for them (80–470 m away) |
| Forecast | Open-Meteo (free tier). Falls back to MET Norway when Open-Meteo's shared daily quota is exhausted |

## Run locally

```bash
python3 fetch.py --selftest
python3 fetch.py --days 14   # backfill 14 days of 07/12/17 slots
```

## Checks (CI)

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: `python` (ruff check, ruff format --check, `fetch.py --selftest`), `js` (ESLint with the repo rules in `eslint-rules/`, `node --test`), `html` (html-validate, pinned + SRI check, secret scan, README field check), `workflows` (actionlint) and `smoke` (Playwright against `tests/fixtures/data`, 390 and 430 px, light and dark; screenshots are uploaded as an artifact).

Locally:

```bash
npm ci
npm run lint && npm test        # JS, HTML and repo checks
npx playwright test --trace off # smoke test; screenshots in test-results/
pip install -r requirements-dev.txt && ruff check . && ruff format --check .
```

Custom rules: no `spanGaps: true` (ESLint), `localStorage`/`sessionStorage` only inside `try` (`eslint-rules/storage-in-try.js`), every external script/stylesheet pinned and with `integrity` (`scripts/check-sri.mjs`), every data field in this README (`scripts/check-readme-fields.mjs`), no tokens in the repo (`scripts/check-secrets.mjs`).

### Require CI before merge (repo owner, one-time)

The files in `.github/rulesets/` are only copies; a ruleset takes effect once applied: Settings → Rules → Rulesets → New ruleset → Import a ruleset, pick the file, check that Enforcement is Active.
`protect-branches.json` (all branches: no force-push, creation or deletion) stays as it is. `require-ci.json` adds, for `main` only, a required pull request and the `python`, `js`, `html`, `workflows` and `smoke` checks (names = the job ids in `ci.yml`); repository admins can still bypass.
**Apply `require-ci.json` only after the data workflow no longer pushes to `main`** (it still does today, and the Actions bot cannot bypass a required pull request).
