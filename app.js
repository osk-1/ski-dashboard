const BOUNDS = { lon0: 10.09, lon1: 10.43, lat0: 47.003, lat1: 47.240 }; // west: east edge of the Sonnenkopf ski area; north: 2 km south of Warth
const PLACES = [["St. Anton", 10.2636, 47.1295], ["St. Christoph", 10.2135, 47.1277], ["Pettneu", 10.3428, 47.1453],
  ["Ischgl", 10.2921, 47.0125]];
const PEAKS = [["Valluga 2811", 10.2125, 47.1575, true], ["Scheibler 2978", 10.2220, 47.0587, true], ["Augstenbergkopf 2881", 10.2402, 47.0775, true],
  ["Maroikopf 2529", 10.1632, 47.1136, false],["Kaltenberg 2896", 10.1383, 47.0865, false], ["Trittkopf 2720", 10.1935, 47.1553, false], ["Rüfispitze 2636", 10.1846, 47.1919, false],
  ["Madlochspitze 2545", 10.1226, 47.1792, false], ["Erzbergspitze 2536", 10.1421, 47.1531, false], ["Wildebene 2570", 10.1803, 47.0958, false], ["Saumspitze 3039", 10.2696, 47.0509, true], ["Kreuzjochspitze 2919", 10.3061, 47.0793, true],
  ["Hochkarspitze 2836", 10.3076, 47.1108, true], ["Erlijoch 2431", 10.2179, 47.1756, false], ["Roßfallscharte 2732", 10.2887, 47.0945, false]];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtSlot = t => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
const arrow = (x, y, to, c) => `<path d="M0-10L6 2H2.5V10H-2.5V2H-6Z" fill="${c}" transform="translate(${x} ${y}) rotate(${to})"/>`;

let state = { stations: [], readings: [], danger: null, regions: null, hourly: null, health: null, updated: null, selected: null };
const win = { cond: 24, snow: 72, wind: 24 }; // chart windows in hours, one switch per chart
const winKey = k => k + "H"; // localStorage keys condH, snowH, windH
let charts = {};
try { state.selected = localStorage.getItem("sel"); } catch {}
for (const k in win) try { win[k] = winOr(+localStorage.getItem(winKey(k)), win[k]); } catch {}

function delta24(id) {
  const r = state.readings; if (r.length < 2) return null;
  const last = [...r].reverse().find(x => x.hs[id] != null); if (!last) return null;
  const cutoff = new Date(last.t) - 24 * 3600e3, prev = [...r].reverse().find(x => new Date(x.t) <= cutoff);
  const a = last.hs[id], b = prev?.hs[id];
  return a == null || b == null ? null : Math.round(a - b);
}

// accuracy (#42): words for what is wrong with a value, never the value itself
const FN = { hs: "snow height", n24: "new snow 24 h", hsd24: "24 h change", lt: "air temp", oft: "snow surface", rh: "humidity", wg: "wind", wg_boe: "gusts", wr: "wind direction" };
const fmtLast = t => viennaKey(t).slice(0, 10) === viennaKey(Date.now()).slice(0, 10) ? fmtHour(t) : fmtSlot(t);
const badText = v => v.suspect ? `suspect: ${v.reason}` : `no recent data (last ${fmtLast(v.last)})`;
const isBad = v => !v.ok && !v.missing;
const group = (xs, key) => xs.reduce((o, x) => ((o[key(x)] ??= []).push(x), o), Object.create(null)); // Object.groupBy needs Safari 17.4
const badList = bad => Object.entries(group(Object.entries(bad), ([, v]) => badText(v))).map(([t, fs]) => `${fs.map(([f]) => FN[f]).join(", ")}: ${t}`).join("; ");

let sumH = 24; // summary window in hours (key sumH)
try { sumH = winOr(+localStorage.getItem("sumH"), 24); } catch {}
function renderSummary() {
  const sh = shown(), s = sh.filter(x => x.hs != null), hours = state.hourly?.hours || {}, now = anchorMs(hours, Date.now()), el = document.getElementById("sumBody");
  for (const b of document.getElementById("sumWin").children) b.setAttribute("aria-pressed", +b.dataset.h === sumH);
  const left = sh.filter(x => Object.keys(x.bad).length).map(x => `${esc(x.name)} (${esc(badList(x.bad))})`);
  const note = left.length ? `<p class="src xl">Not current or suspect: ${left.join(" · ")}.</p>` : "";
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  const deep = s.length ? s.reduce((a, b) => b.hs > a.hs ? b : a) : null;
  // every placed station of any type, independent of the map layers; hourly flags are limit checks only, so a station whose gust is flagged now (frozen, stuck) is left out of the gust
  const all = placed(), bs = bandStats(all, hours, now, sumH), src = state.hourly?.model?.source || "source unknown";
  const t = v => v == null ? "–" : v, g = strongestGust(hours, all.filter(x => !x.flags?.wg_boe && !x.flags?.wg), now, sumH), gs = g && all.find(x => x.id === g.id);
  const cov = (hh, of, n, all) => `${hh != null && hh < of ? ` · ${hh} of ${of} h` : ""}${n && n !== all ? ` · n=${n}` : ""}`;
  const cards = BANDS.filter(([k]) => bs[k].n > 0).map(([k, name, rng]) => { const r = bs[k]; return `<div class="stat band"><h3>${name} (${rng}) · ${r.n} station${r.n > 1 ? "s" : ""} <small>n=${r.n}, median</small></h3>
    <div><b${r.snowLast == null ? ' title="No data in this window"' : ""}>${r.snowLast == null ? "–" : `+${r.snowLast} cm`}</b><span>New snow last ${sumH} h, measured${cov(r.snowLastH, r.of, r.snowLastN, r.n)}</span></div>
    <div><b${r.snowNext == null ? ' title="No forecast for these stations"' : ""}>${r.snowNext == null ? "–" : `+${r.snowNext} cm`}</b><span>Next ${sumH} h, model · ${esc(src)}${cov(r.snowNextH, r.of, r.snowNextN, r.n)}</span></div>
    <div><b${r.tmin == null ? ' title="No data in this window"' : ""}>${t(r.tmin)} / ${t(r.tmax)} °C</b><span>Min / max last ${sumH} h, measured${cov(null, 0, r.tminN, r.n)}</span></div></div>`; }).join("");
  el.innerHTML = stat(deep ? `${Math.round(deep.hs)} cm` : "–", deep ? `Deepest · ${esc(deep.name)}` : "Deepest station")
    + (g ? stat(`${Math.round(g.y)} km/h`, `Strongest gust, last ${sumH} h · ${esc(gs?.name ?? g.id)} · ${g.wr == null ? "direction unknown" : `<span style="display:inline-block;transform:rotate(${(g.wr + 180) % 360}deg)" aria-hidden="true">↑</span> from ${compass(g.wr)}`} · ${fmtSlot(keyMs(g.k))}`)
      : `<div class="stat"><b title="No data in this window">–</b><span>Strongest gust, last ${sumH} h</span></div>`)
    + (cards || '<p class="src xl">No station data in this window.</p>') + note;
}
document.getElementById("sumWin").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  sumH = winOr(+b.dataset.h, sumH);
  try { localStorage.setItem("sumH", sumH); } catch {}
  renderSummary();
});

