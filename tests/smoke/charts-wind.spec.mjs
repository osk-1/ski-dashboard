/* global Chart */
// Wind chart (#40): tab, shared switch, forecast zone, arrows; the tap read-out of the sheet charts is in sheet.spec.mjs.
import { expect, test } from "@playwright/test";
import { open, tab, VIEWPORTS } from "./helpers.mjs";

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`wind chart at ${vp.name}px, ${scheme}`, async ({ browser }) => {
      const { page, context, problems } = await open(browser, vp, scheme, { storage: { sel: "SKAP1", tab: "wind" } }); // wind-only station
      await expect(page.locator("#updated")).toContainText("stations");
      await expect(page.locator("#windPanel")).toBeVisible();
      await expect(page.locator("#snowPanel")).toBeHidden();
      await expect(page.locator("#windWin button[data-h='24']")).toHaveAttribute("aria-pressed", "true"); // default
      await expect.poll(() => page.evaluate(() => !!Chart.getChart("wind"))).toBe(true);
      const d = await page.evaluate(() => Chart.getChart("wind").data.datasets.map((x) => ({ label: x.label, kind: x.kind, dash: x.borderDash ?? null, spanGaps: x.spanGaps, n: x.data.filter((p) => p.y != null).length })));
      expect(d.every((x) => x.kind && x.spanGaps !== true)).toBe(true);
      expect(d.find((x) => x.dash)?.label).toContain("model");
      const arrows = d.find((x) => x.label === "Direction");
      expect(arrows.n).toBeGreaterThan(0);
      expect(arrows.n).toBeLessThanOrEqual(41);
      expect(await page.evaluate(() => Chart.getChart("wind").config.plugins.map((p) => p.id))).toContain("zone");
      await expect(page.locator("#windNote")).toContainText("MET Norway"); // wind comes from the fixture's fallback run
      await expect(page.locator("#windNote")).not.toContainText("Open-Meteo");

      await page.locator("#windPanel").screenshot({ path: `test-results/screens/wind-24h-${vp.name}-${scheme}.png` });

      await page.click("#windWin button[data-h='168']");
      await page.waitForTimeout(300);
      await page.locator("#windPanel").screenshot({ path: `test-results/screens/wind-7d-${vp.name}-${scheme}.png` });

      // gauge station with wind: same chart; a station without a wind sensor falls back to Conditions
      await page.click("#windWin button[data-h='24']");
      await page.selectOption("#stnSel", "TAWES-11311");
      await expect(page.locator("#windPanel")).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!Chart.getChart("wind"))).toBe(true);
      await page.selectOption("#stnSel", "SKAP2");
      await expect(page.locator("#windPanel")).toBeHidden(); // no wind sensor
      await expect(page.locator("#condPanel")).toBeVisible();

      // Conditions at 1 h / 24 h / 7 d
      await page.selectOption("#stnSel", "TAWES-11311");
      await tab(page, "cond");
      for (const [h, n] of [[24, "24h"], [168, "7d"]]) {
        await page.click(`#condWin button[data-h='${h}']`);
        await page.waitForTimeout(300);
        await page.locator("#condWin").locator("xpath=ancestor::section").screenshot({ path: `test-results/screens/conditions-${n}-${vp.name}-${scheme}.png` });
      }
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
