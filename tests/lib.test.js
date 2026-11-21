const test = require("node:test");
const assert = require("node:assert/strict");
const { tierOf, groupByPixel, describeGroup, band, esc, hasWind, arrowOn, lambert, viennaKey, keyMs, anchorMs, slice, WINDOWS, winOr, tickStepH, risePts, delta, latest, extreme, refroze, valueState, misplaced, goodOnly, refreshStale, bandOf, BANDS, median, compass, sumField, extremeOf, bandStats, strongestGust } = require("../lib.js");

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

const T = iso => Date.parse(iso);
test("valueState: ok, missing, stale per field, suspect, offline; dates[field] wins", () => {
  const now = T("2026-11-20T16:35:00+01:00");
  const s = { date: "2026-11-20T13:35:00+01:00", hs: 30, wg: 12, lt: -2, wr: null, flags: {}, dates: {} }; // 3 h old
  assert.deepEqual(valueState(s, "hs", now), { ok: true }); // hs is stale only after 6 h
  assert.deepEqual(valueState(s, "wg", now), { stale: true, last: T(s.date) }); // wind after 1 h
  assert.deepEqual(valueState(s, "lt", now), { stale: true, last: T(s.date) }); // air temp after 2 h
  assert.deepEqual(valueState(s, "wr", now), { missing: true });
  assert.deepEqual(valueState({ ...s, dates: { wg: "2026-11-20T16:20:00+01:00" } }, "wg", now), { ok: true });
  const fresh = { ...s, date: "2026-11-20T16:20:00+01:00", flags: { wg: "sensor frozen?" } };
  assert.deepEqual(valueState(fresh, "wg", now), { suspect: true, reason: "sensor frozen?" });
  assert.deepEqual(valueState({ ...s, date: "2026-11-19T15:40:00+01:00" }, "hs", now), { offline: true, last: T("2026-11-19T15:40:00+01:00") });
  assert.equal(valueState({ ...s, date: undefined }, "hs", now).offline, true);
  // derived new snow / change follow hs: stale, suspect or offline hs makes them so too
  assert.deepEqual(valueState({ ...fresh, hsd24: 5, flags: { hs: "jump" } }, "hsd24", now), { suspect: true, reason: "jump" });
  assert.deepEqual(valueState({ ...s, date: "2026-11-20T09:35:00+01:00", n24: 4 }, "n24", now), { stale: true, last: T("2026-11-20T09:35:00+01:00") });
  assert.deepEqual(valueState({ ...fresh, hsd24: 5 }, "hsd24", now), { ok: true });
});
test("goodOnly nulls every value that is not ok; misplaced", () => {
  const now = T("2026-11-20T16:35:00+01:00");
  const g = goodOnly({ date: "2026-11-20T16:20:00+01:00", hs: 30, wg: 0, wg_boe: 0, wr: 90, flags: { wg: "sensor frozen?", wr: "sensor frozen?" } }, now);
  assert.equal(g.hs, 30); assert.equal(g.wg, null); assert.equal(g.wr, null); assert.equal(g.wg_boe, 0);
  assert.deepEqual(Object.keys(g.bad), ["wg", "wr"]);
  assert.equal(misplaced({ flags: { station: "location mismatch" } }), true);
  assert.equal(misplaced({ flags: {} }), false);
});
test("refreshStale: day window 75 min, night window from 19:00 of that evening", () => {
  const at = k => keyMs(k);
  assert.equal(refreshStale("2026-11-20T15:21:00+01:00", at("2026-11-20T16") + 35 * 60e3), false); // 74 min
  assert.equal(refreshStale("2026-11-20T15:19:00+01:00", at("2026-11-20T16") + 35 * 60e3), true); // 76 min
  assert.equal(refreshStale("2026-11-20T19:40:00+01:00", at("2026-11-21T06")), false); // night: last run 19:40 is enough
  assert.equal(refreshStale("2026-11-20T18:50:00+01:00", at("2026-11-20T23")), true); // before 19:00 that evening
  assert.equal(refreshStale("2026-11-20T19:05:00+01:00", at("2026-11-20T22")), false);
  assert.equal(refreshStale("2026-11-19T19:30:00+01:00", at("2026-11-21T02")), true); // the night before's run
  assert.equal(refreshStale("2026-11-20T19:30:00+01:00", at("2026-11-21T07")), true); // 07:00: day rule again
  assert.equal(refreshStale(undefined, at("2026-11-21T07")), true);
});

