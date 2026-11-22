#!/usr/bin/env python3
"""Fetch Arlberg snow data into ./data/ for the dashboard (run by GitHub Actions).

Writes:
  data/stations.json   current readings per station (snow height, wind, temperature)
  data/hourly.json     {"model": {source, issued, fields: {field: {source, issued}}}, "hours": {local "YYYY-MM-DDTHH": {field: {stationId: value}}}}, rolling 7 days (+ model hours ahead); see README
  data/health.json     {run, sources: {tirol, tawes, vorarlberg, model, bulletins: {ok, error, detail}}, model also warning}, flagged, offline}; see README

Usage: python3 fetch.py
"""

import gzip
import http.client
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Vienna")
# Feed IDs (LWD-Nummer, or feature id when none): snow stations, then wind stations
STATIONS = (
    "SAUL2",
    "SKAP2",
    "SAAU2",
    "SAGA2",
    "c9b477f0-c934-013d-99fc-5af9cc682f9b",
    "KDIA2",
    "SARE2",
    "KSIN2",
    "KSPI2",
    "IPIS2",
    "aea1a765-2cff-3a00-bb88-3cfed1dfd875",
    "SKAP1",
    "SAGA1",
    "SAAU1",
    "KSIN1",
    "KDIA1",
    "SAYO1",
    "SARE1",
    "KGRO1",
    "IPIS1",
)
HOURLY_DAYS = 7
UTC_KEY = "%Y-%m-%dT%H"  # hourly.json "tried": archive hours fetched fine, so an hour with no Tirol value is not requested again
BACKFILL_MAX, BACKFILL_SECONDS = 48, 300  # Tirol archive files per run (newest missing hours first) and wall-clock budget; the rest wait for later runs
MET_SECONDS = 120  # wall-clock budget for the MET Norway fallback loop; stations not reached in time are named as failed
MFIELDS = ("pm", "sm", "mt", "sd", "mw", "mg", "md")  # model fields
HFIELDS = ("lt", "oft", "rh", "hs", "hr", "pr", "pm", "sm", "mt", "wg", "wg_boe", "wr", "sd", "mw", "mg", "md")  # per-hour maps in hourly.json
MEASURED = ("lt", "oft", "rh", "hs", "wg", "wg_boe", "wr")  # what makes a Tirol hour "present" (not model, not derived)
WIND = ("SKAP1", "SAGA1", "SAAU1", "KSIN1", "KDIA1", "SAYO1", "SARE1", "KGRO1", "IPIS1")
LWD = "https://static.avalanche.report/weather_stations/"
GEO = "https://dataset.api.hub.geosphere.at/v1/station/"
TAWES = {
    "11311": ("St. Anton (Tal)", 1304, "snow"),
    "11110": ("Galzig", 2079, "wind"),
    "11307": ("Langen/Arlberg", 1221, "snow"),
}  # GeoSphere TAWES id: (name, altitude m, type)
VOR = "https://lawinen.at/smet/vor/"  # LWD Vorarlberg station feed (what at-08.lawinen-warnung.eu's station map reads)
VOR_IDS = {"ZURS1": "snow", "LECA1": "snow", "LECH1": "snow", "LANG1": "snow", "ALBO2": "snow", "VALL1": "wind"}  # shortName: type
BULLETINS = {
    "Euregio avalanche.report": "https://static.avalanche.report/bulletins/latest/EUREGIO_en_CAAMLv6.json",
    # 404 until LWD Vorarlberg publishes the season's first bulletin (usually early December)
    "LWD Vorarlberg": "https://static.lawinen-warnung.eu/bulletins/latest/AT-08_en_CAAMLv6.json",
}
UA = {"User-Agent": "arlberg-snow-dashboard/0.1 (https://github.com/osk-1/ski-dashboard)"}
# Plausibility checks (flag only, never change a value); thresholds to tune. rh up to 103: saturated sensors read 100–103
LIMITS = {"hs": (0, 800), "lt": (-45, 35), "oft": (-45, 35), "wg": (0, 250), "wg_boe": (0, 250), "wr": (0, 360), "rh": (0, 103)}  # -> "out of range"
JUMP = {"hs": (-15, 30), "lt": (-8, 8)}  # allowed change latest hour vs hour before -> "jump"
STUCK_HOURS, STUCK_WIND = 6, 5  # identical lt (wr: while wg > 5 km/h) for 6 consecutive hours -> "stuck"
FROZEN_HOURS = 3  # wg == 0 for 3 latest hours while lt < 0 and rh > 95 -> "sensor frozen?"
FUTURE = timedelta(minutes=10)  # measurement time this far ahead of the run -> "time in future"
LOCATION_M = 500  # farther from REFERENCE, or another name -> flags["station"] = "location mismatch"
VALUES = ("hs", "n24", "hsd24", "lt", "wg", "wg_boe", "wr")  # measured value fields of a station dict
# id: (name, lat, lon) as the feeds reported them on 2026-11-20 (TAWES: GeoSphere's coordinates)
REFERENCE = {
    "KSIN1": ("Kappl Kapplerkopf", 47.06064, 10.3255),
    "SKAP2": ("Kapall Schneestation", 47.14749, 10.25878),
    "SKAP1": ("Kapall Windstation", 47.14908, 10.24794),
    "KSIN2": ("Kappl Sinsenergampen", 47.06064, 10.34034),
    "KSPI2": ("Kappl Spidur Alpe", 47.09232, 10.4119),
    "SAGA1": ("Gampberg Windstation", 47.10991, 10.27761),
    "SAGA2": ("Gampberg Schneestation", 47.11174, 10.27135),
    "SAYO1": ("Osthangbahn Young", 47.13324, 10.22553),
    "IPIS2": ("Pischgraben", 47.0182, 10.26762),
    "SAAU2": ("Äußere Rendlalpe", 47.1297, 10.31545),
    "aea1a765-2cff-3a00-bb88-3cfed1dfd875": ("Ganatschalm", 47.1377, 10.3968),
    "SAAU1": ("Hochkar", 47.11424, 10.31372),
    "KDIA2": ("Dias", 47.07911, 10.34524),
    "c9b477f0-c934-013d-99fc-5af9cc682f9b": ("Kartellboden-Damm", 47.06999, 10.26469),
    "SARE2": ("Rendl Riffel 1", 47.07774, 10.2662),
    "IPIS1": ("Madleinkopf", 47.01712, 10.24878),
    "KDIA1": ("Lattejoch", 47.08458, 10.3386),
    "SAUL2": ("Ulmerhütte", 47.14702, 10.21192),
    "KGRO1": ("Kappl Großgfallkopf", 47.10168, 10.40883),
    "SARE1": ("Salzboden", 47.10168, 10.26708),
    "TAWES-11110": ("Galzig", 47.12972, 10.23028),
    "TAWES-11307": ("Langen/Arlberg", 47.13167, 10.12333),
    "TAWES-11311": ("St. Anton (Tal)", 47.13139, 10.26667),
    "VOR-ALBO2": ("Albona", 47.1317, 10.17122),
    "VOR-LANG1": ("Langen Blasegg", 47.14059, 10.11794),
    "VOR-LECA1": ("Lech/Arlberg", 47.21, 10.14083),
    "VOR-LECH1": ("Lech Kriegerhorn", 47.2142, 10.11432),
    "VOR-VALL1": ("Valluga (Radar)", 47.1575, 10.21278),
    "VOR-ZURS1": ("Zürs Hexenboden", 47.17359, 10.17078),
}


