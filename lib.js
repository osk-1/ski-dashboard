// Pure helpers (no DOM), shared by app.js in the browser and by node --test.
const STEPS = [10, 25, 50, 100]; // cm bands for the sequential scale
const band = hs => (hs == null ? -1 : STEPS.filter(s => hs >= s).length);
const hasWind = s => s.wr != null && s.wg != null;
const arrowOn = s => hasWind(s) && s.wg >= 1; // no direction arrow in calm air
// Austria Lambert (EPSG:31287, Bessel 1841) for the new-snow images, applied straight to WGS84: the ~100 m datum shift is far below their 500 m pixels
const lambert = (() => {
  const r = Math.PI / 180,
    a = 6377397.155,
    f = 1 / 299.1528128,
    e = Math.sqrt(2 * f - f * f),
    m = p => Math.cos(p) / Math.sqrt(1 - (e * Math.sin(p)) ** 2),
    t = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = Math.log(m(49 * r) / m(46 * r)) / Math.log(t(49 * r) / t(46 * r)),
    F = m(49 * r) / (n * t(49 * r) ** n),
    r0 = a * F * t(47.5 * r) ** n;
  return (lat, lon) => {
    const q = a * F * t(lat * r) ** n,
      g = n * (lon - 13 - 1 / 3) * r;
    return [400000 + q * Math.sin(g), 400000 + r0 - q * Math.cos(g)];
  };
})();
// Hourly series (data/hourly.json): hour keys are Vienna local "YYYY-MM-DDTHH"
const H = 3600e3,
  MEASURED = ["lt", "oft", "rh", "hs", "hr", "pr", "wg", "wg_boe", "wr"];
const VK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
// cached by UTC hour: Vienna's offset is a whole number of hours, so the cache is exact; it holds only the hours the page asks for
const VKC = new Map(),
  viennaKey = ms => {
    const h = Math.floor(ms / H);
    if (VKC.has(h)) return VKC.get(h);
    const p = Object.fromEntries(VK.formatToParts(ms).map(x => [x.type, x.value]));
    const k = `${p.year}-${p.month}-${p.day}T${p.hour}`;
    VKC.set(h, k);
    return k;
  };
// the UTC instant of a key: Vienna is UTC+1 or +2 (a key skipped by the spring DST change -> null)
const keyMs = k => {
  const t = Date.UTC(+k.slice(0, 4), k.slice(5, 7) - 1, +k.slice(8, 10), +k.slice(11, 13));
  return [t - H, t - 2 * H].find(x => viennaKey(x) === k) ?? null;
};
// "now" for the window: real time, or the newest measured hour when that is more than 7 days old (dead feed, test fixtures)
const anchorMs = (hours, now) => {
  const k = Object.keys(hours)
    .sort()
    .reverse()
    .find(k => MEASURED.some(f => hours[k][f] && Object.keys(hours[k][f]).length));
  const t = k && keyMs(k);
  return t != null && now - t > 7 * 24 * H ? t : now;
};
// one point per hour in [from, to], y null where nothing was recorded (a gap, never filled)
const slice = (hours, field, id, from, to) => {
  const out = [];
  for (let t = Math.ceil(from / H) * H; t <= to; t += H) {
    const k = viennaKey(t);
    out.push({ x: t, y: hours[k]?.[field]?.[id] ?? null, k });
  }
  return out;
};
// hourly points summed into Vienna-local bins of `step` hours (3: 00-03, 03-06 …; 24: calendar days), for bars over long windows; extra: further fields of p summed too
// each bin: x the middle of its whole bin (partial bins at the window edges too, so every bar sits on one even grid and keeps its width), x0/x1 first/last hour, y null when no hour has a value, n hours with a value of `of` in the window
// shortcut: an hour's key is its start, so a precipitation sum "ending at 00:00" lands in the new day; fine for a 3 h / day overview, exact attribution would shift keys by one hour
const binSum = (pts, step, extra = []) => {
  const out = [];
  for (const p of pts) {
    const k = viennaKey(p.x),
      id =
        step >= 24
          ? k.slice(0, 10) + "T00"
          : k.slice(0, 11) + String(Math.floor(+k.slice(11) / step) * step).padStart(2, "0");
    let b = out.at(-1);
    if (!b || b.id !== id) out.push((b = { id, x0: p.x, y: null, n: 0, of: 0 }));
    b.x1 = p.x;
    b.of++;
    if (p.y != null) {
      b.y = (b.y ?? 0) + p.y;
      b.n++;
    }
    for (const f of extra) if (p[f] != null) b[f] = (b[f] ?? 0) + p[f];
  }
  return out.map(({ id, ...b }) => ({
    ...b,
    x: keyMs(id) + (step * H) / 2,
    y: b.y == null ? null : Math.round(b.y * 10) / 10,
    ...Object.fromEntries(extra.map(f => [f, b[f] == null ? undefined : Math.round(b[f] * 10) / 10])),
  }));
};
// newest recorded value of a field at or before `to`
const latest = (hours, field, id, to) => {
  const lim = viennaKey(to),
    k = Object.keys(hours)
      .sort()
      .reverse()
      .find(k => k <= lim && hours[k][field]?.[id] != null);
  return k ? { k, y: hours[k][field][id] } : null;
};
// chart windows in hours (#40) and the x-axis tick spacing (h) for each
const WINDOWS = [1, 6, 12, 24, 48, 72, 168];
const winOr = (v, def) => (WINDOWS.includes(v) ? v : def);
const tickStepH = h => ({ 6: 2, 12: 4, 24: 12, 48: 24, 72: 24, 168: 24 })[h];
// chart bars: hourly HS rise, never negative (settling); gaps stay null. The summary's "new snow" is riseOf, not a sum of these
const risePts = (hours, id, from, to) =>
  slice(hours, "hr", id, from, to).map(p => ({ ...p, y: p.y == null ? null : Math.max(0, p.y) }));