const DG = ["No rating", "Low", "Moderate", "Considerable", "High", "Very high"];
const dchip = (l, t = "") => `<span class="dg dg${l}">${l ? l + " " : ""}${t || DG[l]}</span>`;
function renderDanger() {
  const rs = Object.entries(state.danger?.regions || {}), box = document.getElementById("danger"), top = document.getElementById("dangerChip");
  box.hidden = top.hidden = !rs.length;
  if (!rs.length) return;
  // per region: one bulletin can be current while the other is a leftover from an earlier run
  const stale = r => new Date(r.valid_end) < new Date(), cur = rs.filter(([, r]) => !stale(r)), old = !cur.length;
  const fmt = r => new Date(r.valid_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" });
  const day = fmt(rs[0][1]);
  const mx = Math.max(0, ...(old ? rs : cur).flatMap(([, r]) => r.ratings.map(x => x.level)));
  top.className = "meta" + (old ? " old" : "");
  top.innerHTML = `Avalanche danger ${dchip(mx)}` + (old ? ` Last bulletin: ${day}, not current` : "");
  box.className = "panel" + (old ? " old" : "");
  box.innerHTML = `<h2>Avalanche danger${old ? ` <span class="meta">last bulletin ${day}, not current</span>` : ""}</h2>` + rs.map(([, r]) => {
    const by = {}; // highest level per elevation band, over all day periods
    for (const x of r.ratings) { const k = x.bound + x.elevation; if (!by[k] || x.level > by[k].level) by[k] = x; }
    const parts = Object.values(by).sort((a, b) => (a.bound === "below") - (b.bound === "below")).map(x => dchip(x.level, x.bound ? `${x.bound} ${esc(x.elevation)}${isNaN(x.elevation) ? "" : " m"}` : ""));
    const pr = [...new Set(r.problems.map(p => p.type.replace(/_/g, " ")))].map(esc).join(", ");
    const note = !old && stale(r) ? ` <span class="meta">last bulletin ${fmt(r)}, not current</span>` : "";
    return `<div${note ? ' class="old"' : ""}><b>${esc(r.name)}</b>${note} ${parts.join(" ")}${pr ? `<span class="meta">${pr}</span>` : ""}</div>`;
  }).join("");
}

let map, groups, dangerLayer, dangerOk, lc, lp, fitBounds, fitZ;
const landmarks = [];
const mapDiv = document.getElementById("map");
document.getElementById("legend").addEventListener("click", e => { const b = e.target.closest("button"); if (b) b.setAttribute("aria-expanded", e.currentTarget.classList.toggle("open")); });
const phone = () => matchMedia("(max-width: 820px), (max-height: 500px) and (orientation: landscape)").matches;
// Map layer selector: station categories (a data array, so more can be added) + the avalanche-danger overlay.
const CATS = [["snow", "Snow"], ["wind", "Wind"], ["weather", "Weather"]];
const catOf = s => s.type === "wind" || s.type === "weather" ? s.type : "snow";
const DGC = ["#9aa5b1", "#ccff66", "#ffff00", "#ff9900", "#ff0000", "#000"]; // same as .dg0..dg5
let lay = { on: {}, hide: [] }; // hide: station ids, so new stations default to visible
try { const j = JSON.parse(localStorage.getItem("layers")); if (j) { if (typeof j.on === "object" && j.on) lay.on = j.on; if (Array.isArray(j.hide)) lay.hide = j.hide; if (typeof j.nsh === "number") lay.nsh = j.nsh; } } catch {}
const vis = s => lay.on[catOf(s)] && !lay.hide.includes(s.id); // dot, label, table row, summary
const arrowVis = s => arrowOn(s) && s.type !== "wind" && lay.on.wind && !lay.hide.includes(s.id); // small wind arrow above a snow/weather dot
const placed = () => state.stations.filter(s => !misplaced(s)); // a station reported somewhere else is not shown at all
const shown = () => placed().filter(vis).map(s => goodOnly(s, Date.now())); // map and summary: good values only, the rest null with the reason in .bad
for (const k of [...CATS.map(c => c[0]), "danger", "peaks"]) lay.on[k] ??= !phone() || k === "snow"; // defaults: phone shows snow only; a saved choice wins
lay.on.newsnow ??= false; lay.nsh ??= 24; // off everywhere: it fetches extra images
// New-snow overlay (avalanche.report): config loaded on first enable; nsEnd = selected period end (ms, UTC); nsImg caches url -> reprojected data URL
let nsCfg, nsEnd, nsErr, nsBusy, nsOv, nsPin; const nsImg = {};
const NS_ATTR = 'New snow: <a href="https://avalanche.report" target="_blank" rel="noopener">GeoSphere Austria via avalanche.report</a>';
const nsRange = () => nsCfg.timeRanges.find(r => r.timeRange === lay.nsh) || nsCfg.timeRanges[0];
const nsUrl = (tpl, end) => { const d = new Date(end).toISOString(); return tpl.replace("https://wiski.tirol.gv.at/lawine/", "https://static.avalanche.report/").replaceAll("$year", d.slice(0, 4)).replaceAll("$date", d.slice(0, 10)).replaceAll("$hour", d.slice(11, 13)); };
const nsBounds = () => map.options.maxBounds.pad(1);
const nsCur = () => nsUrl(nsRange().imageOverlayURL, nsEnd);
const nsEnds = () => { const r = nsRange(), s = r.timeStepHours * 36e5, i = Date.parse(r.initialTimestamp), lo = Date.parse(r.maxAnalysisTimestamp) - 7 * 864e5, out = [];
  for (let t = i + Math.floor((Date.parse(r.maxForecastTimestamp) - i) / s) * s; t >= lo; t -= s) out.push(t); return out; }; // newest first, every initialTimestamp + k·step
function nsLoad() {
  nsBusy = true;
  fetch("https://static.avalanche.report/zamg_meteo/overlays/new-snow/config.json").then(r => r.ok ? r.json() : Promise.reject())
    .then(c => { if (!c.timeRanges?.length || !c.thresholds?.length || !c.boundingBoxes?.some(b => b.lambert)) throw 0; nsCfg = c; nsEnd = Date.parse(nsRange().initialTimestamp); })
    .catch(() => { nsErr = true; }).finally(() => { nsBusy = false; nsPanel(); renderMap(); });
}
function nsPanel() {
  const x = lp?.querySelector("#nsx"); if (!x) return; // the panel is not in the document yet during onAdd
  const f = document.activeElement?.dataset?.ns; // rebuilt selects must not drop keyboard focus
  lp.querySelector("#nsn").textContent = lay.on.newsnow && nsErr ? "unavailable" : "";
  if (!lay.on.newsnow || !nsCfg) { x.innerHTML = ""; return; }
  const ma = Date.parse(nsRange().maxAnalysisTimestamp), ends = nsEnds(), opt = t => `<option value="${t}"${t === nsEnd ? " selected" : ""}>${esc(fmtSlot(t))}</option>`;
  x.innerHTML = `<label><span>Period</span><select data-ns="h">${nsCfg.timeRanges.map(r => `<option value="${esc(r.timeRange)}"${r === nsRange() ? " selected" : ""}>${esc(r.timeRange)} h</option>`).join("")}</select></label>` +
    `<label><span>Until</span><select data-ns="t">${[["Forecast", t => t > ma], ["Past", t => t <= ma]].map(([l, f]) => ends.some(f) ? `<optgroup label="${l}">${ends.filter(f).map(opt).join("")}</optgroup>` : "").join("")}</select></label>`;
  if (f) x.querySelector(`[data-ns="${f}"]`)?.focus();
}
// GIF in Austria Lambert -> canvas over 3x the map's maxBounds (the view is wider than them, and can zoom out a step), sampled linearly in Web Mercator because L.imageOverlay stretches linearly there
const nsDraw = url => new Promise((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onerror = no; im.onload = () => { try {
  const W = im.width, H = im.height, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); g.drawImage(im, 0, 0); const src = g.getImageData(0, 0, W, H).data;
  const B = nsCfg.boundingBoxes.find(b => b.lambert).lambert, sx = (B[2] - B[0]) / W, sy = (B[3] - B[1]) / H;
  const P = L.Projection.SphericalMercator, mb = nsBounds(), nw = P.project(mb.getNorthWest()), se = P.project(mb.getSouthEast()), dx = se.x - nw.x, dy = se.y - nw.y, k = 600 / Math.max(Math.abs(dx), Math.abs(dy)); // ~3 px per 500 m source px
  const w = Math.round(Math.abs(dx) * k), h = Math.round(Math.abs(dy) * k), o = document.createElement("canvas"); o.width = w; o.height = h; const og = o.getContext("2d"), out = og.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ll = P.unproject(L.point(nw.x + (i + .5) * dx / w, nw.y + (j + .5) * dy / h)), [x, y] = lambert(ll.lat, ll.lng), col = Math.floor((x - B[0]) / sx), row = Math.floor((B[3] - y) / sy);
    if (col >= 0 && col < W && row >= 0 && row < H) out.data.set(src.subarray((row * W + col) * 4, (row * W + col) * 4 + 4), (j * w + i) * 4);
  }
  og.putImageData(out, 0, 0); ok(o.toDataURL()); } catch (e) { no(e); } }; im.src = url; });
// 1 km PNG (R = cm) -> its R channel, cached by url like the GIF
const nsPng = url => new Promise((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onerror = no; im.onload = () => { try {
  const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0); ok({ W: im.width, H: im.height, d: g.getImageData(0, 0, im.width, im.height).data }); } catch (e) { no(e); } }; im.src = url; });