def get_json(url):
    for attempt in (1, 2):  # one retry on transient network errors; bad JSON is not retried
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except (OSError, http.client.HTTPException) as e:
            if attempt == 2 or (isinstance(e, urllib.error.HTTPError) and e.code < 500):  # a 404 will not change in 2 s
                raise
            time.sleep(2)


def snapshot_url(slot_local):
    # Archive filenames are UTC hours: local 07:00 CET lives in ..._06-00_stations.geojson
    return LWD + slot_local.astimezone(timezone.utc).strftime("%Y-%m-%d_%H-00") + "_stations.geojson"


def num(v):
    return None if v is None else round(float(v), 1)


def kmh(x):  # m/s -> km/h
    return None if x is None else num(x * 3.6)


def vienna(s):
    return None if s is None else datetime.fromisoformat(s).astimezone(TZ).isoformat()


def depth(v):
    return None if v is None else max(0.0, num(v))  # sensors read slightly negative on bare ground


def station(f):
    p, id = f["properties"], f["properties"].get("LWD-Nummer") or f["id"]
    return {
        "id": id,
        "uuid": f["id"],
        "name": p["name"],
        "region": p.get("LWD-Region"),
        "type": "wind" if id in WIND else "snow",
        "lon": round(f["geometry"]["coordinates"][0], 5),
        "lat": round(f["geometry"]["coordinates"][1], 5),
        "alt": int(f["geometry"]["coordinates"][2]),
        "hs": depth(p.get("HS")),
        "n24": num(p.get("N24")),
        "hsd24": num(p.get("HSD24")),
        "lt": num(p.get("LT")),
        # WG = mean wind speed km/h, WG_BOE = gust km/h (verified: WG 46 vs WG_BOE 84 on wind stations), WR = direction °
        "wg": num(p.get("WG")),
        "wg_boe": num(p.get("WG_BOE")),
        "wr": num(p.get("WR")),
        "date": vienna(p.get("date")),
    }


