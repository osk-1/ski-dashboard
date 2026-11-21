/* global win, cardId, openCard, getComputedStyle, document, innerHeight */
// Wide screens keep the page layout (no sheet, no full-screen mode); crossing the phone breakpoint moves the panel and card without leftovers.
import { expect, test } from "@playwright/test";
import { DESKTOP, open, VIEWPORTS } from "./helpers.mjs";

test("desktop layout: no sheet, panel in the grid, card in the panel, all windows", async ({ browser }) => {
  const { page, context, problems } = await open(browser, DESKTOP, "light", { desktop: true, storage: { sel: "SKAP2" } });
  await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/sheet/);
  await expect(page.locator(".grid2 > #mapPanel")).toHaveCount(1);
  await expect(page.locator("#mapPanel > #stationCard")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Full screen" })).toHaveCount(0);

  // 1 h window: numbers instead of a chart (the sheet has only 24 h / 72 h / 7 d)
  await page.click("#condWin button[data-h='1']");
  await expect(page.locator("#condNow")).toContainText("°C");
  await expect(page.locator("#condBox")).toBeHidden();
  await page.selectOption("#stnSel", "VOR-ZURS1");
  // 1 h times: gauge hours are the HH:00 sample; a Tirol hour shows the station's own time when it is that hour, else only "hour of"
  await expect(page.locator("#condNow .stat").first()).toContainText("20 Nov, 16:00");
  await page.selectOption("#stnSel", "SKAP2"); // newest hourly lt at 10:00, station time 15:40
  await expect(page.locator("#condNow .stat").first()).toContainText("hour of 20 Nov, 10:00");
  await expect(page.locator("#condNow .stat").first().locator("s.bad")).toHaveCount(1);
  await page.click("#snowWin button[data-h='1']");
  await expect(page.locator("#snowNow")).toContainText("vs 1 h ago");
  await expect(page.locator("#snowNow")).toContainText("Next hour: snowfall");
  await expect(page.locator("#snowNow")).toContainText("Next hour: depth");
  await expect(page.locator("#snowBox")).toBeHidden();
  await page.selectOption("#stnSel", "TAWES-11311");
  await expect(page.locator("#snowNow")).toContainText("no forecast");
  await page.click("#windWin button[data-h='1']");
  await expect(page.locator("#windNow")).toContainText("vs 1 h ago");
  await expect(page.locator("#windNow")).toContainText("Next hour: mean wind");
  await expect(page.locator("#windBox")).toBeHidden();
  expect(problems).toEqual([]);
  await context.close();
});

test("crossing the phone breakpoint: card closed, panel and card moved, one shared window", async ({ browser }) => {
  const vp = VIEWPORTS[0];
  const { page, context, problems } = await open(browser, vp, "light", { storage: { sel: "SKAP2" } });
  await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
  await page.evaluate(() => openCard("SKAP2"));
  await expect(page.locator("#stationCard")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/sheet/);

  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await expect(page.locator("html")).not.toHaveClass(/sheet/);
  await expect(page.locator(".grid2 > #mapPanel > #stationCard")).toHaveCount(1);
  await expect(page.locator("#stationCard")).toBeHidden();
  expect(await page.evaluate(() => cardId)).toBeUndefined(); // no phantom highlight
  await page.click("#snowWin button[data-h='168']"); // desktop: windows are per chart
  expect(await page.evaluate(() => [win.cond, win.snow])).toEqual([24, 168]);

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await expect(page.locator("html")).toHaveClass(/sheet/);
  await expect(page.locator("body > #mapPanel")).toHaveCount(1);
  await expect(page.locator("header > #stationCard")).toHaveCount(1);
  expect(await page.evaluate(() => new Set(Object.values(win)).size)).toBe(1); // a selectable shared window
  await expect(page.locator("#snowWin button[data-h='24']")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => openCard("SKAP2"));
  await expect(page.locator("#stationCard")).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();
});

for (const vp of [{ name: "1440", width: 1440, height: 900 }, { name: "1024", width: 1024, height: 768 }]) {
  test(`map-first layout at ${vp.name}: full-height map beside a scrolling sidebar holding the charts`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, "light", { desktop: true });
    await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
    const map = await page.locator("#map").boundingBox();
    const side = await page.locator(".wrap").boundingBox();
    expect(map.y).toBe(0);
    expect(map.height).toBe(vp.height);
    expect(map.x).toBeGreaterThanOrEqual(side.width);
    expect(map.width).toBeGreaterThan(side.width);
    expect(side.height).toBe(vp.height);
    expect(await page.locator(".wrap").evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")).toBe(true);
    for (const id of ["cond", "snow", "wind"]) expect(await page.locator(`.wrap #${id}`).count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true); // the page itself does not scroll
    expect(problems).toEqual([]);
    await context.close();
  });
}
