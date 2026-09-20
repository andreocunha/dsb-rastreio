# DSB · Solar Boat Race

Lightweight tracking interface for the Lagoa de Imboassica in Macaé, built with Next.js and Canvas 2D. Boat movement is still **demonstration data**, not live competition telemetry. Competitors follow the selected paths: Match Race uses boats 1 and 2, one per lane; Slalom uses boat 1. Other competitors wait in the waiting area. Support boats and jet skis have separate slow patrols outside the course, never a race route. These demo assignments remain fixed until the course changes; there is no automatic heat rotation or emergency dispatch.

## Run

```sh
npm install
npm run dev
```

Production, including the offline app shell:

```sh
npm run build
npm start
```

The build command generates `public/offline-manifest.js` from the exact Next build. Deploy the generated file together with `public/sw.js` and the Next build. Do not deploy with only `next build`, bypassing the package script. A secure origin (HTTPS, or localhost for development) is required for service workers.

## Map and interaction

The default chart bundles simplified OpenStreetMap geometry: no external tiles, map library, web font or 3D engine is loaded. The satellite button loads imagery on demand. Drag/pinch or use zoom buttons; select a boat on the map or in the accessible fleet list; the initial view fits the selected course. The sliders button below the layer selector opens the course editor. Controls sit near the bottom edge, above the fleet panel on mobile.

The course editor retains buoys, routes, finish line and support area in local storage. This saves changes **only on the current device**; it does not publish a course to spectators. A blocked or full storage API displays a save failure. Coordinates and saved data are validated on restore. See [geography provenance and licensing](lib/map/data/README.md).

Seven 2026 course presets include the supplied schedule. Their geometry is approximate, manually traced from the supplied images: see [course references and limitations](lib/map/data/COURSES.md). Routes and buoys save per course; maintenance and waiting areas are shared across the event. The legacy circuit remains under “Circuito livre / anterior”. Drag handles to adjust geometry, tap a path to insert vertices, undo edits or restore a built-in model. Restoring a course preserves the shared event areas. The mobile editor collapses its options while editing, and fitting the course accounts for the open panel. Zoom reaches level 21; satellite images are enlarged from native level 18 above that level, keeping request counts bounded.

## Offline behaviour

- Production installs an atomic, versioned cache of the home page, its JS/CSS, manifest and small app icon. Installation completes only after the entire shell has been cached.
- Subsequent home navigations use that cached build immediately. New builds install in the background and show an explicit update action, avoiding mixed HTML/JS versions.
- The illustrated map and mock boats work offline after preparation. First-ever access still requires a connection. Browser eviction or clearing site data removes this capability.
- Satellite is optional: only visited tiles are available offline. Persistent satellite storage is capped at 120 tiles; the in-memory cache at 96 images, with six simultaneous requests. Failed tiles do not retry every frame; reconnection clears their failure state.
- Navigation caching is restricted to `/`. API, telemetry, RSC, mutations and unrelated origins are not cached. Real GPS updates will require connectivity and explicit stale-position handling when integrated.
- Development intentionally does not register this worker, to prevent caching dev/HMR chunks.

## Rendering budget

The geographic background and transparent moving layer use separate canvases. A small margin allows the background to be translated during camera movement before repainting. Boat hulls/panels/shadows are cached sprites rendered at 3× resolution. The moving layer follows screen density up to DPR 3 with a five-million-pixel buffer limit; the background stays capped at DPR 1.5. Movement is capped at 30 fps (15 with reduced motion), trails at 100 points per boat sampled every 400 ms. The fleet summary updates at 2 Hz. Hidden tabs stop their animation loop; paused scenes are redrawn only after an interaction changes them.

These are implementation limits, not a guarantee for every device. Benchmark a representative low-end Android device and the intended competition telemetry before the event.

Wake length, width and opacity follow each boat's speed in knots: hidden up to 0.3 knots, moderate at 6 knots, and capped at 12 knots. Faster support craft use that same ceiling without changing the competitors' scale. Each visible wake uses five arcs; the separate colored position history still represents the traveled path.

## Checks

```sh
npm test
npm run lint
npm run build
```

Tests cover geographic round trips, persisted/corrupt course data, static-background invalidation, DPR and hidden-tab handling, tile concurrency/memory limits, atomic offline installation, API cache isolation and tile cache bounds. Production browser checks should include a narrow mobile viewport and a reload with the app server unavailable after the service worker has finished installing.