def vor_station(f):
    """Vorarlberg feature -> station dict. Units there: HS/HSD_24 m, TA K, VW/VW_MAX m/s."""
    p, c = f["properties"], f["geometry"]["coordinates"]
    scale = lambda k, x: None if p.get(k) is None else p[k] * x
    return {
        "id": "VOR-" + p["shortName"],
        "uuid": f["id"],
        "name": p["name"],
        "region": p.get("microRegionID"),
        "type": VOR_IDS[p["shortName"]],
        "lon": round(c[0], 5),
        "lat": round(c[1], 5),
        "alt": int(c[2]),
        "hs": depth(scale("HS", 100)),
        "n24": None,
        "hsd24": num(scale("HSD_24", 100)),  # PSUM_24 is rain+snow water, not new snow
        "lt": None if p.get("TA") is None else num(p["TA"] - 273.15),
        "wg": num(scale("VW", 3.6)),
        "wg_boe": num(scale("VW_MAX", 3.6)),
        "wr": num(p.get("DW")),
        "date": vienna(p.get("date")),
    }


def add(maps, id, **vals):
    for k, v in vals.items():
        if v is not None:
            maps[k][id] = v


def smet_table(text):
    """{UTC timestamp: {column: float}} from a SMET file; nodata and bad cells omitted (one bad cell must not drop the row)."""
    head, _, data = text.partition("[DATA]")
    hdr = {k.strip(): v.strip() for k, _, v in (ln.partition("=") for ln in head.splitlines()) if v}
    cols, nodata = hdr["fields"].split()[1:], float(hdr.get("nodata", -999))
    out = {}
    for r in (ln.split() for ln in data.splitlines()):
        if r:
            out[r[0]] = row = {}
            for c, x in zip(cols, r[1:]):
                try:
                    if float(x) != nodata:
                        row[c] = float(x)
                except ValueError:
                    pass
    return out


SMET_CONV = {
    "lt": ("TA", lambda x: num(x - 273.15)),
    "rh": ("RH", lambda x: num(x * 100)),
    "hs": ("HS", lambda x: depth(x * 100)),
    "wg": ("VW", kmh),
    "wg_boe": ("VW_MAX", kmh),
    "wr": ("DW", num),
}


def smet_hourly(tab):
    """{local hour key: {field: value}} from smet_table (5-min UTC rows; HS m, TA K, RH 0–1, VW m/s); pr = PSUM sum of the 12 rows ending at HH:00, null if any is missing."""
    out = {}
    for ts, r in tab.items():
        if ts.endswith(":00:00Z"):
            t = datetime.fromisoformat(ts)
            ps = [tab.get((t - timedelta(minutes=5 * i)).strftime("%Y-%m-%dT%H:%M:%SZ"), {}).get("PSUM") for i in range(12)]
            v = {k: fn(r[c]) for k, (c, fn) in SMET_CONV.items() if c in r}
            out[hkey(t)] = {**v, "pr": None if None in ps else num(sum(ps))}
    return {k: {f: x for f, x in v.items() if x is not None} for k, v in out.items()}


def parse_tawes(gj, names):
    """GeoSphere geojson -> station dicts, one per feature, using each parameter's newest value. FF/FFX m/s -> km/h.
    Parameters are staggered: date = newest measurement, dates = {field: time} for fields measured at another time."""
    out = []
    for f in gj["features"]:
        p, id = f["properties"]["parameters"], f["properties"]["station"]
        new = lambda k: next(((x, t) for x, t in reversed(list(zip(p.get(k, {}).get("data") or [], gj["timestamps"]))) if x is not None), (None, None))
        v = lambda k: new(k)[0]
        at = {f: vienna(new(k)[1]) for f, k in (("hs", "SCHNEE"), ("lt", "TL"), ("wg", "FF"), ("wg_boe", "FFX"), ("wr", "DD")) if new(k)[1]}
        date = max(at.values(), key=datetime.fromisoformat, default=vienna(gj["timestamps"][-1]))
        out.append(
            {
                "id": "TAWES-" + id,
                "uuid": "TAWES-" + id,
                "name": names[id][0],
                "region": None,
                "type": names[id][2],
                "lon": round(f["geometry"]["coordinates"][0], 5),
                "lat": round(f["geometry"]["coordinates"][1], 5),
                "alt": names[id][1],
                "hs": depth(v("SCHNEE")),
                "n24": None,
                "hsd24": None,
                "lt": num(v("TL")),
                "wg": kmh(v("FF")),
                "wg_boe": kmh(v("FFX")),
                "wr": num(v("DD")),
                "date": date,
                "dates": {f: t for f, t in at.items() if t != date},
            }
        )
    return out


