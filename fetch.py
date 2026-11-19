#!/usr/bin/env python3
"""Fetch Arlberg snow data into ./data/ for the dashboard (run by GitHub Actions).

Writes:
  data/stations.json   current readings per station (snow height, wind, temperature)
  data/forecast.json   5-day snowfall and min/max temperature per station
  data/readings.json   {slot: {t, hs}} history of snow stations; slot = local "YYYY-MM-DDTHH", hours 07/12/17; merged, never pruned

Usage: python3 fetch.py [--days N]   # N = days of reading slots to (re)build, default 1
       python3 fetch.py --selftest
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Vienna")
SLOT_HOURS = (7, 12, 17)
# Feed IDs (LWD-Nummer, or feature id when none): snow stations, then wind stations
STATIONS = ("SAUL2", "SKAP2", "SAAU2", "SAGA2", "c9b477f0-c934-013d-99fc-5af9cc682f9b", "KDIA2",
            "SKAP1", "SAGA1", "SAAU1", "KSIN1", "KDIA1")
WIND = ("SKAP1", "SAGA1", "SAAU1", "KSIN1", "KDIA1")
LWD = "https://static.avalanche.report/weather_stations/"
GEO = "https://dataset.api.hub.geosphere.at/v1/station/"
TAWES = {"11311": ("St. Anton (Tal)", 1304, "snow"), "11110": ("Galzig", 2079, "wind")}  # GeoSphere TAWES id: (name, altitude m, type)
UA = {"User-Agent": "arlberg-snow-dashboard/0.1"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


def snapshot_url(slot_local):
    # Archive filenames are UTC hours: local 07:00 CET lives in ..._06-00_stations.geojson
    return LWD + slot_local.astimezone(timezone.utc).strftime("%Y-%m-%d_%H-00") + "_stations.geojson"


def num(v):
    return None if v is None else round(float(v), 1)


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
        "date": p.get("date"),
    }


def parse_tawes(gj, names):
    """GeoSphere geojson -> station dicts, one per feature, using each parameter's newest value. FF/FFX m/s -> km/h; SCHNEE null = wind-only."""
    out = []
    for f in gj["features"]:
        p, id = f["properties"]["parameters"], f["properties"]["station"]
        v = lambda k: next((x for x in reversed(p.get(k, {}).get("data") or []) if x is not None), None)  # staggered: newest non-null
        kmh = lambda x: None if x is None else num(x * 3.6)
        out.append({"id": "TAWES-" + id, "uuid": "TAWES-" + id, "name": names[id][0], "region": None,
                    "type": names[id][2], "lon": round(f["geometry"]["coordinates"][0], 5),
                    "lat": round(f["geometry"]["coordinates"][1], 5), "alt": names[id][1], "hs": depth(v("SCHNEE")), "n24": None,
                    "hsd24": None, "lt": num(v("TL")), "wg": kmh(v("FF")), "wg_boe": kmh(v("FFX")), "wr": num(v("DD")),
                    "date": gj["timestamps"][-1]})
    return out


def tawes_history(gj, slot_keys):
    """{local slot key: {TAWES-id: cm}} from a historical geojson (UTC 10-min timestamps), snow stations only."""
    ts = [datetime.fromisoformat(t).astimezone(TZ).strftime("%Y-%m-%dT%H:%M") for t in gj["timestamps"]]
    out = {}
    for f in gj["features"]:
        d = f["properties"]["parameters"]["SCHNEE"]["data"]
        for k in slot_keys:
            i = ts.index(k + ":00") if k + ":00" in ts else None
            if i is not None and d[i] is not None:
                out.setdefault(k, {})["TAWES-" + f["properties"]["station"]] = depth(d[i])
    return out


def slots(days, now):
    out = []
    for d in range(days - 1, -1, -1):
        day = (now - timedelta(days=d)).date()
        for h in SLOT_HOURS:
            s = datetime(day.year, day.month, day.day, h, tzinfo=TZ)
            if s <= now:
                out.append(s)
    return out


