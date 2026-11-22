const test = require("node:test");
const assert = require("node:assert/strict");
const { binSum, tierOf, groupByPixel, describeGroup, band, esc, hasWind, arrowOn, lambert, viennaKey, keyMs, anchorMs, slice, WINDOWS, winOr, tickStepH, risePts, delta, latest, extreme, refroze, valueState, misplaced, goodOnly, refreshStale, bandOf, BANDS, median, compass, sumField, riseOf, extremeOf, bandStats, strongestGust, nsKeys, nsStep, lerp } = require("../lib.js");

test("band: cm thresholds", () => {
  assert.equal(band(null), -1);
  assert.deepEqual([0, 9.9, 10, 25, 50, 100, 250].map(band), [0, 0, 1, 2, 3, 4, 4]);
});
test("esc escapes html", () => assert.equal(esc(`<a href="x">&`), "&lt;a href=&quot;x&quot;&gt;&amp;"));
test("esc escapes apostrophe", () => assert.equal(esc("a'b"), "a&#39;b"));
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
  assert.deepEqual(sumField(HR, "hr", "A", TK("10"), TK("13")), { v: 3, n: 3, of: 4 }); // 1 + max(0,-2) + (flagged 12 skipped) + 2
  assert.deepEqual(sumField(HR, "hr", "B", TK("10"), TK("13")), { v: 0, n: 0, of: 4 });
  assert.deepEqual(extremeOf(HR, "lt", "A", TK("10"), TK("13"), true), { x: TK("12"), y: 0, k: "2026-11-20T12" });
  assert.equal(extremeOf(HR, "lt", "A", TK("10"), TK("13"), false).y, -3);
  assert.equal(extremeOf(HR, "lt", "B", TK("10"), TK("13"), true), null);
  assert.equal(extremeOf(HR, "wg_boe", "A", TK("10"), TK("13"), true).y, 40); // 99 is flagged
});
test("riseOf: high-water mark of hs; jitter and settling add nothing, gaps keep the mark, flagged skipped", () => {
  const mk = (...v) => Object.fromEntries(v.map((y, i) => ["2026-11-20T" + String(10 + i), y == null ? {} : { hs: { A: y } }]));
  const r = (h, n) => riseOf(h, "A", TK("10"), TK(String(10 + n))).v;
  assert.equal(r(mk(50, 51, 50, 51, 50), 4), 1);
  assert.equal(r(mk(50, 55, 60), 2), 10);
  assert.equal(r(mk(50, 48, 55), 2), 5);
  assert.equal(r(mk(50, null, null, 58), 3), 8); // gap
  assert.equal(r(mk(50, 55, null, 54, 56), 4), 6); // mark 55 kept over the gap and the dip
  const f = mk(50, 70, 52); f["2026-11-20T11"].flags = { A: { hs: "x" } };
  assert.deepEqual(riseOf(f, "A", TK("10"), TK("12")), { v: 2, n: 2, of: 3 });
});
test("riseOf: 1 h window seeds from the boundary hour (now-h), so one reading gives its rise", () => {
  const h = { "2026-11-20T13": { hs: { A: 50 } }, "2026-11-20T14": { hs: { A: 52 } } };
  assert.deepEqual(riseOf(h, "A", TK("14"), TK("14")), { v: 2, n: 1, of: 1 });
});
test("riseOf: boundary hour missing or flagged falls back to the first in-window value", () => {
  const h = { "2026-11-20T14": { hs: { A: 52 } }, "2026-11-20T15": { hs: { A: 55 } } };
  assert.deepEqual(riseOf(h, "A", TK("14"), TK("15")), { v: 3, n: 2, of: 2 }); // no 13: mark starts at 52
  h["2026-11-20T13"] = { hs: { A: 50 }, flags: { A: { hs: "x" } } };
  assert.deepEqual(riseOf(h, "A", TK("14"), TK("15")), { v: 3, n: 2, of: 2 }); // flagged 13 ignored
  h["2026-11-20T13"] = { hs: { A: 60 } };
  assert.deepEqual(riseOf(h, "A", TK("14"), TK("15")), { v: 0, n: 2, of: 2 }); // unflagged 13 seeds: 52 and 55 are below 60
});
test("strongestGust: ties go to the first station, flagged skipped, empty null", () => {
  assert.deepEqual(strongestGust(HR, [{ id: "A" }, { id: "B" }], TK("13"), 4), { y: 40, id: "A", k: "2026-11-20T10", wr: 90 });
  assert.equal(strongestGust(HR, [{ id: "B" }, { id: "A" }], TK("13"), 4).id, "B");
  assert.equal(strongestGust(HR, [], TK("13"), 3), null);
  assert.equal(strongestGust(HR, [{ id: "Z" }], TK("13"), 3), null);
});
test("past window is (now-h, now]: h hours, not h+1", () => {
  const h = { "2026-11-20T12": { hs: { A: 10 } }, "2026-11-20T13": { hs: { A: 11 } }, "2026-11-20T14": { hs: { A: 15 }, wg_boe: { A: 9 } }, "2026-11-20T11": { wg_boe: { A: 50 } } };
  const r = bandStats([{ id: "A", alt: 1700 }], h, TK("14"), 1);
  assert.equal(r.mid.snowLast, 4); // 1 h window = hour 14 only; boundary 13 (hs 11) seeds the mark, 15 - 11 = 4
  assert.equal(bandStats([{ id: "A", alt: 1700 }], h, TK("14"), 2).mid.snowLast, 5); // 13, 14; boundary 12 (hs 10): 11 - 10 + 15 - 11 = 5
  assert.equal(bandStats([{ id: "A", alt: 1700 }], h, TK("14"), 3).mid.snowLast, 5);
  assert.equal(strongestGust(h, [{ id: "A" }], TK("14"), 3).y, 9); // 11 h is outside (14-3, 14]
});
test("bandStats: medians per band, per-metric counts, partial coverage, empty band", () => {
  const st = [{ id: "A", alt: 1700 }, { id: "B", alt: 1800 }, { id: "Z", alt: 2500 }];
  const H2 = structuredClone(HR); H2["2026-11-20T11"].hs = { A: 50 }; H2["2026-11-20T13"].hs = { A: 52 };
  const r = bandStats(st, H2, TK("13"), 3); // past (10, 13]: 11, 12 (flagged hr), 13; next (13, 16]: 14
  assert.deepEqual(r.mid, { n: 1, of: 3, snowLast: 2, snowNext: 1.5, tmin: -1, tmax: 0, snowLastN: 1, snowNextN: 1, tminN: 1, tmaxN: 1, snowLastH: 2, snowNextH: 1 }); // 2 of 3 hours measured, 1 of 3 forecast: partial
  assert.equal(r.valley.n, 0); assert.equal(r.valley.snowLast, null); assert.equal(r.high.n, 0);
  assert.equal(sumField(HR, "hr", "A", TK("10"), TK("13")).of, 4);
});
test("bandStats: even number of stations in a band -> median is the mean of the middle two", () => {
  const h = { "2026-11-20T13": { hs: { A: 50, B: 50 } }, "2026-11-20T14": { hs: { A: 51, B: 54 }, lt: { A: -1, B: -5 } } };
  const r = bandStats([{ id: "A", alt: 1700 }, { id: "B", alt: 1800 }], h, TK("14"), 1);
  assert.deepEqual([r.mid.snowLast, r.mid.snowLastN, r.mid.tmin, r.mid.tminN], [2.5, 2, -3, 2]); // (1 + 4) / 2, (-1 + -5) / 2
});
test("sumField / riseOf: the repeated 02:00 of the autumn DST change counts once (hour keys can repeat)", () => {
  const from = Date.UTC(2026, 9, 25, 0, 0), to = Date.UTC(2026, 9, 25, 2, 0); // 02:00 CEST, 02:00 CET, 03:00 CET
  assert.equal(viennaKey(from), viennaKey(from + 3600e3)); // two instants, one key
  const h = { "2026-10-25T02": { sm: { A: 2 } }, "2026-10-25T03": { sm: { A: 1 } } };
  assert.deepEqual(sumField(h, "sm", "A", from, to), { v: 3, n: 2, of: 2 });
});

