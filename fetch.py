#!/usr/bin/env python3
"""Fetch Arlberg snow data into ./data/ for the dashboard (run by GitHub Actions).

Writes:
  data/stations.json   current readings per station (snow height, wind, temperature)
  data/hourly.json     {"model": {source, issued, fields: {field: {source, issued}}}, "hours": {local "YYYY-MM-DDTHH": {field: {stationId: value}}}}, rolling 7 days (+ model hours ahead); see README
  data/health.json     {run, sources: {tirol, tawes, vorarlberg, model, bulletins: {ok, error, detail}}, model also warning}, flagged, offline}; see README

Usage: python3 fetch.py
       python3 fetch.py --selftest
"""

import contextlib
import gzip
import http.client
import io
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
BACKFILL_MAX, BACKFILL_SECONDS = 48, 300  # Tirol archive files per run (newest missing hours first) and wall-clock budget; the rest wait for later runs
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
UA = {"User-Agent": "arlberg-snow-dashboard/0.1"}
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
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


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
        "date": vienna(p["date"]),
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


def missing_hours(hours, ids, now):
    """Past full hours of the window (current hour excluded: it comes from the live feed) where no id has any measured value."""
    have = {k for k, v in hours.items() if any(id in v.get(f, {}) for f in MEASURED for id in ids)}
    t = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)  # step in UTC: local wall hours skip/repeat on DST days
    out = [t - timedelta(hours=i) for i in range(HOURLY_DAYS * 24, 0, -1)]
    return [x for x in out if hkey(x) not in have]


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
    for s in stations:
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
    bad, miss, t0 = 0, missing_hours(hours, STATIONS, now), time.monotonic()
    todo = backfill(miss)  # Tirol archive: only hours not yet recorded, capped so a slow archive can't time out the job
    for i, t in enumerate(todo):
        if time.monotonic() - t0 > BACKFILL_SECONDS:
            todo = todo[:i]
            break
        try:
            for k, maps in tirol_hours(get_json(snapshot_url(t))["features"], by_uuid).items():
                hmerge(hours, k, maps, keep=True)  # first value read at its own hour stays
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
    for st in stations:
        st["flags"] = check(st, hours, now)
    with open("data/stations.json", "w") as fh:
        json.dump({"updated": now.isoformat(timespec="minutes"), "stations": stations}, fh)
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
    hourly["hours"] = {k: {f: m for f, m in v.items() if m} for k, v in prune_hours(hours, now).items()}  # empty maps omitted
    hour_flags(hourly["hours"])
    with open("data/hourly.json", "w") as fh:
        json.dump(hourly, fh, sort_keys=True, separators=(",", ":"))
    ids = {s["region"].split()[0] for s in stations if s.get("region")}
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
    if regions:
        with open("data/danger.json", "w") as fh:
            json.dump({"source": ", ".join(BULLETINS), "regions": regions, "generated": now.isoformat(timespec="minutes")}, fh)
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
    with open("data/health.json", "w") as fh:
        json.dump(health, fh)
    print(f"{len(stations)} stations, {len(hourly['hours'])} hours, forecast: {fsrc}")