test("tierOf: thresholds relative to fitZ", () => {
  assert.deepEqual([12, 12.75, 13, 13.75, 14, 16].map(z => tierOf(z, 12)), [0, 0, 1, 1, 2, 2]);
  assert.equal(tierOf(11, 12), 0);
});
test("groupByPixel: within / outside 28 px, chain, keep, empty", () => {
  const P = (id, x, y, rank = 0) => ({ id, x, y, rank });
  assert.deepEqual(groupByPixel([P("a", 0, 0), P("b", 28, 0)]), [["a", "b"]]);
  assert.deepEqual(groupByPixel([P("a", 0, 0), P("b", 29, 0)]), [["a"], ["b"]]);
  // chain: c is 40 px from the seed a, so it is not pulled in through b
  assert.deepEqual(groupByPixel([P("a", 0, 0, 3), P("b", 20, 0, 2), P("c", 40, 0, 1)]), [["a", "b"], ["c"]]);
  assert.deepEqual(groupByPixel([P("a", 0, 0, 3), P("k", 5, 0, 2), P("b", 10, 0, 1)], 28, "k"), [["a", "b"], ["k"]]);
  assert.deepEqual(groupByPixel([P("k", 0, 0, 9), P("a", 5, 0, 1)], 28, "k"), [["k"], ["a"]]);
  assert.deepEqual(groupByPixel([]), []);
});
test("describeGroup: snow+wind, two snow, snow+wind+snow, single", () => {
  const S = (id, type, hs) => ({ id, type, hs });
  assert.deepEqual(describeGroup([S("w", "wind"), S("s", "snow", 40)]), { lead: S("s", "snow", 40), wind: S("w", "wind"), count: 1 });
  assert.deepEqual(describeGroup([S("a", "snow", 10), S("b", "snow", 90)]), { lead: S("b", "snow", 90), wind: null, count: 2 });
  assert.deepEqual(describeGroup([S("a", "snow", 10), S("w", "wind"), S("b", "snow", 90)]), { lead: S("b", "snow", 90), wind: null, count: 3 });
  assert.deepEqual(describeGroup([S("w", "wind")]), { lead: S("w", "wind"), wind: null, count: 1 });
});

test("winOr / tickStepH", () => {
  assert.equal(winOr(72, 24), 72); assert.equal(winOr(5, 24), 24); assert.equal(winOr(NaN, 24), 24);
  assert.deepEqual(WINDOWS.map(tickStepH), [undefined, 2, 4, 12, 24, 24, 24]);
});
test("risePts: never negative, gaps stay null", () => {
  const h = { "2026-11-20T10": { hr: { A: -0.4 } }, "2026-11-20T11": { hr: { A: 1.5 } }, "2026-11-20T13": { hr: { A: 0 } } };
  const ys = risePts(h, "A", keyMs("2026-11-20T10"), keyMs("2026-11-20T13")).map(p => p.y);
  assert.deepEqual(ys, [0, 1.5, null, 0]);
});
test("delta: change over backH, null when either end is missing", () => {
  const h = { "2026-11-20T10": { hs: { A: 50.2 } }, "2026-11-20T11": { hs: { A: 51 } }, "2026-11-20T12": {}, "2026-11-20T13": { hs: { A: 53.1 } } };
  assert.deepEqual(delta(h, "hs", "A", keyMs("2026-11-20T13"), 3), { now: 53.1, then: 50.2, d: 2.9 });
  assert.deepEqual(delta(h, "hs", "A", keyMs("2026-11-20T12"), 2), { now: 51, then: 50.2, d: 0.8 }); // gap hour falls back to the latest value
  assert.equal(delta(h, "hs", "A", keyMs("2026-11-20T13"), 6), null);
  assert.equal(delta(h, "hs", "A", keyMs("2026-11-20T20"), 1), null); // newest value 7 h old: both ends are the same hour, not a 0 change
  assert.equal(delta(h, "hs", "B", keyMs("2026-11-20T13"), 1), null);
});

