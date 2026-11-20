const BOUNDS = { lon0: 10.09, lon1: 10.43, lat0: 47.003, lat1: 47.240 }; // west: east edge of the Sonnenkopf ski area; north: 2 km south of Warth
const PLACES = [["St. Anton", 10.2636, 47.1295], ["St. Christoph", 10.2135, 47.1277], ["Pettneu", 10.3428, 47.1453],
  ["Ischgl", 10.2921, 47.0125]];
const PEAKS = [["Valluga 2811", 10.2125, 47.1575], ["Scheibler 2978", 10.2220, 47.0587], ["Augstenbergkopf 2881", 10.2402, 47.0775],
  ["Maroikopf 2529", 10.1632, 47.1136],["Kaltenberg 2896", 10.1383, 47.0865], ["Trittkopf 2720", 10.1935, 47.1553], ["Rüfispitze 2636", 10.1846, 47.1919],
  ["Madlochspitze 2545", 10.1226, 47.1792], ["Erzbergspitze 2536", 10.1421, 47.1531], ["Wildebene 2570", 10.1803, 47.0958], ["Saumspitze 3039", 10.2696, 47.0509], ["Kreuzjochspitze 2919", 10.3061, 47.0793],
  ["Hochkarspitze 2836", 10.3076, 47.1108], ["Erlijoch 2431", 10.2179, 47.1756], ["Roßfallscharte 2732", 10.2887, 47.0945]];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtSlot = t => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
const arrow = (x, y, to, c) => `<path d="M0-10L6 2H2.5V10H-2.5V2H-6Z" fill="${c}" transform="translate(${x} ${y}) rotate(${to})"/>`;

let state = { stations: [], readings: [], forecast: null, danger: null, regions: null, hourly: null, health: null, updated: null, selected: null };
let condH = 24;
let charts = {};
try { state.selected = localStorage.getItem("sel"); } catch {}
try { const v = +localStorage.getItem("condH"); if ([1, 6, 12, 24, 48, 72, 168].includes(v)) condH = v; } catch {}

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

