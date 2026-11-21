/* global document, window */
// Summary strip (#40): altitude bands with counts, own persisted window switch, strongest gust, no overflow.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, shot, VIEWPORTS } from "./helpers.mjs";

const stations = JSON.parse(readFileSync(new URL("../fixtures/data/stations.json", import.meta.url))).stations.filter((s) => !s.flags?.station);
const hourly = JSON.parse(readFileSync(new URL("../fixtures/data/hourly.json", import.meta.url))).hours;
const past = Object.keys(hourly).filter((k) => k >= "2026-11-19T17" && k <= "2026-11-20T16"), next = Object.keys(hourly).filter((k) => k > "2026-11-20T16" && k <= "2026-11-21T16");
const hasHs = (id) => Object.values(hourly).some((h) => h.hs?.[id] != null);
// a station counts when it has temperature or HS rise in the last 24 h, or (with an HS series) model snowfall in the next 24 h
const has = (id) => past.some((k) => hourly[k].lt?.[id] != null || (hasHs(id) && hourly[k].hr?.[id] != null)) || (hasHs(id) && next.some((k) => hourly[k].sm?.[id] != null));
const count = (lo, hi) => stations.filter((s) => s.alt >= lo && s.alt < hi && has(s.id)).length;

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`summary strip at ${vp.name}px, ${scheme}`, async ({ browser }) => {
      const { page, context, problems } = await open(browser, vp, scheme);
      const sum = page.locator("#summary");
      await expect(page.locator("#updated")).toContainText("stations");
      await expect(page.locator("#sumWin button[data-h='24']")).toHaveAttribute("aria-pressed", "true");
      await expect(sum).not.toContainText("Average of");
      await expect(sum).toContainText("Deepest ·");
      // band cards: counts from the fixture (empty bands omitted)
      for (const [name, n] of [["Valley", count(0, 1600)], ["Mid", count(1600, 2201)], ["High", count(2201, 1e9)]]) {
        const card = sum.locator(".band", { hasText: `${name} (` });
        if (n) await expect(card.locator("h3")).toContainText(`${n} station${n > 1 ? "s" : ""}`); else await expect(card).toHaveCount(0);
      }
      await expect(sum).toContainText("New snow last 24 h, measured");
      await expect(sum).toContainText("Next 24 h, model · Open-Meteo");
      await expect(sum).toContainText(/Strongest gust, last 24 h · \S.* · .*from [NSEW]/);
      await expect(sum.locator(".band", { hasText: "High (" })).toHaveCount(1); // wind-only stations count although the Wind layer is off
      const text24 = await sum.innerText();
      await shot(page, "summary-24h", vp, scheme);

      await page.click("#sumWin button[data-h='168']");
      await expect(sum).toContainText("New snow last 168 h, measured");
      await expect(sum).toContainText(/measured · \d+ of 168 h/); // a station with fewer hourly rises than the window is marked partial
      expect(await sum.innerText()).not.toBe(text24);
      await shot(page, "summary-7d", vp, scheme);
      await page.reload();
      await expect(page.locator("#sumWin button[data-h='168']")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#condWin button[data-h='24']")).toHaveAttribute("aria-pressed", "true"); // other switches untouched

      await page.click("#sumWin button[data-h='1']");
      await expect(sum).toContainText("last 1 h");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
