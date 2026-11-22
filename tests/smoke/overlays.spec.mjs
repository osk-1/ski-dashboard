/* global map, L, document, window, Image, nsImg, requestAnimationFrame -- page globals inside page.evaluate */
import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { DESKTOP, open, VIEWPORTS } from "./helpers.mjs";

// tiny grey PNG: rows of R values (R = G = B)
const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]), o = Buffer.alloc(4); o.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([o, b, c]); };
const png = (rows) => { const W = rows[0].length, ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(rows.length, 4); ih.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(Buffer.concat(rows.map((r) => Buffer.from([0, ...r.flatMap((v) => [v, v, v])]))))), chunk("IEND", Buffer.alloc(0))]); };

const BASE = "https://static.avalanche.report/zamg_meteo/overlays";
const TS = "2026-11-21T19:00:00+00:00";
const LAMBERT = { validity: ["2020-01-01T00:00:00Z", "2100-01-01T00:00:00Z"], lambert: [20500, 190500, 719500, 619500] };
const LATLON = { validity: ["2020-01-01T00:00:00Z", "2100-01-01T00:00:00Z"], bbox: [9.4, 45.6167, 13.0333, 47.8167] };
const FC = "2026-11-23T19:00:00+00:00";
const cfg = (k, units, thresholds, box, ranges = [1], fc = FC) => ({ parameter: k, units, thresholds, boundingBoxes: [box],
  timeRanges: ranges.map((h) => ({ timeRange: h, timeStepHours: h === 1 ? 1 : 6, initialTimestamp: TS, maxAnalysisTimestamp: TS, maxForecastTimestamp: h === 1 ? fc : TS,
    imageOverlayURL: `${BASE}/${k}/$year/$date/$date_$hour-00_${k}.gif`, dataOverlayURL: `${BASE}/${k}/$year/$date/$date_$hour-00_${k}.png` })) });
const th = () => [{ range: [null, -10], color: "#0481ff" }, { range: [-10, -5], color: "#03cdff" }, { range: [-5, 5], color: "#8cffff" }, { range: [5, null], color: "#ff0505" }];
const CFG = {
  "new-snow": cfg("new-snow", "cm", th(), LAMBERT, [6, 24]),
  temp: cfg("temp", "°C", th(), LAMBERT),
  wind: cfg("wind", "km/h", th(), LAMBERT),
  gust: cfg("gust", "km/h", th(), LATLON),
  "snow-height": cfg("snow-height", "cm", th(), LAMBERT, [1], TS), // analysis only
};
// pixel values: temp R = 110 -> −5 °C, wind 30, snow 99; gust is a 40x40 image with an opaque-looking border (R = 200) around a block of 50 that covers lat/lon 47.13, 10.26
const GUST = Array.from({ length: 40 }, (_, r) => Array.from({ length: 40 }, (_, c) => (c >= 4 && c < 16 && r >= 6 && r < 20 ? 50 : 200)));
const DATA = { "new-snow": [[12, 12], [12, 12]], temp: [[110, 110], [110, 110]], wind: [[30, 30], [30, 30]], gust: GUST, "snow-height": [[99, 99], [99, 99]] };

const setup = (fail = []) => async (page) => {
  await page.route(`${BASE}/**`, (route) => {
    const u = new URL(route.request().url()), k = u.pathname.split("/")[3], h = { "access-control-allow-origin": "*" };
    if (fail.includes(k)) return route.fulfill({ status: 404, headers: h, body: "" });
    if (u.pathname.endsWith("config.json")) return route.fulfill({ contentType: "application/json", headers: h, body: JSON.stringify(CFG[k]) });
    const dh = (Number(u.pathname.match(/_(\d\d)-00_/)?.[1] ?? 19) - 19 + 24) % 24; // temp differs per hour (R + hours after 19:00) so lerped values change
    return route.fulfill({ contentType: "image/png", headers: h, body: png(k === "temp" ? DATA[k].map((r) => r.map((v) => v + dh)) : DATA[k]) }); // a PNG also serves as the "gif"
  });
};
const openPanel = async (page) => { await page.getByRole("button", { name: "Map layers" }).click(); await expect(page.locator("#lp")).toBeVisible(); };
const KEY = { None: "", "New snow": "new-snow", Temperature: "temp", Wind: "wind", Gust: "gust", "Snow depth": "snow-height" };
const radio = (page, name) => page.locator(`#lp input[data-wx="${KEY[name]}"]`);
const click = (page, lat, lng) => page.evaluate(([a, b]) => map.fire("click", { latlng: L.latLng(a, b) }), [lat, lng]);
const pin = (page) => page.locator("#map .leaflet-tooltip.val", { has: page.locator("b") }).last();

