const test = require("node:test");
const assert = require("node:assert/strict");
const { band, esc, hasWind, arrowOn, lambert } = require("../lib.js");

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
