# Implementation status

What is done and verified, and what still needs hardware. Decisions and upstream evidence: [DECISIONS.md](DECISIONS.md).
Last updated 2026-10-22. Development host: macOS 27 Apple Silicon, Docker Desktop 28.4 (arm64), Compose 2.39, Node 24.22.1.

## Done and verified (commands actually run on the development host)

| Area | Verified by | Result |
|---|---|---|
| Clean install exactly as in README (`docker compose down -v`; `cp .env.example .env`; `docker compose up -d --build`) | `docker compose ps`; `lsof` listeners | app + grid healthy; only `127.0.0.1:3000` listens on the host |
| Dynamic Grid, pinned per-arch catalogue, digest enforcement, hardened browser containers | `npm run test:grid` | 3/3 pass (Firefox 149.0.2, arm64) |
| End-to-end through BrowserLab only (launch, identity, viewport, viewer auth, keyboard, mouse, native-dialog upload, download, screenshot, result, exports, close, restart persistence, interrupted-session cleanup) | `node tests/integration/live-smoke.mjs --restart` | 28/28 pass |
| UI E2E (real key/mouse events into the noVNC canvas, screenshot, result, end, results, exports) | `npm run test:e2e` | pass |
| Static no-socket mode | `docker compose -f compose.yaml -f compose.static.yaml up -d` + live smoke | 24/24 pass; no mounts on grid or app |
| Unit + stub-Grid integration | `npm test` | 44/44 pass |
| Lint / types / build / licences / workflows | `npm run lint`, `npm run typecheck`, `npm run build`, `node scripts/check-licenses.mjs`, actionlint | clean; 104 production packages allowed |
| Diagnostics | `npm run doctor -- --check-url http://app:3000/fixture/` | no problems |
| Firefox 115 ESR image recipe | `docker compose -f compose.yaml -f compose.legacy-amd64.yaml build firefox-esr-image` | builds; Mozilla signature (key 14F26682…D98F0353) and SHA-256 verified; `Mozilla Firefox 115.43.1esr`, channel `esr` |
| Legacy images are genuine vendor builds | `--version` / `dpkg -l` inside pinned images | Google Chrome 109.0.5414.119, Microsoft Edge 121.0.2277.128, Firefox 115.0.3 (release), Chrome 149.0.7827.200, Edge 149.0.4022.98 |
| Parsers match real pages | captured `chrome://version` (Chrome 109), `edge://version` (Edge 121), `about:support` (Firefox 115 ESR, 149) | used as unit-test fixtures (amd64 captures were emulated diagnostics, not test evidence) |
| Worker files | `docker compose -f compose.worker-amd64.yaml config -q`; `… -f compose.remote-workers.example.yaml config -q`; tunnel image build | valid; tunnel image builds (OpenSSH 10.0) |

## Not run / blocked by hardware (external requirements)

| Item | Why | What is needed |
|---|---|---|
| Live sessions for Edge 121, Firefox 115 ESR, Firefox 115 release, Chrome/Edge 149 | First CI run (2026-10-22): Chrome 109 and Firefox 149 (amd64) fully passed; Chrome 149 and Edge 121 stopped at test-script steps that are now fixed; the rest were not reached | Re-run CI `live-default` / `live-legacy` after merging the fix, and record results in BROWSER-SUPPORT.md |
| Safari 16 | Needs a Mac on macOS 12/13 with Safari 16; development Mac has Safari 27 | Follow [SAFARI-WORKER.md](SAFARI-WORKER.md) incl. the manual validation; until then `safari-16-mac` stays not provisioned |
| Remote amd64 worker / Mac via SSH tunnel | No second machine | Files validated only; run once on real hardware |
| Windows Docker Desktop, macOS Intel, Linux hosts | No hardware here | CI covers Linux amd64/arm64 once enabled; Windows/Intel Mac are manual |
| CI `live-*` jobs | First run had failures (see BROWSER-SUPPORT.md); fixes on branch `fix/live-smoke-ci` | Merge and re-run |

## Known limitations / deliberate omissions

- Optional console-error panel not implemented (spec marks it optional).
- No vendor "latest release" lookups; "newest provisioned" only.
- PDF via the browser's print-to-PDF of the HTML report.
- Safari: capability-level identity only; no downloads; no file staging after handover; manual window close.
- Grid can leave a container behind if its own container creation fails; `npm run doctor -- --fix` removes orphans.

## Commands

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"     # Node 24 on the dev Mac (keg-only)
npm ci && npm run lint && npm run typecheck && npm test && npm run build
docker compose up -d --build
npm run test:grid
node tests/integration/live-smoke.mjs --restart
npm run test:e2e
npm run doctor
```
