// Missing or broken data: no hourly.json on first load, a station with an unreadable reading time. The page must still work, with no console error.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, VIEWPORTS } from "./helpers.mjs";

const fx = JSON.parse(readFileSync(new URL("../fixtures/data/stations.json", import.meta.url)));
const mine = { tableOpen: "1", layers: JSON.stringify({ on: { snow: true, wind: true, weather: true } }) };
const bad = JSON.stringify({ ...fx, stations: fx.stations.map((s) => (s.id === "KSIN2" ? { ...s, date: "n/a" } : s)) });

for (const vp of VIEWPORTS) {
  test(`hourly.json missing on first load at ${vp.name}px`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, "light", { fixtures: { hourly: null }, storage: { ...mine, sel: "SKAP2" } });
    await expect(page.locator("#updated")).toContainText("stations");
    await expect(page.locator("#updated")).toContainText("hourly data couldn't be refreshed");
    for (const id of ["cond", "snow", "wind"]) await expect(page.locator(`#${id}Note`)).toContainText("No hourly data");
    await expect(page.locator("#condPanel")).toBeVisible(); // the sheet starts on Conditions
    await expect(page.locator("#rows tr[data-id]").first()).toBeVisible(); // the rest of the page works
    expect(problems.filter((p) => !p.includes("404"))).toEqual([]); // the browser logs the 404 itself; no page error
    await context.close();
  });

  test(`hourly.json back after a failed refresh redraws at ${vp.name}px`, async ({ browser }) => {
    // loads: 1 an empty hourly, 2 a failed one (old kept), 3 the real one; stations.json never changes, as between night runs
    let n = 0;
    const setup = (page) => page.route("**/data/hourly.json", (route) => (++n === 2 ? route.fulfill({ status: 404, body: "" }) : n === 1 ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ model: {}, hours: {} }) }) : route.fallback()));
    const { page, context } = await open(browser, vp, "light", { setup, storage: { ...mine, sel: "SKAP2" } });
    await expect(page.locator("#condNote")).toContainText("No hourly data for this station");
    const refresh = async (min) => { await page.clock.setFixedTime(new Date(Date.parse(fx.updated) + min * 60e3)); await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); }; // a tab shown again after 30+ min reloads
    await refresh(31);
    await expect(page.locator("#updated")).toContainText("hourly data couldn't be refreshed");
    await refresh(62);
    await expect(page.locator("#updated")).not.toContainText("couldn't be refreshed");
    await expect(page.locator("#condNote")).not.toContainText("No hourly data for this station"); // the good hourly.json is drawn
    await context.close();
  });

  test(`unreadable reading time at ${vp.name}px`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, "light", { fixtures: { stations: bad }, storage: mine });
    await expect(page.locator("#updated")).toContainText("stations"); // not "Couldn't load"
    await expect(page.locator("#sumBody")).toContainText("no recent data (last unknown)");
    await expect(page.locator("#checkList")).toContainText("Kappl Sinsenergampen offline: no measurement for over 24 h (last unknown)"); // not 1 Jan 1970
    await expect(page.locator("#rows tr[data-id]").first()).toBeVisible();
    expect(problems).toEqual([]);
    await context.close();
  });
}