function nsClick(e) { // value of the new-snow PNG under the click, as a pin with a tooltip
  if (!nsOv || e.originalEvent?.target.closest?.(".leaflet-tooltip,.leaflet-interactive")) return; // stations and their value tags are not map spots
  const url = nsUrl(nsRange().dataOverlayURL, nsEnd), cur = nsCur();
  (nsImg[url] ??= nsPng(url)).then(({ W, H, d }) => { if (!nsOv || nsCur() !== cur) return; // the selection moved on while this loaded
    const B = nsCfg.boundingBoxes.find(b => b.lambert).lambert, [x, y] = lambert(e.latlng.lat, e.latlng.lng), col = Math.floor((x - B[0]) / ((B[2] - B[0]) / W)), row = Math.floor((B[3] - y) / ((B[3] - B[1]) / H));
    nsPin?.remove(); nsPin = L.circleMarker(e.latlng, { pane: "places", radius: 8, interactive: false, color: css("--fg"), weight: 2, fillOpacity: 0 }).addTo(map)
      .bindTooltip(`<b>${col >= 0 && col < W && row >= 0 && row < H ? `+${d[(row * W + col) * 4]} cm (${esc(nsRange().timeRange)} h)` : "–"}</b>`, { permanent: true, direction: "right", offset: [8, 0], className: "val" }); },
    () => { delete nsImg[url]; });
}
function nsShow() {
  const url = nsCur(); if (nsOv) return;
  (nsImg[url] ??= nsDraw(url)).then(src => { if (nsOv || !lay.on.newsnow || nsCur() !== url) return; // the selection moved on while this loaded
    nsOv = L.imageOverlay(src, nsBounds(), { pane: "newsnow", opacity: .55, interactive: false, attribution: NS_ATTR }).addTo(map); nsOv.url = url; },
    () => { delete nsImg[url]; if (nsCur() === url) { nsErr = true; nsPanel(); renderMap(); } });
}
// Full screen: the Fullscreen API where it works, otherwise (iPhone Safari) the same panel pinned by CSS. Every exit path ends in exitFs().
let fs = false, fsPushed = false, fsBack = false, fsY = 0, fsBtn;
const fsPanel = document.getElementById("mapPanel"), fsRefresh = () => { map.invalidateSize(); if (fs) map.dragging.enable(); else if (L.Browser.mobile) map.dragging.disable(); }; // resize then re-fits and re-lays out
function enterFs() {
  if (fs) return;
  fs = true; fsY = scrollY; fsPanel.classList.add("fs"); document.documentElement.classList.add("fs-lock"); fsBtn.setAttribute("aria-pressed", "true");
  fsPanel.requestFullscreen?.()?.catch(() => {}); // refused: stay in CSS mode
  history.pushState({ fs: 1 }, ""); fsPushed = true; fsRefresh();
}
function exitFs() {
  if (!fs) return;
  closeCard(false);
  fs = false; fsPanel.classList.remove("fs"); document.documentElement.classList.remove("fs-lock"); fsBtn.setAttribute("aria-pressed", "false");
  document.getElementById("legend").classList.remove("open"); document.getElementById("fsLegend").setAttribute("aria-expanded", "false");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (fsPushed) { fsPushed = false; if (history.state?.fs) { fsBack = true; history.back(); } } // popstate already consumed the entry when it started the exit
  scrollTo(0, fsY); fsRefresh(); fsBtn.focus();
}
document.getElementById("fsExit").onclick = exitFs;
document.getElementById("fsLegend").onclick = e => e.currentTarget.setAttribute("aria-expanded", document.getElementById("legend").classList.toggle("open"));
addEventListener("keydown", e => { if (e.key === "Escape" && fs) card.classList.contains("open") ? closeCard() : exitFs(); }); // first Escape closes the station card
addEventListener("popstate", () => { if (fsBack) { fsBack = false; return; } fsPushed = false; exitFs(); }); // fsBack: the pop our own history.back() causes must not close a session entered since
addEventListener("orientationchange", () => { if (map) fsRefresh(); });
document.addEventListener("fullscreenchange", () => { if (fs && !document.fullscreenElement) exitFs(); else if (map) fsRefresh(); });
// Station card (full screen only): a tap on a station opens it instead of selecting; Open charts leaves full screen and selects.
const card = document.getElementById("stationCard"), scRows = [["hs", v => Math.round(v) + " cm"], ["n24", v => v + " cm"], ["lt", v => v + " °C"], ["wg", v => Math.round(v) + " km/h"], ["wg_boe", v => Math.round(v) + " km/h"], ["wr", v => `<svg width="14" height="14" viewBox="-7 -10 14 20" aria-hidden="true">${arrow(0, 0, (v + 180) % 360, "currentColor")}</svg> ${Math.round(v)}°`]];
let cardId;
function openCard(id) {
  const s = state.stations.find(x => x.id === id); if (!s) return;
  cardId = state.selected = id; // renderMap highlights it; the charts wait for Open charts
  const g = goodOnly(s, Date.now());
  document.getElementById("scTitle").textContent = s.name; document.getElementById("scAlt").textContent = `${s.alt} m`;
  document.getElementById("scRows").innerHTML = scRows.map(([f, fmt]) => {
    const bad = g.bad[f], label = FN[f][0].toUpperCase() + FN[f].slice(1);
    if (g[f] == null && !bad && !(f === "hs" && s.type === "snow")) return ""; // hide what this station type does not measure
    return `<div class="scr"><span>${esc(label)}</span>` + (bad ? `<b class="nd">${esc(badText(bad))}</b><i></i>` : g[f] == null ? "<b>—</b><i></i>" : `<b>${fmt(g[f])}</b><i>${esc(fmtLast(Date.parse(s.dates?.[f] || s.date)))}</i>`) + "</div>";
  }).join("");
  renderMap(); card.classList.add("open"); card.focus();
}
function closeCard(refocus = true) {
  if (!card.classList.contains("open")) return;
  card.classList.remove("open");
  if (refocus) (document.querySelector(`#map [data-sid="${CSS.escape(cardId)}"]`) || fsBtn).focus();
}
document.getElementById("scClose").onclick = () => closeCard();
document.getElementById("scOpen").onclick = () => {
  const id = cardId; exitFs(); select(id);
  // instant ("auto"): a smooth scroll got cancelled by the layout shifting back from full screen; instant also honours prefers-reduced-motion
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("condTitle").scrollIntoView({ block: "start", behavior: "auto" })));
};
function initMap() {
  mapDiv.innerHTML = "";
  const B = BOUNDS, pad = [.03, .015];
  map = L.map("map", { maxBounds: [[B.lat0 - pad[1], B.lon0 - pad[0]], [B.lat1 + pad[1], B.lon1 + pad[0]]], maxBoundsViscosity: 1, zoomSnap: .25, maxZoom: 16, dragging: !L.Browser.mobile }); // touch: one finger scrolls the page, two fingers (touchZoom) pan/zoom the map
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 15, maxZoom: 16, attribution: "Relief: Esri World Hillshade" }).addTo(map);
  const near = L.latLngBounds(state.stations.map(s => [s.lat, s.lon])).pad(.15); // landmarks around the stations stay in view; far ones (Ischgl) would only shrink the map
  fitBounds = L.latLngBounds([...state.stations.map(s => [s.lat, s.lon]), ...[...PLACES, ...PEAKS].map(([, lon, lat]) => [lat, lon]).filter(c => near.contains(c))]);
  const reset = () => { map.fitBounds(fitBounds, { paddingTopLeft: [60, 40], paddingBottomRight: [40, 40] }); }; // extra left padding keeps the view clear of the zoom/reset controls
  const fit = () => { reset(); fitZ = map.getZoom(); map.setMinZoom(fitZ - 1); };
  fit();
  let timer;
  map.on("resize", () => { names(); clearTimeout(timer); timer = setTimeout(() => { fit(); renderMap(); }, 150); });
  const Reset = L.Control.extend({ onAdd() {
    const d = L.DomUtil.create("div", "leaflet-bar"), b = L.DomUtil.create("button", "", d);
    b.type = "button"; b.title = "Reset view"; b.setAttribute("aria-label", "Reset view");
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>';
    b.onclick = reset; L.DomEvent.disableClickPropagation(d); return d; } });
  new Reset({ position: "topleft" }).addTo(map);
  const Full = L.Control.extend({ onAdd() {
    const d = L.DomUtil.create("div", "leaflet-bar"), b = fsBtn = L.DomUtil.create("button", "", d);
    b.type = "button"; b.title = "Full screen"; b.setAttribute("aria-label", "Full screen"); b.setAttribute("aria-pressed", "false");
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>';
    b.onclick = () => fs ? exitFs() : enterFs(); L.DomEvent.disableClickPropagation(d); return d; } });
  new Full({ position: "topleft" }).addTo(map);
  const Layers = L.Control.extend({ onAdd() {
    const d = lc = L.DomUtil.create("div", "lay"), bar = L.DomUtil.create("div", "leaflet-bar", d), b = L.DomUtil.create("button", "", bar), p = lp = L.DomUtil.create("div", "lp", d);
    b.type = "button"; b.title = "Map layers"; b.setAttribute("aria-label", "Map layers"); b.setAttribute("aria-controls", "lp");
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 15 5.5 8 9.5 1 5.5ZM1 8.5l7 4 7-4"/></svg>';
    p.id = "lp"; p.hidden = true; b.setAttribute("aria-expanded", !p.hidden);
    const stn = c => placed().filter(s => catOf(s) === c).sort((a, b) => b.alt - a.alt);
    const row = (attr, id, text, extra = "") => `<label><input type="checkbox" ${attr}="${esc(id)}"> <span>${esc(text)}${extra}</span></label>`;
    const stale = Object.values(state.danger?.regions || {}).some(r => new Date(r.valid_end) < new Date());
    p.innerHTML = [...CATS.filter(([k]) => stn(k).length).map(([k, n]) => row("data-cat", k, n)), ...dangerOk ? [row("data-cat", "danger", "Avalanche danger", stale ? " <small>not current</small>" : "")] : [], row("data-cat", "newsnow", "New snow", ' <small id="nsn"></small>') + '<div class="ns" id="nsx"></div>', row("data-cat", "peaks", "Peaks")].join("") +
      CATS.filter(([k]) => stn(k).length).map(([k, n]) => `<div role="group" aria-label="${n} stations"><div class="gh"><b>${n} stations</b><button type="button" data-set="${k}:1" aria-label="All ${n.toLowerCase()} stations">All</button><button type="button" data-set="${k}:0" aria-label="No ${n.toLowerCase()} stations">None</button></div>${stn(k).map(s => row("data-stn", s.id, s.name, ` <small>${s.alt} m</small>`)).join("")}</div>`).join("");
    const sync = () => { for (const i of p.querySelectorAll("input")) i.checked = i.dataset.cat ? lay.on[i.dataset.cat] : !lay.hide.includes(i.dataset.stn); nsPanel(); };
    const size = () => { p.style.maxHeight = map.getSize().y - 80 + "px"; };
    const done = () => { sync(); try { localStorage.setItem("layers", JSON.stringify(lay)); } catch {} renderSummary(); renderMap(); renderTable(); };
    p.addEventListener("change", e => { const i = e.target; if (i.dataset.ns || i.dataset.cat === "newsnow") nsErr = false; // any new-snow change retries a failed load
      if (i.dataset.ns) { if (i.dataset.ns === "h") { lay.nsh = +i.value; nsEnd = Date.parse(nsRange().initialTimestamp); } else nsEnd = +i.value; return done(); }
      if (i.dataset.cat) lay.on[i.dataset.cat] = i.checked; else lay.hide = i.checked ? lay.hide.filter(x => x !== i.dataset.stn) : [...lay.hide, i.dataset.stn]; done(); });
    p.addEventListener("click", e => {
      const t = e.target.closest("button"); if (!t) return;
      const [c, on] = t.dataset.set.split(":"), ids = state.stations.filter(s => catOf(s) === c).map(s => s.id);
      lay.hide = [...lay.hide.filter(x => !ids.includes(x)), ...on === "1" ? [] : ids]; if (on === "1") lay.on[c] = true; done();
    });
    b.onclick = () => { p.hidden = !p.hidden; b.setAttribute("aria-expanded", !p.hidden); renderMap(); }; // labels dodge the open panel
    map.on("resize", size); size(); sync();
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); L.DomEvent.on(d, "keydown", L.DomEvent.stopPropagation);
    return d; } });
  map.createPane("places").style.zIndex = 350; // under the station dots
  map.createPane("hit").style.zIndex = 390; // tap pads: under every dot, so a pad never covers a neighbouring dot
  for (const [list, cls] of [[PLACES, "v"], [PEAKS, "pk"]]) for (const [name, lon, lat, major] of list) {
    const marker = L.marker([lat, lon], { pane: "places", interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="pl ${cls}"><i></i>${esc(name)}</span>` }) }).addTo(map);
    landmarks.push({ name, lat, lon, marker, pk: cls === "pk", major });
  }
  map.createPane("danger").style.zIndex = 330; // above the relief tiles, under places and stations
  map.createPane("newsnow").style.zIndex = 340; // above danger, under places; own pane, so the dark-mode tile filter skips it
  groups = Object.fromEntries(CATS.map(([k]) => [k, L.layerGroup()]));
  dangerOk = !!(state.regions && state.danger?.regions);
  dangerLayer = L.geoJSON(dangerOk ? state.regions : null, { pane: "danger", interactive: false, style: f => {
    const r = state.danger.regions[f.properties.id], c = DGC[Math.max(0, ...(r?.ratings.map(x => x.level) || []))], old = !r || new Date(r.valid_end) < new Date();
    return { color: c, weight: 1, opacity: old ? .35 : .8, fillColor: c, fillOpacity: old ? .12 : .4 }; } });
  new Layers({ position: "topright" }).addTo(map);
  const names = () => { for (let i = 0; i < 3; i++) mapDiv.classList.toggle("t" + i, tierOf(map.getZoom(), fitZ) === i); }; // t0 / t1 / t2
  map.on("zoomend", () => { names(); renderMap(); }); names(); map.on("click", nsClick); map.on("click", () => closeCard());
}

function renderMap() {
  const snow = i => i < 0 ? css("--line") : css(`--snow-${i}`);
  const lg = document.getElementById("legend");
  lg.innerHTML = `<span class="ls"><span>Snow<span class="cm"> height</span>:</span>` +
    ["&lt;10", "10–25", "25–50", "50–100", "100+"].map((l, i) => `<i style="background:${snow(i)}"></i><span>${l}<span class="cm"> cm</span></span>`).join("") +
    `<span class="ph">cm</span></span><button type="button" aria-label="Wind legend" aria-expanded="${lg.classList.contains("open")}">?</button>` +
    `<span class="sep">·</span><span class="wx"><svg width="14" height="22" viewBox="-7 -11 14 22">${arrow(0, 0, 180, css("--wind"))}</svg> Wind blows toward, mean km/h · arrow alone = wind-only station</span>`;
  if (typeof L === "undefined") { mapDiv.innerHTML = '<div class="empty">Map unavailable.</div>'; return; }
  if (!state.stations.length) return;
  if (!map) initMap();
  const focusId = document.activeElement?.dataset?.sid; // rebuilt markers must not drop keyboard focus
  for (const [k] of CATS) { map[lay.on[k] ? "addLayer" : "removeLayer"](groups[k]); groups[k].clearLayers(); }
  map[lay.on.danger && dangerOk ? "addLayer" : "removeLayer"](dangerLayer);
  if (nsOv && !(lay.on.newsnow && nsOv.url === nsCur())) { nsOv.remove(); nsOv = null; }
  if (nsPin && !nsOv) { nsPin.remove(); nsPin = null; }
  if (lay.on.newsnow && !nsErr) nsCfg ? nsShow() : nsBusy || nsLoad();
  if (lay.on.newsnow && nsCfg && !nsErr) lg.insertAdjacentHTML("beforeend", `<span class="sep">·</span><span class="ls ns"><span>New snow (${esc(nsRange().timeRange)} h):</span>` +
    nsCfg.thresholds.map(({ range: [lo, hi], color }) => `<i${lo == null ? ' class="b"' : ""} style="background:${lo == null ? "transparent" : esc(color)}"></i><span>${esc(lo == null ? "<" + hi : hi == null ? lo + "+" : lo + "–" + hi)}<span class="cm"> cm</span></span>`).join("") + `<span class="ph">cm</span></span>`);
  // Label layout at the current zoom, in container pixels (re-run on every zoomend): stations within 28 px merge, labels follow the zoom tier (#39).
  // Landmark labels move beside/above/below their symbol to clear dots and arrows; each value tooltip then takes the lowest-overlap spot around its dot.
  const size = map.getSize(), at = (lat, lon) => map.latLngToContainerPoint([lat, lon]), tier = tierOf(map.getZoom(), fitZ);
  const narrow = size.x < 480, charW = narrow ? 7 : 8, tipH = narrow ? 20 : 24;
  mapDiv.classList.toggle("narrow", narrow);
  const area = r => (r[2] - r[0]) * (r[3] - r[1]);
  const overlap = (r, q) => Math.max(0, Math.min(r[2], q[2]) - Math.max(r[0], q[0])) * Math.max(0, Math.min(r[3], q[3]) - Math.max(r[1], q[1]));
  const mb = mapDiv.getBoundingClientRect(), tl = mapDiv.querySelector(".leaflet-top.leaflet-left").getBoundingClientRect(), ctl = [[0, 0, tl.right - mb.left, tl.bottom - mb.top]], cb = lc.getBoundingClientRect(); // zoom/reset/full-screen column and the layer button/panel, weighted 10x: nothing should sit under them
  ctl.push([cb.left - mb.left, cb.top - mb.top, cb.right - mb.left, cb.bottom - mb.top]);
  const costAgainst = (boxes, r) => boxes.reduce((c, q) => c + overlap(r, q), 0) + 10 * ctl.reduce((c, q) => c + overlap(r, q), 0) + 4 * (area(r) - overlap(r, [0, 0, size.x, size.y])); // outside the map counts extra
  const S = shown(), byId = Object.fromEntries(S.map(s => [s.id, s]));
  const grp = groupByPixel(S.map(s => ({ id: s.id, ...at(s.lat, s.lon), rank: s.type === "wind" ? -2 : s.hs ?? -1 })), tier === 2 ? 0 : 28, state.selected).map(ids => {
    const mem = ids.map(i => byId[i]), g = mem.length > 1 ? describeGroup(mem) : { lead: mem[0], wind: null, count: 1 };
    const ll = [mem.reduce((a, m) => a + m.lat, 0) / mem.length, mem.reduce((a, m) => a + m.lon, 0) / mem.length], { x, y } = at(...ll);
    const arr = g.wind && arrowOn(g.wind) ? g.wind : arrowVis(g.lead) ? g.lead : null; // merged: the wind member's arrow, else the lead's own
    return { mem, ...g, merged: mem.length > 1, ll, x, y, arr, own: [[x - 11, y - 11, x + 11, y + 11], ...arr ? [[x - 10, y - 36, x + 10, y - 12]] : []] };
  });
  const merged = new Set(grp.filter(g => g.merged).flatMap(g => g.mem.map(m => m.id)));
  const all = placed().map(s => goodOnly(s, Date.now())), loose = all.filter(s => arrowVis(s) && !merged.has(s.id)); // arrows of snow dots that are not in a merged group (or whose dot is hidden)
  const stationBoxes = grp.flatMap(g => g.own);
  for (const s of loose) { const { x, y } = at(s.lat, s.lon); if (!vis(s)) stationBoxes.push([x - 10, y - 36, x + 10, y - 12]); }
  const taken = [...stationBoxes];
  const place = lm => { // label box beside its symbol with the least overlap; peaks always label to the right
    const { x, y } = at(lm.lat, lm.lon), len = lm.name.length * 7;
    // right (""), left ("l"), below ("d"), above ("u"); crowded villages also try raised/lowered and nudged-out variants (inline offsets)
    const sides = [["", 0, 0, [x - 6, y - 9, x + 14 + len, y + 9]], ["l", 0, 0, [x - 14 - len, y - 9, x + 6, y + 9]], ["d", 0, 0, [x - 6, y - 5, x + 6 + len, y + 22]], ["u", 0, 0, [x - 6, y - 22, x + 6 + len, y + 5]]];
    if (!lm.pk) for (const dx of [0, 18]) for (const dy of [-18, 18, -36, 36]) sides.push(["", dx, dy, [x - 6 + dx, y - 9 + dy, x + 14 + len + dx, y + 9 + dy]], ["l", dx, dy, [x - 14 - len - dx, y - 9 + dy, x + 6 - dx, y + 9 + dy]]);
    const [side, dx, dy, box] = (lm.pk ? sides.slice(0, 1) : sides).reduce((best, c) => costAgainst(taken, c[3]) < costAgainst(taken, best[3]) ? c : best), el = lm.marker.getElement().firstChild;
    el.className = el.className.replace(/ (l|d|u)$/, "") + (side && " " + side);
    el.style.left = el.style.right = el.style.top = ""; // only the nudged variants set inline offsets
    if (dx || dy) { el.style[side ? "right" : "left"] = -4 + dx + "px"; el.style.top = -9 + dy + "px"; }
    return box;
  };
  const peakOn = lm => lay.on.peaks && (tier === 2 || (tier === 1 ? lm.major : lm.name.startsWith("Valluga"))); // tier 0: Valluga only; tier 1: the major peaks; tier 2: all
  for (const lm of landmarks) if (!lm.pk) { const { x, y } = at(lm.lat, lm.lon); taken.push([x - 6, y - 9, x + 6, y + 9]); } // village symbols first, so no label lands on a neighbour's marker
  for (const lm of landmarks) {
    if (lm.pk) map[peakOn(lm) ? "addLayer" : "removeLayer"](lm.marker);
    if (!lm.pk || (peakOn(lm) && lm.name.startsWith("Valluga"))) {
      const box = place(lm); // villages and the overview peak claim their spot first
      lm.box = box;
      if (lm.pk && tier > 0 && costAgainst([], box) > 0) map.removeLayer(lm.marker); else taken.push(box); // only at the overview must Valluga stay, even under a control
    }
  }
  for (const lm of landmarks) if (!lm.pk) { // second pass: every village re-picks its side now that the others' labels are known
    taken.splice(taken.indexOf(lm.box), 1); lm.box = place(lm); taken.push(lm.box);
  }
  const tap = ll => { const n = grp.reduce((a, t) => map.distance(ll, t.ll) < map.distance(ll, a.ll) ? t : a); n.merged ? zoomTo(n) : pick(n.lead.id); }; // overlapping pads: nearest group or station wins
  const pick = id => fs ? openCard(id) : select(id);
  const zoomTo = g => map.setView(g.ll, Math.min(map.getZoom() + 1, map.getMaxZoom()));
  let focusEl;
  for (const g of grp.sort((a, b) => b.ll[0] - a.ll[0])) {
    const s = g.lead, { x, y, merged: mg } = g, sel = s.id === state.selected, wo = s.type === "wind", wx = s.type === "weather", wind = hasWind(s), lg2 = groups[catOf(s)];
    const bad = s.bad[wo ? "wg" : wx ? "lt" : "hs"];
    const val = bad ? badText(bad) : wo ? (s.wg == null ? "–" : Math.round(s.wg) + " km/h") : wx ? (s.lt == null ? "–" : s.lt + " °C") : s.hs == null ? "–" : Math.round(s.hs) + " cm";
    // direction + offset: beside the dot first, then the four diagonals, then below and above
    const spots = [["right", [10, 0]], ["left", [-10, 0]], ["right", [8, 17]], ["right", [8, -17]], ["left", [-8, 17]], ["left", [-8, -17]], ["bottom", [0, 12]], ["top", [0, -12]]];
    const tipBox = (dir, [dx, dy], w) => {
      const left = dir === "right" ? x + dx + 2 : dir === "left" ? x + dx - 2 - w : x - w / 2;
      const top = dir === "bottom" ? y + 3 + dy : dir === "top" ? y - 3 - tipH + dy : y + dy - tipH / 2;
      return [left, top, left + w, top + tipH];
    };
    const bestSpot = w => spots.map(([dir, off]) => ({ dir, off, box: tipBox(dir, off, w) }))
      .reduce((best, c) => (c.cost = costAgainst(taken.filter(q => !g.own.includes(q)), c.box)) < best.cost ? c : best, { cost: Infinity }); // a station's own dot is no obstacle
    // tiers: no values at overview (the selected station keeps name + value); a group of several shows only its badge. Still colliding: drop names, then values.
    let tip = (!mg || g.count === 1) && (tier >= 1 || sel), nm = sel || tier === 2, spot;
    const valW = 14 + charW * val.length, nmW = charW * (s.name.length + 1);
    if (tip) {
      spot = bestSpot(nm ? valW + nmW : valW);
      if (!sel && spot.cost > 0 && nm) { nm = false; spot = bestSpot(valW); }
      if (!sel && spot.cost > 0) tip = false; else taken.push(spot.box);
    }
    const names = g.mem.map(m => m.name), label = mg ? `${g.mem.length} stations: ${names.join(", ")}` : `${s.name}, ${wo ? "wind " : ""}${val === "–" ? "no data" : val}`;
    if (phone()) L.circleMarker(g.ll, { pane: "hit", radius: 22, stroke: false, fillOpacity: 0, bubblingMouseEvents: false }).on("click", e => tap(e.latlng)).addTo(lg2); // 44px touch target
    // wind-only: just the arrow (or a calm ring) centred in a 44px box, haloed when selected; snow stations keep the coloured dot
    const m = wo ? L.marker(g.ll, { keyboard: false, icon: L.divIcon({ className: "wind-ic", iconSize: [44, 44], iconAnchor: [22, 22], html: `<svg width="44" height="44" viewBox="-22 -22 44 44"><circle r="13" fill="${sel ? css("--panel") : "transparent"}"${sel ? ` stroke="${css("--fg")}" stroke-width="3"` : ""}/>${arrowOn(s) ? arrow(0, 0, (s.wr + 180) % 360, css("--wind")) : `<circle r="4.5" fill="${css("--panel")}" stroke="${css("--wind")}" stroke-width="2"/>`}</svg>` }) }).addTo(lg2)
      : L.circleMarker(g.ll, { radius: sel ? 12 : 9, weight: sel ? 3 : 2, color: sel ? css("--fg") : css("--panel"), fillColor: snow(band(s.hs)), fillOpacity: 1, bubblingMouseEvents: false }).addTo(lg2);
    if (tip) m.bindTooltip(`<span class="nm">${esc(s.name)}</span><b${bad ? ' class="nd"' : ""}>${esc(val)}</b>`, { permanent: true, direction: spot.dir, offset: spot.off, interactive: true, className: "val" + (sel ? " sel" : "") + (nm ? " wn" : "") });
    if (mg && g.count > 1) L.marker(g.ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: "gb-ic", iconSize: [16, 16], iconAnchor: [-1, 17], html: `<span class="gb" aria-hidden="true">${g.count}</span>` }) }).addTo(lg2);
    if (g.arr && mg) L.marker(g.ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: "wind-ic", iconSize: [20, 20], iconAnchor: [10, 32], html: `<svg width="20" height="20" viewBox="-10 -10 20 20">${arrow(0, 0, (g.arr.wr + 180) % 360, css("--wind"))}</svg>` }) }).addTo(groups.wind);
    const act = mg ? () => zoomTo(g) : () => pick(s.id);
    m.on("click", act); // interactive tooltip clicks bubble here too
    const el = m.getElement(), t = document.createElementNS("http://www.w3.org/2000/svg", "title");
    t.textContent = mg ? label : `${s.name} · ${s.alt} m · ${wo ? "wind station" : wx ? "weather station" : val}${s.lt != null ? ` · ${s.lt} °C` : ""}${wind ? ` · wind ${Math.round(s.wg)} km/h${s.wg_boe != null ? `, gusts ${Math.round(s.wg_boe)}` : ""}` : ""}`;
    if (wo) el.title = t.textContent; else el.append(t); // SVG paths take a <title>, the HTML wind icon a title attribute
    el.setAttribute("tabindex", "0"); el.setAttribute("role", "button"); el.dataset.sid = s.id;
    el.setAttribute("aria-label", label);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    if (s.id === focusId) focusEl = el;
  }
  for (const s of loose) L.marker([s.lat, s.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: "wind-ic", iconSize: [20, 20], iconAnchor: [10, s.id === state.selected && vis(s) ? 36 : 32], html: `<svg width="20" height="20" viewBox="-10 -10 20 20">${arrow(0, 0, (s.wr + 180) % 360, css("--wind"))}</svg>` }) }).addTo(groups.wind);
  for (const lm of landmarks) if (lm.pk && peakOn(lm) && !lm.name.startsWith("Valluga")) { // peaks last: only where they clear every dot, label and control
    const box = place(lm);
    if (costAgainst(taken, box) > 0) map.removeLayer(lm.marker); else taken.push(box);
  }
  focusEl?.focus();
}

function renderTable() {
  if (!state.stations.length) return;
  const byAlt = (a, b) => b.alt - a.alt, rows = placed().filter(vis).sort(byAlt), now = Date.now();
  // close reading: a value that is not current or suspect stays visible, greyed and struck through, with the reason
  const st = (s, f) => valueState(s, f, now), strike = (v, t) => isBad(v) ? `<s class="bad">${t}</s>` : t;
  const why = vs => { const t = [...new Set(vs.filter(isBad).map(badText))]; return t.length ? `<span class="why">${esc(t.join("; "))}</span>` : ""; };
  document.getElementById("rows").innerHTML = !rows.length ? '<tr><td colspan="5" class="empty">No stations selected on the map.</td></tr>' : rows.map(s => {
    const d = delta24(s.id), hs = st(s, "hs"), wg = st(s, "wg"), gu = st(s, "wg_boe"), wr = st(s, "wr");
    return `<tr tabindex="0" data-id="${esc(s.id)}" aria-selected="${s.id === state.selected}">
      <td class="nm" title="${esc(s.name)}">${esc(s.name)}<small>${s.alt} m</small></td><td class="n altc">${s.alt} m</td><td class="n"><b>${s.hs == null ? "–" : strike(hs, Math.round(s.hs) + '<span class="u"> cm</span>')}</b>${why([hs])}</td>
      <td class="n ${d > 0 && !isBad(hs) ? "up" : ""}">${d == null ? "–" : strike(hs, (d > 0 ? "+" : "") + d)}</td>
      <td class="n">${hasWind(s) ? `${arrowOn(s) ? strike(wr, `<span style="display:inline-block;color:var(--wind);transform:rotate(${(s.wr + 180) % 360}deg)">↑</span>`) + " " : ""}${strike(wg, Math.round(s.wg))}${s.wg_boe != null ? " / " + strike(gu, Math.round(s.wg_boe)) : ""}${why([wg, gu, wr])}` : "–"}</td></tr>`;
  }).join("");
  const sel = document.getElementById("stnSel");
  const opts = placed().filter(s => vis(s) || s.id === state.selected).sort(byAlt).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(""); // the selected station stays listed even when hidden
  if (sel.dataset.o !== opts) sel.innerHTML = sel.dataset.o = opts;
  sel.value = state.selected;
  sel.parentNode.hidden = false;
}

function chartDefaults() {
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--line");
  Chart.defaults.font.family = css("--body");
  // "nearest" on the x axis, but only points with a value (a null bar or gap would otherwise win and show no tooltip) and never the direction arrows
  Chart.Interaction.modes.nearestX = (c, e) => {
    const all = []; let best = Infinity;
    c.data.datasets.forEach((d, di) => { if (!c.isDatasetVisible(di) || d.noTip) return; c.getDatasetMeta(di).data.forEach((element, index) => { if (d.data[index]?.y == null) return; const dx = Math.abs(element.x - e.x); best = Math.min(best, dx); all.push({ element, datasetIndex: di, index, dx }); }); });
    return all.filter(m => m.dx <= best + .5);
  };
}

function renderCharts() {
  const s = state.stations.find(x => x.id === state.selected);
  if (!s || typeof Chart === "undefined") return;
  chartDefaults();
  renderCond(s);
  renderSnow(s);
  renderWind(s);
}

const fmtHour = (t, day) => new Date(t).toLocaleString("en-GB", { ...(day ? { weekday: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" }), timeZone: "Europe/Vienna" });
const srcOf = id => id.startsWith("TAWES-") ? "GeoSphere Austria" : id.startsWith("VOR-") ? "LWD Vorarlberg" : "LWD Tirol";

const legend = { labels: { boxWidth: 14, boxHeight: 8, font: { size: 11 } } };
const hasField = (hours, f, id) => Object.values(hours).some(h => h[f]?.[id] != null);
const nn = a => a.some(p => p.y != null);
// shaded forecast zone after "now", dashed now line, label naming the model source (clipped to the zone)
const forecastZone = (now, label) => ({ id: "zone", beforeDatasetsDraw(c) {
  const { ctx, chartArea: a, scales: { x } } = c, px = Math.max(a.left, Math.min(a.right, x.getPixelForValue(now))), muted = css("--muted");
  ctx.save(); ctx.fillStyle = css("--accent-soft"); ctx.globalAlpha = .5; ctx.fillRect(px, a.top, a.right - px, a.bottom - a.top);
  ctx.globalAlpha = 1; ctx.strokeStyle = muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
  ctx.fillStyle = muted; ctx.font = `11px ${css("--body")}`;
  let t = label; while (t.length > 3 && ctx.measureText(t).width > a.right - px - 8) t = t.slice(0, -2).trimEnd() + "…";
  if (a.right - px > 24) ctx.fillText(t, px + 4, a.top + 11);
  if (px - a.left > 34) { ctx.textAlign = "right"; ctx.fillText("now", px - 4, a.top + 11); }
  ctx.restore(); } });
// numeric (ms) x scale from..to, hourly ticks thinned by window, Vienna-time labels; no date adapter
const timeAxis = (from, to, h) => { const step = tickStepH(h) * 3600e3; return { type: "linear", min: from, max: to, grid: { display: false },
  afterBuildTicks: ax => { ax.ticks = []; for (let t = Math.ceil(from / 3600e3) * 3600e3; t <= to; t += 3600e3) if (keyMs(viennaKey(t)) === t && (+viennaKey(t).slice(11) * 3600e3) % step === 0) ax.ticks.push({ value: t }); },
  ticks: { maxRotation: 0, autoSkipPadding: 8, font: { size: 11 }, callback: v => viennaKey(v).endsWith("T00") ? fmtHour(v, true) : fmtHour(v) } }; };
// measured series with flagged hours (hourly.json flags) faded, hollow dot, reason in the tooltip
const fade = c => `color-mix(in srgb, ${c} 30%, transparent)`;
const flagAt = x => x.chart.data.datasets[x.datasetIndex].data[x.p0DataIndex]?.fl || x.chart.data.datasets[x.datasetIndex].data[x.p1DataIndex]?.fl;
const measLine = (hours, id, pts, f, label, unit, c, o = {}) => ({ label, unit, kind: "measured", src: `measured · ${srcOf(id)}`, data: pts.map(p => ({ ...p, fl: hours[p.k]?.flags?.[id]?.[f] })), borderColor: c, backgroundColor: c, borderWidth: 2,
  pointRadius: x => x.raw?.fl ? 3.5 : 0, pointBackgroundColor: css("--panel"), pointBorderColor: css("--fg"), pointBorderWidth: 1.5, segment: { borderColor: x => flagAt(x) ? fade(c) : undefined }, pointHoverRadius: 5, pointHitRadius: 8, spanGaps: false, yAxisID: "y", ...o });
const barSet = (label, unit, data, o) => ({ type: "bar", label, unit, data, order: 2, barPercentage: 1, categoryPercentage: .8, ...o });
const statHtml = (t, name, small, bad) => `<div class="stat"><b>${bad ? `<s class="bad">${t}</s>` : t}</b><span>${name}</span><small>${small}</small></div>`;
const modelSrcOf = () => { const m = state.hourly?.model || {}; return `model · ${m.source || "source unknown"}${m.issued ? ", latest issue " + fmtSlot(m.issued) : ""}`; };
// latest measured value of f as a stat card, with its measurement time and stale/suspect state
function latestCard(s, f, name, u, hours, now, gauge) {
  const id = s.id, v = latest(hours, f, id, now), own = Date.parse(s.dates?.[f] || s.date);
  // instant values: TAWES/Vorarlberg hours are the HH:00 sample; a Tirol hour holds a time inside it, so the station's own time when it is that hour and the same value (the hour keeps its first value), else only the hour, aged from its end
  // pr/hr cover whole hours and have no staleAfter: never stale
  const at = v && staleAfter[f] && (gauge ? keyMs(v.k) : !isNaN(own) && viennaKey(own) === v.k && v.y === s[f] ? own : null), end = v && (at || keyMs(v.k) + 3600e3);
  const fl = v && hours[v.k].flags?.[id]?.[f], old = v && Date.now() - end > staleAfter[f];
  const when = !v ? "no data" : at ? fmtSlot(at) : staleAfter[f] ? `hour of ${fmtSlot(keyMs(v.k))}` : fmtSlot(keyMs(v.k));
  return statHtml(v ? `${esc(v.y)} ${u}` : "–", name, `${when}${fl ? ` · suspect: ${esc(fl)}` : old ? " · not current" : ""}`, fl || old);
}
// tooltip shared by the three charts: value, time, source (kind = measured | model, set on each dataset); the direction dataset is not hit-tested
const tip = (o = {}) => ({ filter: i => i.parsed.y != null && !i.dataset.noTip, callbacks: { title: it => fmtSlot(it[0].parsed.x),
  label: c => `${c.dataset.label}: ${c.parsed.y} ${c.dataset.unit}${c.raw.fl ? ` · suspect: ${c.raw.fl}` : ""}`, footer: it => [...new Set(it.map(i => i.dataset.src))], ...o } });
// next model hour of field f as a stat card
const nextCard = (hours, id, now, f, name, u) => {
  const p = slice(hours, f, id, now + 1, now + 3600e3)[0];
  return statHtml(p?.y != null ? `${p.y} ${u}` : !hasField(hours, f, id) ? "no forecast" : "no data", name, p ? fmtSlot(p.x) + " · model" : "", false);
};
const chartRedraw = { cond: s => renderCond(s), snow: s => renderSnow(s), wind: s => renderWind(s) };

// Conditions: the station's hourly series, -X ... now (measured) ... +X (model), or the latest values for 1 h
function renderCond(s) {
  const hours = state.hourly?.hours || {}, id = s.id, el = i => document.getElementById(i);
  for (const b of el("condWin").children) b.setAttribute("aria-pressed", +b.dataset.h === win.cond);
  const condH = win.cond;
  el("condTitle").textContent = `Conditions · ${s.name}`;
  charts.cond?.destroy(); charts.cond = null;
  const any = f => hasField(hours, f, id);
  const gauge = /^(TAWES|VOR)-/.test(id), pf = gauge ? "pr" : "hr", hasOft = any("oft");
  const lines = [["lt", "Air", "°C"], ...(hasOft ? [["oft", "Snow surface", "°C"]] : []), ["rh", "Humidity", "%"], [pf, gauge ? "Precipitation" : "Snow depth rise", gauge ? "mm" : "cm"]];
  const has = Object.values(hours).some(h => Object.entries(h).some(([f, m]) => f !== "flags" && m[id] != null));
  el("condBox").hidden = el("condNow").hidden = el("condWin").parentNode.hidden = !has;
  if (!has) { el("condNote").textContent = "No hourly data for this station."; return; }
  const now = anchorMs(hours, Date.now());
  const modelSrc = modelSrcOf();
  el("condBox").hidden = condH === 1; el("condNow").hidden = condH !== 1; el("condRh").parentNode.hidden = condH === 1;
  if (condH === 1) {
    el("condNow").innerHTML = lines.map(([f, name, u]) => latestCard(s, f, name, u, hours, now, gauge)).join("");
    el("condNote").textContent = `Latest measured values (${srcOf(id)}), with their measurement times.`;
    return;
  }
  const from = now - condH * 3600e3, to = now + condH * 3600e3, past = f => slice(hours, f, id, from, now), fut = f => slice(hours, f, id, now + 1, to);
  const warm = css("--wind"), accent = css("--accent"), rain = css("--snow-2"), rainM = css("--snow-3"), muted = css("--muted");
  const ln = (f, label, unit, c, o = {}) => measLine(hours, id, past(f), f, label, unit, c, o);
  const lt = ln("lt", "Air", "°C", warm), mt = { ...ln("mt", "Air · model", "°C", warm, { borderDash: [5, 4], borderWidth: 1.5, kind: "model", src: modelSrc }), data: fut("mt") };
  const oft = hasOft && ln("oft", "Snow surface", "°C", accent);
  const rh = el("condRh").checked && ln("rh", "Humidity", "%", muted, { borderWidth: 1, yAxisID: "yH" });
  const bar = (label, unit, data, o) => barSet(label, unit, data, { yAxisID: "yP", ...o });
  const pr = bar(gauge ? "Precipitation" : "Snow depth rise", gauge ? "mm" : "cm", past(pf), { backgroundColor: rain, kind: "measured", src: `measured · ${srcOf(id)}` });
  const pm = bar("Precip. · model", "mm", slice(hours, "pm", id, from, to).map(p => ({ ...p, sm: hours[p.k]?.sm?.[id] })), { backgroundColor: "transparent", borderColor: rainM, borderWidth: 1.5, kind: "model", src: modelSrc });
  const hasModel = nn(mt.data) || nn(pm.data);
  const sets = [lt, oft, rh, mt, pr, pm].filter(d => d && (d === lt || nn(d.data)));
  const zero = { color: c => c.tick.value === 0 ? css("--fg") : css("--line"), lineWidth: c => c.tick.value === 0 ? 1.5 : 1 };
  el("cond").setAttribute("aria-label", `Conditions chart, ${condH} hours either side of now`);
  charts.cond = new Chart(el("cond"), {
    type: "line", data: { datasets: sets }, plugins: [forecastZone(now, `forecast · ${state.hourly.model?.source || "source unknown"}`)],
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: "nearestX", intersect: false },
      plugins: { legend,
        tooltip: tip({ label: c => `${c.dataset.label}: ${c.parsed.y} ${c.dataset.unit}${c.raw.sm != null ? ` (snow ${c.raw.sm} cm)` : ""}${c.raw.fl ? ` · suspect: ${c.raw.fl}` : ""}` }) },
      scales: {
        x: timeAxis(from, to, condH),
        y: { title: { display: true, text: "°C" }, grid: zero, grace: "5%", suggestedMin: 0, suggestedMax: 0 },
        ...(nn(pr.data) || nn(pm.data) ? { yP: { position: "right", beginAtZero: true, grid: { display: false }, title: { display: true, text: gauge ? "mm" : "cm / mm" } } } : {}),
        ...(rh && nn(rh.data) ? { yH: { position: "right", min: 0, max: 100, grid: { display: false }, title: { display: true, text: "%" } } } : {}) } },
  });
  // last complete night / day from all of hourly.json, not just the window
  const t = v => `${v.y} °C at ${fmtHour(keyMs(v.k))}`, day = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const n = extreme(hours, "lt", id, now, true), d = extreme(hours, "lt", id, now, false), fr = hasOft && refroze(hours, id, now), cnt = p => `${p.pts.length} of ${p.of} h with data`;
  el("condNote").textContent = [
    n ? `Overnight min (night from ${day(n.date)}, 18–08 h): ${t(n.at)} (${cnt(n)}).` : "No air temperature for the last complete night.",
    d ? `Daytime max (${day(d.date)}, 08–18 h): ${t(d.at)} (${cnt(d)}).` : "No air temperature for the last complete day.",
    ...(hasOft ? [fr ? (fr.ok ? `Snow surface refroze in the night from ${day(fr.date)} (below 0 °C in every hour with data, ${cnt(fr)}).` : `Snow surface didn't refreeze in the night from ${day(fr.date)} (${t(fr.warm)}, ${cnt(fr)}).`) : "No snow surface data for the last complete night."] : []),
    hasModel ? `Dashed / outlined: ${modelSrc}.` : "Model unavailable.",
    ...(sets.some(d => d.data.some(p => p.fl)) ? ["Faded points failed a plausibility check (tap one for the reason)."] : []),
  ].join(" ");
}

// Snow depth: measured HS and new-snow bars -X ... now, model depth and snowfall now ... +X, or numbers for 1 h
function renderSnow(s) {
  const hours = state.hourly?.hours || {}, id = s.id, el = i => document.getElementById(i), h = win.snow;
  for (const b of el("snowWin").children) b.setAttribute("aria-pressed", +b.dataset.h === h);
  charts.snow?.destroy(); charts.snow = null;
  el("snowTitle").textContent = `Snow depth · ${s.name}`;
  const has = hasField(hours, "hs", id);
  el("snowPanel").hidden = !has; // wind-only and weather stations have no snow depth
  if (!has) return;
  const now = anchorMs(hours, Date.now()), modelSrc = modelSrcOf(), gauge = /^(TAWES|VOR)-/.test(id);
  el("snowBox").hidden = h === 1; el("snowNow").hidden = h !== 1;
  if (h === 1) {
    const dh = delta(hours, "hs", id, now, 1), nx = (f, name, u) => nextCard(hours, id, now, f, name, u);
    const v = latest(hours, "hs", id, now);
    el("snowNow").innerHTML = latestCard(s, "hs", "Snow height", "cm", hours, now, gauge)
      + statHtml(dh ? `${dh.d > 0 ? "+" : ""}${dh.d} cm` : "–", "Snow height vs 1 h ago", dh ? `${dh.then} → ${dh.now} cm, hour of ${fmtSlot(keyMs(v.k))}` : "no data", false)
      + nx("sm", "Next hour: snowfall", "cm") + nx("sd", "Next hour: depth", "cm");
    el("snowNote").textContent = `Latest measured values (${srcOf(id)}) and the next model hour (${modelSrc}).`;
    return;
  }
  const from = now - h * 3600e3, to = now + h * 3600e3, accent = css("--accent"), rain = css("--snow-2"), rainM = css("--snow-3");
  const hsL = measLine(hours, id, slice(hours, "hs", id, from, now), "hs", "Snow height", "cm", accent);
  const rise = barSet("Snow depth rise", "cm", risePts(hours, id, from, now), { backgroundColor: rain, yAxisID: "yR", kind: "measured", src: `measured · ${srcOf(id)}` });
  const sd = { label: "Depth · model", unit: "cm", kind: "model", src: modelSrc, data: slice(hours, "sd", id, now + 1, to), borderColor: accent, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 8, spanGaps: false, yAxisID: "y" };
  const sm = barSet("Snowfall · model", "cm", slice(hours, "sm", id, now + 1, to), { backgroundColor: "transparent", borderColor: rainM, borderWidth: h >= 72 ? 1 : 1.5, barPercentage: h >= 72 ? .6 : 1, yAxisID: "yR", kind: "model", src: modelSrc });
  const sets = [hsL, sd, rise, sm].filter(d => nn(d.data));
  el("snow").setAttribute("aria-label", `Snow depth chart, ${h} hours either side of now`);
  charts.snow = new Chart(el("snow"), {
    type: "line", data: { datasets: sets }, plugins: [forecastZone(now, `forecast · ${state.hourly.model?.source || "source unknown"}`)],
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: "nearestX", intersect: false },
      plugins: { legend, tooltip: tip() },
      scales: { x: timeAxis(from, to, h), y: { beginAtZero: true, grace: "5%", title: { display: true, text: "cm" } },
        ...(nn(rise.data) || nn(sm.data) ? { yR: { position: "right", beginAtZero: true, grid: { display: false }, title: { display: true, text: "cm / h" } } } : {}) } },
  });
  el("snowNote").textContent = [
    nn(hsL.data) ? `Line: measured snow height (${srcOf(id)}); bars: hourly rise, never negative.` : "No snow height measured in this window.",
    nn(sd.data) ? "" : "No forecast for snow depth.", nn(sm.data) ? "" : "No forecast for snowfall.",
    nn(sd.data) || nn(sm.data) ? `Dashed / outlined: ${modelSrc}.` : "",
    ...(hsL.data.some(p => p.fl) ? ["Faded points failed a plausibility check (tap one for the reason)."] : []),
  ].filter(Boolean).join(" ");
}

