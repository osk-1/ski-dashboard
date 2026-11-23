# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
A personal tool for the owner and a small group of friends who ski around St. Anton / Rendl and Lech / Zürs. They check snow depth, new snow, wind and avalanche danger before heading out, mostly on a phone. There is no broader public audience.

## Product Purpose
Arlberg Snow Depth shows measured snow height, temperature and wind from the weather stations around the Arlberg, with 7 days of history, a 7-day model forecast and the current avalanche danger. Success is that its owner can read the conditions at a glance, in a layout designed for how they look at them, instead of opening several sites.

## Positioning
It is hyper-local and aggregates data that otherwise lives on separate sites (Lawinenwarndienst Tirol and Vorarlberg, GeoSphere Austria, Open-Meteo, the Euregio avalanche bulletin) into one view built around the owner's own way of reading conditions. Measured values come first, and suspicious ones are flagged rather than hidden.

## Operating Context
- Static site on GitHub Pages, plain JavaScript, no backend.
- Data is fetched by scheduled GitHub Actions (`fetch.py`) and published to Pages without data commits.
- Phones (up to 820 px wide) get a bottom-sheet layout over a full-screen map. Wider screens get a desktop page.
- Fonts are self-hosted (Barlow, Barlow Condensed).
- The page is also a PWA (manifest and icons).

## Capabilities and Constraints
- The station list is fixed in `fetch.py`: 11 snow and 9 wind stations, plus TAWES and Vorarlberg stations.
- More stations should be added when they exist inside the current map area.
- Data is never fabricated. Missing values stay missing, and implausible ones are flagged, not changed.
- Source credits and licences are shown, including LWD Vorarlberg, which states no licence.
- English UI today. A German UI is a possible later extension.
- Out of season, the page shows the last bulletin and marks it as not current.

## Brand Commitments
Name: "Arlberg Snow Depth". No other brand commitments were stated.

## Evidence on Hand
Live data in `data/` and fixtures in `tests/fixtures/data/`. There are no testimonials or user numbers, and none should be invented.

## Product Principles
- Measured data first, model data labelled as model.
- Show data age and trust explicitly: flags, offline stations and stale bulletins.
- Optimise for the owner's phone-first, glanceable reading, not a generic audience.
- Stay static and dependency-light.
- Make adding a station or a language cheap.

## Accessibility & Inclusion
No specific standard was stated.