def daily_snow_from_metno(timeseries, days):
    """Sum MET Norway precipitation into local-day snowfall (cm). Returns {date: [snow_cm, tmin, tmax]}."""
    acc = {}
    for t in timeseries:
        ts = datetime.fromisoformat(t["time"].replace("Z", "+00:00")).astimezone(TZ)
        day = ts.date().isoformat()
        if day not in days:
            continue
        temp = t["data"]["instant"]["details"]["air_temperature"]
        # met.no gives hourly steps for ~2.5 days, then 6-hourly steps with only next_6_hours
        nxt = t["data"].get("next_1_hours") or t["data"].get("next_6_hours")
        mm = nxt["details"].get("precipitation_amount", 0) if nxt else 0
        a = acc.setdefault(day, [0.0, temp, temp])
        # shortcut: 1 mm water = 1 cm snow when <= 0.5 °C (10:1 ratio); real ratios vary 5–20:1
        if temp <= 0.5:
            a[0] += mm
        a[1], a[2] = min(a[1], temp), max(a[2], temp)
    return {d: [round(v[0], 1), v[1], v[2]] for d, v in acc.items()}


LEVEL = {"low": 1, "moderate": 2, "considerable": 3, "high": 4, "very_high": 5}


def parse_danger(bulletin, ids):
    out = {}
    for b in bulletin["bulletins"]:
        rat = [{"level": LEVEL.get(r["mainValue"], 0),
                "bound": "below" if "upperBound" in r.get("elevation", {}) else "above" if "lowerBound" in r.get("elevation", {}) else None,
                "elevation": next(iter(r.get("elevation", {}).values()), None), "period": r.get("validTimePeriod")}
               for r in b["dangerRatings"]]
        prob = [{"type": p["problemType"], "elevation": p.get("elevation"), "aspects": p.get("aspects", [])} for p in b.get("avalancheProblems", [])]
        for r in b["regions"]:
            if r["regionID"] in ids and r["regionID"] not in out:
                out[r["regionID"]] = {"name": r["name"], "published": b["publicationTime"], "valid_start": b["validTime"]["startTime"],
                                      "valid_end": b["validTime"]["endTime"], "ratings": rat, "problems": prob}
    return out


def forecast(stations):
    days = [(datetime.now(TZ).date() + timedelta(days=i)).isoformat() for i in range(5)]
    try:
        q = "&".join([
            "latitude=" + ",".join(str(s["lat"]) for s in stations),
            "longitude=" + ",".join(str(s["lon"]) for s in stations),
            "elevation=" + ",".join(str(s["alt"]) for s in stations),
        ])
        res = get_json("https://api.open-meteo.com/v1/forecast?" + q +
                       "&daily=snowfall_sum,temperature_2m_min,temperature_2m_max&hourly=snow_depth"
                       "&forecast_days=5&timezone=Europe%2FVienna")
        res = res if isinstance(res, list) else [res]
        pts = {}
        for s, r in zip(stations, res):
            depth = r["hourly"]["snow_depth"]  # metres, hourly
            pts[s["id"]] = {
                "snowfall": r["daily"]["snowfall_sum"],
                "tmin": r["daily"]["temperature_2m_min"],
                "tmax": r["daily"]["temperature_2m_max"],
                "depth": [None if all(v is None for v in depth[i*24:(i+1)*24]) else
                          round(100 * max(v for v in depth[i*24:(i+1)*24] if v is not None)) for i in range(5)],
            }
        return {"source": "Open-Meteo", "days": days, "points": pts}
    except Exception as e:
        print("Open-Meteo failed, falling back to MET Norway:", e, file=sys.stderr)
    pts = {}
    for s in stations:
        r = get_json(f"https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={s['lat']:.4f}&lon={s['lon']:.4f}&altitude={s['alt']}")
        d = daily_snow_from_metno(r["properties"]["timeseries"], days)
        pts[s["id"]] = {
            "snowfall": [d.get(x, [None])[0] for x in days],
            "tmin": [d[x][1] if x in d else None for x in days],
            "tmax": [d[x][2] if x in d else None for x in days],
            "depth": None,  # met.no has no snow-depth forecast
        }
    return {"source": "MET Norway (snowfall estimated from precipitation)", "days": days, "points": pts}


