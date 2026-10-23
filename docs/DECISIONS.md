# Decisions and evidence

Each answer below was established with a runnable check on 2026-10-22 (host: macOS 27, Apple Silicon, Docker Desktop
28.4, Compose 2.39) unless marked otherwise.

## 1. Selenium Grid release and the live VNC route

`selenium/standalone-docker:4.51.0-20261010` (amd64+arm64), pinned by digest in `docker/Dockerfile.grid`. With
`se:vncEnabled`, sessions return `se:vnc = ws://<grid>/session/{id}/se/vnc`. Proven by RFB handshake through that route.
Regression: `tests/integration/grid-contract.test.mjs`.

Findings that shaped the config (all regression-tested):
- Grid must use `url = "http://127.0.0.1:2375"` (its in-container socat); `unix://` crashes Grid.
- `SE_NODE_MAX_SESSIONS` is ignored by standalone-docker; `SE_DYNAMIC_MAX_SESSIONS` works.
- Grid needs an assets directory ("Assets path must be set"); a named volume is used. It is bound into browser
  containers only for `se:recordVideo`, which BrowserLab never sends.
- Grid's default 300 s session timeout would kill manual sessions with no WebDriver traffic; BrowserLab sends a WebDriver
  keepalive every 60 s while open, and keeps 300 s so Grid reaps sessions if BrowserLab dies.
- `reject-unsupported-caps = true` in the TOML (the env var is not read by standalone-docker) makes unknown builds fail in
  milliseconds instead of queueing for 180 s.
- Grid 4.51 cannot use `repo:tag@digest` ("pull succeeded but image not present locally") and fails at container
  creation with `repo@digest` ("Unable to find name"). So the TOML uses tags and the grid entrypoint enforces
  `# pin` lines: it pulls by digest and re-points the tag before Grid starts, failing closed.
- Grid pulls every mapped image for its own platform at start, so TOMLs are generated per architecture.
- Grid leaves a browser container behind if container creation fails half-way (seen during misconfiguration);
  `npm run doctor -- --fix` removes orphans.

## 2. Dynamic Grid with interactive, bidirectional VNC

Yes on Docker Desktop for macOS (arm64): pointer click and key events sent through the WebSocket changed page state, read
back via WebDriver; pixel sampling proves the VNC desktop shows the WebDriver page. Canonical mode = Dynamic Grid.
Linux amd64/arm64 are covered by CI jobs (results appear once the repository runs Actions). Windows Docker Desktop: not
run (no hardware). A static one-container mode without any Docker socket (`compose.static.yaml`) is provided and tested
(live smoke 24/24) for hosts that forbid socket mounts.

VNC inside the private network has no password: Dynamic Grid copies every `SE_*` variable of the Grid container into
every browser container, so a password would be readable by any browser container anyway. The authenticated BrowserLab
relay is the only path to it, and nothing publishes 7900/5900.

## 3. Official historic images

| Target | Result |
|---|---|
| Google Chrome 109 | `selenium/standalone-chrome:109.0-chromedriver-109.0-grid-4.51.0-20261010@sha256:eba35b7b…` (amd64 only). Inside: `google-chrome-stable 109.0.5414.119-1`, ChromeDriver 109.0.5414.74. Branded Chrome, not Chromium. |
| Microsoft Edge 121 | `selenium/standalone-edge:121.0-…@sha256:f81b8609…` (amd64 only). Inside: `microsoft-edge-stable 121.0.2277.128-1`, msedgedriver 121.0.2277.128. |
| Firefox 115 ESR | **No official image.** Selenium's `115.0` image is Firefox 115.0.3 on the `release` channel. Recipe `browser-images/custom/firefox-115esr` installs Mozilla's `115.43.1esr` Linux x86_64 tarball, verifying `SHA256SUMS` signed by Mozilla's release key (primary fingerprint `14F26682D0916CDD81E37B6D61B7B526D98F0353`) and asserting version and `esr` channel at build time. |

Chrome for Testing starts at 113 and is not used. Runtime sessions for these three need an amd64 host (CI `live-legacy`).

## 4. Distinguishing Firefox 115 ESR from 115 release

Yes, from the running browser: Firefox `about:support` reports *Update Channel* (`esr` vs `release`) and version
`115.43.1esr`; WebDriver reports `115.43.1`. BrowserLab reads it in a throwaway tab and requires the catalogue's
`updateChannel`. Unit-tested with both directions of confusion.

## 5. Safari 16 manual control

Apple documents that WebDriver-controlled Safari windows are covered by a glass pane that blocks user input; breaking it
permanently ends the WebDriver session. So Safari uses a handover design (WebDriver phase, then manual control over
macOS Screen Sharing with VNC auth terminated server-side, through SSH). Requirements: real Mac on macOS 12/13 with
Safari 16, auto-login dedicated user, LaunchAgent-hosted Selenium server, Screen Sharing VNC password, SSH tunnel.
**Not run** on Safari 16 hardware; the catalogue entry stays unready until a person completes the validation in
[SAFARI-WORKER.md](SAFARI-WORKER.md).

## 6. Reaching localhost / VPN targets

`host.docker.internal` works from browser containers on Docker Desktop; BrowserLab also sets
`host.docker.internal:host-gateway` on the Grid and (via `ExtraHosts`) on every browser container, verified by the
contract test, so Linux Engine works the same way. Verified here: a host-run app at `http://host.docker.internal:3000`
was reachable from the browser. URLs are never rewritten. See [LOCALHOST-AND-STAGING.md](LOCALHOST-AND-STAGING.md).

## 7. Redistribution

BrowserLab publishes only its own app and grid-wrapper images. Browser images are pulled from SeleniumHQ by digest by
each installation; the Firefox ESR image is built locally from Mozilla's archive and not published. See
[NOTICE.md](../NOTICE.md).

## Other choices

- **npm workspaces** (npm ships with Node; no extra tool). **Node 24 LTS** with native TypeScript type stripping: the API
  runs from source, no transpile step.
- **TypeScript 6.0**: typescript-eslint does not yet support TypeScript 7.
- **One app container** serving API, UI and fixture (same origin, no nginx) instead of separate api/web Dockerfiles.
- **JSON catalogue** instead of YAML (no YAML dependency; Zod-validated).
- **No React Router**, no Tailwind: a 15-line hash router and plain CSS suffice.
- **Downloads are unpacked in memory**: `selenium-webdriver`'s `downloadFile()` writes zip entry names to disk unchecked.
- **Policy rows keep the user's order**; "newest" in policies means newest **provisioned**, never the vendor's latest.
- **`compose.remote-workers.example.yaml`** replaces the spec's `compose.safari-worker.example.yaml`: the same SSH tunnel
  serves both amd64 and Mac workers.
- **Sessions start in `queued`**: URL/target validation is synchronous before the row exists, so `requested` and
  `validating` are never persisted.
- **Opt-in emulation on Apple Silicon** (`compose.apple-silicon-legacy.yaml`): the original plan ruled out emulation
  because QEMU is slow and unreliable. Docker Desktop's Rosetta ran Chrome 109, Edge 121 and Firefox 115 ESR through the
  full live smoke on Apple Silicon at native-like speed, so it is offered as an explicit opt-in. Emulated containers
  report `x86_64`, so emulation cannot be detected from inside; the workers are declared in
  `BROWSERLAB_EMULATED_WORKERS` and every session, report and UI view from them is labelled *Emulated*.
