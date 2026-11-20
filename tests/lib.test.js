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
const hrs = (field, vals) => Object.fromEntries(Object.entries(vals).map(([k, y]) => [k, { [field]: { A: y } }]));
const fullNight = (f = (i) => -i) => { // 2026-11-19T18 ... 2026-11-20T07, values f(0..13)
  const o = {}; for (let i = 0; i < 14; i++) o[viennaKey(keyMs("2026-11-19T18") + i * 3600e3)] = f(i); return o;
};
test("period: last complete night and day at 19:00", () => {
  const h = hrs("lt", { ...fullNight(), "2026-11-20T08": 1, "2026-11-20T12": 5, "2026-11-20T17": 2, "2026-11-20T18": -9 });
  const now = keyMs("2026-11-20T19");
  const n = extreme(h, "lt", "A", now, true), d = extreme(h, "lt", "A", now, false);
  assert.equal(n.date, "2026-11-19"); assert.equal(n.of, 14); assert.equal(n.pts.length, 14); assert.deepEqual(n.at, { x: keyMs("2026-11-20T07"), y: -13, k: "2026-11-20T07" }); // tonight's -9 is not counted
  assert.equal(d.date, "2026-11-20"); assert.equal(d.of, 10); assert.equal(d.pts.length, 3); assert.equal(d.at.y, 5);
  assert.equal(extreme(h, "lt", "A", keyMs("2026-11-20T17"), false), null); // today's day not over yet -> yesterday, which has no data
});
test("period: 10:00 with a short window still uses the full last night", () => {
  const n = extreme(hrs("lt", fullNight()), "lt", "A", keyMs("2026-11-20T10"), true);
  assert.equal(n.of, 14); assert.equal(n.pts.length, 14); assert.equal(n.date, "2026-11-19");
});
test("period: DST nights are 13 / 15 h long", () => {
  assert.equal(extreme(hrs("lt", { "2026-03-29T05": 1 }), "lt", "A", keyMs("2026-03-29T12"), true).of, 13);
  assert.equal(extreme(hrs("lt", { "2026-10-25T05": 1 }), "lt", "A", keyMs("2026-10-25T12"), true).of, 15);
});
test("refroze: below 0 in every overnight hour with data, partial data counted", () => {
  const now = keyMs("2026-11-20T10");
  const r = refroze(hrs("oft", { "2026-11-19T20": -1, "2026-11-20T02": null, "2026-11-20T06": -0.1 }), "A", now);
  assert.equal(r.ok, true); assert.equal(`${r.pts.length} of ${r.of} h`, "2 of 14 h");
  const w = refroze(hrs("oft", { "2026-11-19T20": -1, "2026-11-20T02": 0 }), "A", now);
  assert.equal(w.ok, false); assert.equal(w.warm.k, "2026-11-20T02");
  assert.equal(refroze(hrs("oft", { "2026-11-20T09": -4, "2026-11-19T17": -2 }), "A", now), null); // nothing inside 18-08
});