function renderSummary() {
  const sh = shown(), s = sh.filter(x => x.hs != null), ex = sh.filter(x => x.bad.hs).length;
  const left = sh.filter(x => Object.keys(x.bad).length).map(x => `${esc(x.name)} (${esc(badList(x.bad))})`);
  const note = left.length ? `<p class="src xl">Not current or suspect: ${left.join(" · ")}.</p>` : "";
  if (!s.length) { document.getElementById("summary").innerHTML = '<div class="stat"><b>–</b><span>No snow stations shown</span></div>' + note; return; }
  const deep = s.reduce((a, b) => b.hs > a.hs ? b : a);
  const avg = s.reduce((a, b) => a + b.hs, 0) / s.length;
  const ds = s.map(x => delta24(x.id)).filter(x => x != null);
  const dAvg = ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : null;
  const fc = state.forecast?.points?.[deep.id]?.snowfall;
  const fcSum = fc ? Math.round(fc.reduce((a, b) => a + (b || 0), 0)) : null;
  document.getElementById("summary").innerHTML = [
    [`${Math.round(deep.hs)} cm`, `Deepest · ${esc(deep.name)}`],
    [`${Math.round(avg)} cm`, `Average of ${s.length}${ex ? ` · ${ex} excluded` : " stations"}`],
    [dAvg == null ? "–" : `${dAvg > 0 ? "+" : ""}${dAvg} cm`, "Avg change 24 h"],
    [fcSum == null ? "–" : `${fcSum} cm`, "Model new snow, 5 days"],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("") + note;
}

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

let map, groups, dangerLayer, dangerOk, lc, lp, fitBounds, fitZ, fitCenter;
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
function initMap() {
  mapDiv.innerHTML = "";
  const B = BOUNDS, pad = [.03, .015];
  map = L.map("map", { maxBounds: [[B.lat0 - pad[1], B.lon0 - pad[0]], [B.lat1 + pad[1], B.lon1 + pad[0]]], maxBoundsViscosity: 1, zoomSnap: .25, maxZoom: 16, dragging: !L.Browser.mobile }); // touch: one finger scrolls the page, two fingers (touchZoom) pan/zoom the map
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 15, maxZoom: 16, attribution: "Relief: Esri World Hillshade" }).addTo(map);
  const near = L.latLngBounds(state.stations.map(s => [s.lat, s.lon])).pad(.15); // landmarks around the stations stay in view; far ones (Ischgl) would only shrink the map
  fitBounds = L.latLngBounds([...state.stations.map(s => [s.lat, s.lon]), ...[...PLACES, ...PEAKS].map(([, lon, lat]) => [lat, lon]).filter(c => near.contains(c))]);
  const reset = () => { map.fitBounds(fitBounds, { paddingTopLeft: [60, 40], paddingBottomRight: [40, 40] }); }; // extra left padding keeps the view clear of the zoom/reset controls
  const fit = () => { reset(); fitZ = map.getZoom(); fitCenter = map.project(map.getCenter(), fitZ); map.setMinZoom(fitZ - 1); };
  fit();
  let timer;
  map.on("resize", () => { names(); clearTimeout(timer); timer = setTimeout(() => { fit(); renderMap(); }, 150); });
  const Reset = L.Control.extend({ onAdd() {
    const d = L.DomUtil.create("div", "leaflet-bar"), b = L.DomUtil.create("button", "", d);
    b.type = "button"; b.title = "Reset view"; b.setAttribute("aria-label", "Reset view");
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>';
    b.onclick = reset; L.DomEvent.disableClickPropagation(d); return d; } });
  new Reset({ position: "topleft" }).addTo(map);
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
  for (const [list, cls] of [[PLACES, "v"], [PEAKS, "pk"]]) for (const [name, lon, lat] of list) {
    const marker = L.marker([lat, lon], { pane: "places", interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="pl ${cls}"><i></i>${esc(name)}</span>` }) }).addTo(map);
    landmarks.push({ name, lat, lon, marker, pk: cls === "pk" });
  }
  map.createPane("danger").style.zIndex = 330; // above the relief tiles, under places and stations
  map.createPane("newsnow").style.zIndex = 340; // above danger, under places; own pane, so the dark-mode tile filter skips it
  groups = Object.fromEntries(CATS.map(([k]) => [k, L.layerGroup()]));
  dangerOk = !!(state.regions && state.danger?.regions);
  dangerLayer = L.geoJSON(dangerOk ? state.regions : null, { pane: "danger", interactive: false, style: f => {
    const r = state.danger.regions[f.properties.id], c = DGC[Math.max(0, ...(r?.ratings.map(x => x.level) || []))], old = !r || new Date(r.valid_end) < new Date();
    return { color: c, weight: 1, opacity: old ? .35 : .8, fillColor: c, fillOpacity: old ? .12 : .4 }; } });
  new Layers({ position: "topright" }).addTo(map);
  const names = () => { mapDiv.classList.toggle("names", !phone() && map.getZoom() >= fitZ + 1.5); mapDiv.classList.toggle("zin", map.getZoom() >= fitZ + 1); };
  map.on("zoomend", names); names(); map.on("click", nsClick);
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
  // Label layout at the fitted view, in map pixels. Landmark labels move beside/above/below their symbol to clear station
  // dots and arrows; each value tooltip then takes the lowest-overlap spot around its dot.
  const size = map.getSize(), origin = fitCenter.subtract(size.divideBy(2)), at = (lat, lon) => map.project([lat, lon], fitZ).subtract(origin);
  const narrow = size.x < 480, charW = narrow ? 7 : 8, tipH = narrow ? 20 : 24;
  mapDiv.classList.toggle("narrow", narrow);
  const area = r => (r[2] - r[0]) * (r[3] - r[1]);
  const overlap = (r, q) => Math.max(0, Math.min(r[2], q[2]) - Math.max(r[0], q[0])) * Math.max(0, Math.min(r[3], q[3]) - Math.max(r[1], q[1]));
  const ctl = [[0, 0, 50, 112]], mb = mapDiv.getBoundingClientRect(), cb = lc.getBoundingClientRect(); // zoom + reset column and the layer button/panel, weighted 10x: nothing should sit under them
  ctl.push([cb.left - mb.left, cb.top - mb.top, cb.right - mb.left, cb.bottom - mb.top]);
  const costAgainst = (boxes, r) => boxes.reduce((c, q) => c + overlap(r, q), 0) + 10 * ctl.reduce((c, q) => c + overlap(r, q), 0) + 4 * (area(r) - overlap(r, [0, 0, size.x, size.y])); // outside the map counts extra
  const stationBoxes = [];
  const all = placed().map(s => goodOnly(s, Date.now()));
  for (const s of all) { const { x, y } = at(s.lat, s.lon); if (vis(s)) stationBoxes.push([x - 14, y - 14, x + 14, y + 14]); if (arrowVis(s)) stationBoxes.push([x - 10, y - 36, x + 10, y - 12]); }
  const taken = [...stationBoxes];
  for (const lm of landmarks) {
    if (lm.pk) { map[lay.on.peaks ? "addLayer" : "removeLayer"](lm.marker); if (!lay.on.peaks) continue; }
    const { x, y } = at(lm.lat, lm.lon), len = lm.name.length * 7;
    const sides = [["", [x - 6, y - 9, x + 14 + len, y + 9]], ["l", [x - 14 - len, y - 9, x + 6, y + 9]], ["d", [x - 6, y - 5, x + 6 + len, y + 22]], ["u", [x - 6, y - 22, x + 6 + len, y + 5]]];
    // peaks always label to the right of the symbol
    const [side, box] = (lm.pk ? sides.slice(0, 1) : sides).reduce((best, c) => costAgainst(taken, c[1]) < costAgainst(taken, best[1]) ? c : best);
    lm.marker.getElement().firstChild.className = lm.marker.getElement().firstChild.className.replace(/ (l|d|u)$/, "") + (side && " " + side);
    taken.push(box);
  }
  let focusEl;
  for (const s of shown().sort((a, b) => b.lat - a.lat)) {
    const sel = s.id === state.selected, wo = s.type === "wind", wx = s.type === "weather", wind = hasWind(s), grp = groups[catOf(s)];
    const bad = s.bad[wo ? "wg" : wx ? "lt" : "hs"];
    const val = bad ? badText(bad) : wo ? (s.wg == null ? "–" : Math.round(s.wg) + " km/h") : wx ? (s.lt == null ? "–" : s.lt + " °C") : s.hs == null ? "–" : Math.round(s.hs) + " cm";
    const { x, y } = at(s.lat, s.lon);
    // direction + offset: beside the dot first, then the four diagonals, then below and above
    const spots = [["right", [10, 0]], ["left", [-10, 0]], ["right", [8, 17]], ["right", [8, -17]], ["left", [-8, 17]], ["left", [-8, -17]], ["bottom", [0, 12]], ["top", [0, -12]]];
    const tipBox = (dir, [dx, dy], w) => {
      const left = dir === "right" ? x + dx + 2 : dir === "left" ? x + dx - 2 - w : x - w / 2;
      const top = dir === "bottom" ? y + 3 + dy : dir === "top" ? y - 3 - tipH + dy : y + dy - tipH / 2;
      return [left, top, left + w, top + tipH];
    };
    const bestSpot = w => spots.map(([dir, off]) => ({ dir, off, box: tipBox(dir, off, w) }))
      .reduce((best, c) => (c.cost = costAgainst(taken, c.box)) < best.cost ? c : best, { cost: Infinity });
    const valW = 14 + charW * val.length;
    const spot = bestSpot(sel ? valW + charW * (s.name.length + 1) : valW); // the selected station always keeps its name, even if it must overlap
    taken.push(spot.box);
    const dir = spot.dir, offset = spot.off;
    if (phone()) L.circleMarker([s.lat, s.lon], { pane: "hit", radius: 22, stroke: false, fillOpacity: 0, bubblingMouseEvents: false }).on("click", e => select(shown().reduce((n, t) => map.distance(e.latlng, [t.lat, t.lon]) < map.distance(e.latlng, [n.lat, n.lon]) ? t : n).id)).addTo(grp); // overlapping pads: pick the station nearest the tap // 44px touch target
    // wind-only: just the arrow (or a calm ring) centred in a 44px box, haloed when selected; snow stations keep the coloured dot
    const m = wo ? L.marker([s.lat, s.lon], { keyboard: false, icon: L.divIcon({ className: "wind-ic", iconSize: [44, 44], iconAnchor: [22, 22], html: `<svg width="44" height="44" viewBox="-22 -22 44 44"><circle r="13" fill="${sel ? css("--panel") : "transparent"}"${sel ? ` stroke="${css("--fg")}" stroke-width="3"` : ""}/>${arrowOn(s) ? arrow(0, 0, (s.wr + 180) % 360, css("--wind")) : `<circle r="4.5" fill="${css("--panel")}" stroke="${css("--wind")}" stroke-width="2"/>`}</svg>` }) }).addTo(grp)
      : L.circleMarker([s.lat, s.lon], { radius: sel ? 12 : 9, weight: sel ? 3 : 2, color: sel ? css("--fg") : css("--panel"), fillColor: snow(band(s.hs)), fillOpacity: 1, bubblingMouseEvents: false }).addTo(grp);
    m.bindTooltip(`<span class="nm">${esc(s.name)}</span><b${bad ? ' class="nd"' : ""}>${esc(val)}</b>`, { permanent: true, direction: dir, offset, interactive: true, className: "val" + (sel ? " sel" : "") });
    m.on("click", () => select(s.id)); // interactive tooltip clicks bubble here too
    const el = m.getElement(), t = document.createElementNS("http://www.w3.org/2000/svg", "title");
    t.textContent = `${s.name} · ${s.alt} m · ${wo ? "wind station" : wx ? "weather station" : val}${s.lt != null ? ` · ${s.lt} °C` : ""}${wind ? ` · wind ${Math.round(s.wg)} km/h${s.wg_boe != null ? `, gusts ${Math.round(s.wg_boe)}` : ""}` : ""}`;
    if (wo) el.title = t.textContent; else el.append(t); // SVG paths take a <title>, the HTML wind icon a title attribute
    el.setAttribute("tabindex", "0"); el.setAttribute("role", "button"); el.dataset.sid = s.id;
    el.setAttribute("aria-label", `${s.name}, ${wo ? "wind " : ""}${val === "–" ? "no data" : val}`);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(s.id); } });
    if (s.id === focusId) focusEl = el;
  }
  for (const s of all.filter(arrowVis)) L.marker([s.lat, s.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: "wind-ic", iconSize: [20, 20], iconAnchor: [10, s.id === state.selected && vis(s) ? 36 : 32], html: `<svg width="20" height="20" viewBox="-10 -10 20 20">${arrow(0, 0, (s.wr + 180) % 360, css("--wind"))}</svg>` }) }).addTo(groups.wind);
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
}

function renderCharts() {
  const s = state.stations.find(x => x.id === state.selected);
  if (!s || typeof Chart === "undefined") return;
  chartDefaults();
  renderCond(s);
  const accent = css("--accent"), soft = css("--accent-soft");
  const wind = s.type === "wind", warm = css("--wind"), dim = c => `color-mix(in srgb, ${c} 45%, transparent)`;
  const col = k => state.readings.map(r => r[k]?.[s.id] ?? null);
  const hist = state.readings.map(r => ({ x: fmtSlot(r.t), y: r.hs?.[s.id] ?? null }));
  const [lt, wg, gust, wr] = ["lt", "wg", "wg_boe", "wr"].map(col);
  const fp = state.forecast?.points?.[s.id], fcSrc = `${state.forecast?.source || "source unknown"}, issued ${fmtSlot(state.forecast?.generated)}`;
  const days = state.forecast?.days || [];
  const dayLabel = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  const proj = !wind && fp?.depth ? days.map((d, i) => ({ x: dayLabel(d) + " (fc)", y: fp.depth[i] })) : [];
  const labels = [...hist.map(p => p.x), ...proj.map(p => p.x)];
  const pad = a => [...a, ...proj.map(() => null)];
  const has = a => a.some(v => v != null), hasT = has(lt), hasW = has(wg);
  const ln = (label, data, c, o = {}) => ({ label, data: pad(data), borderColor: c, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, spanGaps: false, tension: .25, ...o });
  // arrows sit on y=0 pointing where the wind blows to, same rotation as the map arrows; calm/unknown -> no point
  const arrowImg = to => { const c = document.createElement("canvas"); c.width = c.height = 18; const x = c.getContext("2d"); x.translate(9, 9); x.scale(.85, .85); x.rotate(to * Math.PI / 180); x.fillStyle = warm; x.fill(new Path2D("M0-10L6 2H2.5V10H-2.5V2H-6Z")); return c; };
  const step = Math.ceil(wr.length / 40); // thin out so arrows do not overlap
  const arrows = wr.map((d, i) => i % step || d == null || wg[i] == null || wg[i] < 1 ? null : arrowImg((d + 180) % 360));
  const sets = wind ? [
    ln("Mean wind (km/h)", wg, warm),
    ln("Gusts (km/h)", gust, dim(warm), { borderWidth: 1.5 }),
    { label: "Direction", data: pad(arrows.map(a => a && 0)), showLine: false, pointStyle: pad(arrows.map(a => a || "circle")), pointRadius: 9, pointHoverRadius: 9 },
  ] : [
    ln("Measured HS (cm)", hist.map(p => p.y), accent, { backgroundColor: soft, fill: "origin", tension: .25 }),
    ...(hasT ? [ln("Temperature (°C)", lt, warm, { yAxisID: "y2", borderWidth: 1.5 })] : []),
    ...(proj.length ? [{ label: "Forecast depth · model (cm)", data: [...hist.map(() => null), ...proj.map(p => p.y)], borderColor: accent, borderDash: [5, 4], borderWidth: 2, pointRadius: 4, fill: false }] : []),
  ];

  document.getElementById("hist").setAttribute("aria-label", wind ? "Wind history chart" : "Snow height and temperature history chart");
  document.getElementById("histTitle").textContent = `History · ${s.name}`;
  document.getElementById("histNote").textContent = !hist.length || (wind && !hasW) ? "No history recorded yet."
    : wind ? `${hist.length} readings since ${hist[0].x}. Mean wind, gusts and direction (arrows point where the wind blows to).`
    : `${hist.length} readings since ${hist[0].x}.` + (hasT ? " Orange line: air temperature (right axis, grid line at 0 °C)." : "") + (proj.length ? ` Dashed line: model snow depth (${fcSrc}).` : "");
  charts.hist?.destroy();
  charts.hist = new Chart(document.getElementById("hist"), {
    type: "line",
    data: { labels, datasets: sets },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: sets.length > (wind ? 2 : 1), labels: { filter: i => i.text !== "Direction" } },
        tooltip: { filter: i => i.dataset.label !== "Direction", callbacks: { label: c => `${c.dataset.label.replace(/ \(.*/, "")}: ${c.parsed.y} ${c.dataset.label.match(/\((.*)\)/)[1]}`, afterBody: it => { const w = wr[it[0].dataIndex]; return wind && w != null ? `Wind from ${Math.round(w)}°` : ""; } } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0 } }, y: { beginAtZero: true, title: { display: true, text: wind ? "km/h" : "cm" }, ...(wind ? { grace: "8%", ticks: { callback: v => v < 0 ? "" : v } } : {}) },
        ...(hasT && !wind ? { y2: { position: "right", title: { display: true, text: "°C" }, grid: { color: c => c.tick.value === 0 ? css("--fg") : "transparent", lineWidth: c => c.tick.value === 0 ? 1.5 : 0 } } } : {}) } },
  });

  document.getElementById("fcTitle").textContent = `5-day snowfall (model) · ${s.name}`;
  charts.fc?.destroy();
  if (!fp) { document.getElementById("fcSource").textContent = "No forecast stored yet."; return; }
  const t0 = v => v == null ? "–" : Math.round(v);
  charts.fc = new Chart(document.getElementById("fc"), {
    type: "bar",
    data: { labels: days.map((d, i) => [dayLabel(d), `${t0(fp.tmin[i])}° / ${t0(fp.tmax[i])}°`]), datasets: [{ label: "New snow · model (cm)", data: fp.snowfall, backgroundColor: accent, borderRadius: 4, maxBarThickness: 44 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y ?? 0} cm new snow (model)` } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, font: { size: 11 } } }, y: { beginAtZero: true, title: { display: true, text: "cm" } } } },
  });
  document.getElementById("fcSource").textContent = `Model: ${fcSrc}. Under each day: model min / max °C at station altitude.`;
}

