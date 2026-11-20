// Every key fetch.py writes to data/*.json (taken from the committed fixtures) must appear in the README as `key`.
import { readFileSync } from "node:fs";

const read = (f) => JSON.parse(readFileSync(new URL(`../tests/fixtures/data/${f}.json`, import.meta.url), "utf8"));
const keys = new Set();
const add = (o) => Object.keys(o).forEach((k) => keys.add(k));
const stations = read("stations"), forecast = read("forecast"), danger = read("danger");
add(stations); stations.stations.forEach(add);
add(forecast); Object.values(forecast.points).forEach(add);
Object.values(read("readings")).forEach(add); // slot keys are dynamic; the keys inside a slot are the fields
add(danger);
for (const r of Object.values(danger.regions)) { add(r); r.ratings.forEach(add); r.problems.forEach(add); }

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const missing = [...keys].filter((k) => !readme.includes("`" + k + "`") && !readme.includes("`" + k + ":") && !new RegExp("`[^`\\n]*\\b" + k + "\\b[^`\\n]*`").test(readme));
if (missing.length) { console.error("Not documented in README.md: " + missing.join(", ")); process.exit(1); }
console.log(`README documents all ${keys.size} data fields`);