def main(days):
    now = datetime.now(TZ)
    stations = [station(f) for f in get_json(LWD + "stations.geojson")["features"] if (f["properties"].get("LWD-Nummer") or f["id"]) in STATIONS]
    for m in set(STATIONS) - {x["id"] for x in stations}:
        print("station missing from feed:", m, file=sys.stderr)
    try:  # secondary source: a failure must not abort the run
        q = "tawes-v1-10min?parameters=SCHNEE,TL,FF,FFX,DD&station_ids=" + ",".join(TAWES)
        stations += parse_tawes(get_json(GEO + "current/" + q), TAWES)
    except Exception as e:
        print("GeoSphere TAWES failed:", e, file=sys.stderr)
    by_uuid = {s["uuid"]: s["id"] for s in stations if s["type"] == "snow"}

    os.makedirs("data", exist_ok=True)
    try:
        with open("data/readings.json") as fh:
            readings = json.load(fh)
    except FileNotFoundError:
        readings = {}
    for s in slots(days, now):
        try:
            feats = get_json(snapshot_url(s))["features"]
        except Exception as e:
            print("skip", s.isoformat(), e, file=sys.stderr)
            continue
        hs = {by_uuid[f["id"]]: depth(f["properties"].get("HS")) for f in feats if f["id"] in by_uuid}
        slot = readings.setdefault(s.strftime("%Y-%m-%dT%H"), {"hs": {}})
        slot["t"] = s.isoformat()
        slot["hs"].update(hs)  # merge: keep other sources' ids (TAWES)
    try:  # TAWES snow height at the slot times, one historical request
        sl = slots(days, now)
        u = lambda x: x.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
        gj = get_json(GEO + "historical/tawes-v1-10min?parameters=SCHNEE&station_ids=" + ",".join(
            i for i, v in TAWES.items() if v[2] == "snow") + f"&start={u(sl[0])}&end={u(now)}")
        iso = {s.strftime("%Y-%m-%dT%H"): s.isoformat() for s in sl}
        for k, hs in tawes_history(gj, list(iso)).items():
            readings.setdefault(k, {"t": iso[k], "hs": {}})["hs"].update(hs)
    except Exception as e:
        print("TAWES history failed:", e, file=sys.stderr)
    with open("data/readings.json", "w") as fh:
        json.dump(readings, fh, sort_keys=True, separators=(",", ":"))

    with open("data/stations.json", "w") as fh:
        json.dump({"updated": now.isoformat(timespec="minutes"), "stations": stations}, fh)
    fc = forecast(stations)
    fc["generated"] = now.isoformat(timespec="minutes")
    with open("data/forecast.json", "w") as fh:
        json.dump(fc, fh)
    try:  # secondary source: a failure must not abort the run
        ids = {s["region"].split()[0] for s in stations if s.get("region")}
        regions = parse_danger(get_json("https://static.avalanche.report/bulletins/latest/EUREGIO_en_CAAMLv6.json"), ids)
        with open("data/danger.json", "w") as fh:
            json.dump({"source": "Euregio avalanche.report", "regions": regions, "generated": now.isoformat(timespec="minutes")}, fh)
    except Exception as e:
        print("avalanche bulletin failed:", e, file=sys.stderr)
    print(f"{len(stations)} stations, {len(readings)} reading slots, forecast: {fc['source']}")


