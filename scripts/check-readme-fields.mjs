// Every key fetch.py writes to data/*.json (taken from the committed fixtures) must appear in the README as `key`.
import { readFileSync } from "node:fs";

const read = (f) => JSON.parse(readFileSync(new URL(`../tests/fixtures/data/${f}.json`, import.meta.url), "utf8"));
const keys = new Set();
const add = (o) => Object.keys(o).forEach((k) => keys.add(k));
const stations = read("stations"), danger = read("danger");
add(stations); stations.stations.forEach((s) => { add(s); add(s.flags); if (s.dates) add(s.dates); }); // flags/dates keys are fields or "station"
const hourly = read("hourly");
add(hourly); add(hourly.model);
Object.values(hourly.hours).forEach(add); // hour keys are dynamic; the keys inside an hour are the fields
// hours[k].flags is {stationId: {field: reason}}: ids are dynamic, fields are covered above
const health = read("health");
add(health); add(health.sources); Object.values(health.sources).forEach(add);
health.flagged.forEach(add); health.offline.forEach(add);
add(danger);
for (const r of Object.values(danger.regions)) { add(r); r.ratings.forEach(add); r.problems.forEach(add); }

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const missing = [...keys].filter((k) => !readme.includes("`" + k + "`") && !readme.includes("`" + k + ":") && !new RegExp("`[^`\\n]*\\b" + k + "\\b[^`\\n]*`").test(readme));
if (missing.length) { console.error("Not documented in README.md: " + missing.join(", ")); process.exit(1); }
console.log(`README documents all ${keys.size} data fields`);
