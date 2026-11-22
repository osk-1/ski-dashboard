/* global lay, WX, NSW, map, lp, renderMap, fmtSlot, css */ // from app.js
/* exported nsFresh, nsName, nsLoad, nsClick, nsShow, nsC */ // used by app.js
// Weather overlay (avalanche.report), split from app.js. Classic script loaded before app.js: it shares app.js's globals (map, lay, WX, NSW, lp, renderMap, ...) and only uses them when called.
// Weather overlay (avalanche.report): config per key, loaded on first selection; nsEnd = selected period end (ms, UTC; hourly overlays: now); nsImg caches url -> reprojected data URL
// nsGo: the shown (or loading) selection: keyframes, their frames, the fade position; nsOv: its overlays A (+ B while fading); nsAt: the clicked spot and its value per keyframe
const nsCfg = {},
  nsAge = {},
  nsErr = {},
  nsBusy = {},
  nsImg = {};
const nsRm = matchMedia("(prefers-reduced-motion: reduce)");
let nsEnd, nsOv, nsPin, nsGo, nsRaf, nsAt;
let nsPlay = !nsRm.matches;
const nsFresh = () => {
  if (Date.now() - nsAge[lay.wx] > 18e5) delete nsCfg[lay.wx];
}; // a config older than 30 min is fetched again, so "Now" is not a stale time
const nsC = () => nsCfg[lay.wx],
  nsName = () => WX.find(w => w[0] === lay.wx)[1],
  nsMinus = v => String(v).replaceAll("-", "−");
const nsDec = (k, r) => (k === "temp" ? (r - 120) / 2 : r); // PNG red channel -> value (temp: °C = (R − 120) / 2)
const NS_ATTR =
  'Weather model: <a href="https://avalanche.report" target="_blank" rel="noopener">GeoSphere Austria via avalanche.report</a>';
const nsRange = () => nsC().timeRanges.find(r => r.timeRange === lay.nsh) || nsC().timeRanges[0];
const nsUrl = (tpl, end) => {
  const d = new Date(end).toISOString();
  return tpl
    .replace("https://wiski.tirol.gv.at/lawine/", "https://static.avalanche.report/")
    .replaceAll("$year", d.slice(0, 4))
    .replaceAll("$date", d.slice(0, 10))
    .replaceAll("$hour", d.slice(11, 13));
};
const nsBounds = () => map.options.maxBounds.pad(1);
const nsKf = () =>
  lay.wx === "new-snow" ? [nsEnd] : (k => (k.length > 1 ? k : [nsEnd]))(nsKeys(nsEnds(), lay.nsw, nsEnd)); // keyframes; a window without data falls back to Now
const nsCur = () =>
  nsKf()
    .map(t => nsUrl(nsRange().imageOverlayURL, t))
    .join(" "); // identifies the selection: a single frame is just its url
