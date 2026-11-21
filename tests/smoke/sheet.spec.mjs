/* global document, map, scrollY, innerHeight, Chart -- page globals inside page.evaluate */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, shot, VIEWPORTS } from "./helpers.mjs";

const st = (id) => JSON.parse(readFileSync(new URL("../fixtures/data/stations.json", import.meta.url))).stations.find((x) => x.id === id);
const fx = (n) => JSON.parse(readFileSync(new URL(`../fixtures/data/${n}.json`, import.meta.url)));
const vk = (t) => new Date(t).toLocaleString("sv-SE", { timeZone: "Europe/Vienna" }).slice(0, 13).replace(" ", "T"); // hourly.json key
const hit = (page, y) => page.evaluate((yy) => { const e = document.elementFromPoint(100, yy); return e.closest("#map") ? "map" : e.closest(".wrap") ? "sheet" : e.tagName; }, y);

// bottom sheet (the only phone layout): full-screen map under a page that scrolls over it
for (const vp of VIEWPORTS) for (const scheme of ["light", "dark"]) {
  test(`bottom sheet at ${vp.name}px, ${scheme}`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, scheme);
    await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
    const m = await page.locator("#mapPanel").boundingBox();
    expect([m.x, m.y, m.width]).toEqual([0, 0, vp.width]); expect(m.height).toBeGreaterThanOrEqual(vp.height);
    expect(await page.evaluate(() => map.dragging.enabled())).toBe(true); // one finger pans the map: the page scrolls only on the sheet
    expect(await hit(page, 150)).toBe("map"); expect(await hit(page, vp.height - 40)).toBe("sheet");
    await expect(page.locator("#legend")).toBeInViewport();
    await expect(page.locator("#map .val.sel")).toHaveCount(0); // nothing tapped: no station highlighted
    expect((await page.locator("h1").boundingBox()).height).toBeLessThanOrEqual(1); // name for screen readers only
    await expect(page.locator("#glance .stat")).toHaveCount(3); // fixture bulletin is from May: no danger cells
    await expect(page.locator("#glance")).toContainText("Galzig now"); await expect(page.locator("#glance")).toContainText("Ulmerhütte snow 24 h");
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
    await page.waitForFunction(() => Math.abs(document.querySelector(".chartsec").getBoundingClientRect().top) < 40);
    // one chart at a time, one shared 24 h / 72 h / 7 d switch, notes folded
    await expect(page.locator("#condPanel")).toBeVisible(); await expect(page.locator("#snowPanel")).toBeHidden(); await expect(page.locator("#windPanel")).toBeHidden();
    await expect(page.locator("#condNote")).toBeHidden(); await expect(page.locator("#condPanel .note summary")).toBeVisible();
    await expect(page.locator("#condWin button:visible")).toHaveCount(3);
    const read = page.locator("#condRead");
    await expect(read).toContainText("Air: "); await expect(read.locator("b")).toHaveText("20 Nov, 10:00"); // starts at the latest measured hour (the fixture station stops at 10:00)
    const n = await read.locator("span").count(), shown = await page.evaluate(() => { const c = Chart.getChart("cond"); return c.data.datasets.filter((d, i) => c.isDatasetVisible(i) && !d.noTip).length; });
    expect(n).toBe(shown); // one entry per visible series, gaps as "–"
    const box = await page.locator("#cond").boundingBox();
    await page.touchscreen.tap(box.x + box.width * .3, box.y + box.height / 2);
    await expect(read.locator("b")).not.toHaveText("20 Nov, 10:00"); await expect(read.locator("span")).toHaveCount(n); const t = await read.locator("b").textContent();
    await page.waitForTimeout(300); await expect(read.locator("b")).toHaveText(t); // stays after the finger lifts
    await shot(page, "sheet-charts", vp, scheme);
    await page.locator("#chartTabs button[data-tab='snow']").click();
    await expect(page.locator("#snowPanel")).toBeVisible(); await expect(page.locator("#condPanel")).toBeHidden();
    await page.locator("#snowWin button[data-h='168']").click();
    for (const c of ["condWin", "snowWin", "windWin"]) await expect(page.locator(`#${c} button[data-h='168']`)).toHaveAttribute("aria-pressed", "true");
    const bars = await page.evaluate(() => Chart.getChart("snow").data.datasets.filter((d) => d.type === "bar").map((d) => d.data.length));
    expect(Math.max(...bars)).toBeLessThanOrEqual(8); // daily sums, not 168 hourly bars
    await expect(page.locator("#snowBox")).toBeVisible(); await expect(page.locator("#snowRead")).toContainText("Snow height"); await expect(page.locator("#snowRead")).toContainText("Snow depth rise"); await shot(page, "sheet-snow-7d", vp, scheme);
    await page.locator("#chartTabs button[data-tab='cond']").click();

    await page.evaluate(() => document.getElementById("checks").scrollIntoView()); // fully raised: the sheet covers the map
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0); expect(await hit(page, 100)).toBe("sheet");
    expect(problems).toEqual([]);
    await context.close();
  });
}

test("peek: current bulletin per region, Galzig forecast", async ({ browser }) => {
  const dg = fx("danger"), hr = fx("hourly"), now = Date.parse(fx("stations").updated);
  for (const r of Object.values(dg.regions)) r.valid_end = "2026-11-21T16:00:00Z";
  dg.regions["AT-07-10"].ratings = [{ level: 3, bound: null, elevation: null, period: null }];
  for (let h = 1; h <= 24; h++) { // model hours after "now": 1 cm per hour from hour 13, -8 … -1 °C
    const o = (hr.hours[vk(now + h * 3600e3)] ??= {});
    (o.sm ??= {})["TAWES-11110"] = h > 12 ? 1 : 0; (o.mt ??= {})["TAWES-11110"] = -8 + (h % 8);
  }
  const st = fx("stations"), ul = st.stations.find((x) => x.id === "SAUL2"); ul.date = st.updated; ul.hs = 52.6; // a fresh reading
  for (const [h, v] of [[0, 52.6], [-24, 43.4]]) { const k = vk(now + h * 3600e3); ((hr.hours[k] ??= {}).hs ??= {}).SAUL2 = v; }
  const { page, context, problems } = await open(browser, VIEWPORTS[0], "light", { fixtures: { danger: JSON.stringify(dg), hourly: JSON.stringify(hr), stations: JSON.stringify(st) } });
  const g = page.locator("#glance .stat");
  await expect(g).toHaveCount(6);
  await expect(g.nth(0)).toContainText("Lechtal Alps West"); await expect(g.nth(1)).toContainText("3 Considerable"); await expect(g.nth(1)).toContainText("Verwall Central");
  await expect(g.nth(5)).toContainText("+9 cm");
  await expect(g.nth(4)).toContainText("+12 cm"); await expect(g.nth(4)).toContainText("Galzig next 24 h · -8 / -1 °C");
  expect(VIEWPORTS[0].height - (await page.locator(".wrap").boundingBox()).y).toBeLessThan(VIEWPORTS[0].height * .3);
  await shot(page, "sheet-peek-current", VIEWPORTS[0], "light");
  expect(problems).toEqual([]);
  await context.close();
});
