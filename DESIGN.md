---
name: Arlberg Snow Depth
description: A quiet, glanceable conditions dashboard for the Arlberg: measured snow, wind and avalanche danger over a map.
colors:
  sky-paper: "#f4f7fa"
  panel-white: "#ffffff"
  ink-navy: "#142030"
  muted-slate: "#5b6b7d"
  hairline: "#d8e0e8"
  barometer-blue: "#1d5fc4"
  barometer-tint: "#dbe7f8"
  valley-grey: "#e9eef3"
  village-brown: "#8a6a3c"
  wind-ember: "#c0561a"
  snow-0: "#e6eef8"
  snow-1: "#b9d0ee"
  snow-2: "#7fa9de"
  snow-3: "#3f7cc8"
  snow-4: "#1a4f9c"
  danger-1: "#ccff66"
  danger-2: "#ffff00"
  danger-3: "#ff9900"
  danger-4: "#ff0000"
  danger-5: "#000000"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.02em"
  stat:
    fontFamily: "Barlow Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "1.7rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.06em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  sheet: "16px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "16px"
  xl: "18px"
components:
  panel:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.lg}"
    padding: "16px"
  segmented-button:
    backgroundColor: "{colors.sky-paper}"
    textColor: "{colors.muted-slate}"
    typography: "{typography.label}"
    height: "34px"
  segmented-button-selected:
    backgroundColor: "{colors.barometer-blue}"
    textColor: "{colors.panel-white}"
  select:
    backgroundColor: "{colors.sky-paper}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.sm}"
    padding: "4px 6px"
  danger-chip:
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
---

# Design System: Arlberg Snow Depth

## Overview

**Creative North Star: "The Quiet Barometer"**

The interface is an instrument you glance at, not a site you browse. A cool blue-grey field, one blue accent, and condensed Barlow numerals let the map and the readings carry everything. Chrome recedes: panels are paper-white on a pale sky ground, separated by hairlines, with no decoration that is not data.

It is built for one owner reading conditions on a phone, often outdoors. Density is high but calm. Numbers are tabular and large where they answer the question ("how much snow, how windy"), and small muted text states how old or how trusted a value is. Measured values and model values are always visibly different, and suspect or stale data is faded and labelled, never hidden.

Light and dark follow the system setting. Dark is the same system re-tuned for low ambient light: deep navy panels, a lighter accent, and an inverted snow ramp where more snow is lighter.

**Key Characteristics:**
- Flat, tonal, hairline-bordered surfaces; one lifted layer (the phone sheet).
- One accent (barometer blue) used for selection, focus and links, never for decoration.
- Condensed display face for headings and big numbers; humanist sans for everything else.
- Snow depth is a five-step blue ramp; wind is a single ember orange; avalanche danger uses the fixed EAWS colours.
- Every reading carries its age, source or trust state.

## Colors

A cool, desaturated blue-grey palette with a single saturated blue, one warm ember for wind, and a muted brown for villages on the map.