// Wind: mean and gusts -X ... now (measured), model mean/gusts now ... +X, direction arrows on the baseline, or numbers for 1 h
function renderWind(s) {
  const hours = state.hourly?.hours || {}, id = s.id, el = i => document.getElementById(i), h = win.wind;
  for (const b of el("windWin").children) b.setAttribute("aria-pressed", +b.dataset.h === h);
  charts.wind?.destroy(); charts.wind = null;
  el("windTitle").textContent = `Wind · ${s.name}`;
  const has = hasField(hours, "wg", id);
  el("windPanel").hidden = !has;
  if (!has) return;
  const now = anchorMs(hours, Date.now()), modelSrc = modelSrcOf(), gauge = /^(TAWES|VOR)-/.test(id);
  el("windBox").hidden = h === 1; el("windNow").hidden = h !== 1;
  if (h === 1) {
    const dg = delta(hours, "wg_boe", id, now, 1), v = latest(hours, "wg_boe", id, now), nx = (f, name, u) => nextCard(hours, id, now, f, name, u);
    el("windNow").innerHTML = latestCard(s, "wg", "Mean wind", "km/h", hours, now, gauge) + latestCard(s, "wg_boe", "Gusts", "km/h", hours, now, gauge)
      + statHtml(dg ? `${dg.d > 0 ? "+" : ""}${dg.d} km/h` : "–", "Gusts vs 1 h ago", dg ? `${dg.then} → ${dg.now} km/h, hour of ${fmtSlot(keyMs(v.k))}` : "no data", false)
      + latestCard(s, "wr", "Wind from", "°", hours, now, gauge)
      + nx("mw", "Next hour: mean wind", "km/h") + nx("mg", "Next hour: gusts", "km/h") + nx("md", "Next hour: wind from", "°");
    el("windNote").textContent = `Latest measured values (${srcOf(id)}) and the next model hour (${modelSrc}).`;
    return;
  }
  const from = now - h * 3600e3, to = now + h * 3600e3, warm = css("--wind"), muted = css("--muted"), light = `color-mix(in srgb, ${warm} 55%, transparent)`;
  const past = f => slice(hours, f, id, from, now), fut = f => slice(hours, f, id, now + 1, to);
  const fwd = (f, label, c, w) => ({ ...measLine(hours, id, fut(f), f, label, "km/h", c, { borderDash: [5, 4], borderWidth: w, kind: "model", src: modelSrc }), data: fut(f) });
  const mean = measLine(hours, id, past("wg"), "wg", "Mean wind", "km/h", warm), gust = measLine(hours, id, past("wg_boe"), "wg_boe", "Gusts", "km/h", light, { borderWidth: 1.5 });
  const mw = fwd("mw", "Mean wind · model", warm, 1.5), mg = fwd("mg", "Gusts · model", light, 1.5);
  // arrows point where the wind blows to; at most ~40 per window; calm or unknown direction: none
  const arrowImg = (to, c) => { const k = document.createElement("canvas"); k.width = k.height = 18; const x = k.getContext("2d"); x.translate(9, 9); x.scale(.85, .85); x.rotate(to * Math.PI / 180); x.fillStyle = c; x.fill(new Path2D("M0-10L6 2H2.5V10H-2.5V2H-6Z")); return k; };
  const dirs = [...past("wr").map((p, i) => ({ ...p, sp: past("wg")[i].y, c: warm })), ...fut("md").map((p, i) => ({ ...p, sp: fut("mw")[i].y, c: muted }))], step = Math.ceil(dirs.length / Math.min(40, Math.floor((el("wind").clientWidth - 50) / 22))); // >= 22 px apart: glyphs are 18 px
  const on = dirs.map((d, i) => i % step === 0 && d.y != null && d.sp != null && d.sp >= 1);
  const dir = { label: "Direction", unit: "°", kind: "measured", src: `measured · ${srcOf(id)}`, noTip: true, data: dirs.map((d, i) => ({ x: d.x, y: on[i] ? 0 : null })), showLine: false, spanGaps: false,
    pointStyle: dirs.map((d, i) => on[i] ? arrowImg((d.y + 180) % 360, d.c) : "circle"), pointRadius: 9, pointHoverRadius: 9, pointHitRadius: 0, clip: false };
  const sets = [mean, gust, mw, mg, dir].filter(d => nn(d.data));
  const dirAt = x => { const k = viennaKey(x), d = x <= now ? hours[k]?.wr?.[id] : hours[k]?.md?.[id]; return d == null ? "" : `Wind from ${Math.round(d)}°`; };
  el("wind").setAttribute("aria-label", `Wind chart, ${h} hours either side of now`);
  charts.wind = new Chart(el("wind"), {
    type: "line", data: { datasets: sets }, plugins: [forecastZone(now, `forecast · ${state.hourly.model?.source || "source unknown"}`)],
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: "nearestX", intersect: false },
      plugins: { legend: { labels: { ...legend.labels, filter: i => i.text !== "Direction" } }, tooltip: tip({ afterBody: it => dirAt(it[0].parsed.x) }) },
      scales: { x: timeAxis(from, to, h), y: { beginAtZero: true, grace: "8%", title: { display: true, text: "km/h" }, ticks: { callback: v => v < 0 ? "" : v } } } },
  });
  el("windNote").textContent = [
    nn(mean.data) ? `Lines: measured mean wind and gusts (${srcOf(id)}); arrows point where the wind blows to.` : "No wind measured in this window.",
    nn(mw.data) ? "" : "No forecast for mean wind.", nn(mg.data) ? "" : "No forecast for gusts.",
    nn(mw.data) || nn(mg.data) ? `Dashed: ${modelSrc}.` : "",
    ...(mean.data.some(p => p.fl) || gust.data.some(p => p.fl) ? ["Faded points failed a plausibility check (tap one for the reason)."] : []),
  ].filter(Boolean).join(" ");
}