test("exclusive selection, legend, period, until", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await openPanel(page);
  await expect(page.locator('#lp input[name="wx"]')).toHaveCount(6); // None + 5
  await radio(page, "Temperature").check();
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  await expect(page.locator("#legend .ls.ns")).toContainText("Temperature");
  await expect(page.locator("#legend .ls.ns")).toContainText("−5–5"); // a real minus sign
  await expect(page.locator("#legend .ls.ns")).toContainText("−10–−5"); // ...in both numbers
  await expect(page.locator("#legend .ls.ns")).toContainText("°C");
  await expect(page.locator('#lp [data-ns="h"]')).toHaveCount(0); // hourly: no period
  await expect(page.locator('#lp [data-ns="t"]')).toHaveCount(0); // hourly: window buttons, no until
  await expect(page.locator('#lp [data-ns="w-24"]')).toBeEnabled(); // 24 h back...
  await expect(page.locator('#lp [data-ns="w0"]')).toHaveAttribute("aria-pressed", "true"); // ...Now by default
  await radio(page, "Wind").check();
  await expect(page.locator('#lp input[name="wx"]:checked')).toHaveCount(1);
  await expect(radio(page, "Wind")).toBeChecked();
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  await expect(page.locator("#legend .ls.ns")).toContainText("km/h");
  await radio(page, "New snow").check();
  await expect(page.locator('#lp [data-ns="h"]')).toHaveCount(1);
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  await radio(page, "Snow depth").check();
  await expect(page.locator('#lp [data-ns="w3"]')).toHaveAttribute("aria-disabled", "true"); // analysis only
  await expect(page.locator('#lp [data-ns="w-3"]')).toBeEnabled();
  // the danger checkbox is independent of the radio group
  const danger = page.locator("#lp label", { hasText: "Avalanche danger" }).locator("input");
  const was = await danger.isChecked();
  await danger.setChecked(!was);
  await expect(radio(page, "Snow depth")).toBeChecked();
  await radio(page, "None").check();
  await expect(danger).toBeChecked({ checked: !was });
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("click values", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await openPanel(page);
  for (const [name, want] of [["Temperature", "−5 °C"], ["Wind", "30 km/h"], ["Gust", "50 km/h"], ["Snow depth", "99 cm"]]) {
    await radio(page, name).check();
    await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
    await click(page, 47.13, 10.26);
    await expect(pin(page)).toHaveText(want);
  }
  expect(problems).toEqual([]);
});

const gustPixels = (page) => page.evaluate(() => new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, im.width, im.height).data; let a = 0, b = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) a++; else if (d[i] === 50) b++; } ok([a, b]); }; im.src = document.querySelector(".leaflet-image-layer").src; }));

test("gust border is cleared, inner values kept", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await openPanel(page);
  await radio(page, "Gust").check();
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  const [clear, kept] = await gustPixels(page);
  expect(clear).toBeGreaterThan(0); // the border colour (R = 200) is gone...
  expect(kept).toBeGreaterThan(0); // ...the block inside stays
  expect(problems).toEqual([]);
});

test("switching away while an image loads does not poison its cache", async ({ browser }) => {
  let release; const held = new Promise((r) => { release = r; });
  const base = setup();
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: async (pg) => { await base(pg); await pg.route(`${BASE}/gust/**/*.gif`, async (route) => { await held; await route.fallback(); }); } });
  await openPanel(page);
  await radio(page, "Gust").check(); // its image is held...
  await radio(page, "Wind").check(); // ...while the selection moves to a Lambert overlay
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  release();
  await page.evaluate(() => Promise.allSettled(Object.values(nsImg))); // the held gust image finishes drawing, unseen
  await radio(page, "Gust").check();
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  const [clear, kept] = await gustPixels(page);
  expect(clear).toBeGreaterThan(0);
  expect(kept).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});