test("bandOf / BANDS", () => {
  assert.deepEqual([1599, 1600, 2200, 2201].map(bandOf), ["valley", "mid", "mid", "high"]);
  assert.equal(BANDS.length, 3);
});
test("median / compass", () => {
  assert.equal(median([]), null); assert.equal(median([null]), null); assert.equal(median([3, null, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.deepEqual([0, 44, 90, 350].map(compass), ["N", "NE", "E", "N"]);
});
const HR = { "2026-11-20T10": { hr: { A: 1 }, lt: { A: -3 }, wg_boe: { A: 40, B: 40 }, wr: { A: 90, B: 180 } }, "2026-11-20T11": { hr: { A: -2 }, lt: { A: -1 }, wg_boe: { A: 30 } },
  "2026-11-20T12": { hr: { A: 4 }, lt: { A: 0 }, wg_boe: { A: 99 }, flags: { A: { hr: "x", wg_boe: "x" } } }, "2026-11-20T13": { hr: { A: 2 }, sm: { A: 5 }, hs: { A: 1 } }, "2026-11-20T14": { sm: { A: 1.5 }, hs: { A: 1 } } };
const TK = h => keyMs("2026-11-20T" + h);
test("sumField / extremeOf: flagged and null hours skipped, hr never negative", () => {
  assert.deepEqual(sumField(HR, "hr", "A", TK("10"), TK("13")), { v: 3, n: 3 }); // 1 + max(0,-2) + (flagged 12 skipped) + 2
  assert.deepEqual(sumField(HR, "hr", "B", TK("10"), TK("13")), { v: 0, n: 0 });
  assert.deepEqual(extremeOf(HR, "lt", "A", TK("10"), TK("13"), true), { x: TK("12"), y: 0, k: "2026-11-20T12" });
  assert.equal(extremeOf(HR, "lt", "A", TK("10"), TK("13"), false).y, -3);
  assert.equal(extremeOf(HR, "lt", "B", TK("10"), TK("13"), true), null);
  assert.equal(extremeOf(HR, "wg_boe", "A", TK("10"), TK("13"), true).y, 40); // 99 is flagged
});
test("strongestGust: ties go to the first station, flagged skipped, empty null", () => {
  assert.deepEqual(strongestGust(HR, [{ id: "A" }, { id: "B" }], TK("13"), 3), { y: 40, id: "A", k: "2026-11-20T10", wr: 90 });
  assert.equal(strongestGust(HR, [{ id: "B" }, { id: "A" }], TK("13"), 3).id, "B");
  assert.equal(strongestGust(HR, [], TK("13"), 3), null);
  assert.equal(strongestGust(HR, [{ id: "Z" }], TK("13"), 3), null);
});
test("bandStats: medians per band, metrics without data are null, empty band n=0", () => {
  const st = [{ id: "A", alt: 1700 }, { id: "B", alt: 1800 }, { id: "Z", alt: 2500 }];
  const r = bandStats(st, HR, TK("13"), 3);
  assert.deepEqual(r.mid, { n: 1, snowLast: 3, snowNext: 1.5, tmin: -3, tmax: 0 }); // B has no data; next = hours after now only (14 h)
  assert.deepEqual(r.valley, { n: 0, snowLast: null, snowNext: null, tmin: null, tmax: null });
  assert.equal(r.high.n, 0);
});