test("viennaKey cache: one key per UTC hour, right across the autumn DST change, repeat calls agree", () => {
  const ms = ["2026-10-24T23:30:00Z", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "2026-10-25T02:30:00Z"].map(Date.parse), want = ["2026-10-25T01", "2026-10-25T02", "2026-10-25T02", "2026-10-25T03"];
  assert.deepEqual(ms.map(viennaKey), want);
  assert.deepEqual(ms.map(viennaKey), want); // cached
  assert.equal(viennaKey(ms[1] + 20 * 60e3), want[1]); // same UTC hour, other minute
});

test("binSum: Vienna-day and 3 h bins, null only when a bin has no value, extra fields summed", () => {
  const pts = [["2026-11-20T22", 1], ["2026-11-20T23", null], ["2026-11-21T00", 2], ["2026-11-21T01", 0.25], ["2026-11-21T02", null], ["2026-11-21T03", null]].map(([k, y]) => ({ x: keyMs(k), y, k, sm: y && y * 2 }));
  const d = binSum(pts, 24, ["sm"]);
  assert.deepEqual(d.map(b => [b.y, b.n, b.of, b.sm]), [[1, 1, 2, 2], [2.3, 2, 4, 4.5]]);
  assert.equal(d[0].x, keyMs("2026-11-20T12")); assert.equal(binSum(pts, 3)[1].x, keyMs("2026-11-21T00") + 1.5 * 3600e3);
  assert.deepEqual(binSum(pts, 3).map(b => [b.y, b.of]), [[1, 2], [2.3, 3], [null, 1]]);
});