test("saved settings", async ({ browser }) => {
  let o = await open(browser, DESKTOP, "light", { desktop: true, setup: setup(), storage: { layers: JSON.stringify({ on: { newsnow: true } }) } });
  await openPanel(o.page);
  await expect(radio(o.page, "New snow")).toBeChecked();
  await o.page.locator("#lp input[data-cat=peaks]").click(); // any change saves
  expect(await o.page.evaluate(() => { const j = JSON.parse(localStorage.getItem("layers")); return [j.wx, j.on.newsnow]; })).toEqual(["new-snow", undefined]);
  expect(o.problems).toEqual([]);
  o = await open(browser, DESKTOP, "light", { desktop: true, setup: setup(), storage: { layers: JSON.stringify({ wx: "bogus" }) } });
  await openPanel(o.page);
  await expect(radio(o.page, "None")).toBeChecked();
  expect(o.problems.filter((p) => !p.includes("Failed to load resource"))).toEqual([]);
});

test("one overlay unavailable", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup(["gust"]) });
  await openPanel(page);
  await radio(page, "Gust").check();
  await expect(page.locator('#lp [data-n="gust"]')).toHaveText("unavailable");
  await expect(page.locator('#lp small[data-n]:not(:empty)')).toHaveCount(1);
  await radio(page, "Wind").check();
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  await radio(page, "Gust").check(); // retry
  await expect(page.locator('#lp [data-n="gust"]')).toHaveText("unavailable");
  let tries = 0; await page.route(`${BASE}/gust/config.json`, (r) => { tries++; return r.fulfill({ status: 404, body: "" }); });
  await radio(page, "Gust").click(); // already selected: clicking it again retries too
  await expect.poll(() => tries).toBe(1);
  expect(problems.filter((p) => !p.includes("Failed to load resource"))).toEqual([]);
});

for (const vp of [DESKTOP, ...VIEWPORTS]) for (const scheme of ["light", "dark"]) {
  test(`every overlay at ${vp.name}px, ${scheme}`, async ({ browser }) => {
    const { page, problems } = await open(browser, vp, scheme, { desktop: vp === DESKTOP, setup: setup() });
    await openPanel(page);
    for (const n of ["New snow", "Temperature", "Wind", "Gust", "Snow depth"]) { await radio(page, n).check(); await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); // no horizontal scroll
    expect(problems).toEqual([]);
  });
}

const ops = (page) => page.evaluate(() => [...document.querySelectorAll("#map .leaflet-image-layer")].map((e) => +e.style.opacity));
// distinct opacity readings so far, polled (no sleeps)
const seen = async (page, n) => { const all = new Set(); await expect.poll(async () => { (await ops(page)).forEach((o) => all.add(o.toFixed(3))); return all.size; }, { timeout: 15000 }).toBeGreaterThanOrEqual(n); return all; };

test("+6 animates: several frames load, opacity changes", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  const gifs = new Set(); page.on("request", (r) => { if (/temp\/.*\.gif/.test(r.url())) gifs.add(r.url()); });
  await openPanel(page);
  await radio(page, "Temperature").check();
  await page.locator('#lp [data-ns="w6"]').click();
  await expect(page.locator('#lp [data-ns="w6"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('#lp [data-ns="p"]')).toHaveAttribute("aria-label", "Pause");
  await expect(page.locator("#lp .nsp small")).toContainText(/every \d+ h/);
  await expect.poll(() => gifs.size, { timeout: 15000 }).toBeGreaterThan(2);
  await seen(page, 3);
  expect(problems).toEqual([]);
});

test("Now stays static", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await openPanel(page);
  await radio(page, "Temperature").check();
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  await expect(page.locator('#lp [data-ns="p"]')).toHaveCount(0);
  const before = await ops(page);
  expect(before).toEqual([.55]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))); // a few frames
  expect(await ops(page)).toEqual([.55]);
  expect(problems).toEqual([]);
});

test("Snow depth disables the + buttons", async ({ browser }) => {
  const { page } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await openPanel(page);
  await radio(page, "Snow depth").check();
  for (const h of [3, 6, 12, 24, 48]) await expect(page.locator(`#lp [data-ns="w${h}"]`)).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#lp .nsn")).toHaveText("No forecast for this layer"); // visible, not only a hover title
  await page.locator('#lp [data-ns="w6"]').click({ force: true }); // a click on a disabled window does nothing
  await expect(page.locator('#lp [data-ns="w0"]')).toHaveAttribute("aria-pressed", "true");
});

