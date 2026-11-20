const test = require("node:test");
const assert = require("node:assert/strict");
const { Linter } = require("eslint");
const rule = require("../eslint-rules/storage-in-try.js");

const linter = new Linter();
const run = (code, rules) => linter.verify(code, [{ plugins: { local: { rules: { "storage-in-try": rule } } }, languageOptions: { sourceType: "script", globals: { localStorage: "readonly" } }, rules }]);
const storage = { "local/storage-in-try": "error" };

test("storage-in-try", () => {
  assert.equal(run("try { localStorage.getItem('a'); } catch {}", storage).length, 0);
  assert.equal(run("function f() { try { const x = localStorage.a; } catch {} }", storage).length, 0);
  assert.equal(run("localStorage.getItem('a');", storage).length, 1);
  assert.equal(run("try {} catch { localStorage.getItem('a'); }", storage).length, 1, "catch block is not protected");
  assert.equal(run("try { f(); } finally { sessionStorage.x; }", storage).length, 1, "finally block is not protected");
});

test("spanGaps: true is rejected (config)", async () => {
  const { ESLint } = require("eslint");
  const e = new ESLint({ cwd: process.cwd() });
  const [r] = await e.lintText("new Chart({ spanGaps: true });", { filePath: "app.js" });
  assert.ok(r.messages.some((m) => m.ruleId === "no-restricted-syntax"));
  const [ok] = await e.lintText("new Chart({ spanGaps: false });", { filePath: "app.js" });
  assert.equal(ok.messages.length, 0);
});