// change of a field over the last backH hours: { now, then, d } from the newest values at or before each instant; null if either is missing or both resolve to the same hour (no real comparison)
const delta = (hours, field, id, now, backH) => {
  const a = latest(hours, field, id, now),
    b = latest(hours, field, id, now - backH * H);
  return a && b && a.k !== b.k ? { now: a.y, then: b.y, d: Math.round((a.y - b.y) * 10) / 10 } : null;
};
const shift = (d, n) =>
  new Date(Date.UTC(+d.slice(0, 4), d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10); // "YYYY-MM-DD" + n days
// the latest night (18:00-08:00) or day (08:00-18:00) that has ended by `now`, over its full length in hourly.json
// { date (local date it starts on), pts with data, of = hours in the period (DST-aware, normally 14 / 10) }
const period = (hours, field, id, now, night) => {
  const span = d => (night ? [keyMs(d + "T18"), keyMs(shift(d, 1) + "T08")] : [keyMs(d + "T08"), keyMs(d + "T18")]);
  let d = viennaKey(now).slice(0, 10);
  while (span(d)[1] > now) d = shift(d, -1);
  const [from, to] = span(d),
    all = slice(hours, field, id, from, to - H),
    pts = all.filter(p => p.y != null);
  return pts.length ? { date: d, pts, of: all.length } : null;
};
const extreme = (hours, field, id, now, night) => {
  const p = period(hours, field, id, now, night);
  return p && { ...p, at: p.pts.reduce((a, b) => ((night ? b.y < a.y : b.y > a.y) ? b : a)) };
};
// surface refroze: below 0 °C in every hour with data of the last complete night; null = no data that night
const refroze = (hours, id, now) => {
  const p = period(hours, "oft", id, now, true);
  return p && { ...p, ok: p.pts.every(x => x.y < 0), warm: p.pts.find(x => x.y >= 0) };
};
// Accuracy (#42): a station value is only shown as fact when present, fresh and unflagged; judged by its own measurement time
const staleAfter = { wg: H, wg_boe: H, wr: H, lt: 2 * H, oft: 2 * H, rh: 2 * H, hs: 6 * H, n24: 6 * H, hsd24: 6 * H },
  offlineAfter = 24 * H;
const valueState = (s, f, now) => {
  if (s[f] == null) return { missing: true };
  if ((f === "n24" || f === "hsd24") && s.hs != null) {
    const h = valueState(s, "hs", now);
    if (!h.ok) return h;
  } // derived from hs: no better than hs
  const last = Date.parse(s.dates?.[f] || s.date),
    age = now - last;
  if (!(age <= offlineAfter)) return { offline: true, last }; // no or unreadable time counts as offline
  if (age > staleAfter[f]) return { stale: true, last };
  return s.flags?.[f] ? { suspect: true, reason: s.flags[f] } : { ok: true };
};
const misplaced = s => s.flags?.station === "location mismatch"; // hidden from map and summary
// the station with every value that is not ok set to null, and what was wrong in `bad`: {field: state}
const goodOnly = (s, now) => {
  const g = { ...s, bad: {} };
  for (const f in staleAfter) {
    const v = valueState(s, f, now);
    if (!v.ok && !v.missing) {
      g[f] = null;
      g.bad[f] = v;
    }
  }
  return g;
};
// banner rule: 07-20 h older than 75 min (hourly cadence + run time); at night, last refresh before 19:00 of the evening the night began
const refreshStale = (lastIso, now) => {
  const last = Date.parse(lastIso),
    k = viennaKey(now),
    h = +k.slice(11);
  if (isNaN(last)) return true;
  if (h >= 7 && h < 20) return now - last > 75 * 60e3;
  return last < keyMs((h >= 20 ? k.slice(0, 10) : shift(k.slice(0, 10), -1)) + "T19");
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Map zoom tiers (#39): 0 = overview, 1 = values, 2 = names + everything
const tierOf = (z, fitZ) => (z < fitZ + 1 ? 0 : z < fitZ + 2 ? 1 : 2);
// Greedy pixel grouping: highest rank seeds a group and absorbs unassigned points within px; `keep` stays alone. pts: [{id, x, y, rank}]
const groupByPixel = (pts, px = 28, keep = null) => {
  const left = [...pts].sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1)),
    out = [];
  while (left.length) {
    const seed = left.shift(),
      ids = [seed.id];
    if (seed.id !== keep)
      for (let i = 0; i < left.length;)
        left[i].id !== keep && Math.hypot(left[i].x - seed.x, left[i].y - seed.y) <= px
          ? ids.push(left.splice(i, 1)[0].id)
          : i++;
    out.push(ids);
  }
  return out;
};
// lead = deepest non-wind member; one snow-type + one wind-only member = a dot with the wind arrow on it
const describeGroup = members => {
  const snowy = members.filter(m => m.type !== "wind"),
    wind = members.filter(m => m.type === "wind");
  const lead = snowy.reduce((a, b) => ((b.hs ?? -1) > (a.hs ?? -1) ? b : a), snowy[0] || members[0]);
  return snowy.length === 1 && wind.length === 1
    ? { lead, wind: wind[0], count: 1 }
    : { lead, wind: null, count: members.length };
};
// Summary strip (#40): altitude bands, medians, sums over hourly.json
const bandOf = alt => (alt < 1600 ? "valley" : alt <= 2200 ? "mid" : "high");
const BANDS = [
  ["valley", "Valley", "< 1,600 m"],
  ["mid", "Mid", "1,600-2,200 m"],
  ["high", "High", "> 2,200 m"],
];
const median = xs => {
  const v = xs.filter(x => x != null).sort((a, b) => a - b),
    m = v.length >> 1;
  return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : null;
};
const compass = d => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
// one point per hour key: the repeated 02:00 of the autumn DST change is one hour of data, not two
const hourPts = (hours, field, id, from, to) => {
  const seen = new Set();
  return slice(hours, field, id, from, to).filter(p => !seen.has(p.k) && seen.add(p.k));
};
// hours of `field` in [from, to] that have a value and are not flagged for this station
const okPts = (hours, field, id, from, to) =>
  hourPts(hours, field, id, from, to).filter(p => p.y != null && !hours[p.k]?.flags?.[id]?.[field]);
// hr (HS rise) is clamped at 0 like risePts; of = hours in the window
const sumField = (hours, field, id, from, to) => {
  const v = okPts(hours, field, id, from, to).map(p => (field === "hr" ? Math.max(0, p.y) : p.y));
  return { v: v.reduce((a, b) => a + b, 0), n: v.length, of: hourPts(hours, field, id, from, to).length };
};
// new snow = HS rise above the running maximum (high-water mark) of the unflagged hs values: jitter and settling add nothing, gaps keep the mark.
// The mark starts at the hour before the window's first hour (the boundary), so the rise from there counts; without a usable boundary it starts at the first in-window value.
const riseOf = (hours, id, from, to) => {
  const first = Math.ceil(from / H) * H,
    b = okPts(hours, "hs", id, first - H, first - H)[0];
  let m = b ? b.y : null,
    v = 0;
  const pts = okPts(hours, "hs", id, from, to);
  for (const p of pts) {
    if (m != null && p.y > m) v += p.y - m;
    m = m == null ? p.y : Math.max(m, p.y);
  }
  return { v, n: pts.length, of: hourPts(hours, "hs", id, from, to).length };
};
const extremeOf = (hours, field, id, from, to, max) =>
  okPts(hours, field, id, from, to).reduce((a, p) => (!a || (max ? p.y > a.y : p.y < a.y) ? p : a), null);
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
// per band: n = stations with any data; each metric is the median over the stations that have it (null when none), with its own station count (…N)
// and, for snow, the median hours with data (…H) out of the window's hours (of): less than `of` means a partial total. Windows are (now-h, now] and (now, now+h].
const bandStats = (stations, hours, now, h) => {
  const out = {},
    past = [now - h * H + 1, now],
    next = [now + 1, now + h * H];
  for (const [b] of BANDS) {
    const st = stations.filter(s => bandOf(s.alt) === b),
      has = id => Object.values(hours).some(x => x.hs?.[id] != null);
    const per = st.map(s => {
      const hs = has(s.id),
        a = hs ? riseOf(hours, s.id, ...past) : { n: 0 },
        c = hs ? sumField(hours, "sm", s.id, ...next) : { n: 0 };
      const lo = extremeOf(hours, "lt", s.id, ...past, false),
        hi = extremeOf(hours, "lt", s.id, ...past, true);
      return {
        snowLast: a.n ? a.v : null,
        snowNext: c.n ? c.v : null,
        tmin: lo?.y ?? null,
        tmax: hi?.y ?? null,
        snowLastH: a.n || null,
        snowNextH: c.n || null,
      };
    });
    out[b] = { n: per.filter(p => ["snowLast", "snowNext", "tmin", "tmax"].some(f => p[f] != null)).length, of: h };
    for (const f of ["snowLast", "snowNext", "tmin", "tmax"]) {
      out[b][f] = r1(median(per.map(p => p[f])));
      out[b][f + "N"] = per.filter(p => p[f] != null).length;
    }
    for (const f of ["snowLastH", "snowNextH"])
      out[b][f] = median(per.map(p => p[f])) == null ? null : Math.round(median(per.map(p => p[f])));
  }
  return out;
};
// strongest gust (wg_boe) over the stations and the past window, with its direction; first station wins a tie
const strongestGust = (hours, stations, now, h) =>
  stations.reduce((a, s) => {
    const e = extremeOf(hours, "wg_boe", s.id, now - h * H + 1, now, true);
    return e && (!a || e.y > a.y) ? { y: e.y, id: s.id, k: e.k, wr: hours[e.k]?.wr?.[s.id] ?? null } : a;
  }, null);
// weather-overlay animation: hours between keyframes per window (-24..+48; 0 = Now), keyframes ascending, on the ends grid, nowT always in, up to the named end nowT ± win (the step table keeps it to <= 9)
const nsStep = w => ({ 48: 6, 24: 3, 12: 2 })[Math.abs(w)] || 1;
const nsKeys = (ends, win, nowT) => {
  const s = nsStep(win) * 36e5,
    d = Math.sign(win),
    have = new Set(ends),
    out = [];
  for (let k = 0; k <= (Math.abs(win) * 36e5) / s; k++)
    if (have.has(nowT + d * k * s)) out.push(nowT + d * k * s);
    else break; // a gap ends the run (the range is contiguous); nowT missing -> []
  return out.sort((a, b) => a - b);
};
const lerp = (a, b, t) => (a == null ? b : b == null ? a : a + (b - a) * t);
if (typeof module !== "undefined")
  module.exports = {
    binSum,
    tierOf,
    groupByPixel,
    describeGroup,
    STEPS,
    band,
    hasWind,
    arrowOn,
    lambert,
    esc,
    viennaKey,
    keyMs,
    anchorMs,
    slice,
    WINDOWS,
    winOr,
    tickStepH,
    risePts,
    delta,
    latest,
    period,
    extreme,
    refroze,
    staleAfter,
    offlineAfter,
    valueState,
    misplaced,
    goodOnly,
    refreshStale,
    bandOf,
    BANDS,
    median,
    compass,
    sumField,
    riseOf,
    extremeOf,
    bandStats,
    strongestGust,
    nsKeys,
    nsStep,
    lerp,
  };
