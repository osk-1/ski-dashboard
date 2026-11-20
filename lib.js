// Pure helpers (no DOM), shared by app.js in the browser and by node --test.
const STEPS = [10, 25, 50, 100]; // cm bands for the sequential scale
const band = hs => hs == null ? -1 : STEPS.filter(s => hs >= s).length;
const hasWind = s => s.wr != null && s.wg != null;
const arrowOn = s => hasWind(s) && s.wg >= 1; // no direction arrow in calm air
// Austria Lambert (EPSG:31287, Bessel 1841) for the new-snow images, applied straight to WGS84: the ~100 m datum shift is far below their 500 m pixels
const lambert = (() => { const r = Math.PI / 180, a = 6377397.155, f = 1 / 299.1528128, e = Math.sqrt(2 * f - f * f), m = p => Math.cos(p) / Math.sqrt(1 - (e * Math.sin(p)) ** 2), t = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = Math.log(m(49 * r) / m(46 * r)) / Math.log(t(49 * r) / t(46 * r)), F = m(49 * r) / (n * t(49 * r) ** n), r0 = a * F * t(47.5 * r) ** n;
  return (lat, lon) => { const q = a * F * t(lat * r) ** n, g = n * (lon - 13 - 1 / 3) * r; return [400000 + q * Math.sin(g), 400000 + r0 - q * Math.cos(g)]; }; })();
console.assert(Math.hypot(...lambert(47.1295, 10.2636).map((v, i) => v - [167256.4, 363425.3][i])) < 1, "lambert");
// Hourly series (data/hourly.json): hour keys are Vienna local "YYYY-MM-DDTHH"
const H = 3600e3, MEASURED = ["lt", "oft", "rh", "hs", "hr", "pr", "wg", "wg_boe", "wr"];
const VK = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
const viennaKey = ms => { const p = Object.fromEntries(VK.formatToParts(ms).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}`; };
// the UTC instant of a key: Vienna is UTC+1 or +2 (a key skipped by the spring DST change -> null)
const keyMs = k => { const t = Date.UTC(+k.slice(0, 4), k.slice(5, 7) - 1, +k.slice(8, 10), +k.slice(11, 13)); return [t - H, t - 2 * H].find(x => viennaKey(x) === k) ?? null; };
// "now" for the window: real time, or the newest measured hour when that is more than 7 days old (dead feed, test fixtures)
const anchorMs = (hours, now) => {
  const k = Object.keys(hours).sort().reverse().find(k => MEASURED.some(f => hours[k][f] && Object.keys(hours[k][f]).length));
  const t = k && keyMs(k);
  return t != null && now - t > 7 * 24 * H ? t : now;
};
// one point per hour in [from, to], y null where nothing was recorded (a gap, never filled)
const slice = (hours, field, id, from, to) => {
  const out = [];
  for (let t = Math.ceil(from / H) * H; t <= to; t += H) { const k = viennaKey(t); out.push({ x: t, y: hours[k]?.[field]?.[id] ?? null, k }); }
  return out;
};
// newest recorded value of a field at or before `to`
const latest = (hours, field, id, to) => { const lim = viennaKey(to), k = Object.keys(hours).sort().reverse().find(k => k <= lim && hours[k][field]?.[id] != null); return k ? { k, y: hours[k][field][id] } : null; };
// latest night (18:00-08:00) or day (08:00-18:00) among the points that has data: { pts with data, hours of it in the points }
const period = (pts, night) => {
  const prev = k => new Date(Date.UTC(+k.slice(0, 4), k.slice(5, 7) - 1, +k.slice(8, 10) - 1)).toISOString().slice(0, 10);
  const grp = k => { const h = +k.slice(11, 13); return night ? (h >= 18 ? k.slice(0, 10) : h < 8 ? prev(k) : null) : (h >= 8 && h < 18 ? k.slice(0, 10) : null); };
  const g = [...pts].reverse().find(p => p.y != null && grp(p.k) != null);
  if (!g) return null;
  const all = pts.filter(p => grp(p.k) === grp(g.k));
  return { date: grp(g.k), pts: all.filter(p => p.y != null), of: all.length };
};
const extreme = (pts, night) => { const p = period(pts, night); return p && { ...p, at: p.pts.reduce((a, b) => (night ? b.y < a.y : b.y > a.y) ? b : a) }; };
// surface refroze: below 0 °C in every overnight hour with data; null = no overnight data
const refroze = oft => { const p = period(oft, true); return p && { ...p, ok: p.pts.every(x => x.y < 0), warm: p.pts.find(x => x.y >= 0) }; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
if (typeof module !== "undefined") module.exports = { STEPS, band, hasWind, arrowOn, lambert, esc, viennaKey, keyMs, anchorMs, slice, latest, period, extreme, refroze };
