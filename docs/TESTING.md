# Testing

| Suite | Command | Needs | Covers |
|---|---|---|---|
| Unit + stub-Grid integration | `npm test` | Node 24 | URL policy; layered identity (real captured `chrome://version`/`edge://version` pages, Chromium and ESR-vs-release rejection); capability allowlist; catalogue/TOML safety and drift; RFB auth vs noVNC's DES; CSV/HTML escaping; lifecycle, capacity race, mismatch, worker loss, restart recovery, idle expiry, multi-worker routing; viewer token/Origin/takeover; projects, policy, matrix, import/export; evidence path safety; migrations. The stub Grid never stands in for browser evidence. |
| Grid contract | `npm run test:grid` (`CATALOG_ID`, `BROWSER_NAME` to choose a build) | `docker compose up -d grid` | Real Dynamic Grid + real browser: slot cap, timeout, unknown id rejected, bidirectional VNC, same desktop (pixel), upload, managed download, hardened container (no binds/mounts/ports/privileges/socket), cleanup. |
| Live smoke | `node tests/integration/live-smoke.mjs --catalog <id> [--restart]` | full stack | Only through BrowserLab: health, availability, launch, identity, viewport, viewer auth, keyboard + Enter (form submit), mouse click, native file dialog upload, download via the browser's address bar, screenshot, result, JSON/CSV/HTML export, close + idempotency, socket closed; `--restart`: interrupted session not passed, persistence, container released. Safari exits 2 = manual part pending. |
| UI E2E | `npm run test:e2e` (once: `npx playwright install chromium`) | full stack | Playwright drives BrowserLab's UI: launch, real key/mouse events into the noVNC canvas, screenshot, result, end session, results page, exports. Playwright's Chromium only drives the UI; it is never a browser under test. |
| Diagnostics | `npm run doctor [-- --fix] [-- --check-url URL]` | stack | Docker, services, exposed ports, workers, build availability, orphaned browser containers, URL reachability from the browser network. |

Fixture site: `tests/fixtures/site/` (served at `/fixture/`; generic, no real data). `?color=rrggbb` paints the page for
same-desktop checks; form submission, file selection and the large link on page 2 change the URL so tests can observe
input from outside the browser.

## Running the API outside Docker

```bash
docker compose up -d grid
docker run -d --rm --name bl-tunnel --network browserlab_browserlab -p 127.0.0.1:14444:4444 --entrypoint socat browserlab/grid:local TCP-L:4444,fork,reuseaddr TCP:grid:4444
BROWSERLAB_GRID_URLS=local=http://127.0.0.1:14444 BROWSERLAB_DATA_DIR=./data node apps/api/src/server.ts
node tests/integration/live-smoke.mjs --fixture http://host.docker.internal:3000/fixture
```

## CI

`.github/workflows/ci.yml`: checks (lint, typecheck, tests, build, TOML drift, licences, `npm audit`, Compose validation,
no company/secret strings); multi-arch app/grid image builds; `live-default` (Linux amd64: Firefox/Chrome/Edge current,
contract, smoke with restart, UI E2E); `live-arm64` (Linux arm64: Firefox, and amd64-only builds must report
unsupported); `live-legacy` (Chrome 109, Edge 121, Firefox 115 ESR, Firefox 115 release; not on pull requests, run it on a branch with `gh workflow run CI --ref <branch>`);
`safari` only on manual dispatch with a self-hosted `macos-safari16` runner – skipped otherwise, never reported green.

Windows and macOS GitHub runners cannot run Linux browser containers, so Docker Desktop on Windows/macOS is verified
manually and recorded in [BROWSER-SUPPORT.md](BROWSER-SUPPORT.md).
