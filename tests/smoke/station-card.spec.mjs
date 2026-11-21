/* global document, MouseEvent, map, fitZ, select */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, shot, VIEWPORTS } from "./helpers.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/data/${name}.json`, import.meta.url)));
// the staleness cases of accuracy.spec.mjs data()
function stale() {
  const d = fixture("stations");
  const st = (id) => d.stations.find((s) => s.id === id);
  st("VOR-ZURS1").date = "2026-11-20T13:35:00+01:00"; // 3 h old: wind stale, HS fresh
  Object.assign(st("SAGA1"), { wg: 0, wg_boe: 0, flags: { wg: "sensor frozen?", wg_boe: "sensor frozen?", wr: "sensor frozen?" } });
  return JSON.stringify(d);
}
// zoom onto the station first (tier 2 merges nothing), then click its marker
const tap = (page, id) => { const s = fixture("stations").stations.find((x) => x.id === id); return page.evaluate(([i, lat, lon]) => { map.setView([lat, lon], fitZ + 2, { animate: false }); document.querySelector(`#map [data-sid="${i}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true })); }, [id, s.lat, s.lon]); };

for (const vp of VIEWPORTS) for (const scheme of ["light", "dark"]) {
  test(`station card at ${vp.name}px, ${scheme}`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, scheme, { fixtures: { stations: stale() }, storage: { layers: JSON.stringify({ on: { snow: true, wind: true } }) } });
    const card = page.locator("#stationCard");
    await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();

    await page.evaluate(() => select("SKAP2")); // the selection the card previews must not change
    await tap(page, "VOR-ZURS1"); // wind stale, HS fresh, 1920 m
    await expect(card).toBeVisible(); await expect(page.locator("#scAlt")).toHaveText("1920 m");
    const title = await page.locator("#scTitle").textContent();
    await expect(card).toBeFocused();
    const hs = page.locator("#scRows .scr", { hasText: "Snow height" }), wind = page.locator("#scRows .scr", { hasText: /^Wind(?! direction)/ });
    await expect(hs).toContainText("23 cm"); await expect(hs).toContainText(/\d:\d\d/); // number + age
    await expect(wind).toContainText("no recent data"); await expect(wind).not.toContainText("42.8"); await expect(wind).not.toContainText("43 km");
    await expect(page.locator("#scRows .scr", { hasText: "New snow" })).toHaveCount(0); // not measured here
    await shot(page, "station-card", vp, scheme);
    expect((await card.boundingBox()).height).toBeLessThanOrEqual(vp.height * 0.45 + 1);
    for (const b of ["#scClose", "#scOpen"]) expect((await page.locator(b).boundingBox()).height).toBeGreaterThanOrEqual(44);

    await tap(page, "SAGA1"); // wind-only, flagged: suspect, no HS row
    await expect(page.locator("#scRows")).toContainText("suspect: sensor frozen?");
    await expect(page.locator("#scRows .scr", { hasText: "Snow height" })).toHaveCount(0);
    await tap(page, "SKAP2"); await expect(page.locator("#scTitle")).not.toHaveText(title); // swapped
    await tap(page, "VOR-ZURS1"); await expect(page.locator("#scTitle")).toHaveText(title);

    await page.keyboard.press("Escape"); // first Escape: card only
    await expect(card).toBeHidden();
    await expect(page.locator('#map [data-sid="VOR-ZURS1"]')).toBeFocused();
    await tap(page, "VOR-ZURS1"); await expect(card).toBeVisible();
    await page.locator("#scClose").click(); await expect(card).toBeHidden();
    await tap(page, "VOR-ZURS1"); await expect(card).toBeVisible();
    await page.locator("#map").click({ position: { x: 5, y: 80 } }); await expect(card).toBeHidden(); // empty map

    await tap(page, "VOR-ZURS1"); await expect(card).toBeVisible(); await page.locator("#scClose").click(); // preview only: selection and charts stay on SKAP2
    await expect(page.locator("#stnSel")).toHaveValue("SKAP2");
    expect(await page.evaluate(() => localStorage.getItem("sel"))).toBe("SKAP2");
    await tap(page, "VOR-ZURS1"); await page.getByRole("button", { name: "Open charts" }).click();
    await expect(page.locator("#stnSel")).toHaveValue("VOR-ZURS1");
    await expect.poll(async () => (await page.locator(".chartsec").boundingBox()).y, { timeout: 4000 }).toBeLessThan(40); // scrolled to the top of the charts (smooth scroll settles)
    expect(problems).toEqual([]);
    await context.close();
  });
}

// #60: Open charts picks the relevant tab (not persisted); a station tapped near the bottom stays above the card
test("station card: wind station opens on Wind, map keeps the station above the card", async ({ browser }) => {
  const { page, context, problems } = await open(browser, VIEWPORTS[0], "light", { storage: { tab: "cond", layers: JSON.stringify({ on: { snow: true, wind: true } }) } });
  const card = page.locator("#stationCard");
  await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
  const s = fixture("stations").stations.find((x) => x.id === "SKAP1");
  await page.evaluate(([lat, lon]) => { // put the station at the bottom of the map, where the card will be
    map.setView([lat, lon], fitZ + 2, { animate: false });
    const h = map.getSize().y; map.panBy([0, h / 2 - 20], { animate: false }); // station now 20 px from the map's bottom edge
    document.querySelector('#map [data-sid="SKAP1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, [s.lat, s.lon]);
  await expect(card).toBeVisible();
  await expect.poll(async () => (await page.locator('#map [data-sid="SKAP1"]').boundingBox()).y + (await page.locator('#map [data-sid="SKAP1"]').boundingBox()).height).toBeLessThanOrEqual((await card.boundingBox()).y);
  await page.getByRole("button", { name: "Open charts" }).click();
  await expect(page.locator(".chartsec")).toHaveAttribute("data-tab", "wind");
  expect(await page.evaluate(() => localStorage.getItem("tab"))).toBe("cond"); // auto-chosen tab is not saved
  await page.evaluate(() => select("SKAP2")); // the wind pick does not stick: a snow station opens on the user's tab
  await expect(page.locator(".chartsec")).toHaveAttribute("data-tab", "cond");
  expect(problems).toEqual([]);
  await context.close();
});
