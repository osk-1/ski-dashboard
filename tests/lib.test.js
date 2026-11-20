const test = require("node:test");
const assert = require("node:assert/strict");
const { band, esc, hasWind, arrowOn, lambert, viennaKey, keyMs, anchorMs, slice, latest, extreme, refroze } = require("../lib.js");

test("band: cm thresholds", () => {
  assert.equal(band(null), -1);
  assert.deepEqual([0, 9.9, 10, 25, 50, 100, 250].map(band), [0, 0, 1, 2, 3, 4, 4]);
});
test("esc escapes html", () => assert.equal(esc(`<a href="x">&`), "&lt;a href=&quot;x&quot;&gt;&amp;"));
test("wind helpers", () => {
  assert.equal(hasWind({ wr: 0, wg: 0 }), true);
  assert.equal(hasWind({ wr: null, wg: 3 }), false);
  assert.equal(arrowOn({ wr: 90, wg: 0.5 }), false);
  assert.equal(arrowOn({ wr: 90, wg: 1 }), true);
});
test("lambert: St. Anton", () => {
  const [x, y] = lambert(47.1295, 10.2636);
  assert.ok(Math.hypot(x - 167256.4, y - 363425.3) < 1);
});

test("vienna hour keys: winter, summer, DST gap", () => {
  assert.equal(viennaKey(Date.parse("2026-11-20T15:00:00Z")), "2026-11-20T16");
  assert.equal(keyMs("2026-11-20T16"), Date.parse("2026-11-20T15:00:00Z"));
  assert.equal(keyMs("2026-07-01T12"), Date.parse("2026-07-01T10:00:00Z"));
  assert.equal(keyMs("2026-03-29T02"), null); // skipped by the clock change
});
test("anchorMs: now, or the newest measured hour when older than 7 days", () => {
  const hours = { "2026-11-20T16": { lt: { A: 1 } }, "2026-11-20T20": { mt: { A: 2 } } }; // model hours don't count
  const t16 = keyMs("2026-11-20T16"), now = t16 + 3 * 3600e3;
  assert.equal(anchorMs(hours, now), now);
  assert.equal(anchorMs(hours, t16 + 8 * 24 * 3600e3), t16);
  assert.equal(anchorMs({}, now), now);
});
test("slice: one point per hour, gaps stay null", () => {
  const hours = { "2026-11-20T10": { lt: { A: -1 } }, "2026-11-20T12": { lt: { A: -3, B: 5 } } };
  const pts = slice(hours, "lt", "A", keyMs("2026-11-20T10") - 1800e3, keyMs("2026-11-20T12"));
  assert.deepEqual(pts.map(p => [p.k, p.y]), [["2026-11-20T10", -1], ["2026-11-20T11", null], ["2026-11-20T12", -3]]);
  assert.equal(pts[1].x - pts[0].x, 3600e3);
  assert.deepEqual(latest(hours, "lt", "A", keyMs("2026-11-20T11")), { k: "2026-11-20T10", y: -1 });
  assert.equal(latest(hours, "lt", "C", Date.now()), null);
});
const pts = vals => Object.entries(vals).map(([k, y]) => ({ k, y }));
test("extreme: latest night min and day max", () => {
  const p = pts({ "2026-11-19T12": 4, "2026-11-19T17": 1, "2026-11-19T18": 0, "2026-11-19T23": -2, "2026-11-20T03": -5, "2026-11-20T07": -1, "2026-11-20T08": 3, "2026-11-20T09": null });
  const n = extreme(p, true), d = extreme(p, false);
  assert.equal(n.date, "2026-11-19"); assert.deepEqual(n.at, { k: "2026-11-20T03", y: -5 }); assert.equal(n.pts.length, 4);
  assert.equal(d.date, "2026-11-20"); assert.equal(d.at.y, 3); assert.equal(d.of, 2); assert.equal(d.pts.length, 1);
  assert.equal(extreme(pts({ "2026-11-20T12": 1 }), true), null);
});
test("refroze: below 0 in every overnight hour with data", () => {
  assert.equal(refroze(pts({ "2026-11-19T20": -1, "2026-11-20T02": null, "2026-11-20T06": -0.1 })).ok, true);
  const r = refroze(pts({ "2026-11-19T20": -1, "2026-11-20T02": 0 }));
  assert.equal(r.ok, false); assert.equal(r.warm.k, "2026-11-20T02");
  assert.equal(refroze(pts({ "2026-11-20T10": -4, "2026-11-20T02": null })), null);
});