const nsEnds = () => {
  const r = nsRange(),
    s = r.timeStepHours * 36e5,
    i = Date.parse(r.initialTimestamp),
    lo = Date.parse(r.maxAnalysisTimestamp) - (nsC().timeRanges.length > 1 ? 7 * 864e5 : 24 * 36e5),
    out = []; // hourly overlays: 24 h back
  for (let t = i + Math.floor((Date.parse(r.maxForecastTimestamp) - i) / s) * s; t >= lo; t -= s) out.push(t);
  return out;
}; // newest first, every initialTimestamp + k·step
function nsLoad(k) {
  nsBusy[k] = true;
  fetch(`https://static.avalanche.report/zamg_meteo/overlays/${k}/config.json`, { signal: AbortSignal.timeout(15000) })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(c => {
      if (!c.timeRanges?.length || !c.thresholds?.length || !c.boundingBoxes?.some(b => b.lambert || b.bbox)) throw 0;
      nsCfg[k] = c;
      nsAge[k] = Date.now();
      if (lay.wx === k) nsEnd = Date.parse(nsRange().initialTimestamp);
    })
    .catch(() => {
      nsErr[k] = true;
    })
    .finally(() => {
      nsBusy[k] = false;
      nsPanel();
      renderMap();
    });
}
function nsPanel() {
  const x = lp?.querySelector("#nsx");
  if (!x) return; // the panel is not in the document yet during onAdd
  const f = document.activeElement?.dataset?.ns; // rebuilt selects must not drop keyboard focus
  for (const w of WX) lp.querySelector(`[data-n="${w[0]}"]`).textContent = nsErr[w[0]] ? "unavailable" : ""; // only the selected one is tried; the note stays until a retry
  if (!lay.wx || !nsC()) {
    x.innerHTML = "";
    return;
  }
  const ma = Date.parse(nsRange().maxAnalysisTimestamp),
    ends = nsEnds(),
    opt = t => `<option value="${t}"${t === nsEnd ? " selected" : ""}>${esc(fmtSlot(t))}</option>`,
    on = nsKf().length > 1 ? lay.nsw : 0;
  if (lay.wx !== "new-snow")
    x.innerHTML =
      `<div class="seg nsw" role="group" aria-label="Time window">${NSW.map(w => `<button type="button" data-ns="w${w}" aria-pressed="${w === on}"${w && nsKeys(ends, w, nsEnd).length < Math.abs(w) / nsStep(w) + 1 ? ` aria-disabled="true" title="${w > 0 ? "No forecast for this layer" : "No data this far back"}"` : ""}>${w ? nsMinus((w > 0 ? "+" : "") + w) : "Now"}</button>`).join("")}</div>` +
      (nsKeys(ends, 3, nsEnd).length < 2 ? `<small class="nsn">No forecast for this layer</small>` : "") + // the hint must reach touch screens and screen readers too
      (on
        ? `<div class="nsp"><button type="button" data-ns="p" aria-label="${nsPlay ? "Pause" : "Play"}">${nsPlay ? "❚❚" : "▶"}</button><small>every ${nsStep(on)} h${nsPlay ? "" : " · paused"}</small></div>`
        : "");
  else
    x.innerHTML =
      (nsC().timeRanges.length > 1
        ? `<label><span>Period</span><select data-ns="h">${nsC()
            .timeRanges.map(
              r =>
                `<option value="${esc(r.timeRange)}"${r === nsRange() ? " selected" : ""}>${esc(r.timeRange)} h</option>`,
            )
            .join("")}</select></label>`
        : "") +
      `<label><span>Until</span><select data-ns="t">${[
        ["Forecast", t => t > ma],
        ["Past", t => t <= ma],
      ]
        .map(([l, f]) => (ends.some(f) ? `<optgroup label="${l}">${ends.filter(f).map(opt).join("")}</optgroup>` : ""))
        .join("")}</select></label>`;
  if (f) x.querySelector(`[data-ns="${f}"]`)?.focus();
}
// lat/lon -> source pixel [col, row] on a W x H image: Lambert box, or (gust) the plain lat/lon box [lon0, lat0, lon1, lat1]
const nsPix = (lat, lon, W, H, cfg) => {
  const bs = cfg.boundingBoxes,
    B = bs.find(b => b.lambert)?.lambert;
  if (B) {
    const [x, y] = lambert(lat, lon);
    return [Math.floor((x - B[0]) / ((B[2] - B[0]) / W)), Math.floor((B[3] - y) / ((B[3] - B[1]) / H))];
  }
  const [x0, y0, x1, y1] = bs.findLast(b => b.bbox).bbox;
  return [Math.floor((lon - x0) / ((x1 - x0) / W)), Math.floor((y1 - lat) / ((y1 - y0) / H))];
};
// the gust GIF is opaque: clear the border colour flood-filled in from the edges (a plain colour key would also cut real values inside)
const nsClear = (d, W, H) => {
  const k = d.slice(0, 3),
    st = [],
    hit = (i, j) => {
      const p = (j * W + i) * 4;
      if (d[p + 3] && d[p] === k[0] && d[p + 1] === k[1] && d[p + 2] === k[2]) {
        d[p + 3] = 0;
        st.push(i, j);
      }
    };
  for (let i = 0; i < W; i++) {
    hit(i, 0);
    hit(i, H - 1);
  }
  for (let j = 0; j < H; j++) {
    hit(0, j);
    hit(W - 1, j);
  }
  while (st.length) {
    const j = st.pop(),
      i = st.pop();
    if (i > 0) hit(i - 1, j);
    if (i < W - 1) hit(i + 1, j);
    if (j > 0) hit(i, j - 1);
    if (j < H - 1) hit(i, j + 1);
  }
};
// GIF in Austria Lambert (or lat/lon) -> canvas; cfg is the overlay's own config, not "the current one" (the selection can change while the image loads) over 3x the map's maxBounds (the view is wider than them, and can zoom out a step), sampled linearly in Web Mercator because L.imageOverlay stretches linearly there
const nsDraw = (url, cfg) =>
  new Promise((ok, no) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onerror = no;
    im.onload = () => {
      try {
        const W = im.width,
          H = im.height,
          c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        g.drawImage(im, 0, 0);
        const src = g.getImageData(0, 0, W, H).data;
        if (!cfg.boundingBoxes.some(b => b.lambert)) nsClear(src, W, H);
        const { w, h, m } = nsMap(cfg, W, H),
          o = document.createElement("canvas");
        o.width = w;
        o.height = h;
        const og = o.getContext("2d"),
          out = og.createImageData(w, h),
          s32 = new Uint32Array(src.buffer),
          o32 = new Uint32Array(out.data.buffer);
        for (let p = 0; p < m.length; p++) if (m[p] >= 0) o32[p] = s32[m[p]];
        og.putImageData(out, 0, 0);
        ok(o.toDataURL());
      } catch (e) {
        no(e);
      }
    };
    im.src = url;
  });
