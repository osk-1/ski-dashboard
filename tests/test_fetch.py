"""Tests for fetch.py (pure helpers and the whole run). Run: python3 -m unittest discover tests"""

import contextlib
import http.client
import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest import mock

import fetch
from fetch import *  # noqa: F403  the tests exercise nearly every name in fetch.py


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

    # parse_open_meteo: a short response is a parse error, and forecast() records it and falls back
    try:
        parse_open_meteo([{"hourly": {"time": []}}], ["A", "B"])
        raise AssertionError("short Open-Meteo response was not rejected")
    except ValueError as e:
        assert "returned 1 points for 2 stations" in str(e), e
    with contextlib.redirect_stderr(io.StringIO()):
        fmodel, source, warning, perr = forecast(stn + [{"id": "B", "lat": 47.2, "lon": 10.3, "alt": 1500}], stub(lambda: [{"hourly": {"time": []}}]))
    assert source == "MET Norway" and perr is not None and "returned 1 points for 2 stations" in perr, perr

    # forecast(): with the MET budget already spent, no station is fetched and every station is named in the warning
    budget, fetch.MET_SECONDS = fetch.MET_SECONDS, -1
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            fmodel, source, warning, perr = forecast(stn + [{"id": "B", "lat": 47.2, "lon": 10.3, "alt": 1500}], stub(down))
    finally:
        fetch.MET_SECONDS = budget
    assert fmodel == {} and warning.endswith("; MET Norway failed for: A, B"), (fmodel, warning)


class FetchTests(unittest.TestCase):
    def test_helpers(self):
        selftest()

    def test_main_writes_consistent_files(self):
        """main() with stubbed feeds: TAWES down -> old TAWES station carried over; files valid, health records the failure."""
        now = datetime.now(TZ)
        live = {
            "features": [
                {
                    "id": "u1",
                    "geometry": {"coordinates": [10.25878, 47.14749, 2400]},
                    "properties": {"LWD-Nummer": "SKAP2", "name": "Kapall Schneestation", "HS": 80, "LT": -3.0, "date": now.isoformat()},
                }
            ]
        }
        vor = {
            "features": [
                {
                    "id": "v1",
                    "geometry": {"coordinates": [10.17078, 47.17359, 1920]},
                    "properties": {
                        "shortName": "ZURS1",
                        "name": "Zürs Hexenboden",
                        "microRegionID": "AT-08-03-01",
                        "HS": 0.5,
                        "TA": 270.0,
                        "date": now.isoformat(),
                    },
                }
            ]
        }

        def get(url):
            if url.endswith("stations.geojson") and "static.avalanche.report" in url:
                return live
            if url.endswith("stations_vor.geojson"):
                return vor
            raise OSError("down: " + url)  # TAWES, bulletins and the Tirol archive

        old_tawes = {"id": "TAWES-11311", "uuid": "TAWES-11311", "date": "2026-11-19T07:00:00+01:00", "lt": -2.0, "name": "St. Anton (Tal)"}
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()):
            os.chdir(tmp)
            try:
                os.mkdir("data")
                with open("data/stations.json", "w") as fh:
                    json.dump({"stations": [old_tawes]}, fh)
                with (
                    mock.patch.object(fetch, "get_json", get),
                    mock.patch.object(fetch, "forecast", lambda st: ({}, "Open-Meteo", None, None)),
                    mock.patch.object(fetch.urllib.request, "urlopen", side_effect=OSError("down")),
                ):
                    fetch.main()
                data = {f: json.load(open(f"data/{f}.json")) for f in ("stations", "hourly", "health")}
                self.assertFalse(any(f.endswith(".tmp") for f in os.listdir("data")))
            finally:
                os.chdir(cwd)
        ids = [x["id"] for x in data["stations"]["stations"]]
        self.assertEqual(sorted(ids), ["SKAP2", "TAWES-11311", "VOR-ZURS1"])  # old TAWES carried over unchanged
        self.assertEqual(next(x for x in data["stations"]["stations"] if x["id"] == "TAWES-11311")["lt"], -2.0)
        self.assertFalse(data["health"]["sources"]["tawes"]["ok"])
        self.assertTrue(data["health"]["sources"]["tirol"]["ok"] and data["health"]["sources"]["vorarlberg"]["ok"])
        self.assertIn(now.strftime("%Y-%m-%dT%H"), data["hourly"]["hours"])  # live hour recorded
