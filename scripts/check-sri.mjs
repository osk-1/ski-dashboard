// Every external <script src> / <link rel=stylesheet> in index.html: exact version in the URL + an integrity attribute.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];
const bad = [];
for (const tag of tags) {
  const url = /\b(?:src|href)="(https?:\/\/[^"]+)"/i.exec(tag)?.[1];
  if (!url || (/^<link/i.test(tag) && !/rel="stylesheet"/i.test(tag))) continue;
  if (!/\d+\.\d+\.\d+/.test(url)) bad.push(`${url}: no exact x.y.z version in the URL`);
  if (!/\bintegrity="sha(256|384|512)-[^"]+"/i.test(tag)) bad.push(`${url}: missing integrity attribute`);
}
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
console.log(`SRI ok (${tags.length} tags checked)`);
