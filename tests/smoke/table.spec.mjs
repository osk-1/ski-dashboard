/* global document, window */
// Station table (#40): temp + last reading columns, stale rows, sortable headers, change window switch.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { open, VIEWPORTS } from "./helpers.mjs";

const fx = JSON.parse(readFileSync(new URL("../fixtures/data/stations.json", import.meta.url)));
const mine = { tableOpen: "1", layers: JSON.stringify({ on: { snow: true, wind: true } }) };
const stale = JSON.stringify({ ...fx, stations: fx.stations.map((s) => (s.id === "KSIN2" ? { ...s, date: "2026-11-20T09:35:00+01:00" } : s)) });
const hourly = JSON.parse(readFileSync(new URL("../fixtures/data/hourly.json", import.meta.url))).hours;
const { delta, anchorMs } = createRequire(import.meta.url)("../../lib.js");
// the change cell's expected text, worked out from the fixture: HS now (the anchor hour) minus HS h hours earlier
const want = (id, h) => { const d = delta(hourly, "hs", id, anchorMs(hourly, Date.parse(fx.updated)), h)?.d; return d == null ? "–" : (d > 0 ? "+" : "") + d; };
const chg = (page, id) => page.locator(`#rows tr[data-id="${id}"] td:nth-child(4)`);
const col = (page, i) => page.locator(`#rows tr[data-id] td:nth-child(${i})`).allInnerTexts();

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"]) {
    test(`table at ${vp.name}px, ${scheme}`, async ({ browser }) => {
      const { page, context, problems } = await open(browser, vp, scheme, { storage: mine, fixtures: { stations: stale } });
      await expect(page.locator("#rows tr[data-id]").first()).toBeVisible();
      await expect(page.locator("#tbl thead th")).toHaveCount(7);
      await expect(page.locator("#tbl th[data-k=alt]")).toHaveAttribute("aria-sort", "descending");
      const alts = (await col(page, 2)).map((t) => parseInt(t));
      expect(alts).toEqual([...alts].sort((a, b) => b - a));
      await expect(page.locator("#chgHead")).toHaveText("Δ HS 24 h");
      await page.locator("#tableDetails").screenshot({ path: `test-results/screens/table-default-${vp.name}-${scheme}.png` });

      expect((await col(page, 4)).filter((t) => t !== "–").length).toBeGreaterThan(0); // 24 h change comes from hourly.json
      expect(want("SKAP2", 24)).not.toBe("–");
      await expect(chg(page, "SKAP2")).toHaveText(want("SKAP2", 24)); // the value itself: right sign, anchored at the last measured hour

      // sort by HS: descending first, then ascending; stale/missing last either way
      await page.click("#tbl th[data-k=hs] button");
      await expect(page.locator("#tbl th[data-k=hs]")).toHaveAttribute("aria-sort", "descending");
      await expect(page.locator("#tbl th[data-k=alt]")).toHaveAttribute("aria-sort", "none");
      const hs = async () => (await page.locator("#rows tr[data-id]").evaluateAll((trs) => trs.map((t) => (t.querySelector("td:nth-child(3) s") ? NaN : parseFloat(t.querySelector("td:nth-child(3)").textContent))))).map((v) => (isNaN(v) ? null : v));
      let v = await hs(), n = v.filter((x) => x != null);
      expect(n.length).toBeGreaterThan(2);
      expect(v.slice(0, n.length)).toEqual([...n].sort((a, b) => b - a));
      expect(v.slice(n.length).every((x) => x == null)).toBe(true);
      expect(v.length).toBeGreaterThan(n.length); // the stale/gauge-less rows exist and sit last
      await page.locator("#tableDetails").screenshot({ path: `test-results/screens/table-sorted-${vp.name}-${scheme}.png` });
      await page.click("#tbl th[data-k=hs] button");
      await expect(page.locator("#tbl th[data-k=hs]")).toHaveAttribute("aria-sort", "ascending");
      v = await hs(); n = v.filter((x) => x != null);
      expect(v.slice(0, n.length)).toEqual([...n].sort((a, b) => a - b));
      expect(v.slice(n.length).every((x) => x == null)).toBe(true);

      // header clicks do not select a row; row click still does
      const sel = await page.locator("#rows tr[aria-selected=true]").getAttribute("data-id");
      await page.click("#tbl th[data-k=wg] button");
      await expect(page.locator("#rows tr[aria-selected=true]")).toHaveAttribute("data-id", sel);

      // the change column follows the window: 72 h values differ from the 24 h ones (the fixture covers 7 days)
      const d24 = await col(page, 4);
      await page.selectOption("#chgSel", "72");
      await expect(page.locator("#chgHead")).toHaveText("Δ HS 72 h");
      expect(await col(page, 4)).not.toEqual(d24);
      await expect(chg(page, "SKAP2")).toHaveText(want("SKAP2", 72));

      // change window persists and relabels
      await page.selectOption("#chgSel", "168");
      await expect(page.locator("#chgHead")).toHaveText("Δ HS 7 d");
      await page.reload();
      await expect(page.locator("#chgHead")).toHaveText("Δ HS 7 d");
      await expect(page.locator("#chgSel")).toHaveValue("168");
      expect(await page.evaluate(() => localStorage.getItem("chgH"))).toBe("168");

      // stale row, temp and last reading columns
      const row = page.locator('#rows tr[data-id="KSIN2"]');
      await expect(row).toHaveClass(/stale/);
      await expect(row.locator(".tag")).toHaveText("stale");
      await expect(row.locator("td.last")).toHaveText("09:35");
      await expect(row.locator("td.last")).toHaveAttribute("title", /20 Nov/);
      await expect(page.locator("#rows tr[data-id]:not(.stale) td:nth-child(6)", { hasText: "°" }).first()).toBeVisible();
      await expect(page.locator('#rows tr[data-id="VOR-ZURS1"]')).not.toHaveClass(/stale/);

      // fits: no page-level horizontal overflow
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