const NS_H = 36e5, NOW = Date.UTC(2026, 0, 10, 12), ENDS = Array.from({ length: 24 + 48 + 1 }, (_, i) => NOW + (48 - i) * NS_H); // newest first, -24..+48
test("nsStep: step table", () => {
  assert.deepEqual([-24, -12, -6, -3, 0, 3, 6, 12, 24, 48].map(nsStep), [3, 2, 1, 1, 1, 1, 1, 2, 3, 6]);
});
test("nsKeys: <= 9 ascending, on the step grid, include nowT", () => {
  for (const w of [-24, -12, -6, -3, 3, 6, 12, 24, 48]) {
    const k = nsKeys(ENDS, w, NOW), s = nsStep(w) * NS_H;
    assert.ok(k.length <= 9 && k.includes(NOW) && k.includes(NOW + w * NS_H), `win ${w}`); // reaches the end the button names
    assert.deepEqual(k, [...k].sort((a, b) => a - b));
    assert.ok(k.every((t, i) => i === 0 || t - k[i - 1] === s) && k.every(t => (t - NOW) % s === 0 && (w < 0 ? t >= NOW + w * NS_H && t <= NOW : t >= NOW && t <= NOW + w * NS_H)), `win ${w}`);
  }
  assert.deepEqual(nsKeys(ENDS, 6, NOW), [0, 1, 2, 3, 4, 5, 6].map(i => NOW + i * NS_H));
  assert.deepEqual(nsKeys(ENDS, -12, NOW), [-12, -10, -8, -6, -4, -2, 0].map(i => NOW + i * NS_H));
  assert.deepEqual(nsKeys(ENDS, 48, NOW), [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => NOW + i * 6 * NS_H));
  assert.deepEqual(nsKeys(ENDS, -24, NOW), [-8, -7, -6, -5, -4, -3, -2, -1, 0].map(i => NOW + i * 3 * NS_H));
});
test("nsKeys: Now, and clipped to the available range", () => {
  assert.deepEqual(nsKeys(ENDS, 0, NOW), [NOW]);
  assert.deepEqual(nsKeys(ENDS.filter(t => t <= NOW), 48, NOW), [NOW]); // snow height: no forecast
  assert.deepEqual(nsKeys(ENDS.filter(t => t <= NOW), 3, NOW), [NOW]);
  assert.deepEqual(nsKeys(ENDS.filter(t => t !== NOW), 6, NOW), []); // nowT off the grid or outside the range: no keyframes (app falls back to the single nowT frame)
  assert.deepEqual(nsKeys(ENDS.filter(t => t >= NOW - 2 * NS_H), -6, NOW), [-2, -1, 0].map(i => NOW + i * NS_H));
});
test("lerp: ends, middle, null-safe", () => {
  assert.equal(lerp(2, 6, 0), 2); assert.equal(lerp(2, 6, 0.5), 4); assert.equal(lerp(2, 6, 1), 6);
  assert.equal(lerp(null, 6, 0.5), 6); assert.equal(lerp(2, null, 0.5), 2); assert.equal(lerp(null, null, 0.5), null);
});