// output pixel -> source pixel index (−1 outside the image), once per config and image size: every frame of a layer shares the geometry
const nsMap = (cfg, W, H) =>
  ((cfg.idx ??= {})[W + "x" + H] ??= (() => {
    const P = L.Projection.SphericalMercator,
      mb = nsBounds(),
      nw = P.project(mb.getNorthWest()),
      se = P.project(mb.getSouthEast()),
      dx = se.x - nw.x,
      dy = se.y - nw.y,
      k = 600 / Math.max(Math.abs(dx), Math.abs(dy)); // ~3 px per 500 m source px
    const w = Math.round(Math.abs(dx) * k),
      h = Math.round(Math.abs(dy) * k),
      m = new Int32Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const ll = P.unproject(L.point(nw.x + ((i + 0.5) * dx) / w, nw.y + ((j + 0.5) * dy) / h)),
          [col, row] = nsPix(ll.lat, ll.lng, W, H, cfg);
        m[j * w + i] = col >= 0 && col < W && row >= 0 && row < H ? row * W + col : -1;
      }
    return { w, h, m };
  })());
// PNG (R = value) -> its R channel only (1/4 of the memory; up to 9 per click), cached by url like the GIF
const nsPng = url =>
  new Promise((ok, no) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onerror = no;
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext("2d");
        g.drawImage(im, 0, 0);
        const px = g.getImageData(0, 0, im.width, im.height).data,
          d = new Uint8Array(px.length >> 2);
        for (let i = 0; i < d.length; i++) d[i] = px[i * 4];
        ok({ W: im.width, H: im.height, d });
      } catch (e) {
        no(e);
      }
    };
    im.src = url;
  });
