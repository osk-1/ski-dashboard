/* global map, fitZ, state, renderMap, openCard, document, BOUNDS -- page globals inside page.evaluate */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, shot, VIEWPORTS } from "./helpers.mjs";

const zoomBy = async (page, d) => { await page.evaluate((d) => { map.setZoom(fitZ + d, { animate: false }); }, d); await page.waitForTimeout(300); }; // zoomend re-lays out synchronously; removed tooltips fade out for 200 ms
const visibleBoxes = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.classList.contains("pl") ? (() => { const g = document.createRange(); g.selectNodeContents(e.lastChild); return g.getBoundingClientRect(); })() : e.getBoundingClientRect(), // village: the name only, its symbol may sit on a station
       m = document.getElementById("map").getBoundingClientRect(); return { pl: e.classList.contains("pl"), t: e.textContent || e.getAttribute("aria-label"), l: r.left, r: r.right, top: r.top, b: r.bottom, in: r.width > 0 && r.left >= m.left && r.right <= m.right && r.top >= m.top && r.bottom <= m.bottom }; }).filter((b) => b.in), sel);
const noOverlaps = (boxes, labelsOnly = false) => { for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (labelsOnly && !a.pl && !b.pl) continue; const e = 2; // px: strokes and anti-aliasing
  expect(a.l + e < b.r && b.l + e < a.r && a.top + e < b.b && b.top + e < a.b, `${a.t} overlaps ${b.t}`).toBe(false); } };

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`map tiers at ${vp.name}px, ${scheme}`, async ({ browser }) => {
      const { page, problems } = await open(browser, vp, scheme, { storage: { layers: JSON.stringify({ on: { snow: true, wind: true, peaks: true }, hide: [] }) } });
      await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
      await page.evaluate(() => { state.selected = null; renderMap(); }); // nothing selected: tier rules only
      expect(await page.evaluate(() => map.getZoom() === fitZ)).toBe(true);

      // tier 0: dots and arrows only, Valluga is the only peak, close stations are merged
      await expect(page.locator("#map .leaflet-tooltip.val")).toHaveCount(0);
      await expect(page.locator("#map .pl.pk")).toHaveCount(1);
      await expect(page.locator("#map .pl.pk")).toContainText("Valluga");
      expect(await page.locator('#map [aria-label*=" stations:"]').count()).toBeGreaterThanOrEqual(1);
      noOverlaps(await visibleBoxes(page, "#map .pl, #map path[data-sid], #map .wind-ic:not([data-sid])"), true); // village labels vs everything; dots vs dots are merged by the 28 px rule
      await shot(page, "map-tier0", vp, scheme, page.locator("#mapPanel"));

      // tier 1: values, more peaks, no station names, nothing overlaps
      await zoomBy(page, 1);
      expect(await page.locator("#map .leaflet-tooltip.val").count()).toBeGreaterThan(0);
      await expect(page.locator("#map .val .nm:visible")).toHaveCount(0);
      noOverlaps(await visibleBoxes(page, "#map .val, #map .pl"));
      await shot(page, "map-tier1", vp, scheme, page.locator("#mapPanel"));

      // tier 2: station names too
      await zoomBy(page, 2);
      expect(await page.locator("#map .val .nm:visible").count()).toBeGreaterThan(0);
      expect(await page.locator("#map .pl.pk").count()).toBeGreaterThan(1); // peaks are not hidden zoomed in on the sheet map (#52)
      noOverlaps(await visibleBoxes(page, "#map .val, #map .pl"));
      await shot(page, "map-tier2", vp, scheme, page.locator("#mapPanel"));

      // zooming out re-lays-out: values and extra peaks are gone again
      await zoomBy(page, 0);
      await expect(page.locator("#map .leaflet-tooltip.val")).toHaveCount(0);
      await expect(page.locator("#map .pl.pk")).toHaveCount(1);

      // a merged marker zooms in; the previewed station is never merged and keeps name + value at tier 0
      const z = await page.evaluate(() => map.getZoom());
      await page.locator('#map [aria-label*=" stations:"]').first().focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => map.getZoom())).toBeGreaterThan(z); // setView animates
      await zoomBy(page, 0);
      await page.evaluate(() => openCard("SKAP2")); // Kapall snow station, merged with its wind station until its card opens (the sheet has no selected highlight)
      await expect(page.locator("#map .leaflet-tooltip.val.sel")).toContainText("Kapall Schneestation");
      await expect(page.locator("#map .leaflet-tooltip.val.sel b")).toContainText("cm");
      expect(problems).toEqual([]);
    });
  }
}

test("a misplaced station far away does not change the initial fit", async ({ browser }) => {
  const fx = JSON.parse(readFileSync(new URL("../fixtures/data/stations.json", import.meta.url)));
  const far = JSON.stringify({ ...fx, stations: fx.stations.map((s, i) => (i ? s : { ...s, lat: 0, lon: 0, flags: { station: "location mismatch" } })) }); // reported at 0,0: hidden everywhere, so the fit ignores it
  const fit = async (fixtures) => { const { page, context } = await open(browser, VIEWPORTS[0], "light", { fixtures }); await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
    const r = await page.evaluate(() => { const c = map.getCenter(); return { z: map.getZoom(), inB: c.lat > BOUNDS.lat0 && c.lat < BOUNDS.lat1 && c.lng > BOUNDS.lon0 && c.lng < BOUNDS.lon1 }; }); await context.close(); return r; };
  const ok = await fit({}), bad = await fit({ stations: far });
  expect(bad.inB).toBe(true);
  expect(bad.z).toBeGreaterThanOrEqual(ok.z); // one station fewer can only tighten the fit, never zoom out to the world
});