### Primary
- **Barometer Blue** (#1d5fc4): selected segmented button, focus rings, links, selected table row edge. Dark mode uses a lighter blue so contrast holds.
- **Barometer Tint** (#dbe7f8): selected-row wash, the shaded forecast zone on charts, hover rows.

### Secondary
- **Wind Ember** (#c0561a): wind arrows and wind series, and the warning banner border and wash. It is the only warm colour in the interface.

### Tertiary
- **Village Brown** (#8a6a3c): village labels and markers on the map, so places read apart from stations.

### Neutral
- **Sky Paper** (#f4f7fa): page ground and control fill.
- **Panel White** (#ffffff): panels, sheet, inputs' parent surfaces.
- **Ink Navy** (#142030): primary text.
- **Muted Slate** (#5b6b7d): secondary text, labels, units, stale rows.
- **Hairline** (#d8e0e8): every border and divider.
- **Valley Grey** (#e9eef3): map land colour under the relief tiles.

### Snow ramp
Five steps, pale to deep blue: **snow-0** (#e6eef8) under 10 cm up to **snow-4** (#1a4f9c) at 100 cm and over. In dark mode the ramp inverts so deeper snow is lighter.

### Avalanche danger
The EAWS levels are fixed external colours (danger-1 #ccff66 to danger-5 #000000 with red text) and are never themed.

### Named Rules
**The One Voice Rule.** Barometer Blue marks what is selected or interactive. It is never used for decoration, and a second accent hue is not added.

**The Measured-First Rule.** Measured series are solid; model series are dashed and labelled with their source. Suspect values fade and carry a reason; they are never recoloured to alarm.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow, system-ui)
**Body Font:** Barlow (with system-ui, -apple-system, Segoe UI)

**Character:** A condensed numeric voice for readings and headings, paired with a friendly, legible sans. Self-hosted, latin subset.

### Hierarchy
- **Display** (700, 2rem, 1.1): the page name on desktop; visually hidden on phones.
- **Headline** (600, 1.15rem, 1.2, uppercase, 0.02em): panel titles.
- **Stat** (600, 1.7rem, 1; 1.3rem on phones, 1.35rem in the glance row): the big numbers, tabular figures.
- **Body** (400, 15px, 1.5): descriptions, table cells, controls at 0.85 to 0.9rem.
- **Label** (500, 0.75rem, 0.06em, uppercase): table headers, field labels, stat captions (0.68 to 0.8rem).

### Named Rules
**The Tabular Numerals Rule.** Anything numeric that may change or align in a column uses tabular figures.

**The Small-Print Age Rule.** Timestamps, sources and trust notes are 0.72 to 0.8rem muted text next to the value, never a separate block.

## Layout

A single column of panels up to 1180px, with a 16px side gutter respecting safe-area insets and 18px between panels. Desktop pairs the map with the station list (a 1.25 : 1 grid) and fixes the sidebar; the summary strip wraps flexibly.

On phones (up to 820px wide, or a landscape phone up to 500px high) the layout becomes a bottom sheet: the map fills the screen and the page scrolls over it from a 150px peek, snapping at the start. A selected station replaces the glance row with its card; charts sit in tabs with one shared 24 h / 72 h / 7 d switch. Touch targets are 44px; reserved heights stop charts jumping while dragging.

Rhythm is built from 6, 8, 10, 16 and 18px steps. Groups are tight (6 to 8px) and panels are separated generously (18px).

## Elevation & Depth

Depth is tonal. The page ground (Sky Paper) sits under Panel White, and Hairline borders define edges; there are no card shadows. The single lifted layer is the phone sheet over the map.

### Shadow Vocabulary
- **Sheet lift** (`box-shadow: 0 -4px 16px rgb(0 0 0 / .18)`): the bottom sheet's top edge over the map. Nothing else casts a shadow.

### Named Rules
**The Flat-By-Default Rule.** Surfaces stay flat at rest. A shadow appears only where a layer genuinely floats above the map.

## Shapes

Gently rounded and small: 4px for tags, 6px for inputs and map popups, 8px for segmented controls, bars and banners, 10px for panels, 16px for the sheet's top corners. Snow stations are circles, wind stations a circle with an arrow, villages a small square, peaks a triangle; the legend uses 22×10px swatches with 2px corners. Pills (999px) are reserved for avalanche danger levels and map badges.

## Components

### Segmented controls (24 h / 72 h / 7 d, tabs)
- **Shape:** one bordered group, 8px outer radius, 1px dividers, 34px tall (44px on phones).
- **Default:** Sky Paper fill with Muted Slate 600 label.
- **Selected:** Barometer Blue fill with white text. **Focus:** 2px accent outline, inset.

### Selects and map controls
- **Style:** Sky Paper fill, Hairline border, 6px radius; map zoom and layer buttons are 30px (44px on phones) with a hairline frame and no shadow.
- **Focus:** 2px accent outline with 1px offset.

### Panels
- **Corner Style:** 10px. **Background:** Panel White. **Border:** 1px Hairline. **Padding:** 16px. **Shadow:** none.

### Station table
- **Style:** hairline row dividers, uppercase muted headers with sort buttons (44px target), tabular numerals right-aligned.
- **State:** the selected row gets a Barometer Tint wash and a 3px inset accent edge; stale rows turn muted with the value struck through and "no recent data (last …)" beneath; suspect values show a reason line.

### Danger chip
- **Style:** pill in the fixed EAWS colour, 0.85rem 600; faded to 45% when the bulletin is not current.

### Station card and glance row (signature)
The phone sheet's glance row is three stat columns (temperature, next 24 h, top snow station), each with a condensed number over a small uppercase caption. A station card replaces it with a heading, altitude, a close button (44px) and ruled rows, each pairing a value with its 24 h min and max in small muted text.

## Do's and Don'ts

### Do:
- **Do** keep surfaces flat with 1px Hairline borders; use Barometer Tint for selection.
- **Do** show age, source or trust beside every reading in 0.72 to 0.8rem muted text.
- **Do** use tabular figures for all aligned numbers and Barlow Condensed for large readings.
- **Do** keep touch targets at 44px on phones and a visible 2px accent focus outline.
- **Do** keep model data dashed and labelled with its source; keep the snow ramp inverted in dark mode.

### Don't:
- **Don't** add card shadows, gradients, glass or decorative imagery; depth is tonal.
- **Don't** introduce a second accent colour or use blue for non-interactive decoration.
- **Don't** theme or restyle the EAWS danger colours.
- **Don't** hide or recolour suspect data to alarm; fade it and give the reason.