function nsClick(e) {
  // value of the weather PNGs under the click, as a pin with a tooltip that follows the animation
  if (!nsOv || !nsRange().dataOverlayURL || e.originalEvent?.target.closest?.(".leaflet-tooltip,.leaflet-interactive"))
    return; // no value PNGs for this layer; stations and their value tags are not map spots
  const p = (nsAt = { ll: e.latlng, g: nsGo, v: [] }),
    k = lay.wx,
    cfg = nsC(),
    tpl = nsRange().dataOverlayURL;
  nsPin?.remove();
  nsPin = null;
  nsGo.keys.forEach((T, i) => {
    const url = nsUrl(tpl, T);
    (nsImg[url] ??= nsPng(url)).then(
      ({ W, H, d }) => {
        if (nsAt !== p) return; // clicked elsewhere, or the selection moved on while this loaded
        const [col, row] = nsPix(p.ll.lat, p.ll.lng, W, H, cfg);
        p.v[i] = col >= 0 && col < W && row >= 0 && row < H ? nsDec(k, d[row * W + col]) : NaN;
        nsTip();
      },
      () => {
        delete nsImg[url];
        if (nsAt === p) {
          p.v[i] = NaN;
          nsTip();
        }
      },
    );
  }); // no data for that hour: the pin says so instead of showing the other hour's value
  nsTrim(nsGo);
}
function nsTip() {
  // the pin's value at the current fade position; a keyframe whose PNG is still loading gives way to the other; a failed one shows –
  const g = nsGo,
    p = nsAt,
    b = g?.B ? g.b : -1;
  if (!p || p.g !== g) return;
  const v = lerp(p.v[g.a], b < 0 ? null : p.v[b], g.t),
    k = lay.wx;
  if (v == null) return;
  const txt =
    `<b>${Number.isNaN(v) ? "–" : `${k === "new-snow" ? "+" : ""}${nsMinus(k === "temp" ? Math.round(v * 2) / 2 : Math.round(v))} ${esc(nsC().units)}${k === "new-snow" ? ` (${esc(nsRange().timeRange)} h)` : ""}`}</b>` +
    (g.keys.length > 1
      ? ` · ${((g.lbl ??= [])[b < 0 || g.t < 0.5 ? g.a : b] ??= esc(new Date(g.keys[b < 0 || g.t < 0.5 ? g.a : b]).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" })))}`
      : ""); // label cached per keyframe: a formatter per frame is wasted work
  if (!nsPin)
    nsPin = L.circleMarker(p.ll, {
      pane: "places",
      radius: 8,
      interactive: false,
      color: css("--fg"),
      weight: 2,
      fillOpacity: 0,
    })
      .addTo(map)
      .bindTooltip(txt, { permanent: true, direction: "right", offset: [8, 0], className: "val" });
  else if (nsPin.txt !== txt) nsPin.setTooltipContent(txt);
  nsPin.txt = txt;
}
function nsSetPlay(on) {
  nsPlay = on;
  cancelAnimationFrame(nsRaf);
  if (on && nsOv && nsGo.keys.length > 1) {
    delete nsGo.ms;
    nsRaf = requestAnimationFrame(nsTick);
  }
  nsPanel();
}
nsRm.addEventListener("change", () => nsSetPlay(!nsRm.matches)); // the OS setting can change while the page is open
const nsOvl = (src, o) =>
  L.imageOverlay(src, nsBounds(), { pane: "newsnow", opacity: o, interactive: false, attribution: NS_ATTR });
// nsImg is keyed by url in load order: keep the newest NS_KEEP entries (a +48 selection is 9 images + 9 value PNGs) and always the shown selection
const NS_KEEP = 30,
  nsUrls = g =>
    g.keys.flatMap(T => [
      nsUrl(nsRange().imageOverlayURL, T),
      ...(nsRange().dataOverlayURL ? [nsUrl(nsRange().dataOverlayURL, T)] : []),
    ]);
