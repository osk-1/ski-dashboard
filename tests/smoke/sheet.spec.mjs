/* global document, map, scrollY, innerHeight -- page globals inside page.evaluate */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, shot, VIEWPORTS } from "./helpers.mjs";

const st = (id) => JSON.parse(readFileSync(new URL("../fixtures/data/stations.json", import.meta.url))).stations.find((x) => x.id === id);
const hit = (page, y) => page.evaluate((yy) => { const e = document.elementFromPoint(100, yy); return e.closest("#map") ? "map" : e.closest(".wrap") ? "sheet" : e.tagName; }, y);

// bottom-sheet prototype (?sheet=1): full-screen map under a page that scrolls over it
for (const vp of VIEWPORTS) for (const scheme of ["light", "dark"]) {
  test(`bottom sheet at ${vp.name}px, ${scheme}`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, scheme, { storage: { sheet: "1" } });
    await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
    const m = await page.locator("#mapPanel").boundingBox();
    expect([m.x, m.y, m.width]).toEqual([0, 0, vp.width]); expect(m.height).toBeGreaterThanOrEqual(vp.height);
    expect(await page.evaluate(() => map.dragging.enabled())).toBe(true); // one finger pans the map: the page scrolls only on the sheet
    await expect(page.getByRole("button", { name: "Full screen", exact: true })).toBeHidden();
    expect(await hit(page, 150)).toBe("map"); expect(await hit(page, vp.height - 40)).toBe("sheet");
    await expect(page.locator("#legend")).toBeInViewport();
    await expect(page.locator("#map .val.sel")).toHaveCount(0); // nothing tapped: no station highlighted
    expect((await page.locator("h1").boundingBox()).height).toBeLessThanOrEqual(1); // name for screen readers only
    await expect(page.locator("#glance .stat")).toHaveCount(4); // danger, deepest, new snow, forecast
    const peek = vp.height - (await page.locator(".wrap").boundingBox()).y;
    expect(peek).toBeLessThan(vp.height * .25); expect((await page.locator("#updated").boundingBox()).y + 16).toBeLessThan(vp.height); // the whole glance fits the peek
    await shot(page, "sheet-peek", vp, scheme);

    const s = st("SKAP2"); // tap a station: its card slides over the sheet, the map stays visible above it
    await page.evaluate(([lat, lon]) => { map.setView([lat, lon], map.getZoom() + 2, { animate: false }); }, [s.lat, s.lon]);
    await page.locator('#map [data-sid="SKAP2"]').first().click();
    const card = page.locator("#stationCard"); await expect(card).toBeVisible(); await expect(card).toBeFocused();
    await expect(page.locator("#map .val.sel")).toHaveCount(1);
    await expect(card.locator(".scr small").first()).toHaveText(/^24 h: min -?\d+.* · max -?\d+/);
    await page.waitForTimeout(300); // slide-in
    expect(await page.evaluate(() => document.elementFromPoint(100, innerHeight - 30).closest("#stationCard") != null)).toBe(true); // on top of the sheet
    expect(await hit(page, 100)).toBe("map");
    await shot(page, "sheet-card", vp, scheme);
    await page.keyboard.press("Escape"); await expect(card).toBeHidden();
    await page.locator('#map [data-sid="SKAP2"]').first().click(); await expect(card).toBeVisible();
    await page.getByRole("button", { name: "Open charts" }).click(); // selects and raises the sheet to the charts
    await expect(card).toBeHidden(); await expect(page.locator("#stnSel")).toHaveValue("SKAP2");
    await page.waitForFunction(() => Math.abs(document.getElementById("condTitle").getBoundingClientRect().top) < 40);
    await shot(page, "sheet-charts", vp, scheme);

    await page.evaluate(() => document.getElementById("checks").scrollIntoView()); // fully raised: the sheet covers the map
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0); expect(await hit(page, 100)).toBe("sheet");
    expect(problems).toEqual([]);
    await context.close();
  });
}

test("sheet=0 turns the prototype off", async ({ browser }) => {
  const { page, context } = await open(browser, VIEWPORTS[0], "light", { storage: { sheet: "1" } });
  await page.goto("/index.html?sheet=0");
  await expect(page.locator("html")).not.toHaveClass(/sheet/);
  await expect(page.getByRole("button", { name: "Full screen", exact: true })).toBeVisible();
  await context.close();
});