def selftest():
    s = datetime(2026, 11, 19, 7, tzinfo=TZ)
    assert snapshot_url(s).endswith("2026-11-19_06-00_stations.geojson")
    assert snapshot_url(datetime(2026, 7, 1, 7, tzinfo=TZ)).endswith("2026-07-01_05-00_stations.geojson")  # summer time
    assert [x.hour for x in slots(1, datetime(2026, 11, 19, 13, tzinfo=TZ))] == [7, 12]
    ts = [{"time": "2026-11-19T10:00:00Z", "data": {"instant": {"details": {"air_temperature": -3}},
                                                     "next_1_hours": {"details": {"precipitation_amount": 2}}}},
          {"time": "2026-11-19T11:00:00Z", "data": {"instant": {"details": {"air_temperature": 3}},
                                                     "next_1_hours": {"details": {"precipitation_amount": 5}}}}]
    assert daily_snow_from_metno(ts, ["2026-11-19"]) == {"2026-11-19": [2.0, -3, 3]}
    f = {"id": "u", "geometry": {"coordinates": [10.3, 47.1, 2400.7]},
         "properties": {"LWD-Nummer": "SKAP1", "name": "W", "HS": None, "LT": -3.44, "WG": 46.352, "WG_BOE": 83.484, "WR": 222.655}}
    st = station(f)
    assert (st["type"], st["lt"], st["wg"], st["wg_boe"], st["wr"], st["hs"], st["alt"], st["hsd24"]) == ("wind", -3.4, 46.4, 83.5, 222.7, None, 2400, None)
    assert station({**f, "properties": {"name": "S", "HS": 3}, "id": "c9b477f0-c934-013d-99fc-5af9cc682f9b"})["type"] == "snow"
    assert depth(-5.2) == 0.0 and depth(None) is None
    bl = {"bulletins": [{"publicationTime": "p", "validTime": {"startTime": "a", "endTime": "e"},
                         "dangerRatings": [{"mainValue": "low", "elevation": {"upperBound": "2600"}, "validTimePeriod": "all_day"},
                                           {"mainValue": "considerable", "elevation": {"lowerBound": "2600"}, "validTimePeriod": "all_day"},
                                           {"mainValue": "no_snow"}],
                         "avalancheProblems": [{"problemType": "wet_snow", "elevation": {"lowerBound": "2500"}, "aspects": ["S"]}],
                         "regions": [{"name": "X", "regionID": "AT-07-07"}, {"name": "Y", "regionID": "AT-07-99"}]}]}
    d = parse_danger(bl, {"AT-07-07"})
    assert list(d) == ["AT-07-07"] and d["AT-07-07"]["valid_end"] == "e" and d["AT-07-07"]["problems"][0]["type"] == "wet_snow"
    assert [(r["level"], r["bound"], r["elevation"]) for r in d["AT-07-07"]["ratings"]] == [(1, "below", "2600"), (3, "above", "2600"), (0, None, None)]
    gj = {"timestamps": ["2026-11-19T05:50+00:00", "2026-11-19T06:00+00:00"], "features": [
        {"geometry": {"coordinates": [10.23, 47.13]}, "properties": {"station": "11110", "parameters": {
            "SCHNEE": {"data": [None, None]}, "TL": {"data": [-1, -2.1]}, "FF": {"data": [1, 5.5]}, "FFX": {"data": [2, 9.6]}, "DD": {"data": [1, 273.0]}}}},
        {"geometry": {"coordinates": [10.27, 47.13]}, "properties": {"station": "11311", "parameters": {
            "SCHNEE": {"data": [7.0, 0.0]}, "TL": {"data": [1, 2.9]}, "FF": {"data": [0.2, None]}, "FFX": {"data": [2, 1.9]}, "DD": {"data": [1, 226.0]}}}}]}
    g, a = parse_tawes(gj, TAWES)
    assert (g["id"], g["type"], g["hs"], g["wg"], g["wg_boe"], g["wr"], g["lt"], g["alt"]) == ("TAWES-11110", "wind", None, 19.8, 34.6, 273.0, -2.1, 2079)
    assert (a["type"], a["hs"], a["wg"]) == ("snow", 0.0, 0.7)
    assert tawes_history(gj, ["2026-11-19T07", "2026-11-19T12"]) == {"2026-11-19T07": {"TAWES-11311": 0.0}}  # 06:00 UTC = 07:00 CET; Galzig has no snow
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        main(int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 1)
