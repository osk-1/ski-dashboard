/* global Chart */
// Accuracy acceptance cases (#42): modified copies of the fixtures, routed per test; the shared fixtures stay as they are.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/data/${name}.json`, import.meta.url)));
const VIEWPORTS = [{ name: "390", width: 390, height: 844 }, { name: "430", width: 430, height: 932 }];

function data() {
  const d = Object.fromEntries(["stations", "forecast", "readings", "danger", "regions", "hourly", "health"].map((n) => [n, fixture(n)]));
  const st = (id) => d.stations.stations.find((s) => s.id === id);
  st("VOR-ZURS1").date = "2026-11-20T13:35:00+01:00"; // 3 h before the run: wind stale, HS still fresh
  Object.assign(st("SAGA1"), { wg: 0, wg_boe: 0, flags: { wg: "sensor frozen?", wg_boe: "sensor frozen?", wr: "sensor frozen?" } }); // rimed anemometer
  Object.assign(st("SKAP2"), { lat: st("SKAP2").lat + 0.009, flags: { station: "location mismatch" } }); // moved 1 km
  d.health.run = "2026-11-20T14:00+01:00"; // last successful refresh 2 h 35 min before "now"
  (d.hourly.hours["2026-11-20T14"].flags ??= {})["VOR-ZURS1"] = { lt: "jump" };
  return d;
}

async function open(browser, vp, scheme, d) {
  const context = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  await page.addInitScript(() => { localStorage.setItem("layers", JSON.stringify({ on: { snow: true, wind: true } })); localStorage.setItem("tableOpen", "1"); });
  await page.route("**/data/*.json", (route) => {
    const n = new URL(route.request().url()).pathname.match(/(\w+)\.json$/)[1];
    return d[n] ? route.fulfill({ contentType: "application/json", body: JSON.stringify(d[n]) }) : route.fulfill({ status: 404, body: "" });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|cdnjs\.cloudflare\.com)/, (route) => {
    const url = route.request().url();
    if (url.includes("arcgisonline")) return route.fulfill({ contentType: "image/png", body: PNG });
    if (url.includes("fonts.googleapis")) return route.fulfill({ contentType: "text/css", body: "" });
    return route.abort();
  });
  await page.clock.setFixedTime(new Date(d.stations.updated));
  await page.goto("/index.html");
  await expect(page.locator("#updated")).toContainText("stations");
  return { page, context, problems };
}

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`accuracy cases at ${vp.name}px, ${scheme}`, async ({ browser }, testInfo) => {
      const { page, context, problems } = await open(browser, vp, scheme, data());
      const shot = (loc, n) => loc.screenshot({ path: testInfo.outputPath(`${vp.name}-${scheme}-${n}.png`) });

      // stale health.json -> banner
      await expect(page.locator("#banner")).toBeVisible();
      await expect(page.locator("#banner")).toContainText("20 Nov, 14:00");
      await shot(page.locator("#banner"), "banner");

      // date 3 h old: wind hidden on the map, struck through in the table, HS still shown
      const zurs = page.locator('#map [data-sid="VOR-ZURS1"] title');
      await expect(zurs).toHaveText(/23 cm/);
      await expect(zurs).not.toHaveText(/wind/);
      const row = page.locator('#rows tr[data-id="VOR-ZURS1"]');
      await expect(row.locator("td").nth(2)).toContainText("23");
      await expect(row.locator("td").nth(2).locator("s")).toHaveCount(0);
      await expect(row.locator("td").nth(4).locator("s.bad")).toHaveCount(3);
      await expect(row.locator("td").nth(4)).toContainText("no recent data (last 13:35)");

      // rimed anemometer: suspect on the map, excluded from the summary with the reason
      await expect(page.locator(".leaflet-tooltip.val", { hasText: "Gampberg Windstation" })).toContainText("suspect: sensor frozen?");
      await expect(page.locator("#summary")).toContainText("Gampberg Windstation (wind, gusts, wind direction: suspect: sensor frozen?)");
      await expect(page.locator("#summary")).toContainText("1 excluded"); // Ulmerhütte HS, offline
      await expect(page.locator('#rows tr[data-id="SAGA1"] .why')).toHaveText("suspect: sensor frozen?");
      await shot(page.locator("#tableDetails"), "table");

      // moved station: hidden from map and table, listed in Data checks
      await expect(page.locator('#map [data-sid="SKAP2"]')).toHaveCount(0);
      await expect(page.locator('#rows tr[data-id="SKAP2"]')).toHaveCount(0);
      await page.click("#checks summary");
      const checks = page.locator("#checkList");
      await expect(checks).toContainText("Kapall Schneestation hidden from map, summary and table: location mismatch");
      await expect(checks).toContainText("Gampberg Windstation: wind, gusts, wind direction suspect: sensor frozen? (wind 0 for 3 hours");
      await expect(checks).toContainText("Ulmerhütte offline");
      await expect(checks).toContainText("Zürs Hexenboden: wind, gusts, wind direction not current: last 13:35, older than 1 h; air temp not current: last 13:35, older than 2 h.");
      await shot(page.locator("#checks"), "checks");

      // flagged hourly point: faded, reason on the point
      await page.selectOption("#stnSel", "VOR-ZURS1");
      await expect.poll(() => page.evaluate(() => Chart.getChart("cond")?.data.datasets[0].data.find((p) => p.fl)?.k)).toBe("2026-11-20T14");
      await expect(page.locator("#condNote")).toContainText("Faded points");
      await expect(page.locator("#fcSource")).toContainText("Model: Open-Meteo, issued");
      await shot(page.locator("#condBox"), "cond-flag");
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}

test("works without health.json", async ({ browser }) => {
  const d = Object.fromEntries(["stations", "forecast", "readings", "danger", "regions", "hourly"].map((n) => [n, fixture(n)]));
  const { page, context, problems } = await open(browser, VIEWPORTS[0], "light", d);
  await expect(page.locator("#banner")).toBeHidden(); // stations.json updated is "now"
  await expect(page.locator("#checkList")).toContainText("Source status unavailable");
  await expect(page.locator("#checkList")).toContainText("Ulmerhütte offline"); // live staleness still works
  expect(problems.filter((p) => !p.startsWith("Failed to load resource"))).toEqual([]); // the 404 itself
  await context.close();
});
