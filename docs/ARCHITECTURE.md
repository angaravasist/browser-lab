# Architecture

```text
Your browser ──http://127.0.0.1:3000──► app container (Node 24, Fastify)
                                          ├─ /api/*            REST, Zod-validated, same-origin only
                                          ├─ /api/sessions/:id/live   WebSocket relay (token + Origin)
                                          ├─ web UI (React + noVNC), /fixture/ demo site
                                          └─ /data: SQLite (WAL) + evidence files
                                                │ WebDriver (W3C) + Grid /status, private network only
                                                ▼
                                  grid container: Selenium Dynamic Grid 4.51.0  ── docker.sock (only here)
                                                │ starts one disposable container per session
                                                ▼
                           browser container (pinned image digest): Xvfb + browser + driver + x11vnc
   optional: other workers (dedicated amd64 Grid, Safari Mac) reached through SSH tunnel containers
```

## Components and why

| Piece | Choice | Reason |
|---|---|---|
| Browser execution | Upstream `selenium/standalone-docker` (Dynamic Grid) | Disposable per-session containers from a controlled image list; no custom orchestration. |
| Catalogue | `browser-images/catalog.json` → generated per-arch Grid TOML | One human-editable source; Grid pulls each image for its own platform, so amd64-only images must never be in an arm64 TOML. |
| Exact image | Stereotype capability `browserlab:catalogId` | Grid routes a request to exactly one image or rejects it (`reject-unsupported-caps`); never substitutes. |
| Image pinning | `# pin <tag> <digest>` lines enforced by `docker/grid-entrypoint.sh` | Grid 4.51 needs tagged images; the entrypoint re-points each tag at its pinned digest before Grid starts, failing closed. |
| Live desktop | Grid's `/session/{id}/se/vnc` WebSocket + noVNC client | Upstream route, verified bidirectional; BrowserLab only relays bytes for one stored session. |
| API | Fastify + `selenium-webdriver` + better-sqlite3, run with Node 24 type stripping | No build step for the API; small dependency set. |
| State | SQLite + in-process timers | Single-user tool; no Redis/queues. REST polling for status. |

## Session lifecycle

`queued → provisioning → starting → verifying → running → closing → completed`, with `failed-to-start`,
`expired`, `interrupted` and `closed-with-error` for abnormal ends. Every transition is a guarded SQL update
(`UPDATE … WHERE state IN (allowed predecessors)`). Capacity is checked and reserved in one SQLite transaction.

1. URL policy (http/https only, no credentials/control characters, private targets only in trusted mode).
2. Target resolved from the catalogue (`catalogId`, project minimum, or newest **provisioned** build).
3. Availability must be `ready` (derived from live Grid `/status`; never declared).
4. W3C new session with allowlisted capabilities only.
5. Identity verification (below); mismatch ⇒ quit + `verification-failed`.
6. Window sized so the page viewport equals the request; then the URL loads. Navigation failure is reported as
   such and the browser stays usable for troubleshooting.
7. Keepalive every 60 s (Grid reaps sessions after 300 s of WebDriver silence, which also cleans up after an API crash);
   sweeper enforces idle and maximum lifetime.
8. On API start, sessions left active are released on the Grid and marked `interrupted`.

## Identity verification (per launch)

1. Provenance: catalogue image + digest (enforced at Grid start) and the `browserlab:catalogId` the Grid echoes.
2. WebDriver capabilities: browserName, full browserVersion, platformName, driver version, Grid node CPU architecture.
3. The browser's own version page, read in a throwaway tab: `chrome://version` / `edge://version` (product,
   "Official build", executable path) or Firefox `about:support` (version, **update channel**, binary path).
4. User-agent data is stored as supplementary only; it is not used for decisions (Firefox reports `x86_64` on arm64
   and Chrome freezes UA minor versions).

Safari: level is "capabilities" only (no version page access through safaridriver); shown as such.

## Live viewer relay

`POST /api/sessions/:id/view-token` → 60 s single-use token. The WebSocket upgrade burns the token first, then
requires an Origin equal to the page's own host (or `BROWSERLAB_PUBLIC_ORIGINS`) and a running session. Upstream is
looked up from the stored session, never from the request. A new viewer replaces the previous one (one controller per
desktop). For the Safari Mac, the relay terminates VNC password auth server-side so the password never reaches a
browser.

## Files and transfers

Uploads are staged into the session's node with Grid's `se/file` endpoint; the user picks the file in the browser's
own file chooser. Downloads are listed and fetched with Grid managed downloads (`se/files`), unpacked in memory with a
size check before inflating. Nothing is kept unless saved as evidence.