function nsTrim(g) {
  const ks = Object.keys(nsImg),
    keep = nsUrls(g);
  for (const u of ks.slice(0, Math.max(0, ks.length - NS_KEEP))) if (!keep.includes(u)) delete nsImg[u];
}
const nsStop = () => {
  cancelAnimationFrame(nsRaf);
  nsOv?.remove();
  nsOv = nsGo = null;
  if (!lay.wx) for (const u in nsImg) delete nsImg[u];
}; // overlay switched off: free its images
const nsOpen = (g, i) => {
  g.a = i;
  nsOv = L.layerGroup([(g.A = nsOvl(g.fr[i], 0.55))]).addTo(map);
  if (g.keys.length > 1) nsRaf = requestAnimationFrame(nsTick);
}; // first frame on the map
function nsShow() {
  if (nsGo) return; // shown or loading (renderMap stops any other selection)
  const g = (nsGo = { id: nsCur(), keys: nsKf(), fr: [], a: 0, b: -1, t: 0 }),
    n = g.keys.length,
    cfg = nsC(),
    tpl = nsRange().imageOverlayURL,
    now = g.keys.indexOf(nsEnd),
    first = nsPlay ? now : lay.nsw < 0 ? 0 : n - 1; // playing starts at Now; paused shows the end the button names, so the window still does something
  for (const i of g.keys.map((_, j) => (first + j) % n)) {
    const url = nsUrl(tpl, g.keys[i]); // that frame first, then in playback order
    (nsImg[url] ??= nsDraw(url, cfg)).then(
      src => {
        if (nsGo !== g) return; // the selection moved on while this loaded
        g.fr[i] = src;
        if (nsOv || (!nsPlay && i !== first && g.fr[first] === undefined)) return; // paused: wait for the frame it should show
        nsOpen(g, i);
      },
      () => {
        delete nsImg[url];
        if (nsGo !== g) return;
        g.fr[i] = false;
        if (i === first && !nsOv) {
          const j = g.fr.findIndex(f => f);
          if (j >= 0) nsOpen(g, j);
        }
        if (g.keys.every((_, j) => g.fr[j] === false)) {
          nsStop();
          nsErr[lay.wx] = true;
          nsPanel();
          renderMap();
        }
      },
    );
  }
  nsTrim(g);
}
function nsTick(ms) {
  // fade A (keyframe a) into B (the next good keyframe b); one loop of the window takes ~10 s
  const g = nsGo;
  if (nsPlay && g.ms != null && ms - g.ms < 32) {
    nsRaf = requestAnimationFrame(nsTick);
    return;
  } // ~30 fps is enough for a slow fade and halves the repaints
  const n = g.keys.length,
    dt = Math.min(ms - (g.ms ?? ms), 100);
  g.ms = ms;
  nsRaf = nsPlay && requestAnimationFrame(nsTick); // paused: draw this frame, then stop (play restarts the loop)
  let b = g.a;
  do b = (b + 1) % n;
  while (g.fr[b] === false && b !== g.a); // a failed keyframe is skipped
  if (b === g.a) {
    cancelAnimationFrame(nsRaf);
    nsRaf = 0;
    return;
  } // one good frame only (the others failed): nothing to animate, cancel the tick asked for above
  if (!g.fr[b]) return; // the next one is still loading
  if (g.b !== b) {
    g.b = b;
    g.B ? g.B.setUrl(g.fr[b]) : nsOv.addLayer((g.B = nsOvl(g.fr[b], 0)));
  }
  if (!g.B.getElement().complete) return; // the new frame is still decoding: keep the current one, do not fade to blank
  if (nsPlay) g.t += (dt * n) / 10000;
  if (g.t >= 1) {
    [g.A, g.B] = [g.B, g.A];
    g.a = b;
    g.b = -1;
    g.t = 0;
  }
  g.A.setOpacity(0.55 * (1 - g.t));
  g.B.setOpacity(0.55 * g.t);
  nsTip();
}