test("a clicked pin's value changes while animating", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await openPanel(page);
  await radio(page, "Temperature").check();
  await page.locator('#lp [data-ns="w6"]').click();
  await expect(page.locator("#map .leaflet-image-layer").first()).toBeAttached();
  await click(page, 47.13, 10.26);
  await expect(pin(page)).toBeVisible({ timeout: 15000 });
  const texts = new Set();
  await expect.poll(async () => { texts.add(await pin(page).innerText()); return texts.size; }, { timeout: 15000 }).toBeGreaterThan(1);
  expect(problems).toEqual([]);
});

test("reduced motion starts paused", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, reducedMotion: "reduce", setup: setup() });
  await openPanel(page);
  await radio(page, "Temperature").check();
  await page.locator('#lp [data-ns="w6"]').click();
  await expect(page.locator('#lp [data-ns="p"]')).toHaveAttribute("aria-label", "Play");
  await expect(page.locator("#map .leaflet-image-layer").first()).toBeAttached();
  const before = await ops(page);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  expect(await ops(page)).toEqual(before);
  await page.locator('#lp [data-ns="p"]').click(); // play works
  await expect(page.locator('#lp [data-ns="p"]')).toHaveAttribute("aria-label", "Pause");
  await seen(page, 2);
  expect(problems).toEqual([]);
});

// all hourly images of a window fail -> the layer says unavailable; one failing frame is skipped and the loop keeps running
const failGifs = (page, hours) => page.route(`${BASE}/temp/**/*.gif`, (r) => r.request().url().match(/_(\d\d)-00_/) && (hours === "all" || hours.includes(r.request().url().match(/_(\d\d)-00_/)[1])) ? r.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" }) : r.fallback());

test("a failing keyframe is skipped, the animation keeps going", async ({ browser }) => {
  const { page } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await failGifs(page, ["22"]);
  await openPanel(page);
  await radio(page, "Temperature").check();
  await page.locator('#lp [data-ns="w6"]').click();
  await seen(page, 3);
  await expect(page.locator('#lp [data-n="temp"]')).toHaveText("");
});

test("every keyframe failing shows unavailable", async ({ browser }) => {
  const { page } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  await failGifs(page, "all");
  await openPanel(page);
  await radio(page, "Temperature").check();
  await page.locator('#lp [data-ns="w6"]').click();
  await expect(page.locator('#lp [data-n="temp"]')).toHaveText("unavailable");
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(0);
});

test("saved window is restored, a bad one falls back to Now", async ({ browser }) => {
  let o = await open(browser, DESKTOP, "light", { desktop: true, setup: setup(), storage: { layers: JSON.stringify({ wx: "temp", nsw: 6 }) } });
  await openPanel(o.page);
  await expect(o.page.locator('#lp [data-ns="w6"]')).toHaveAttribute("aria-pressed", "true");
  await o.page.locator('#lp [data-ns="w12"]').click();
  expect(await o.page.evaluate(() => JSON.parse(localStorage.getItem("layers")).nsw)).toBe(12);
  o = await open(browser, DESKTOP, "light", { desktop: true, setup: setup(), storage: { layers: JSON.stringify({ wx: "temp", nsw: 7 }) } });
  await openPanel(o.page);
  await expect(o.page.locator('#lp [data-ns="w0"]')).toHaveAttribute("aria-pressed", "true");
});

test("switching layer or off drops the old images from the cache", async ({ browser }) => {
  const { page, problems } = await open(browser, DESKTOP, "light", { desktop: true, setup: setup() });
  const urls = () => page.evaluate(() => Object.keys(nsImg));
  await openPanel(page);
  await radio(page, "Temperature").check();
  await page.locator('#lp [data-ns="w6"]').click();
  await seen(page, 2);
  expect((await urls()).length).toBeGreaterThan(1);
  await radio(page, "Wind").check();
  await expect(page.locator("#map .leaflet-image-layer")).toHaveCount(1);
  expect((await urls()).filter((u) => u.includes("/temp/"))).toEqual([]);
  await radio(page, "None").check();
  await expect.poll(urls).toEqual([]);
  expect(problems).toEqual([]);
});