def tawes_hourly(gj):
    """{local hour key: {field: {TAWES-id: value}}} from a historical 10-min geojson: instant values at HH:00, pr = RR sum of the 6 intervals ending at HH:00 (null if any is missing)."""
    # shortcut: each timestamp taken as the end of its 10-min interval (RR is named "Niederschlag der letzten 10 Minuten"); unverified against GeoSphere docs
    ts = [datetime.fromisoformat(t) for t in gj["timestamps"]]
    idx = {t: i for i, t in enumerate(ts)}
    out = {}
    for f in gj["features"]:
        p = f["properties"]["parameters"]
        col = lambda n: (p.get(n) or {}).get("data") or [None] * len(ts)
        rr = col("RR")
        for i, t in enumerate(ts):
            if t.minute == 0:
                ps = [rr[idx[x]] if (x := t - timedelta(minutes=10 * j)) in idx else None for j in range(6)]
                add(
                    out.setdefault(hkey(t), {x: {} for x in HFIELDS}),
                    "TAWES-" + f["properties"]["station"],
                    hs=depth(col("SCHNEE")[i]),
                    lt=num(col("TL")[i]),
                    rh=num(col("RF")[i]),
                    pr=None if None in ps else num(sum(ps)),
                    wg=kmh(col("FF")[i]),
                    wg_boe=kmh(col("FFX")[i]),
                    wr=num(col("DD")[i]),
                )
    return out


def hkey(t):
    return t.astimezone(TZ).strftime("%Y-%m-%dT%H")


def hmerge(hours, k, maps, keep=False):
    """Merge {field: {id: value}} into hours[k], skipping empty maps; keep=True never replaces a value already there."""
    for f, m in maps.items():
        if m:
            d = hours.setdefault(k, {}).setdefault(f, {})
            d.update({**m, **d} if keep else m)


def tirol_hours(feats, by_uuid):
    """{local hour key: {field: {id: value}}} from avalanche.report features, keyed by each feature's own date floored to the hour, whichever file it came from (a repeated old measurement must not pose as a new hour)."""
    out = {}
    for f in feats:
        p, st = f["properties"], by_uuid.get(f["id"])
        if st and p.get("date"):
            add(
                out.setdefault(hkey(datetime.fromisoformat(p["date"])), {x: {} for x in HFIELDS}),
                st["id"],
                lt=num(p.get("LT")),
                oft=num(p.get("OFT")),
                rh=num(p.get("RH")),
                hs=depth(p.get("HS")) if st["type"] == "snow" else None,
                wg=num(p.get("WG")),
                wg_boe=num(p.get("WG_BOE")),
                wr=num(p.get("WR")),
            )
    return out


def missing_hours(hours, ids, now, tried=()):
    """Past full hours of the window (current hour excluded: it comes from the live feed) where no id has any measured value
    and whose archive file was not already fetched fine (tried: UTC hour keys)."""
    have = {k for k, v in hours.items() if any(id in v.get(f, {}) for f in MEASURED for id in ids)}
    t = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)  # step in UTC: local wall hours skip/repeat on DST days
    out = [t - timedelta(hours=i) for i in range(HOURLY_DAYS * 24, 0, -1)]
    return [x for x in out if hkey(x) not in have and x.strftime(UTC_KEY) not in tried]


def backfill(missing):
    """The missing archive hours this run fetches: newest first, at most BACKFILL_MAX."""
    return sorted(missing, reverse=True)[:BACKFILL_MAX]


def hs_rise(hours, ids):
    """hr[id] at k = positive HS change from the hour before (0 when it fell or stayed); only where both hours have hs."""
    for k, v in hours.items():
        prev = hours.get(hkey(datetime.strptime(k, "%Y-%m-%dT%H").replace(tzinfo=TZ).astimezone(timezone.utc) - timedelta(hours=1)), {}).get("hs", {})
        hr = {id: num(max(0.0, x - prev[id])) for id, x in v.get("hs", {}).items() if id in ids and id in prev}
        if hr:
            v["hr"] = hr


def prune_hours(hours, now):
    cutoff = hkey(now.astimezone(timezone.utc) - timedelta(days=HOURLY_DAYS))  # keys sort lexicographically; future model hours stay
    return {k: v for k, v in hours.items() if k >= cutoff}


def series(hours, f, id, t, n):
    """Values of f for id at the n hours ending at t's hour, newest first (None where missing); steps in UTC (DST-safe)."""
    t = t.astimezone(timezone.utc)
    return [hours.get(hkey(t - timedelta(hours=i)), {}).get(f, {}).get(id) for i in range(n)]