// touch: a tap shows the nearest point's tooltip and it stays until a tap elsewhere (outside ~20 px of a point, or off the canvas). Listeners on the canvas survive chart re-creation.
const tipAt = new WeakMap(), clearTip = c => { tipAt.delete(c); if (!c.tooltip.getActiveElements().length) return; c.setActiveElements([]); c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.update(); };
for (const cid of ["cond", "snow", "wind"]) document.getElementById(cid).addEventListener("click", e => {
  const c = charts[cid]; if (!c || !e.pointerType || e.pointerType === "mouse") return;
  const r = c.canvas.getBoundingClientRect(), p = { native: true, x: e.clientX - r.left, y: e.clientY - r.top }; // native: marks x/y as canvas coordinates for Chart.js
  const was = tipAt.get(c); // tapping the point already shown toggles it off
  setTimeout(() => { tipAt.set(c, c.tooltip.getActiveElements().map(a => a.datasetIndex + ":" + a.index).join()); if (c === charts[cid] && was && was === tipAt.get(c) && c.tooltip.opacity) return clearTip(c); if (c === charts[cid] && !c.getElementsAtEventForMode(p, "nearestX", { intersect: false }).some(m => Math.abs(m.element.x - p.x) <= 20 && !m.element.skip)) clearTip(c); }, 50); // after Chart.js's own (rAF-throttled) event handling
});
document.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") for (const cid in charts) if (charts[cid] && !charts[cid].canvas.contains(e.target)) clearTip(charts[cid]); });

