// Shared Playwright setup: fixtures for data/, blank map tiles, fixed clock, error collection. Not a spec (testMatch only takes *.spec.mjs).
import { readFileSync } from "node:fs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const fixture = (name) => readFileSync(new URL(`../fixtures/data/${name}.json`, import.meta.url));

// iPhone 13 / 13 Pro Max widths
export const DESKTOP = { name: "1280", width: 1280, height: 800 };
export const VIEWPORTS = [{ name: "390", width: 390, height: 844 }, { name: "430", width: 430, height: 932 }];

// overrides: { setup: async (page) => extra page.route calls; desktop: true for a mouse, non-mobile context; storage: {key: value} seeded into localStorage, fixtures: {name: Buffer|string} replacing a data file, null = 404 }
// Returns { page, context, problems }; problems collects console errors and page exceptions.
export async function open(browser, vp, scheme, overrides = {}) {
  const context = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1, isMobile: !overrides.desktop, hasTouch: !overrides.desktop });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`exception: ${e.message}`));
  await page.route("**/data/*.json", (route) => {
    const name = new URL(route.request().url()).pathname.match(/(\w+)\.json$/)[1];
    if (overrides.fixtures?.[name] === null) return route.fulfill({ status: 404, body: "" }); // a data file that is missing
    return route.fulfill({ contentType: "application/json", body: overrides.fixtures?.[name] ?? fixture(name) });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|cdnjs\.cloudflare\.com)/, (route) => {
    const url = route.request().url();
    if (url.includes("arcgisonline")) return route.fulfill({ contentType: "image/png", body: PNG });
    if (url.includes("fonts.googleapis")) return route.fulfill({ contentType: "text/css", body: "" });
    return route.abort();
  });
  if (overrides.storage) await page.addInitScript((kv) => { try { for (const k in kv) localStorage.setItem(k, kv[k]); } catch { /* storage blocked */ } }, overrides.storage);
  await overrides.setup?.(page); // extra routes, registered after (so ahead of) the catch-all
  await page.clock.setFixedTime(new Date(JSON.parse(fixture("stations")).updated)); // "now" = the fixture's run time
  await page.goto("/index.html");
  return { page, context, problems };
}

// optional locator: element screenshot instead of the viewport (a tall element, e.g. the map panel, is framed whole)
export const shot = (page, name, vp, scheme, locator = page) => locator.screenshot({ path: `test-results/screens/${name}-${vp.name}-${scheme}.png` });

// the sheet shows one chart at a time: switch to its tab (cond | snow | wind)
export const tab = (page, name) => page.locator(`#chartTabs button[data-tab="${name}"]`).click();