def dist_m(a, b):
    """Haversine distance in metres between (lat, lon) pairs."""
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def check(st, hours, now):
    """{field|"station": reason} for one station dict; flags only, never changes a value. Jump/stuck/frozen read the measured hourly series ending at the field's own measurement hour."""
    id, fl = st["id"], {}
    at = {f: datetime.fromisoformat(x) for f in VALUES if (x := (st.get("dates") or {}).get(f) or st.get("date"))}
    for f, t in at.items():
        if st.get(f) is not None and t > now + FUTURE:
            fl[f] = "time in future"
    for f, (lo, hi) in LIMITS.items():
        if st.get(f) is not None and not lo <= st[f] <= hi:
            fl.setdefault(f, "out of range")
    for f, (fall, rise) in JUMP.items():
        a, b = series(hours, f, id, at[f], 2) if f in at else (None, None)
        if a is not None and b is not None and not fall <= a - b <= rise:
            fl.setdefault(f, "jump")
    for f in ("lt", "wr"):
        if f in at:
            v, w = series(hours, f, id, at[f], STUCK_HOURS), series(hours, "wg", id, at[f], STUCK_HOURS)
            if v[0] is not None and v.count(v[0]) == STUCK_HOURS and (f == "lt" or all(x is not None and x > STUCK_WIND for x in w)):
                fl.setdefault(f, "stuck")
    if st.get("wg") is not None and st.get("wg_boe") is not None and st["wg_boe"] < st["wg"]:
        fl.setdefault("wg_boe", "gust below mean")
    if "wg" in at:
        wg, lt, rh = (series(hours, f, id, at["wg"], FROZEN_HOURS) for f in ("wg", "lt", "rh"))
        if all(w == 0 and c is not None and c < 0 and r is not None and r > 95 for w, c, r in zip(wg, lt, rh)):
            for f in ("wg", "wg_boe", "wr"):
                fl.setdefault(f, "sensor frozen?")
    ref = REFERENCE.get(id)
    if not ref or ref[0] != st.get("name") or st.get("lat") is None or st.get("lon") is None or dist_m(ref[1:], (st["lat"], st["lon"])) > LOCATION_M:
        fl["station"] = "location mismatch"
    return fl


def hour_flags(hours):
    """hours[k]["flags"] = {id: {field: "out of range"}} (limit checks only), recomputed each run."""
    for v in hours.values():
        fl = {}
        for f, (lo, hi) in LIMITS.items():
            for id, x in v.get(f, {}).items():
                if not lo <= x <= hi:
                    fl.setdefault(id, {})[f] = "out of range"
        v.pop("flags", None)
        if fl:
            v["flags"] = fl


def source_of(id):
    return "tawes" if id.startswith("TAWES-") else "vorarlberg" if id.startswith("VOR-") else "tirol"


def carry(path, src):
    """Station dicts of source src from the previous stations.json, unchanged (old date included), so a failed source ages instead of vanishing."""
    try:
        with open(path) as fh:
            prev = [s for s in json.load(fh)["stations"] if source_of(s["id"]) == src]
    except (OSError, ValueError, KeyError, TypeError) as e:
        print("nothing to carry over for", src, e, file=sys.stderr)
        return []
    print(f"carrying over {len(prev)} {src} stations from the last run", file=sys.stderr)
    return prev


LEVEL = {"low": 1, "moderate": 2, "considerable": 3, "high": 4, "very_high": 5}


def preseason(name, e):
    """LWD Vorarlberg 404s until its first bulletin of the season: the documented normal state, not a failure."""
    return name == "LWD Vorarlberg" and isinstance(e, urllib.error.HTTPError) and e.code == 404


def parse_danger(bulletin, ids):
    out = {}
    for b in bulletin["bulletins"]:
        rat = [
            {
                "level": LEVEL.get(r["mainValue"], 0),
                "bound": "below" if "upperBound" in el else "above" if "lowerBound" in el else None,
                "elevation": next(iter(el.values()), None),
                "period": r.get("validTimePeriod"),
            }
            for r in b["dangerRatings"]
            for el in [r.get("elevation") or {}]
        ]
        prob = [{"type": p["problemType"], "elevation": p.get("elevation"), "aspects": p.get("aspects", [])} for p in b.get("avalancheProblems", [])]
        for r in b["regions"]:
            if r["regionID"] in ids and r["regionID"] not in out:
                out[r["regionID"]] = {
                    "name": r["name"],
                    "published": b["publicationTime"],
                    "valid_start": b["validTime"]["startTime"],
                    "valid_end": b["validTime"]["endTime"],
                    "ratings": rat,
                    "problems": prob,
                }
    return out


def parse_open_meteo(res, ids):
    """Open-Meteo multi-point response -> {hour key: {field: {id: value}}} over MFIELDS.
    The model hours cover the whole hourly array, the past days included (they are re-modelled each run)."""
    if len(res) != len(ids):
        raise ValueError(f"Open-Meteo returned {len(res)} points for {len(ids)} stations")
    model = {}
    for id, r in zip(ids, res):
        h = r["hourly"]
        for n, t in enumerate(h["time"]):
            g = lambda k: h[k][n]  # noqa: E731
            add(
                model.setdefault(t[:13], {f: {} for f in MFIELDS}),
                id,
                pm=num(g("precipitation")),
                sm=num(g("snowfall")),
                mt=num(g("temperature_2m")),
                sd=None if g("snow_depth") is None else num(g("snow_depth") * 100),
                mw=num(g("wind_speed_10m")),
                mg=num(g("wind_gusts_10m")),
                md=num(g("wind_direction_10m")),
            )
    return model


