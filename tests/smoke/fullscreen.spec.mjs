/* global map, exitFs, document, window, history, scrollY, Element -- page globals inside page.evaluate */
import { expect, test } from "@playwright/test";
import { open, shot, VIEWPORTS } from "./helpers.mjs";

const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const settle = (page) => page.waitForTimeout(400); // resize handler re-fits after 150 ms

// css: hide requestFullscreen so the iPhone Safari path is used; api: the real Fullscreen API
for (const mode of ["css", "api"]) for (const vp of VIEWPORTS) for (const scheme of ["light", "dark"]) {
  test(`full screen (${mode}) at ${vp.name}px, ${scheme}`, async ({ browser }) => {
    const { page, context, problems } = await open(browser, vp, scheme, {});
    if (mode === "css") { await page.addInitScript(() => { Element.prototype.requestFullscreen = undefined; }); await page.reload(); }
    const btn = page.getByRole("button", { name: "Full screen", exact: true });
    await expect(page.locator("#map path.leaflet-interactive").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset view" })).toBeVisible();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => window.scrollTo(0, 120)); const y0 = await page.evaluate(() => scrollY);
    expect(await page.evaluate(() => map.dragging.enabled())).toBe(false);

    const enter = async () => { await btn.click(); await expect(btn).toHaveAttribute("aria-pressed", "true"); await settle(page); };
    const exited = async () => { await expect(btn).toHaveAttribute("aria-pressed", "false"); await expect(page.locator("#mapPanel")).not.toHaveClass(/fs/); await settle(page); expect(await page.evaluate(() => scrollY)).toBe(y0); expect(await page.evaluate(() => map.dragging.enabled())).toBe(false); await expect(btn).toBeFocused(); };
    const fills = async (w, h) => {
      expect(await box(page, "#mapPanel")).toEqual({ x: 0, y: 0, w, h });
      const ex = await box(page, "#fsExit"); expect(ex.w).toBeGreaterThanOrEqual(44); expect(ex.h).toBeGreaterThanOrEqual(44);
      expect(ex.x + ex.w).toBeLessThanOrEqual(w); expect(ex.y).toBeGreaterThanOrEqual(0);
      const lay = await box(page, "#map .lay"); expect(lay.y).toBeGreaterThanOrEqual(ex.y + ex.h); // layers control clear of Exit
      expect((await box(page, "#map .leaflet-left .leaflet-bar:last-child button")).h).toBeGreaterThanOrEqual(44); // Full screen control
      expect(await page.evaluate(() => map.dragging.enabled())).toBe(true);
      const m = await page.evaluate(() => ({ s: map.getSize(), c: document.getElementById("map").getBoundingClientRect() }));
      expect([m.s.x, m.s.y]).toEqual([Math.round(m.c.width), Math.round(m.c.height)]);
    };

    await enter(); await fills(vp.width, vp.height);
    if (mode === "api") expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await page.getByRole("button", { name: "Legend", exact: true }).click(); await expect(page.locator("#legend")).toBeVisible();
    await shot(page, "fullscreen-portrait", vp, scheme);
    await page.getByRole("button", { name: "Legend", exact: true }).click(); await expect(page.locator("#legend")).toBeHidden();

    if (vp.name === "390" && mode === "css") { // rotation (a real fullscreen window cannot be resized by the test)
      await page.setViewportSize({ width: 844, height: 390 }); await settle(page); await fills(844, 390);
      if (scheme === "light") await shot(page, "fullscreen-landscape", vp, scheme);
      await page.setViewportSize({ width: vp.width, height: vp.height }); await settle(page);
    }
    await page.locator("#fsExit").click(); await exited();                                   // ✕
    await enter(); await page.keyboard.press("Escape"); await exited();                      // Escape
    await enter(); await page.goBack(); await exited();                                      // Android back (popstate)
    expect(await page.evaluate(() => history.state?.fs)).toBeUndefined();
    await enter(); await page.evaluate(() => exitFs()); await exited();                      // shared exit
    expect(problems).toEqual([]);
    await context.close();
  });
}
