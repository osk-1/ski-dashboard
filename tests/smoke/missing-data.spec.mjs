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

  test(`unreadable reading time at ${vp.name}px`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, "light", { fixtures: { stations: bad }, storage: mine });
    await expect(page.locator("#updated")).toContainText("stations"); // not "Couldn't load"
    await expect(page.locator("#sumBody")).toContainText("no recent data (last unknown)");
    await expect(page.locator("#rows tr[data-id]").first()).toBeVisible();
    expect(problems).toEqual([]);
    await context.close();
  });
}