// banner when the last successful refresh is too old (health.json run time, else stations.json updated)
function renderBanner() {
  const last = state.health?.run || state.updated, b = document.getElementById("banner");
  b.hidden = !refreshStale(last, Date.now());
  const txt = `Data may be out of date: the last successful refresh was ${isNaN(Date.parse(last)) ? "unknown" : fmtSlot(last)}. Check the measurement times before relying on any value.`;
  if (b.textContent !== txt) b.textContent = txt; // role="status": rewriting the same text may re-announce it
}
const WHY = { "out of range": "outside the possible range for this sensor", jump: "changed implausibly fast since the hour before", stuck: "the same value for 6 hours in a row",
  "gust below mean": "gust lower than the mean wind", "sensor frozen?": "wind 0 for 3 hours in freezing, saturated air: the anemometer is probably iced up", "time in future": "measurement time is after the data run" };
// every current flag, offline station, failed source and misplaced station, plus live staleness
function renderChecks() {
  const h = state.health, now = Date.now(), items = [], off = new Map((h?.offline || []).map(o => [o.id, o]));
  for (const [k, v] of Object.entries(h?.sources || {})) if (!v.ok) items.push(`<b>Source ${esc(k)} failed</b> in the last run: ${esc(v.error || "unknown error")}${v.detail ? ` (${esc(v.detail)})` : ""}. Its stations keep their last values, which age as shown.`);
  if (!h) items.push("Source status unavailable (no data checks file from the last run).");
  for (const s of state.stations) if (!(now - Date.parse(s.date) <= offlineAfter)) off.set(s.id, { name: s.name, last: s.date });
  for (const o of off.values()) items.push(`<b>${esc(o.name)}</b> offline: no measurement for over 24 h (last ${esc(fmtSlot(o.last))}).`);
  for (const s of state.stations) {
    if (misplaced(s)) { items.push(`<b>${esc(s.name)}</b> hidden from map, summary and table: location mismatch (reported position or name doesn't match the known station).`); continue; }
    const parts = Object.entries(s.flags || {}).map(([f, r]) => [f, `suspect: ${r} (${WHY[r] || "plausibility check"})`]);
    // live staleness; n24/hsd24 are derived and not shown, the HS line covers them
    if (!off.has(s.id)) for (const f in staleAfter) { const v = valueState(s, f, now); if (v.stale && f !== "n24" && f !== "hsd24") parts.push([f, `not current: last ${fmtLast(v.last)}, older than ${staleAfter[f] / 3600e3} h`]); }
    const txt = Object.entries(group(parts, ([, t]) => t)).map(([t, fs]) => `${fs.map(([f]) => FN[f] || f).join(", ")} ${t}`);
    if (txt.length) items.push(`<b>${esc(s.name)}</b>: ${esc(txt.join("; "))}.`);
  }
  document.getElementById("checksN").textContent = items.length ? `${items.length} note${items.length > 1 ? "s" : ""}` : "all clear";
  document.getElementById("checkList").innerHTML = (items.length ? items : ["All values passed the checks."]).map(x => `<li>${x}</li>`).join("");
}

