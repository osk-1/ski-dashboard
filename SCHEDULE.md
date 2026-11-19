# Scheduled recording task

Create a **scheduled task** with these settings:

| Setting | Value |
|---|---|
| Name | Arlberg snow depth recording |
| Schedule | `CRON_TZ=Europe/Vienna 10 7,12,17 * * *` (07:10, 12:10, 17:10 Vienna time) |
| Mode | a fresh session on each run |
| Environment | `ski-dashboard` (allows static.avalanche.report, api.open-meteo.com, api.met.no) |
| Repository | osk-1/ski-dashboard |
| Notifications | none (optional: push on failure) |

The 10-minute offset gives the hourly station snapshot time to appear.

## Prompt for each run

```
Record the latest Arlberg snow data into the artifact database. Do only this, no other changes.

1. Get the repo github.com/osk-1/ski-dashboard. If it isn't checked out already, run
   `git clone --depth 1 https://github.com/osk-1/ski-dashboard`, then cd into it.
2. Run `python3 fetch.py --days 1`. This writes out/stations.json, out/forecast.json and
   out/readings/<slot>.json for today's 07/12/17 slots that have passed.
   If it fails, report the error and stop.
3. Write into the database of artifact https://claude.ai/artifact/DYQWzaKaoTBmZEWfnZs714
   with the ArtifactData tool (load it with ToolSearch "select:ArtifactData" if needed):
   a. `get` meta/stations and forecast/latest to learn their current `version`.
   b. `list` the collection `readings` (newest page) to see which of today's slot ids exist.
   c. One `batch`: `set` meta/stations from out/stations.json and forecast/latest from
      out/forecast.json (each with `if_version` = the version you read), plus `set` for each
      file in out/readings/ whose doc id (filename without .json) does NOT exist yet
      (no if_version). Use `file_path` with absolute paths.
   If the batch fails because a version changed, re-read and retry once.
4. Reply with one line: station count, which reading slots you added, and the forecast source.
```
