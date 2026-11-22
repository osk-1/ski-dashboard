/* global Chart */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const fixture = (name) => readFileSync(new URL(`../fixtures/data/${name}.json`, import.meta.url));

// iPhone 13 / 13 Pro Max widths
const VIEWPORTS = [{ name: "390", width: 390, height: 844 }, { name: "430", width: 430, height: 932 }];

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`loads cleanly at ${vp.name}px, ${scheme}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const problems = [];
      page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
      page.on("pageerror", (e) => problems.push(`exception: ${e.message}`));

      // No live data, no live tiles: fixtures for data/, a blank tile. The CDN scripts load for real, so their SRI hashes are checked.
      await page.route("**/data/*.json", (route) => route.fulfill({ contentType: "application/json", body: fixture(new URL(route.request().url()).pathname.match(/(\w+)\.json$/)[1]) }));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|cdnjs\.cloudflare\.com)/, (route) => {
        const url = route.request().url();
        if (url.includes("arcgisonline")) return route.fulfill({ contentType: "image/png", body: PNG });
        return route.abort();
      });

      await page.clock.setFixedTime(new Date(JSON.parse(fixture("stations")).updated)); // "now" = the fixture's run time, so the conditions window shows its data and model hours
      await page.goto("/index.html");
      await expect(page.locator("#updated")).toContainText("stations"); // data loaded
      await expect(page.locator("#banner")).toBeHidden(); // health.json run is "now"
      await expect(page.locator("#map .leaflet-container, #map.leaflet-container")).toBeVisible();
      await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible(); // station dots

      // select a station (the select works at every width) and check both charts draw
      await page.selectOption("#stnSel", "SKAP2"); // a station with snow depth; wind-only stations hide the snow panel
      for (const id of ["cond", "snow"]) { // one chart at a time: the tab shows it
        await page.click(`#chartTabs [data-tab="${id}"]`);
        await expect.poll(() => page.evaluate((i) => !!Chart.getChart(i), id)).toBe(true);
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
      await page.click('#chartTabs [data-tab="cond"]');
      // conditions chart: a Tirol station (snow surface, HS rise) and a gauge station with model hours after "now"
      for (const id of ["SKAP2", "VOR-ZURS1"]) {
        await page.selectOption("#stnSel", id);
        await expect.poll(() => page.evaluate(() => Chart.getChart("cond")?.data.datasets.map((d) => d.label).join())).toContain("model");
        await expect(page.locator("#cond")).toBeVisible();
        await expect(page.locator("#condNote")).toContainText(id === "SKAP2" ? "refroze" : "Overnight min");
        if (id === "SKAP2") await page.locator("#condBox").screenshot({ path: testInfo.outputPath(`${vp.name}-${scheme}-cond-skap2.png`) });
      }
      await page.click("#condWin button[data-h='24']");
      await expect.poll(() => page.evaluate(() => !!Chart.getChart("cond"))).toBe(true);
      await page.waitForTimeout(500); // chart animation

      await page.screenshot({ path: testInfo.outputPath(`${vp.name}-${scheme}.png`), fullPage: true });
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