// what the clock can change: each value's state kind and the banner rule; the minute re-check re-renders only when this changes (a rebuilt table drops keyboard focus)
const accSig = () => { const now = Date.now(); return JSON.stringify([refreshStale(state.health?.run || state.updated, now), state.stations.map(s => Object.keys(staleAfter).map(f => Object.keys(valueState(s, f, now))[0]))]); };
let lastSig;
function renderAll() { lastSig = accSig(); renderBanner(); renderSummary(); renderDanger(); renderMap(); renderTable(); renderCharts(); renderChecks(); }

function select(id) {
  state.selected = id;
  try { localStorage.setItem("sel", id); } catch {}
  renderMap(); renderTable(); renderCharts();
}
document.getElementById("stnSel").addEventListener("change", e => select(e.target.value));
document.addEventListener("click", e => { // every .seg[data-chart] window switch
  const b = e.target.closest(".seg[data-chart] button"); if (!b) return;
  const k = b.closest(".seg").dataset.chart; win[k] = winOr(+b.dataset.h, win[k]);
  try { localStorage.setItem(winKey(k), win[k]); } catch {}
  const s = state.stations.find(x => x.id === state.selected); if (s && typeof Chart !== "undefined") chartRedraw[k]?.(s);
});
document.getElementById("condRh").addEventListener("change", () => condRedraw());
function condRedraw() { const s = state.stations.find(x => x.id === state.selected); if (s && typeof Chart !== "undefined") renderCond(s); }
for (const ev of ["click", "keydown"]) document.addEventListener(ev, e => {
  if (ev === "keydown" && e.key !== "Enter" && e.key !== " ") return;
  const el = e.target.closest("[data-id]");
  if (el) { e.preventDefault(); select(el.dataset.id); }
});
const tableDetails = document.getElementById("tableDetails");
let savedOpen = null;
try { savedOpen = localStorage.getItem("tableOpen"); } catch {}
const tableShown = () => savedOpen == null ? matchMedia("(min-width: 821px)").matches : savedOpen === "1";
tableDetails.open = tableShown();
tableDetails.addEventListener("toggle", () => {
  if (tableDetails.open === tableShown()) return; // our own initial set, not a user toggle
  savedOpen = tableDetails.open ? "1" : "0";
  try { localStorage.setItem("tableOpen", savedOpen); } catch {}
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

const note = document.getElementById("updated");
let lastLoad = 0, loading = false;
async function load() {
  if (loading) return;
  loading = true;
  const get = f => fetch(`data/${f}.json`, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  try {
    const [st, rd, dg, rg, hr, he] = await Promise.all([get("stations"), get("readings").catch(() => ({})), get("danger").catch(() => null), get("regions").catch(() => null), get("hourly").catch(() => null), get("health").catch(() => null)]);
    state.danger = dg; state.regions = rg;
    state.stations = st.stations || [];
    state.hourly = hr; state.health = he; state.updated = st.updated;
    state.readings = Object.values(rd).sort((a, b) => new Date(a.t) - new Date(b.t));
    if (!placed().some(s => s.id === state.selected)) state.selected = placed().map(s => goodOnly(s, Date.now())).sort((a, b) => (b.hs ?? 0) - (a.hs ?? 0))[0]?.id; // a misplaced or saved-but-gone station is never picked; default: deepest good HS
    note.textContent = `Updated ${fmtSlot(st.updated)} · ${state.stations.length} stations`;
    lastLoad = Date.now();
    if (map) { dangerOk = !!(state.regions && state.danger?.regions); dangerLayer.clearLayers(); if (dangerOk) dangerLayer.addData(state.regions); } // restyle polygons for the new bulletin
    renderAll();
  } catch {
    if (!lastLoad) note.textContent = "Couldn't load station data. Reload the page to try again."; // refresh failures keep old data
  } finally { loading = false; }
}
load();
// accuracy is judged against the clock: re-check every minute without refetching (charts keep their state)
setInterval(() => { if (state.stations.length && accSig() !== lastSig) { lastSig = accSig(); renderBanner(); renderSummary(); renderMap(); renderTable(); renderChecks(); } }, 60e3);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastLoad > 30 * 60e3) load();
});

