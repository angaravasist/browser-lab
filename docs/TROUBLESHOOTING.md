# Troubleshooting

Start with `npm run doctor` (needs Node.js 24) or **Settings & help** in the UI. Error codes shown by the API/UI:

| Code | Meaning | What to do |
|---|---|---|
| `DOCKER_NOT_RUNNING` | Docker is not reachable | Start Docker Desktop / the Docker service. |
| `GRID_UNAVAILABLE` | The browser grid does not answer | `docker compose ps`; `docker compose logs grid`. The first start pulls 1–4 GB of images; wait until healthy. A grid that exits immediately prints a `BrowserLab:` line explaining why (missing local image, digest pull failure, socket unreachable). |
| `WORKER_OFFLINE` | A configured worker (amd64, mac) is unreachable | Check the SSH tunnel container logs and the worker. |
| `UNSUPPORTED_ARCH` | The build exists only for another CPU (e.g. amd64 Chrome on Apple Silicon) | Use a dedicated amd64 worker ([INSTALLATION.md](INSTALLATION.md#remote-amd64-worker)). BrowserLab does not emulate. |
| `BROWSER_NOT_PROVISIONED` / `VERSION_UNAVAILABLE` | Not in the active Grid profile or catalogue | Legacy builds: `-f compose.legacy-amd64.yaml`. New versions: [ADD-BROWSER-VERSION.md](ADD-BROWSER-VERSION.md). |
| `BROWSER_VERSION_MISMATCH` | The started browser is not exactly the catalogue build | The session was stopped and nothing was marked passed. Check the image digest and catalogue entry; then **Re-probe workers** to retry. |
| `NO_SESSION_CAPACITY` | All session slots are in use | End a session or raise `BROWSERLAB_MAX_CONCURRENT_SESSIONS` if the machine has the memory. |
| `SESSION_START_TIMEOUT` | The browser did not start in time | Usually a slow first image pull or low memory; retry. |
| `VIEWER_UNAVAILABLE` / `VNC_FAILED` | Live desktop cannot connect | Use **Reconnect** (tokens are single-use, 60 s). Another tab may have taken over the desktop. Behind a reverse proxy, list its origin in `BROWSERLAB_PUBLIC_ORIGINS`. |
| `HOST_URL_NOT_REACHABLE` | Your app is not reachable from the browser network | [LOCALHOST-AND-STAGING.md](LOCALHOST-AND-STAGING.md); `npm run doctor -- --check-url <url>`. |
| `NAVIGATION_FAILED` (shown as a note) | The browser runs but the URL failed to load | Not a compatibility result. Fix the URL/network and use the remote address bar. |
| `SESSION_INTERRUPTED` | The browser, worker or BrowserLab stopped during the session | Saved results and evidence are kept; nothing is marked passed. |

## Other symptoms

- **Keyboard goes to the wrong place.** Click inside the desktop to give it the keyboard; click outside to release it.
  Browser shortcuts your own OS intercepts (e.g. Cmd-Tab) cannot be forwarded.
- **Viewport is not what I asked.** The window is sized so the page area matches; the viewer can be resized freely
  without changing it. The maximum is 1920×1080.
- **Uploading a file.** Stage it in the session panel, then in the remote file dialog press Ctrl+L and paste the path.
- **Stray browser containers** after a crash: `npm run doctor -- --fix`.
- **Grid keeps restarting after changing the catalogue:** run `npm run catalog:toml` and `docker compose up -d --build grid`.
- **Port 3000 in use:** set `BROWSERLAB_PORT` in `.env`.
- **Windows:** use Docker Desktop with the WSL2 backend and Linux containers; run commands from PowerShell or WSL.