const fmtHour = (t, day) => new Date(t).toLocaleString("en-GB", { ...(day ? { weekday: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" }), timeZone: "Europe/Vienna" });
const srcOf = id => id.startsWith("TAWES-") ? "GeoSphere Austria" : id.startsWith("VOR-") ? "LWD Vorarlberg" : "LWD Tirol";

// Conditions: the station's hourly series, -X ... now (measured) ... +X (model), or the latest values for 1 h
function renderCond(s) {
  const hours = state.hourly?.hours || {}, id = s.id, el = i => document.getElementById(i);
  for (const b of el("condWin").children) b.setAttribute("aria-pressed", +b.dataset.h === condH);
  el("condTitle").textContent = `Conditions · ${s.name}`;
  charts.cond?.destroy(); charts.cond = null;
  const any = f => Object.values(hours).some(h => h[f]?.[id] != null);
  const gauge = /^(TAWES|VOR)-/.test(id), pf = gauge ? "pr" : "hr", hasOft = any("oft");
  const lines = [["lt", "Air", "°C"], ...(hasOft ? [["oft", "Snow surface", "°C"]] : []), ["rh", "Humidity", "%"], [pf, gauge ? "Precipitation" : "Snow depth rise", gauge ? "mm" : "cm"]];
  const has = Object.values(hours).some(h => Object.entries(h).some(([f, m]) => f !== "flags" && m[id] != null));
  el("condBox").hidden = el("condNow").hidden = el("condWin").parentNode.hidden = !has;
  if (!has) { el("condNote").textContent = "No hourly data for this station."; return; }
  const now = anchorMs(hours, Date.now()), m = state.hourly.model || {};
  const modelSrc = `model · ${m.source || "source unknown"}${m.issued ? ", issued " + fmtSlot(m.issued) : ""}`;
  el("condBox").hidden = condH === 1; el("condNow").hidden = condH !== 1; el("condRh").parentNode.hidden = condH === 1;
  if (condH === 1) {
    el("condNow").innerHTML = lines.map(([f, name, u]) => { const v = latest(hours, f, id, now);
      const fl = v && hours[v.k].flags?.[id]?.[f], old = v && Date.now() - keyMs(v.k) > staleAfter[f], t = v ? `${esc(v.y)} ${u}` : "–"; // pr/hr have no staleAfter: never stale
      return `<div class="stat"><b>${fl || old ? `<s class="bad">${t}</s>` : t}</b><span>${name}</span><small>${v ? fmtSlot(keyMs(v.k)) : "no data"}${fl ? ` · suspect: ${esc(fl)}` : old ? " · not current" : ""}</small></div>`; }).join("");
    el("condNote").textContent = `Latest measured values (${srcOf(id)}), with their measurement times.`;
    return;
  }
  const from = now - condH * 3600e3, to = now + condH * 3600e3, past = f => slice(hours, f, id, from, now), fut = f => slice(hours, f, id, now + 1, to);
  const nn = a => a.some(p => p.y != null);
  const warm = css("--wind"), accent = css("--accent"), rain = css("--snow-2"), rainM = css("--snow-3"), muted = css("--muted");
  // flagged hours (hourly.json hours[k].flags) are drawn faded, with a hollow outlined dot (visible at phone size), and the tooltip names the reason
  const fade = c => `color-mix(in srgb, ${c} 30%, transparent)`, flagAt = x => x.chart.data.datasets[x.datasetIndex].data[x.p0DataIndex]?.fl || x.chart.data.datasets[x.datasetIndex].data[x.p1DataIndex]?.fl;
  const ln = (f, label, unit, c, o = {}) => ({ label, unit, src: `measured · ${srcOf(id)}`, data: past(f).map(p => ({ ...p, fl: hours[p.k]?.flags?.[id]?.[f] })), borderColor: c, backgroundColor: c, borderWidth: 2,
    pointRadius: x => x.raw?.fl ? 3.5 : 0, pointBackgroundColor: css("--panel"), pointBorderColor: css("--fg"), pointBorderWidth: 1.5, segment: { borderColor: x => flagAt(x) ? fade(c) : undefined }, pointHoverRadius: 5, pointHitRadius: 8, spanGaps: false, yAxisID: "y", ...o });
  const lt = ln("lt", "Air", "°C", warm), mt = { ...ln("mt", "Air · model", "°C", warm, { borderDash: [5, 4], borderWidth: 1.5, src: modelSrc }), data: fut("mt") };
  const oft = hasOft && ln("oft", "Snow surface", "°C", accent);
  const rh = el("condRh").checked && ln("rh", "Humidity", "%", muted, { borderWidth: 1, yAxisID: "yH" });
  const bar = (label, unit, data, o) => ({ type: "bar", label, unit, data, yAxisID: "yP", order: 2, barPercentage: 1, categoryPercentage: .8, ...o });
  const pr = bar(gauge ? "Precipitation" : "Snow depth rise", gauge ? "mm" : "cm", past(pf), { backgroundColor: rain, src: `measured · ${srcOf(id)}` });
  const pm = bar("Precip. · model", "mm", slice(hours, "pm", id, from, to).map(p => ({ ...p, sm: hours[p.k]?.sm?.[id] })), { backgroundColor: "transparent", borderColor: rainM, borderWidth: 1.5, src: modelSrc });
  const hasModel = nn(mt.data) || nn(pm.data);
  const sets = [lt, oft, rh, mt, pr, pm].filter(d => d && (d === lt || nn(d.data)));
  const zone = { id: "zone", beforeDatasetsDraw(c) { // shaded forecast zone after "now"
    const { ctx, chartArea: a, scales: { x } } = c, px = Math.max(a.left, Math.min(a.right, x.getPixelForValue(now)));
    ctx.save(); ctx.fillStyle = css("--accent-soft"); ctx.globalAlpha = .5; ctx.fillRect(px, a.top, a.right - px, a.bottom - a.top);
    ctx.globalAlpha = 1; ctx.strokeStyle = muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
    ctx.fillStyle = muted; ctx.font = `11px ${css("--body")}`; ctx.fillText("now", px + 4, a.top + 11); ctx.restore(); } };
  const step = { 6: 2, 12: 4, 24: 12, 48: 24, 72: 24, 168: 24 }[condH] * 3600e3;
  const zero = { color: c => c.tick.value === 0 ? css("--fg") : css("--line"), lineWidth: c => c.tick.value === 0 ? 1.5 : 1 };
  el("cond").setAttribute("aria-label", `Conditions chart, ${condH} hours either side of now`);
  charts.cond = new Chart(el("cond"), {
    type: "line", data: { datasets: sets }, plugins: [zone],
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: { legend: { labels: { boxWidth: 14, boxHeight: 8, font: { size: 11 } } },
        tooltip: { filter: i => i.parsed.y != null, callbacks: { title: it => fmtSlot(it[0].parsed.x),
          label: c => `${c.dataset.label}: ${c.parsed.y} ${c.dataset.unit}${c.raw.sm != null ? ` (snow ${c.raw.sm} cm)` : ""}${c.raw.fl ? ` · suspect: ${c.raw.fl}` : ""}`,
          footer: it => [...new Set(it.map(i => i.dataset.src))] } } },
      scales: {
        x: { type: "linear", min: from, max: to, grid: { display: false },
          afterBuildTicks: ax => { ax.ticks = []; for (let t = Math.ceil(from / 3600e3) * 3600e3; t <= to; t += 3600e3) if (keyMs(viennaKey(t)) === t && (+viennaKey(t).slice(11) * 3600e3) % step === 0) ax.ticks.push({ value: t }); },
          ticks: { maxRotation: 0, font: { size: 11 }, callback: v => viennaKey(v).endsWith("T00") ? fmtHour(v, true) : fmtHour(v) } },
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

// touch: drop the tooltip when the finger lifts; click comes last, after the emulated mousemove that would re-show it (listener on the canvas, which survives chart re-creation)
for (const cid of ["hist", "cond"]) for (const ev of ["pointerup", "touchend", "click"]) document.getElementById(cid).addEventListener(ev, e => { const c = charts[cid]; if (!c || e.pointerType === "mouse" || (e.type === "click" && !e.pointerType)) return; setTimeout(() => { if (c !== charts[cid]) return; c.setActiveElements([]); c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.update(); }, 50); }); // after Chart.js's own (rAF-throttled) event handling

// banner when the last successful refresh is too old (health.json run time, else stations.json updated)
function renderBanner() {
  const last = state.health?.run || state.updated, b = document.getElementById("banner");
  b.hidden = !refreshStale(last, Date.now());
  b.textContent = `Data may be out of date: the last successful refresh was ${last ? fmtSlot(last) : "unknown"}. Check the measurement times before relying on any value.`;
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

function renderAll() { renderBanner(); renderSummary(); renderDanger(); renderMap(); renderTable(); renderCharts(); renderChecks(); }

function select(id) {
  state.selected = id;
  try { localStorage.setItem("sel", id); } catch {}
  renderMap(); renderTable(); renderCharts();
}
document.getElementById("stnSel").addEventListener("change", e => select(e.target.value));
document.getElementById("condWin").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; condH = +b.dataset.h; try { localStorage.setItem("condH", condH); } catch {} condRedraw(); });
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
    const [st, fc, rd, dg, rg, hr, he] = await Promise.all([get("stations"), get("forecast").catch(() => null), get("readings").catch(() => ({})), get("danger").catch(() => null), get("regions").catch(() => null), get("hourly").catch(() => null), get("health").catch(() => null)]);
    state.danger = dg; state.regions = rg;
    state.stations = st.stations || [];
    state.forecast = fc; state.hourly = hr; state.health = he; state.updated = st.updated;
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
setInterval(() => { if (state.stations.length) { renderBanner(); renderSummary(); renderMap(); renderTable(); renderChecks(); } }, 60e3);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastLoad > 30 * 60e3) load();
});

