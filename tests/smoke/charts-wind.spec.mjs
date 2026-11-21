/* global Chart */
// Wind chart (#40): switch, forecast zone, arrows, 1 h numbers; persistent tap tooltips on the wind, Conditions and Snow depth charts.
import { expect, test } from "@playwright/test";
import { open, VIEWPORTS } from "./helpers.mjs";

const tipOpacity = (page, id) => page.evaluate((i) => Chart.getChart(i).tooltip.opacity, id);
// tap the first measured point (dataset 0) from index 10 on; the fixtures have gaps with a real touch tap
async function tap(page, id, off = false) {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300); // let charts resize after the scroll / station change
  const p = await page.evaluate((i) => { const c = Chart.getChart(i), m = c.getDatasetMeta(0).data.find((e, j) => j >= 10 && c.data.datasets[0].data[j].y != null), r = c.canvas.getBoundingClientRect(); return { x: r.left + m.x, y: r.top + m.y }; }, id);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(600);
  expect(await tipOpacity(page, id)).toBe(off ? 0 : 1);
  if (off) return;
  return page.evaluate((i) => Chart.getChart(i).tooltip.body.flatMap((b) => b.lines).join("|") + "|" + Chart.getChart(i).tooltip.afterBody.join("|") + "|" + Chart.getChart(i).tooltip.footer.join("|") + "|" + Chart.getChart(i).tooltip.title.join("|"), id);
}

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`wind chart and tap tooltips at ${vp.name}px, ${scheme}`, async ({ browser }) => {
      const { page, context, problems } = await open(browser, vp, scheme, { storage: { sel: "SKAP1" } }); // wind-only station
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

      // tap tooltip persists, names value / time / measured / source; the page header clears it
      const t = await tap(page, "wind");
      expect(t).toContain("measured");
      expect(t).toContain("km/h");
      expect(t).toContain("Wind from");
      await tap(page, "wind", true); // tapping the same point again toggles it off
      await tap(page, "wind");
      await page.touchscreen.tap(vp.width / 2, 8);
      await expect.poll(() => tipOpacity(page, "wind")).toBe(0);
      await page.locator("#windPanel").screenshot({ path: `test-results/screens/wind-24h-${vp.name}-${scheme}.png` });

      await page.click("#windWin button[data-h='168']");
      await page.waitForTimeout(300);
      await page.locator("#windPanel").screenshot({ path: `test-results/screens/wind-7d-${vp.name}-${scheme}.png` });
      await page.click("#windWin button[data-h='1']");
      await expect(page.locator("#windNow")).toContainText("vs 1 h ago");
      await expect(page.locator("#windNow")).toContainText("Next hour: mean wind");
      await expect(page.locator("#windBox")).toBeHidden();
      await page.locator("#windPanel").screenshot({ path: `test-results/screens/wind-1h-${vp.name}-${scheme}.png` });

      // gauge station with wind: same chart; snow depth and Conditions tooltips too
      await page.click("#windWin button[data-h='24']");
      await page.selectOption("#stnSel", "TAWES-11311");
      await expect(page.locator("#windPanel")).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!Chart.getChart("wind"))).toBe(true);
      expect(await tap(page, "wind")).toContain("measured");
      expect(await tap(page, "cond")).toContain("measured");
      expect(await tipOpacity(page, "wind")).toBe(0); // tapping another chart clears the first
      await page.selectOption("#stnSel", "SKAP2");
      await expect(page.locator("#windPanel")).toBeHidden(); // no wind sensor
      expect(await tap(page, "snow")).toContain("measured");
      await page.touchscreen.tap(vp.width / 2, 8); // outside every canvas
      await expect.poll(() => tipOpacity(page, "snow")).toBe(0);

      // Conditions at 1 h / 24 h / 7 d
      await page.selectOption("#stnSel", "TAWES-11311");
      for (const [h, n] of [[1, "1h"], [24, "24h"], [168, "7d"]]) {
        await page.click(`#condWin button[data-h='${h}']`);
        await page.waitForTimeout(300);
        await page.locator("#condWin").locator("xpath=ancestor::section").screenshot({ path: `test-results/screens/conditions-${n}-${vp.name}-${scheme}.png` });
      }
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
