/* global Chart */
// Snow depth chart (#40): persisted window switch, forecast zone, gaps, 1 h numbers, removed History / 5-day charts.
import { expect, test } from "@playwright/test";
import { open, VIEWPORTS } from "./helpers.mjs";

const sets = (page) => page.evaluate(() => Chart.getChart("snow").data.datasets.map((d) => ({ label: d.label, dash: d.borderDash ?? null, spanGaps: d.spanGaps, ys: d.data.map((p) => p.y), plugins: Chart.getChart("snow").config.plugins.map((p) => p.id) })));

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`snow depth chart at ${vp.name}px, ${scheme}`, async ({ browser }) => {
      const { page, context, problems } = await open(browser, vp, scheme, { storage: { sel: "SKAP2" } });
      await expect(page.locator("#updated")).toContainText("stations");
      await expect(page.locator("#hist, #fc")).toHaveCount(0);
      await expect(page.locator("#snowWin button[data-h='72']")).toHaveAttribute("aria-pressed", "true"); // default
      await expect(page.locator("#snowNote")).toContainText("Open-Meteo");
      await expect.poll(() => page.evaluate(() => !!Chart.getChart("snow"))).toBe(true);
      const d = await sets(page);
      expect(d.find((x) => x.dash)?.label).toContain("model"); // dashed forecast depth
      expect(d.every((x) => x.spanGaps !== true)).toBe(true);
      expect(await page.evaluate(() => Chart.getChart("snow").config.plugins.map((p) => p.id))).toContain("zone");
      expect(await page.evaluate(() => Chart.getChart("snow").config.options.scales.x.type)).toBe("linear");

      // a station with missing hours: a gap inside the measured line (VOR-ZURS1, 17 Nov 03-08 h)
      await page.selectOption("#stnSel", "VOR-ZURS1");
      await page.click("#snowWin button[data-h='168']");
      const ys = (await sets(page)).find((x) => x.label === "Snow height").ys, a = ys.findIndex((y) => y != null), b = ys.findLastIndex((y) => y != null);
      expect(ys.slice(a, b).includes(null)).toBe(true);
      await expect(page.locator("#snowBox")).toBeVisible();
      await page.locator("#snowPanel").screenshot({ path: `test-results/screens/snow-7d-${vp.name}-${scheme}.png` });

      // no forecast depth for this station
      await page.selectOption("#stnSel", "TAWES-11311");
      await expect(page.locator("#snowNote")).toContainText("No forecast for snow depth.");

      // window persists over reload
      await page.reload();
      await expect(page.locator("#snowWin button[data-h='168']")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#condWin button[data-h='24']")).toHaveAttribute("aria-pressed", "true"); // own switch per chart

      await page.selectOption("#stnSel", "SKAP2");
      await page.click("#snowWin button[data-h='24']");
      await expect.poll(() => page.evaluate(() => Chart.getChart("snow").data.datasets.length)).toBeGreaterThan(1);
      await page.waitForTimeout(300);
      await page.locator("#snowPanel").screenshot({ path: `test-results/screens/snow-24h-${vp.name}-${scheme}.png` });

      await page.click("#snowWin button[data-h='1']");
      await expect(page.locator("#snowNow")).toContainText("vs 1 h ago");
      await expect(page.locator("#snowNow")).toContainText("Next hour: snowfall");
      await expect(page.locator("#snowNow")).toContainText("Next hour: depth");
      await expect(page.locator("#snowBox")).toBeHidden();
      await page.locator("#snowPanel").screenshot({ path: `test-results/screens/snow-1h-${vp.name}-${scheme}.png` });
      await page.selectOption("#stnSel", "TAWES-11311");
      await expect(page.locator("#snowNow")).toContainText("no forecast");

      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