def metno_hourly(timeseries, ids):
    """One MET Norway timeseries -> {hour key: {field: {id: value}}} for the fields it has (mt mw mg md pm; no sm/sd).
    ids: every station the series stands for. Instants go to the hour of T; next_1_hours precipitation covers T..T+1h, so (like
    Open-Meteo's) it goes to the hour ending at T+1h. 6-hourly entries have no next_1_hours (next_6_hours is not spread), so no pm."""
    out = {}
    for t in timeseries:
        d = t["data"]["instant"]["details"]
        n1 = (t["data"].get("next_1_hours") or {}).get("details", {})
        at = datetime.fromisoformat(t["time"].replace("Z", "+00:00"))
        m = out.setdefault(hkey(at), {f: {} for f in MFIELDS})
        p = out.setdefault(hkey(at + timedelta(hours=1)), {f: {} for f in MFIELDS})
        for id in ids:
            add(m, id, mt=num(d.get("air_temperature")), mw=kmh(d.get("wind_speed")), mg=kmh(d.get("wind_speed_of_gust")), md=num(d.get("wind_from_direction")))
            add(p, id, pm=num(n1.get("precipitation_amount")))
    return out


def model_meta(prev, model, now, source="Open-Meteo", fields=()):
    """hourly.json "model": a run that got model hours labels them with its source and time (source/issued = the latest run) and
    records that source and time for each field it provided (fields); no model (failure) keeps the previous label."""
    if not model:
        return prev
    mark = {"source": source, "issued": now.isoformat(timespec="minutes")}
    return {**mark, "fields": {**prev.get("fields", {}), **{f: dict(mark) for f in fields}}}


def merge_model(hours, model, clear=False):
    """This run's model values replace earlier ones at the same hours, field by field (a fallback keeps the earlier sd/sm).
    clear=True (the MET Norway fallback, 6-hourly after ~60 h): the fields it provides are first dropped from its first hour on,
    so no hour in between keeps an older Open-Meteo value under the new label. Returns the set of fields this run provided."""
    got = {f for maps in (model or {}).values() for f, m in maps.items() if m}
    if clear and model:
        start = min(model)
        for k, v in hours.items():
            if k >= start:
                for f in got:
                    v.pop(f, None)
    for k, maps in (model or {}).items():
        for f, m in maps.items():
            hours.setdefault(k, {}).setdefault(f, {}).update(m)
    return got


def forecast(stations, fetch=get_json):
    """-> (model hours, source name, warning or None, Open-Meteo parse error or None). A network error on Open-Meteo falls back to
    MET Norway and is returned as the warning (health.json shows it, source still ok); a parse error (the API changed) falls back too
    but is returned so the run records it as a failure in health.json."""
    try:
        q = "&".join(
            [
                "latitude=" + ",".join(str(s["lat"]) for s in stations),
                "longitude=" + ",".join(str(s["lon"]) for s in stations),
                "elevation=" + ",".join(str(s["alt"]) for s in stations),
            ]
        )
        res = fetch(
            "https://api.open-meteo.com/v1/forecast?"
            + q
            + "&hourly=snow_depth,snowfall,precipitation,temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m"
            "&past_days=2&forecast_days=7&timezone=Europe%2FVienna"
        )
        return parse_open_meteo(res if isinstance(res, list) else [res], [s["id"] for s in stations]), "Open-Meteo", None, None
    # HTTPError is a URLError; socket timeouts are OSError; a truncated body is IncompleteRead or JSONDecodeError
    except (urllib.error.URLError, http.client.HTTPException, OSError, TimeoutError, json.JSONDecodeError) as e:
        print("Open-Meteo unreachable, falling back to MET Norway:", e, file=sys.stderr)
        perr = None
        down = f"Open-Meteo unreachable ({e}), using the MET Norway fallback"
    except Exception as e:  # anything else must still fall back, and is recorded as a parse failure
        print("Open-Meteo response not understood (parser broken?), falling back to MET Norway:", repr(e), file=sys.stderr)
        perr = f"Open-Meteo response not understood: {e!r}"
        down = None
    model, failed = {}, []
    t0 = time.monotonic()
    for i, s in enumerate(stations):
        if time.monotonic() - t0 > MET_SECONDS:
            failed += [x["id"] for x in stations[i:]]
            break
        try:
            r = fetch(f"https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={s['lat']:.4f}&lon={s['lon']:.4f}&altitude={s['alt']}")
            merge_model(model, metno_hourly(r["properties"]["timeseries"], [s["id"]]))
        except Exception as e:  # one station must not cost the others their data
            print("MET Norway failed:", s["id"], e, file=sys.stderr)
            failed.append(s["id"])
    if failed:
        msg = "MET Norway failed for: " + ", ".join(failed)
        down = msg if down is None else f"{down}; {msg}"
    return model, "MET Norway", down, perr


