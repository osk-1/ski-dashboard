# Arlberg Snow Depth

Snow height at the Lawinenwarndienst Tirol and Vorarlberg (plus three GeoSphere Austria) weather stations around St. Anton / Rendl and Lech / Zürs,
with history and a 7-day forecast.

Live page: https://osk-1.github.io/ski-dashboard/

## How it works

1. A GitHub Actions workflow (`.github/workflows/fetch.yml`) runs `fetch.py` and publishes the results in `data/` to GitHub Pages (no data commits). Schedule, Vienna time: hourly 06–08, every 30 min 08–15, hourly 15–20, none 20–06. An external scheduler triggers it; GitHub's own cron (`:07`/`:37`) is the backup. A gate step exits early outside 06:00–19:59; otherwise backup cron runs go ahead only when the live data is over 50 min old (so they cover a missed scheduler slot, not a second run per hour; in the half-hourly window a single missed slot waits for the next scheduler run), other triggers when it is over 20 min old. The run first downloads the live `data/*.json` and fails without publishing if `stations.json`, `danger.json` or `hourly.json` is missing or `stations.json` is empty. `health.json` is optional there (it is rewritten each run); if `hourly.json` is ever unreadable, `fetch.py` starts it empty and the Tirol hours are backfilled from the archive over several runs (at most 48 archive hours per run, newest first, within about 5 min, so about 4 runs); normal runs take 30–45 s (the job times out after 20 min). Files:
   - `stations.json`: `updated` (time of the run) and `stations`, the current readings per station (see below)
   - `hourly.json`: `{"model": {source, issued, fields: {field: {source, issued}}}, "hours": {hour: {field: {stationId: value}}}}`, the last 7 days hour by hour plus model hours through the end of the 7th forecast day (today included) (written compactly, null values and empty maps omitted, keys older than 7 days pruned). `hour` is local Vienna time `YYYY-MM-DDTHH`. Instant fields are the value measured at HH:00 (Tirol: the feature's own `date` floored to the hour, from whichever archive file holds it, never replacing a value already recorded at that hour, so a repeated old measurement never fills a later hour); precipitation at HH is the sum of the hour ending at HH:00, null if any sub-interval is missing (never a partial sum). Fields: `lt` air temp °C, `oft` snow surface temp °C (Tirol `OFT`), `rh` relative humidity % (Tirol `RH`, TAWES `RF`, Vorarlberg `RH`), `hs` snow height cm, `hr` HS rise cm (positive hourly change of `hs`, 0 when it fell or stayed, only for Tirol stations, which have no precipitation gauge), `pr` measured precipitation mm (TAWES `RR`, Vorarlberg `PSUM`), `pm` model precipitation mm, `sm` model snowfall cm, `mt` model 2 m temperature °C, `sd` model snow depth cm, `mw` model mean wind km/h (10 m), `mg` model gusts km/h, `md` model wind direction ° (from), `wg`/`wg_boe`/`wr` as in `stations.json`. Model fields come from Open-Meteo (`past_days=2`, so the last two days are also re-modelled each run) and replace earlier model values at the same hours, field by field; `model.source` is `Open-Meteo` or `MET Norway` and `model.issued` the run time when this run got them; `model.fields` is `{field: {source, issued}}`, the same pair per model field, updated only for the fields that run provided (after a MET Norway fallback `sd`/`sm` keep their Open-Meteo pair), and the page labels each forecast series from its own field's entry (the latest run's `model` when `fields` is absent). The MET Norway fallback (hourly timeseries, wind m/s converted to km/h) provides only `mt, mw, mg, md, pm` (`pm` only for its hourly steps, filed at the hour ending at the step's end like Open-Meteo's, never spread over the 6-hourly ones; it has no `sm` or `sd`), first drops those five fields from its first hour on (so a 6-hourly gap never shows an older Open-Meteo value under the MET Norway label; hours before it keep their earlier values) and leaves earlier Open-Meteo `sd`/`sm` hours alone; on a failure `source` and `issued` stay as they were, since the model hours present are still from that issue (the page labels them "latest issue"). Missing model values are omitted (no value, not 0). Each run fetches only the Tirol archive hours of the window where no Tirol station has a measured value yet and whose file was not already fetched fine (`tried`, the UTC hours `YYYY-MM-DDTHH` of those files in `hourly.json`, pruned to 7 days, so an hour that stays empty is not asked for again) (at most `BACKFILL_MAX` = 48 files per run, newest hours first, and none after `BACKFILL_SECONDS` = 300 s; the rest wait for later runs), one TAWES historical request and the weekly Vorarlberg SMET files. `hours[hour].flags` is `{stationId: {field: "out of range"}}`, the limit checks (see Plausibility below) of that hour, recomputed each run.
   - `health.json`: `run` (time of the run), `sources` (`tirol`, `tawes`, `vorarlberg`, `model`, `bulletins`, each `{ok, error, detail}`, `model` also `warning` (Open-Meteo unreachable, the MET Norway fallback used; `ok` stays true and the page lists it as degraded): `ok` false and `error` the message when that source failed this run; `detail` notes partial trouble such as stations missing from a feed, failed history requests or (Tirol) failed archive hours, archive hours left for later runs (`backfill: N hours left for later runs`) or a failed live-hour merge, and for `model` names the forecast source used, Open-Meteo or the MET Norway fallback (`ok` false with `error` also when Open-Meteo answered but its response could not be parsed, which is a bug and not an outage: the fallback is used meanwhile; a network failure alone falls back quietly); `bulletins.ok` is false while any bulletin fails; a 404 from LWD Vorarlberg before its first bulletin of the season is ok with `detail` `no bulletin published yet`), `flagged` (every station flag as `{id, name, field, reason}`) and `offline` (stations whose newest measurement is older than 24 h at run time, `{id, name, last}` with `last` the station's `date`). Not written when the primary Tirol feed fails, since the run then aborts
   - `danger.json`: `source`, `generated` and `regions`, the avalanche danger per region (`AT-07-07`, `AT-07-10`, `AT-07-11`, and from the Vorarlberg bulletin `AT-08-03-01`, `AT-08-03-02`, `AT-08-04`): `ratings` (`level` 0–5, `bound` above/below/null, `elevation`, `period`), `problems` (`type`, `elevation`, `aspects`), `name`, `published`, `valid_start`/`valid_end`. Outside the season it holds the last bulletin of the previous winter; the page marks that as not current. The Vorarlberg bulletin 404s until its first bulletin of the season (usually early December); a bulletin that fails keeps its regions from the last run
2. GitHub Pages serves `index.html`, which reads `stations.json`, `hourly.json`, `danger.json`, `regions.json` and `health.json`.

   Layout: on phones (width up to 820 px, or a landscape phone up to 500 px high) the bottom sheet is the only layout: the map fills the screen and the page scrolls over it as a sheet (glance, summary, tabbed charts with one shared 24 h / 72 h / 7 d switch); tapping a station opens its card, Open charts raises the sheet. Wider screens get the desktop page. There is no full-screen mode and no `?sheet` switch.

To record now: Actions tab → "Record snow data" → Run workflow, tick `force`.

### Setup (repo owner)

1. Settings → Pages → Source: **GitHub Actions**.
2. Fine-grained personal access token: repository access only `osk-1/ski-dashboard`, permission Actions: Read and write, with an expiry (note the renewal date).
3. External scheduler (e.g. cron-job.org, timezone Europe/Vienna) jobs `0 6,7 * * *`, `0,30 8-14 * * *`, `0 15-19 * * *`, each `POST https://api.github.com/repos/osk-1/ski-dashboard/actions/workflows/fetch.yml/dispatches` with headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` and body `{"ref":"main"}`.
   Add a fourth job, weekly, `PUT https://api.github.com/repos/osk-1/ski-dashboard/actions/workflows/fetch.yml/enable` with the same headers (no body). GitHub disables scheduled workflows in public repositories after 60 days without repository activity, and data commits are not made, so a quiet summer counts; this job keeps the workflow enabled. Put the token's expiry date in a calendar too.

## Stations

A fixed list (`STATIONS` in `fetch.py`, 11 snow + 9 wind stations: Ulmerhütte, Kapall, Äußere Rendlalpe, Gampberg,
Kartellboden-Damm, Dias, Rendl Riffel 1, Kappl Sinsenergampen, Kappl Spidur Alpe, Pischgraben, Ganatschalm (snow);
Kapall, Gampberg, Hochkar, Kappl Kapplerkopf, Lattejoch, Osthangbahn Young, Salzboden, Kappl Großgfallkopf, Madleinkopf (wind); Kaisers, Zürs village, Gauderkopf and Albonagrat are not shown); a station missing from the feed is warned about on stderr.
St. Anton (Tal), Galzig and Langen/Arlberg come from GeoSphere TAWES instead (`id` `TAWES-<id>`, `region` null; Galzig is wind-only, no snow gauge).
Zürs Hexenboden, Lech/Arlberg, Lech Kriegerhorn, Langen Blasegg, Albona (snow) and Valluga (wind) come from LWD Vorarlberg (`VOR_IDS`, `id` `VOR-<shortName>`, `region` = micro-region such as `AT-08-03-01`; `n24` is always null).
Fields per station in `stations.json`: `id, uuid, name, region, type` (`snow`/`wind`), `lon, lat, alt`,
`hs` (snow height cm), `n24` (new snow 24 h cm), `hsd24` (HS change 24 h cm), `lt` (air temp °C),
`wg` (mean wind km/h), `wg_boe` (gust km/h), `wr` (wind direction °), `date` (measurement time, Vienna ISO with offset), `flags`.
Missing values are `null`. TAWES stations also have `dates` (`{field: time}`, only for fields measured at another time than `date`,
which is the newest; GeoSphere staggers its parameters); a value's age is `dates[field]` or else `date`.
When TAWES or Vorarlberg fails, the previous run's stations of that source are kept unchanged (old `date` included), so they age instead of vanishing.

### Plausibility

`flags` is `{field: reason}` (empty `{}` when clean); values are never changed, only flagged. Thresholds are constants at the top of `fetch.py`.
`reason` is one of: `out of range` (`hs` 0–800 cm, `lt`/`oft` −45…+35 °C, `wg`/`wg_boe` 0–250 km/h, `wr` 0–360, `rh` 0–103 %, as saturated sensors read 100–103),
`jump` (`hs` +30 / −15 cm or `lt` ±8 °C from the hour before, in `hourly.json`), `stuck` (`lt` identical for 6 consecutive hours, `wr` too while `wg` > 5 km/h in all of them),
`gust below mean` (on `wg_boe` when `wg_boe < wg`), `sensor frozen?` (on `wg`, `wg_boe`, `wr` when `wg` is 0 for the 3 latest hours with `lt` < 0 and `rh` > 95),
`time in future` (on every value whose measurement time is more than 10 min after the run). `flags.station` = `location mismatch` when the station is more than 500 m
from, or named differently than, its entry in `REFERENCE` (or has none). Jump, stuck and frozen use the station's measured hourly series ending at that field's measurement hour.

## Data sources

| Data | Source |
|---|---|
| Stations, snow height (HS) | `https://static.avalanche.report/weather_stations/stations.geojson` |
| History | hourly archive `https://static.avalanche.report/weather_stations/<UTC YYYY-MM-DD_HH>-00_stations.geojson` |
| St. Anton valley (TAWES 11311, snow + wind), Langen/Arlberg (TAWES 11307, snow + wind) and Galzig (TAWES 11110, wind/temperature only, no snow gauge) | GeoSphere Austria Data Hub `https://dataset.api.hub.geosphere.at/v1/station/{current,historical}/tawes-v1-10min` (CC BY 4.0); ids `TAWES-<id>`, m/s converted to km/h; hourly history comes from the historical endpoint |
| Lech / Zürs stations (Vorarlberg) | LWD Vorarlberg `https://lawinen.at/smet/vor/stations_vor.geojson` (the feed the station map at at-08.lawinen-warnung.eu reads; HS m, TA K, VW m/s, converted to cm/°C/km/h); hourly history from the weekly SMET files `https://lawinen.at/smet/vor/woche/<shortName>.smet.gz` (7 days of 5-min values). No licence is stated; the page credits the LWD Vorarlberg |
| Hourly history (`hourly.json`) | Tirol hourly archive (above) and live `stations.geojson`; TAWES historical 10-min (`TL,RF,RR,SCHNEE,FF,FFX,DD`); Vorarlberg weekly SMET 5-min (`TA RH HS PSUM VW VW_MAX DW`, `RH` 0–1 converted to %); Open-Meteo hourly `snow_depth,snowfall,precipitation,temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m` (7 forecast days, one request) |
| Avalanche danger | Euregio CAAMLv6 bulletin `https://static.avalanche.report/bulletins/latest/EUREGIO_en_CAAMLv6.json` and LWD Vorarlberg `https://static.lawinen-warnung.eu/bulletins/latest/AT-08_en_CAAMLv6.json` (same format) |
| Map relief | Leaflet 1.9.4 (cdnjs) with Esri World Hillshade tiles `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer` (loaded in the browser; the map falls back to flat if they fail) |
| Modelled weather (map overlays) | GeoSphere Austria model output as published by avalanche.report: `https://static.avalanche.report/zamg_meteo/overlays/<param>/config.json` and `…/{YYYY}/{YYYY-MM-DD}/{YYYY-MM-DD}_{HH}-00_<param>[_{6h…72h}].gif` (`.png` alongside holds the values, grey, R = G = B). One overlay at a time, loaded in the browser only when selected. The hourly ones (`temp`, `wind`, `gust`, `snow-height`) animate a time window: buttons −24 … +48 h (Now = one static frame), keyframes every 1/1/2/3/6 h (at most 9), a button is disabled when the data does not cover its whole window; a config older than 30 min is fetched again on the next pick; cross-faded in the browser (~10 s per loop, play/pause; reduced motion starts paused and shows the end the button names). A clicked point shows the value at the current hour. `snow-height` has no forecast. `new-snow` keeps its period and until selects. `new-snow` (cm; 6–72 h periods, R = cm), `temp` (°C, hourly, forecast ~53 h, °C = (R − 120) / 2), `wind` (km/h, hourly, R = km/h), `gust` (km/h, hourly, R = km/h), `snow-height` (cm, hourly, analysis only, R = cm). All but `gust` are on the Austria Lambert grid (EPSG:31287, reprojected in the browser, 500 m GIF / 1 km PNG); `gust` is a plain lat/lon box `[lon0, lat0, lon1, lat1]` and its GIF is opaque, so the border colour is cleared by flood fill from the edges. Licence not stated; the page credits GeoSphere Austria / avalanche.report |
| Map place and peak coordinates (`PLACES`, `PEAKS` in `app.js`) | OpenStreetMap via Nominatim, checked 2026-11. St. Christoph uses its village node; Valluga is the OSM peak node; St. Anton, Pettneu and Ischgl keep their hand-entered values, because Nominatim only has municipality centroids for them (80–470 m away) |
| Forecast | Open-Meteo (free tier), 7 days hourly. Falls back to MET Norway when Open-Meteo is unreachable (e.g. its shared daily quota is exhausted; recorded as `warning` on the `model` source) or its response can't be parsed (recorded as a failure); the fallback has no snowfall or snow-depth series |

## Run locally

```bash
python3 -m unittest discover tests
python3 fetch.py
```

## Checks (CI)

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: `python` (ruff check, ruff format --check, `python3 -m unittest discover tests`), `js` (ESLint with the repo rules in `eslint-rules/`, Prettier check on `app.js`/`lib.js`/`overlay.js`, `node --test`), `html` (html-validate, pinned + SRI check, README field check), `workflows` (actionlint) and `smoke` (Playwright against `tests/fixtures/data`, 390 and 430 px, light and dark; screenshots are uploaded as an artifact).

Locally:

```bash
npm ci
npm run lint && npm test        # JS, HTML and repo checks
npm run format                  # Prettier on app.js, lib.js, overlay.js
npx playwright test --trace off # smoke test; screenshots in test-results/
pip install -r requirements-dev.txt && ruff check . && ruff format --check .
```

Custom rules: no `spanGaps: true` (ESLint), `localStorage`/`sessionStorage` only inside `try` (`eslint-rules/storage-in-try.js`), every external script/stylesheet pinned and with `integrity` (`scripts/check-sri.mjs`), every data field in this README (`scripts/check-readme-fields.mjs`).

### Require CI before merge (repo owner, one-time)

The files in `.github/rulesets/` are only copies; a ruleset takes effect once applied: Settings → Rules → Rulesets → New ruleset → Import a ruleset, pick the file, check that Enforcement is Active.
`protect-branches.json` (all branches: no force-push, creation or deletion) stays as it is. `require-ci.json` adds, for `main` only, a required pull request and the `python`, `js`, `html`, `workflows` and `smoke` checks (names = the job ids in `ci.yml`); repository admins can still bypass.
