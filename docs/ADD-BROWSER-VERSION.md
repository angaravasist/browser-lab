# Adding a browser version

Adding version **N** is a data change. No React or Node code changes are needed.

## 1. Find a trustworthy image and confirm what is inside

Prefer official SeleniumHQ images. They publish one tag per browser version, e.g.
`selenium/standalone-chrome:<N>.0-chromedriver-<N>.0-grid-4.51.0-20261010`. List them:

```bash
curl -s "https://hub.docker.com/v2/repositories/selenium/standalone-chrome/tags?page_size=100&name=grid-4.51.0-20261010" | grep -o '"name":"[^"]*"'
```

Keep the Grid release the same as `gridRelease` in `browser-images/catalog.json` unless you upgrade everything.

Check architectures and get the immutable digest:

```bash
docker buildx imagetools inspect selenium/standalone-chrome:<tag>          # platforms listed?
docker buildx imagetools inspect selenium/standalone-chrome:<tag> --format '{{json .Manifest.Digest}}'
```

Check the real executable, not the tag name:

```bash
docker run --rm --entrypoint sh selenium/standalone-chrome:<tag> -c 'google-chrome --version; chromedriver --version; dpkg -l | grep -i chrome'
# Edge: microsoft-edge --version; msedgedriver --version
# Firefox: firefox --version; grep channel "$(dirname "$(readlink -f "$(which firefox)")")/defaults/pref/channel-prefs.js"
```

Rules: Chromium is not Chrome; Firefox `release` is not ESR; a user-agent string proves nothing. If no official image
exists, write a reproducible recipe under `browser-images/custom/<name>/` that downloads the vendor's own signed
binary and asserts version and channel during the build (see `custom/firefox-115esr`). Do not publish
proprietary browser images.

## 2. Add a catalogue entry

Copy a similar entry in `browser-images/catalog.json` and set: `id` (unique), `family`, `brand`, `channel`,
`requestedVersion` (major), `versionMatch` (regex for the **exact** full version you verified), `executableProduct`,
`updateChannel` (Firefox), `architectures`, `image`, `imageDigest` (or `buildRecipe` for local builds),
`driverVersion`, `sourceUrl`, `gridProfile` (`default` or `legacy`) and `maxConcurrentSessions`.

## 3. Regenerate the Grid configuration and test

```bash
npm run catalog:toml          # writes browser-images/grid-*.toml
npm test                      # includes the TOML drift and safety tests
docker compose up -d --build grid      # or with -f compose.legacy-amd64.yaml for legacy entries
CATALOG_ID=<id> BROWSER_NAME=<chrome|firefox|MicrosoftEdge> npm run test:grid
node tests/integration/live-smoke.mjs --catalog <id>
```

Grid reads its catalogue at start, so a restart of the `grid` service is required; there is no hot-add. The entry
becomes **ready** only when the Grid advertises it and the first launch passes identity verification.

## 4. Record provenance

Update [BROWSER-SUPPORT.md](BROWSER-SUPPORT.md) with the build, digest/recipe, date, host and what you ran.

## Static-mode workers

With `compose.static.yaml`, add another service based on the pinned image with
`SE_NODE_STEREOTYPE_EXTRA='{"browserlab:catalogId": "<id>"}'`, `SE_NODE_MAX_SESSIONS=1`,
`SE_NODE_ENABLE_MANAGED_DOWNLOADS=true`, `SE_VNC_NO_PASSWORD=true`, and add it to `BROWSERLAB_GRID_URLS`
(e.g. `local=http://grid:4444,chrome=http://grid-chrome:4444`).