def should_run(now, live_updated, max_age_min):
    """True inside Vienna 06:00-19:59 when the live data is missing, unreadable or older than max_age_min."""
    if not 6 <= now.astimezone(TZ).hour < 20:
        return False
    try:
        return now - datetime.fromisoformat(live_updated) > timedelta(minutes=max_age_min)
    except (TypeError, ValueError):  # None, garbage or naive timestamp: treat as stale
        return True


def merge_history(hours, tried, live, stations, by_uuid, now, src, note):
    """Fill hours in place: Tirol archive backfill (adds to tried), the live hour, TAWES history and Vorarlberg history.
    Partial trouble is recorded on src (health.json) through note."""
    bad, miss, t0 = 0, missing_hours(hours, STATIONS, now, tried), time.monotonic()
    todo = backfill(miss)  # Tirol archive: only hours not yet recorded, capped so a slow archive can't time out the job
    for i, t in enumerate(todo):
        if time.monotonic() - t0 > BACKFILL_SECONDS:
            todo = todo[:i]
            break
        try:
            for k, maps in tirol_hours(get_json(snapshot_url(t))["features"], by_uuid).items():
                hmerge(hours, k, maps, keep=True)  # first value read at its own hour stays
            tried.add(t.strftime(UTC_KEY))
        except Exception as e:
            print("skip hour", t.isoformat(), e, file=sys.stderr)
            bad += 1
    if bad:
        note("tirol", f"archive hours failed: {bad}")
    if len(miss) > len(todo):
        note("tirol", f"backfill: {len(miss) - len(todo)} hours left for later runs")
    try:
        for k, maps in tirol_hours(live, by_uuid).items():
            hmerge(hours, k, maps, keep=True)
    except Exception as e:
        print("live hour failed:", e, file=sys.stderr)
        note("tirol", f"live hour failed: {e}")
    try:  # TAWES hours, one historical request
        u = lambda x: x.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
        start = now - timedelta(days=HOURLY_DAYS, hours=1)  # whole window each run, so TAWES gaps heal on their own
        gj = get_json(GEO + "historical/tawes-v1-10min?parameters=TL,RF,RR,SCHNEE,FF,FFX,DD&station_ids=" + ",".join(TAWES) + f"&start={u(start)}&end={u(now)}")
        for k, maps in tawes_hourly(gj).items():
            hmerge(hours, k, maps)
    except Exception as e:
        print("TAWES history failed:", e, file=sys.stderr)
        src["tawes"]["detail"] = f"history failed: {e}"
    for st in stations:  # Vorarlberg history: last 7 days of 5-min values per station
        if st["id"].startswith("VOR-"):
            try:
                req = urllib.request.Request(VOR + "woche/" + st["id"][4:] + ".smet.gz", headers=UA)
                with urllib.request.urlopen(req, timeout=30) as r:
                    txt = gzip.decompress(r.read()).decode()
                for k, vals in smet_hourly(smet_table(txt)).items():
                    hmerge(hours, k, {f: {st["id"]: v} for f, v in vals.items()})
            except Exception as e:
                print("Vorarlberg history failed:", st["id"], e, file=sys.stderr)
                note("vorarlberg", f"history failed: {st['id']} {e}")


def read_bulletins(ids, src, fail):
    """Danger regions for ids: last run's regions kept, each bulletin that loads replaces its own. Failures go to src/fail."""
    try:  # a bulletin that fails keeps its regions from the last run
        with open("data/danger.json") as fh:
            regions = {k: v for k, v in json.load(fh)["regions"].items() if k in ids}
    except (FileNotFoundError, KeyError, ValueError):
        regions = {}
    for name, url in BULLETINS.items():  # secondary sources: a failure must not abort the run
        try:
            regions.update(parse_danger(get_json(url), ids))
        except Exception as e:
            print("avalanche bulletin failed:", name, e, file=sys.stderr)
            if preseason(name, e):
                src["bulletins"]["detail"] = "no bulletin published yet"
                continue
            fail("bulletins", "; ".join(filter(None, [src["bulletins"]["error"], f"{name}: {e}"])))
    return regions