def selftest():
    s = datetime(2026, 11, 19, 7, tzinfo=TZ)
    assert snapshot_url(s).endswith("2026-11-19_06-00_stations.geojson")
    assert snapshot_url(datetime(2026, 7, 1, 7, tzinfo=TZ)).endswith("2026-07-01_05-00_stations.geojson")  # summer time
    ts = [
        {"time": "2026-11-19T10:00:00Z", "data": {"instant": {"details": {"air_temperature": -3}}, "next_1_hours": {"details": {"precipitation_amount": 2}}}},
        {"time": "2026-11-19T11:00:00Z", "data": {"instant": {"details": {"air_temperature": 3}}, "next_1_hours": {"details": {"precipitation_amount": 5}}}},
    ]
    f = {
        "id": "u",
        "geometry": {"coordinates": [10.3, 47.1, 2400.7]},
        "properties": {"LWD-Nummer": "SKAP1", "name": "W", "HS": None, "LT": -3.44, "WG": 46.352, "WG_BOE": 83.484, "WR": 222.655},
    }
    st = station(f)
    assert (st["type"], st["lt"], st["wg"], st["wg_boe"], st["wr"], st["hs"], st["alt"], st["hsd24"]) == ("wind", -3.4, 46.4, 83.5, 222.7, None, 2400, None)
    assert station({**f, "properties": {"name": "S", "HS": 3}, "id": "c9b477f0-c934-013d-99fc-5af9cc682f9b"})["type"] == "snow"
    assert depth(-5.2) == 0.0 and depth(None) is None
    bl = {
        "bulletins": [
            {
                "publicationTime": "p",
                "validTime": {"startTime": "a", "endTime": "e"},
                "dangerRatings": [
                    {"mainValue": "low", "elevation": {"upperBound": "2600"}, "validTimePeriod": "all_day"},
                    {"mainValue": "considerable", "elevation": {"lowerBound": "2600"}, "validTimePeriod": "all_day"},
                    {"mainValue": "moderate", "elevation": {"lowerBound": "treeline"}},
                    {"mainValue": "low", "elevation": None},
                    {"mainValue": "no_snow"},
                ],
                "avalancheProblems": [{"problemType": "wet_snow", "elevation": {"lowerBound": "2500"}, "aspects": ["S"]}],
                "regions": [{"name": "X", "regionID": "AT-07-07"}, {"name": "Y", "regionID": "AT-07-99"}],
            }
        ]
    }
    d = parse_danger(bl, {"AT-07-07"})
    assert list(d) == ["AT-07-07"] and d["AT-07-07"]["valid_end"] == "e" and d["AT-07-07"]["problems"][0]["type"] == "wet_snow"
    assert [(r["level"], r["bound"], r["elevation"]) for r in d["AT-07-07"]["ratings"]] == [
        (1, "below", "2600"),
        (3, "above", "2600"),
        (2, "above", "treeline"),
        (1, None, None),
        (0, None, None),
    ]
    gj = {
        "timestamps": ["2026-11-19T05:50+00:00", "2026-11-19T06:00+00:00"],
        "features": [
            {
                "geometry": {"coordinates": [10.23, 47.13]},
                "properties": {
                    "station": "11110",
                    "parameters": {
                        "SCHNEE": {"data": [None, None]},
                        "TL": {"data": [-1, -2.1]},
                        "FF": {"data": [1, 5.5]},
                        "FFX": {"data": [2, 9.6]},
                        "DD": {"data": [1, 273.0]},
                    },
                },
            },
            {
                "geometry": {"coordinates": [10.27, 47.13]},
                "properties": {
                    "station": "11311",
                    "parameters": {
                        "SCHNEE": {"data": [7.0, 0.0]},
                        "TL": {"data": [1, 2.9]},
                        "FF": {"data": [0.2, None]},
                        "FFX": {"data": [2, 1.9]},
                        "DD": {"data": [1, 226.0]},
                    },
                },
            },
        ],
    }
    g, a = parse_tawes(gj, TAWES)
    assert (g["id"], g["type"], g["hs"], g["wg"], g["wg_boe"], g["wr"], g["lt"], g["alt"]) == ("TAWES-11110", "wind", None, 19.8, 34.6, 273.0, -2.1, 2079)
    assert (a["type"], a["hs"], a["wg"]) == ("snow", 0.0, 0.7)
    nonempty = lambda h: {k: {f: m for f, m in v.items() if m} for k, v in h.items()}
    assert nonempty(tawes_hourly(gj)) == {
        "2026-11-19T07": {  # 06:00 UTC = 07:00 CET; Galzig has no snow, 11311 no FF
            "hs": {"TAWES-11311": 0.0},
            "lt": {"TAWES-11110": -2.1, "TAWES-11311": 2.9},
            "wg": {"TAWES-11110": 19.8},
            "wg_boe": {"TAWES-11110": 34.6, "TAWES-11311": 6.8},
            "wr": {"TAWES-11110": 273.0, "TAWES-11311": 226.0},
        }
    }
    rr = {
        "timestamps": [f"2026-11-19T{h:02}:{m:02}+00:00" for h, m in [(5, 0), (5, 10), (5, 20), (5, 30), (5, 40), (5, 50), (6, 0), (6, 10), (7, 0)]],
        "features": [],
    }
    rr["features"] = [
        {
            "properties": {
                "station": "1",
                "parameters": {"RR": {"data": [9, 0.1, 0.2, 0, 0, 0.3, 0.4, None, 1]}, "RF": {"data": [None] * 6 + [88.0, None, None]}},
            }
        }
    ]
    th = tawes_hourly(rr)  # 07 CET = 05:10..06:00 UTC summed; 06 and 08 CET lack intervals -> null, not a partial sum
    assert (th["2026-11-19T07"]["pr"], th["2026-11-19T07"]["rh"], th["2026-11-19T06"]["pr"], th["2026-11-19T08"]["pr"]) == (
        {"TAWES-1": 1.0},
        {"TAWES-1": 88.0},
        {},
        {},
    )
    vf = {
        "id": "v",
        "geometry": {"coordinates": [10.170777, 47.173592, 1920]},
        "properties": {
            "shortName": "ZURS1",
            "name": "Zürs Hexenboden",
            "microRegionID": "AT-08-03-01",
            "HS": 0.22,
            "HSD_24": 0.07,
            "TA": 271.9,
            "VW": 9.9,
            "VW_MAX": 20.1,
            "DW": 237,
            "date": "2026-11-20 09:00:00+00:00",
        },
    }
    v = vor_station(vf)
    assert (v["id"], v["type"], v["hs"], v["hsd24"], v["lt"], v["wg"], v["wg_boe"], v["wr"], v["alt"], v["region"]) == (
        "VOR-ZURS1",
        "snow",
        22.0,
        7.0,
        -1.2,
        35.6,
        72.4,
        237.0,
        1920,
        "AT-08-03-01",
    )
    assert v["date"] == "2026-11-20T10:00:00+01:00"
    assert vor_station({**vf, "properties": {"shortName": "ALBO2", "name": "A", "date": "2026-11-20 09:00:00+00:00"}})["lt"] is None
    smet = (
        "SMET 1.1 ASCII\n[HEADER]\nnodata         = -999\nfields         = timestamp TA HS VW\n[DATA]\n"
        "2026-11-19T06:00:00Z 270.1 0.15 10\n2026-11-19T11:00:00Z 271.0 -999 -999\n2026-11-19T16:00:00Z 270.0 -0.01 0.5\n"
    )
    assert smet_hourly(smet_table(smet)) == {  # no VW_MAX/DW columns; nodata per field
        "2026-11-19T07": {"hs": 15.0, "lt": -3.0, "wg": 36.0},
        "2026-11-19T12": {"lt": -2.1},
        "2026-11-19T17": {"hs": 0.0, "lt": -3.1, "wg": 1.8},
    }
    sm2 = smet.replace("2026-11-19T11:00:00Z 271.0 -999 -999", "2026-11-19T11:00:00Z 271.0 abc").replace(
        "2026-11-19T16:00:00Z 270.0 -0.01 0.5", "2026-11-19T16:00:00Z 270.1 0.15"
    )
    assert smet_hourly(smet_table(sm2)) == {  # short row and non-numeric cell keep other fields
        "2026-11-19T07": {"hs": 15.0, "lt": -3.0, "wg": 36.0},
        "2026-11-19T12": {"lt": -2.1},
        "2026-11-19T17": {"hs": 15.0, "lt": -3.0},
    }
    rows = "".join(f"2026-11-19T{5 + (m + 5) // 60:02}:{(m + 5) % 60:02}:00Z 0.9 {'-999' if m == 0 else '0.1'}\n" for m in range(0, 120, 5))  # 05:05..07:00 UTC
    assert smet_hourly(smet_table("[HEADER]\nfields = timestamp RH PSUM\n[DATA]\n" + rows)) == {  # PSUM: 12 values ending at HH:00, 05:05 missing
        "2026-11-19T07": {"rh": 90.0},
        "2026-11-19T08": {"rh": 90.0, "pr": 1.2},
    }
    by = {"u1": {"id": "SKAP2", "type": "snow"}, "u2": {"id": "SKAP1", "type": "wind"}}
    feats = [
        {"id": "u1", "properties": {"date": "2026-11-20T07:10:00+01:00", "LT": -2.8, "OFT": -3.2, "RH": 91.6, "HS": 30.8}},
        {"id": "u2", "properties": {"date": "2026-11-20T06:00:00+01:00", "LT": -4.6, "HS": 5, "WG": 49.4}},  # older: belongs to 06
        {"id": "x", "properties": {"date": "2026-11-20T07:00:00+01:00", "LT": 1}},
    ]
    th = nonempty(tirol_hours(feats, by))  # e.g. the 08 CET file: each value lands at its own date's hour, never the file's
    assert th == {
        "2026-11-20T07": {"lt": {"SKAP2": -2.8}, "oft": {"SKAP2": -3.2}, "rh": {"SKAP2": 91.6}, "hs": {"SKAP2": 30.8}},
        "2026-11-20T06": {"lt": {"SKAP1": -4.6}, "wg": {"SKAP1": 49.4}},  # wind station hs ignored
    }
    hk = {"2026-11-20T06": {"lt": {"SKAP1": -4.0}}}
    for k, maps in th.items():
        hmerge(hk, k, maps, keep=True)
    assert (hk["2026-11-20T06"], hk["2026-11-20T07"]["lt"]) == (
        {"lt": {"SKAP1": -4.0}, "wg": {"SKAP1": 49.4}},
        {"SKAP2": -2.8},
    )  # existing value at H not replaced
    now = datetime(2026, 11, 20, 8, 30, tzinfo=TZ)
    hm = {"2026-11-20T07": {"lt": {"SKAP2": 1}}, "2026-11-20T06": {"pm": {"SKAP2": 1}, "lt": {"TAWES-1": 1}}}  # model/other sources don't count
    mh = [hkey(t) for t in missing_hours(hm, STATIONS, now)]
    assert (len(mh), mh[0], mh[-2:]) == (167, "2026-11-13T08", ["2026-11-20T05", "2026-11-20T06"])
    hr = {
        "2026-11-20T06": {"hs": {"SKAP2": 30.0, "V": 1}},
        "2026-11-20T07": {"hs": {"SKAP2": 30.8, "V": 5}},
        "2026-11-20T08": {"hs": {"SKAP2": 30.1}},
        "2026-11-20T10": {"hs": {"SKAP2": 40}},
    }
    hs_rise(hr, STATIONS)
    assert [hr[k].get("hr") for k in sorted(hr)] == [None, {"SKAP2": 0.8}, {"SKAP2": 0.0}, None]  # no negative, no gap-spanning rise, Tirol ids only
    for d, n in [(datetime(2026, 3, 29, 8, 30, tzinfo=TZ), 168), (datetime(2026, 10, 25, 8, 30, tzinfo=TZ), 167)]:
        mk = [hkey(t) for t in missing_hours({}, STATIONS, d)]  # 168 real hours; autumn repeats T02, spring has no T02
        assert (len(mk), len(set(mk)), "2026-03-29T02" in mk, sorted(prune_hours(dict.fromkeys(mk, 1), d)) == sorted(set(mk))) == (168, n, False, True)
    hd = {
        "2026-03-29T01": {"hs": {"SKAP2": 10}},
        "2026-03-29T03": {"hs": {"SKAP2": 11}},
        "2026-10-25T01": {"hs": {"SKAP2": 10}},
        "2026-10-25T02": {"hs": {"SKAP2": 11}},
    }
    hd["2026-10-25T03"] = {"hs": {"SKAP2": 12}}
    hs_rise(hd, STATIONS)
    assert [hd[k].get("hr") for k in sorted(hd)] == [None, {"SKAP2": 1.0}, None, {"SKAP2": 1.0}, {"SKAP2": 1.0}]  # 01 -> 03 CEST is one real hour
    assert sorted(prune_hours({"2026-11-13T07": 1, "2026-11-13T08": 1, "2026-11-25T23": 1}, now)) == ["2026-11-13T08", "2026-11-25T23"]
    om = {
        "hourly": {
            "time": [f"2026-11-{d}T{h:02}:00" for d in (18, 19, 20) for h in range(24)],
            "snow_depth": [9.0] * 48 + [0.5] * 23 + [None],
            "temperature_2m": [-1.04] * 72,
            "precipitation": [0.2] * 72,
            "snowfall": [None] * 72,
            "wind_speed_10m": [10.0] * 71 + [None],
            "wind_gusts_10m": [25.5] * 72,
            "wind_direction_10m": [270] * 72,
        },
    }
    model = parse_open_meteo([om], ["A"])
    assert (len(model), model["2026-11-18T00"], model["2026-11-20T23"]) == (
        72,
        {"pm": {"A": 0.2}, "sm": {}, "mt": {"A": -1.0}, "sd": {"A": 900.0}, "mw": {"A": 10.0}, "mg": {"A": 25.5}, "md": {"A": 270.0}},
        {"pm": {"A": 0.2}, "sm": {}, "mt": {"A": -1.0}, "sd": {}, "mw": {}, "mg": {"A": 25.5}, "md": {"A": 270.0}},  # null depth/wind stay absent
    )
    assert model["2026-11-20T00"]["sd"] == {"A": 50.0}
    # 7 days hourly: every variable present for every hour
    n7 = 7 * 24
    om7 = {
        "hourly": {
            "time": [(datetime(2026, 11, 20) + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(n7)],
            **{k: [1.0] * n7 for k in ("snow_depth", "temperature_2m", "precipitation", "snowfall", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m")},
        },
    }
    m7 = parse_open_meteo([om7], ["A"])
    assert (len(m7), all(len(v["sd"]) == len(v["mw"]) == len(v["mg"]) == len(v["md"]) == 1 for v in m7.values())) == (n7, True)
    # MET Norway: m/s -> km/h, gust optional, 6-hourly entry has no pm, local hour key across the CET -> CEST switch
    mn = lambda t, wind, extra=None, n1=None: {  # noqa: E731
        "time": t,
        "data": {
            "instant": {"details": {"air_temperature": -2.0, "wind_speed": wind, "wind_from_direction": 180.0, **(extra or {})}},
            **({"next_1_hours": {"details": {"precipitation_amount": n1}}} if n1 is not None else {}),
        },
    }
    mh = metno_hourly([mn("2026-11-20T11:00:00Z", 5.0, {"wind_speed_of_gust": 10.0}, 0.4), mn("2026-11-24T12:00:00Z", 2.0)], ["A", "B"])
    assert mh["2026-11-20T12"] == {
        "mt": {"A": -2.0, "B": -2.0},
        "mw": {"A": 18.0, "B": 18.0},
        "mg": {"A": 36.0, "B": 36.0},
        "md": {"A": 180.0, "B": 180.0},
        "pm": {},
        "sm": {},
        "sd": {},
    }
    assert mh["2026-11-20T13"]["pm"] == {"A": 0.4, "B": 0.4}  # next_1_hours 11-12Z = the hour ending 13:00 local, as Open-Meteo files it
    assert mh["2026-11-24T13"]["pm"] == {} and mh["2026-11-24T13"]["mg"] == {} and mh["2026-11-24T13"]["mw"]["A"] == 7.2
    assert hkey(datetime(2027, 3, 28, 1, 0, tzinfo=timezone.utc)) == "2027-03-28T03"  # 01:00Z = 03:00 CEST (DST day)
    assert [hkey(datetime.fromisoformat(f"2027-03-28T0{h}:00:00+00:00")) for h in (0, 1)] == ["2027-03-28T01", "2027-03-28T03"]
    # plausibility: a clean station gets {}, each rule flags only its own field
    now = datetime(2026, 11, 20, 12, 30, tzinfo=TZ)
    ok = {"id": "SKAP1", "name": "Kapall Windstation", "lat": 47.14908, "lon": 10.24794, "hs": None, "lt": -4.0, "wg": 20.0, "wg_boe": 30.0, "wr": 200.0}
    ok["date"] = "2026-11-20T12:10:00+01:00"
    hk = lambda n, f, vals: {hkey(now - timedelta(hours=i)): {f: {"SKAP1": x}} for i, x in zip(range(n), vals)}  # newest first, from 12h
    hh = lambda *maps: {k: {f: m for d in maps for f, m in d.get(k, {}).items()} for d in maps for k in d}
    assert check(ok, {}, now) == {}
    assert check({**ok, "lt": -50.0, "wr": 361.0, "wg": 260.0, "wg_boe": 270.0}, {}, now) == {
        "lt": "out of range",
        "wr": "out of range",
        "wg": "out of range",
        "wg_boe": "out of range",
    }
    hl = {"2026-11-20T12": {"hs": {"A": 900.0, "B": 50.0}, "rh": {"A": 103.1, "B": 103.0}}, "2026-11-20T11": {"lt": {"A": 1.0}, "flags": {"A": {"lt": "x"}}}}
    hour_flags(hl)  # limits per hour; stale flags of an earlier run dropped
    assert (hl["2026-11-20T12"]["flags"], "flags" in hl["2026-11-20T11"]) == ({"A": {"hs": "out of range", "rh": "out of range"}}, False)
    sn = {**ok, "id": "SKAP2", "name": "Kapall Schneestation", "lat": 47.14749, "lon": 10.25878, "hs": 50.0, "wg": None, "wg_boe": None, "wr": None}
    jh = lambda f, a, b: {"2026-11-20T12": {f: {"SKAP2": a}}, "2026-11-20T11": {f: {"SKAP2": b}}}
    assert [check(sn, jh("hs", a, b), now).get("hs") for a, b in [(50, 19), (50, 20), (50, 66), (50, 65)]] == [
        "jump",
        None,
        "jump",
        None,
    ]  # +31 / -16 jump, +30 / -15 allowed
    assert [check(sn, jh("lt", a, b), now).get("lt") for a, b in [(-4, 4.5), (-4, 4), (5, -3.5)]] == ["jump", None, "jump"]
    assert check(sn, {"2026-11-20T12": {"hs": {"SKAP2": 50}}, "2026-11-20T10": {"hs": {"SKAP2": 0}}}, now) == {}  # gap: no previous hour, no jump
    assert check(ok, hk(6, "lt", [-4.0] * 6), now) == {"lt": "stuck"}
    assert check(ok, hk(6, "lt", [-4.0] * 5 + [-4.1]), now) == {}  # 5 identical hours are not stuck
    assert check(ok, hk(6, "lt", [-4.0] * 5 + [None]), now) == {}  # a missing hour breaks the run
    assert check(ok, hh(hk(6, "wr", [200.0] * 6), hk(6, "wg", [6.0] * 6)), now) == {"wr": "stuck"}
    assert check(ok, hh(hk(6, "wr", [200.0] * 6), hk(6, "wg", [6.0] * 5 + [5.0])), now) == {}  # calm hour: a vane may rest
    assert check({**ok, "wg_boe": 19.9}, {}, now) == {"wg_boe": "gust below mean"}
    fz = hh(hk(3, "wg", [0.0] * 3), hk(3, "lt", [-1.0] * 3), hk(3, "rh", [96.0] * 3))
    frozen = {"wg": "sensor frozen?", "wg_boe": "sensor frozen?", "wr": "sensor frozen?"}
    assert (check({**ok, "wg": 0.0, "wg_boe": 0.0}, fz, now), check(ok, {**fz, "2026-11-20T10": {**fz["2026-11-20T10"], "rh": {"SKAP1": 95.0}}}, now)) == (
        frozen,
        {},
    )
    assert check(ok, {**fz, "2026-11-20T11": {**fz["2026-11-20T11"], "wg": {}}}, now) == {}  # gap in wg: not frozen
    assert check({**ok, "date": "2026-11-20T12:41:00+01:00"}, {}, now) == {f: "time in future" for f in ("lt", "wg", "wg_boe", "wr")}
    assert check({**ok, "date": "2026-11-20T12:40:00+01:00"}, {}, now) == {}
    mv = lambda **kw: check({**ok, **kw}, {}, now).get("station")
    assert mv(lon=None) == "location mismatch"  # no crash without lon
    assert (mv(lat=47.15808), mv(lat=47.15308), mv(name="X"), mv(id="NEW1")) == (
        "location mismatch",
        None,
        "location mismatch",
        "location mismatch",
    )  # 1 km / 440 m north
    # dates: Vienna ISO everywhere; TAWES staggered fields get their own time
    assert station({**f, "properties": {**f["properties"], "date": "2026-11-20T09:20:00+00:00"}})["date"] == "2026-11-20T10:20:00+01:00"
    assert (g["date"], g["dates"], a["date"], a["dates"]) == ("2026-11-19T07:00:00+01:00", {}, "2026-11-19T07:00:00+01:00", {"wg": "2026-11-19T06:50:00+01:00"})
    tmp = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"selftest-stations-{os.getpid()}.json")
    old = [{"id": "SKAP1", "date": "x"}, {"id": "TAWES-11110", "date": "2026-11-19T07:00:00+01:00", "lt": -2.0}, {"id": "VOR-ZURS1", "date": "y"}]
    with open(tmp, "w") as fh:
        json.dump({"stations": old}, fh)
    try:  # carry-over: only the failed source's dicts, unchanged; missing file -> nothing
        with contextlib.redirect_stderr(io.StringIO()):
            assert (carry(tmp, "tawes"), carry(tmp, "vorarlberg"), carry(tmp + ".missing", "tawes")) == ([old[1]], [old[2]], [])
    finally:
        os.remove(tmp)
    nf = lambda code: urllib.error.HTTPError("u", code, "x", None, None)
    assert (preseason("LWD Vorarlberg", nf(404)), preseason("LWD Vorarlberg", nf(500)), preseason("Euregio avalanche.report", nf(404))) == (True, False, False)
    # backfill: newest missing hours first, at most BACKFILL_MAX per run
    mh = missing_hours({}, STATIONS, now)
    assert (len(backfill(mh)), backfill(mh)[0], backfill(mh)[-1], backfill(mh[:3])) == (48, mh[-1], mh[-48], mh[2::-1])
    # a fallback run (no sd/sm) must not erase earlier Open-Meteo hours
    hm = {"2026-11-20T12": {"sd": {"A": 50.0}, "mt": {"A": 1.0, "B": 2.0}}}
    merge_model(hm, {"2026-11-20T12": {"mt": {"A": -3.0}, "sd": {}}})
    assert hm == {"2026-11-20T12": {"sd": {"A": 50.0}, "mt": {"A": -3.0, "B": 2.0}}}
    # the fallback (clear=True) drops its fields from its first hour on, so a 6-hourly gap keeps no older Open-Meteo value; sd and earlier hours stay
    hc = {k: {"sd": {"A": 50.0}, "mt": {"A": 1.0}} for k in ("2026-11-20T11", "2026-11-23T12", "2026-11-23T13")}
    assert merge_model(hc, {"2026-11-23T12": {"mt": {"A": -3.0}, "sd": {}}}, clear=True) == {"mt"}
    assert hc == {
        "2026-11-20T11": {"sd": {"A": 50.0}, "mt": {"A": 1.0}},
        "2026-11-23T12": {"sd": {"A": 50.0}, "mt": {"A": -3.0}},
        "2026-11-23T13": {"sd": {"A": 50.0}},
    }
    # model label: the fallback keeps the earlier Open-Meteo source and issue time
    prev = {"source": "Open-Meteo", "issued": "2026-11-20T08:00+01:00", "fields": {"sd": {"source": "Open-Meteo", "issued": "2026-11-20T08:00+01:00"}}}
    om, mn = {"source": "Open-Meteo", "issued": "2026-11-20T12:30+01:00"}, {"source": "MET Norway", "issued": "2026-11-20T12:30+01:00"}
    assert model_meta(prev, None, now) == prev
    assert model_meta({"source": None, "issued": None}, {"x": {}}, now, fields={"sd"}) == {**om, "fields": {"sd": om}}
    # per-field provenance: the fallback run relabels only the fields it provided, sd keeps its Open-Meteo issue time
    got = merge_model(hm, {"2026-11-20T12": {"mt": {"A": 0.0}, "sd": {}}})
    assert got == {"mt"} and model_meta(prev, {"x": {}}, now, "MET Norway", got) == {**mn, "fields": {"sd": prev["fields"]["sd"], "mt": mn}}
    # forecast(): Open-Meteo network error and parse error both fall back to MET Norway (stubbed fetches); only the parse error is returned
    stn = [{"id": "A", "lat": 47.1, "lon": 10.2, "alt": 2000}]

    def stub(om_fail):
        def fetch(url):
            if "open-meteo" in url:
                return om_fail()
            return {"properties": {"timeseries": ts}}

        return fetch

    def down():
        raise urllib.error.URLError("down")

    def truncated():
        raise http.client.IncompleteRead(b"partial")

    def bad_json():
        raise json.JSONDecodeError("Expecting value", "", 0)

    def attr():
        raise AttributeError("'NoneType' object has no attribute 'get'")

    cases = (
        (down, None, "unreachable"),
        (lambda: {"hourly": {}}, "Open-Meteo response not understood: KeyError('time')", "not understood"),
        (truncated, None, "unreachable"),  # IncompleteRead: network, no parse failure
        (bad_json, None, "unreachable"),  # JSONDecodeError from a truncated body: network, not parser
        (attr, "Open-Meteo response not understood: AttributeError(\"'NoneType' object has no attribute 'get'\")", "not understood"),
    )
    for om_fail, want, log in cases:
        with contextlib.redirect_stderr(io.StringIO()) as err:
            fmodel, source, warning, perr = forecast(stn, stub(om_fail))
        assert source == "MET Norway" and perr == want, (source, perr)
        assert (warning or "").startswith("Open-Meteo unreachable") == (want is None), warning  # an outage is reported, not silent
        assert fmodel["2026-11-19T12"]["mt"] == {"A": 3.0} and fmodel["2026-11-19T12"]["sd"] == {}, fmodel
        assert log in err.getvalue(), err.getvalue()
        assert ("response not understood" in err.getvalue()) == (want is not None)

    # forecast(): a station whose MET fetch raises is named in the warning; the other station's data is kept
    def met_b_fails(url):
        if "open-meteo" in url:
            raise urllib.error.URLError("down")
        if "lat=47.2000" in url:
            raise OSError("boom")
        return {"properties": {"timeseries": ts}}

    with contextlib.redirect_stderr(io.StringIO()) as err:
        fmodel, source, warning, perr = forecast(stn + [{"id": "B", "lat": 47.2, "lon": 10.3, "alt": 1500}], met_b_fails)
    assert source == "MET Norway" and perr is None and fmodel["2026-11-19T12"]["mt"] == {"A": 3.0}, fmodel
    assert warning.endswith("; MET Norway failed for: B") and "MET Norway failed: B boom" in err.getvalue(), (warning, err.getvalue())
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        main()
