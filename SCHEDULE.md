# Scheduled recording task

Create a **scheduled task** with these settings:

| Setting | Value |
|---|---|
| Name | Arlberg snow depth recording |
| Schedule | `CRON_TZ=Europe/Vienna 10 7,12,17 * * *` (07:10, 12:10, 17:10 Vienna time) |
| Mode | a fresh session on each run |
| Environment | `ski-dashboard` (allows static.avalanche.report, api.open-meteo.com, api.met.no) |
| Notifications | none (optional: push on failure) |

The 10-minute offset gives the hourly station snapshot time to appear.

## Prompt for each run

```
Record th## Prompt for each run

Scheduled sessions get no GitHub access to this private repo, so `fetch.py` is also published next to
the artifact page and the run downloads it from there. **After changing `fetch.py`, republish the
artifact with `fetch.py` in its files** (ask Claude: "republish the artifact with the new fetch.py").

```
Record the latest Arlberg snow data into the artifact database. Do only this, no other changes.
Don't clone any git repo; everything needed is in the artifact.

1. Download the fetch script with the Artifact tool: action "read",
   url https://claude.ai/artifact/DYQWzaKaoTBmZEWfnZs714, path "fetch.py".
   The result says where it saved the file. cd into that file's directory.
2. Run `python3 fetch.py --days 1`. This writes out/stations.json, out/forecast.json and
   out/readings/<slot>.json for today's 07/12/17 slots that have passed.
   If it fails, report the error and stop.
3. Write into the database of artifact https://claude.ai/artifact/DYQWzaKaoTBmZEWfnZs714
   with the ArtifactData tool (load it with ToolSearch "select:ArtifactData" if needed):
   a. `get` meta/stations and forecast/latest to learn their current `version`.
   b. `list` the collection `readings` with query limit 1000 to see which of today's slot ids exist.
   c. One `batch`: `set` meta/stations from out/stations.json and forecast/latest from
      out/forecast.json (each with `if_version` = the version you read), plus `set` for each
      file in out/readings/ whose doc id (filename without .json) does NOT exist yet
      (no if_version). Use `file_path` with absolute paths.
   If the batch fails because a version changed, re-read and retry once.
4. Reply with one line: station count, which reading slots you added, and the forecast source.
```

Status: created as scheduled task `Arlberg snow depth recording`; test run on 2026-11-19 succeeded.