def main():
    now = datetime.now(TZ)
    src = {k: {"ok": True, "error": None, "detail": None} for k in ("tirol", "tawes", "vorarlberg", "model", "bulletins")}  # health.json

    def fail(k, e):
        src[k].update(ok=False, error=str(e))

    def note(k, msg):  # partial trouble: the source still delivered
        src[k]["detail"] = "; ".join(filter(None, [src[k]["detail"], msg]))

    live = get_json(LWD + "stations.geojson")["features"]  # primary source: a failure aborts the run
    stations = [station(f) for f in live if (f["properties"].get("LWD-Nummer") or f["id"]) in STATIONS]
    if not stations:
        raise RuntimeError("no Tirol stations in feed")
    if gone := sorted(set(STATIONS) - {x["id"] for x in stations}):
        print("station missing from feed:", *gone, file=sys.stderr)
        src["tirol"]["detail"] = "missing from feed: " + ", ".join(gone)
    try:  # secondary source: a failure must not abort the run
        q = "tawes-v1-10min?parameters=SCHNEE,TL,FF,FFX,DD&station_ids=" + ",".join(TAWES)
        stations += parse_tawes(get_json(GEO + "current/" + q), TAWES)
    except Exception as e:
        print("GeoSphere TAWES failed:", e, file=sys.stderr)
        fail("tawes", e)
        stations += carry("data/stations.json", "tawes")
    try:  # secondary source: a failure must not abort the run
        vor = [vor_station(f) for f in get_json(VOR + "stations_vor.geojson")["features"] if f["properties"].get("shortName") in VOR_IDS]
        stations += vor
        if gone := sorted(set(VOR_IDS) - {x["id"][4:] for x in vor}):
            print("station missing from Vorarlberg feed:", *gone, file=sys.stderr)
            src["vorarlberg"]["detail"] = "missing from feed: " + ", ".join(gone)
    except Exception as e:
        print("Vorarlberg stations failed:", e, file=sys.stderr)
        fail("vorarlberg", e)
        stations += carry("data/stations.json", "vorarlberg")
    by_uuid = {s["uuid"]: s for s in stations}

    os.makedirs("data", exist_ok=True)
    try:
        with open("data/hourly.json") as fh:
            hourly = json.load(fh)
        hours = hourly["hours"]
    except (FileNotFoundError, ValueError, KeyError, TypeError) as e:
        if not isinstance(e, FileNotFoundError):
            print("hourly.json unreadable, starting empty:", e, file=sys.stderr)
        hourly = {"model": {"source": None, "issued": None}, "hours": {}}
        hours = hourly["hours"]
    tried = set(hourly.get("tried", []))
    merge_history(hours, tried, live, stations, by_uuid, now, src, note)
    for st in stations:
        st["flags"] = check(st, hours, now)
    out = {
        "data/stations.json": json.dumps({"updated": now.isoformat(timespec="minutes"), "stations": stations})
    }  # written together at the end: a crash mid-run must not leave new stations beside old hourly data
    fsrc = "failed"
    try:  # secondary source: a failure must not abort the run
        model, name, warning, perr = forecast(stations)
        hourly["model"] = model_meta(hourly["model"], model, now, name, merge_model(hours, model, clear=name != "Open-Meteo"))
        src["model"]["warning"] = warning  # degraded but working: listed in the page's data checks
        fsrc = src["model"]["detail"] = name if name == "Open-Meteo" else "MET Norway (no snowfall or snow depth)"
        if perr:  # the fallback worked, but the primary model is broken: not silent
            fail("model", perr)
    except Exception as e:
        print("forecast failed:", e, file=sys.stderr)
        fail("model", e)
    hs_rise(hours, STATIONS)
    lo = (now.astimezone(timezone.utc) - timedelta(days=HOURLY_DAYS)).strftime(UTC_KEY)
    hourly["tried"] = sorted(k for k in tried if k >= lo)
    hourly["hours"] = {k: {f: m for f, m in v.items() if m} for k, v in prune_hours(hours, now).items()}  # empty maps omitted
    hour_flags(hourly["hours"])
    out["data/hourly.json"] = json.dumps(hourly, sort_keys=True, separators=(",", ":"))
    ids = {s["region"].split()[0] for s in stations if s.get("region")}
    regions = read_bulletins(ids, src, fail)
    if regions:
        out["data/danger.json"] = json.dumps({"source": ", ".join(BULLETINS), "regions": regions, "generated": now.isoformat(timespec="minutes")})
    health = {
        "run": now.isoformat(timespec="minutes"),
        "sources": src,
        "flagged": [{"id": s["id"], "name": s["name"], "field": f, "reason": r} for s in stations for f, r in s["flags"].items()],
        "offline": [
            {"id": s["id"], "name": s["name"], "last": s["date"]}
            for s in stations
            if not s["date"] or datetime.fromisoformat(s["date"]) < now - timedelta(hours=24)
        ],
    }
    out["data/health.json"] = json.dumps(health)
    for path, text in out.items():
        with open(path + ".tmp", "w") as fh:
            fh.write(text)
    for path in out:
        os.replace(path + ".tmp", path)
    print(f"{len(stations)} stations, {len(hourly['hours'])} hours, forecast: {fsrc}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--gate"]:  # workflow Gate step: prints true/false, never fetches
        try:
            with open("/tmp/live.json") as fh:
                live = json.load(fh)["updated"]
        except Exception:
            live = None  # missing or unreadable live data counts as stale
        print("true" if should_run(datetime.now(timezone.utc), live, int(os.environ["MAX_AGE_MIN"])) else "false")
        sys.exit(0)
    main()
