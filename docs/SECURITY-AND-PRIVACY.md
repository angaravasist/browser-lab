# Security and privacy

BrowserLab is a single-user tool for a trusted machine. It has privileged access to browsers and to the Docker runtime.

## Old browsers are dangerous

Historical builds (Chrome 109, Edge 121, Firefox 115 ESR and older) contain publicly known, unpatched vulnerabilities.
A malicious page can compromise the browser container and anything it can reach.

- Only open sites you trust, with **test accounts and synthetic data**. Never use real patient, customer or production data.
- Do not use a Docker host that also runs production services or stores production credentials.
- Browser containers share the host kernel; containers are not virtual machines.

## Docker socket

In the default Dynamic Grid mode the upstream `selenium/standalone-docker` container mounts `/var/run/docker.sock` so it
can start one disposable browser container per session. **Access to the Docker socket is equivalent to root on the
Docker host.** Boundaries BrowserLab enforces and tests (`npm run test:grid`):

- Only the `grid` service mounts the socket. The BrowserLab API/app never does.
- The socket is reachable inside the grid container only via a socat bridge bound to that container's 127.0.0.1.
- Grid's config passes only `Dns*` and `ExtraHosts` host settings to browser containers – never `Binds`, devices or
  privileges. Spawned containers are checked: not privileged, no binds, no mounts, no published ports, no socket,
  only the private network.
- The Grid only starts images listed in BrowserLab's catalogue and only if their tag resolves to the pinned digest.
- BrowserLab builds every WebDriver capability itself from the catalogue; clients cannot pass capabilities, image
  names, video/recording options or volumes.

Where this is not acceptable, use `compose.static.yaml`: no socket is mounted anywhere.

## Rate limiting

Every route is guarded by a Fastify global rate limiter (600 requests per
minute per peer by default, with HTTP 429 and Retry-After over quota).
`BROWSERLAB_RATE_LIMIT_MAX` and `BROWSERLAB_RATE_LIMIT_WINDOW_MS`
adjust the limits. Fastify does not trust client-supplied forwarded IP headers
by default. The plugin is 11.2.0 or a newer 11.x release, which normalizes
IPv6 prefixes. Rate limiting is in-memory per process: keep BrowserLab local
and do not mistake these limits for authentication or a distributed defense.

## Network exposure

Published by default: `127.0.0.1:3000` only. Never published: Selenium Grid/WebDriver (4444), VNC (5900/7900), the Docker
socket or socat (2375). There is no login in the local edition. Binding to `0.0.0.0` or putting BrowserLab on a network
without an authenticating, TLS-terminating reverse proxy is **not supported**: anyone who can reach it can drive browsers
into your network and see their screens. If you put a proxy in front, list its origin in `BROWSERLAB_PUBLIC_ORIGINS`.

Same-origin protection: state-changing API calls with a foreign `Origin` are rejected; the live-viewer WebSocket needs
the page's own Origin plus a single-use, 60-second token bound to one session; a new viewer replaces the old one.

## Data BrowserLab stores

- SQLite: projects, environment URLs, policies, sessions (URLs, versions, timings), results and notes.
- Evidence files: screenshots, desktop captures and downloads you chose to keep. **Screenshots can contain sensitive
  data.** They stay on this machine; nothing is uploaded. Default retention deletes evidence 30 days after a session ends
  (`BROWSERLAB_RETENTION_DAYS`; 0 keeps it).
- Not stored: passwords, cookies, browser profiles, VNC passwords, viewer tokens. Each session uses a fresh browser profile
  in a container that is deleted afterwards (static mode reuses the container but not the profile). Credentials in URLs
  are rejected. Logs redact query-string values and never include viewer tokens or the Mac VNC password.
- No analytics, telemetry or external calls other than pulling the pinned images you configured.

## Remote workers

Workers are reached through SSH tunnels with keys and verified host keys you provide. WebDriver and VNC ports stay on each
worker's loopback. Legacy VNC passwords (macOS Screen Sharing) are weak; treat the SSH tunnel as the security boundary.

## Reporting

See [SECURITY.md](../SECURITY.md).
