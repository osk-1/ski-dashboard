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
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
if (typeof module !== "undefined") module.exports = { STEPS, band, hasWind, arrowOn, lambert, esc };
