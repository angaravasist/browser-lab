# Installation

## Requirements

- Docker with Compose v2.24 or newer (Docker Desktop on Windows with the WSL2/Linux-container backend, Docker Desktop
  on macOS Intel or Apple Silicon, or Docker Engine on Linux). No browser needs to be installed on your computer.
- About 4 GB RAM free per concurrent browser session; 3–6 GB disk for images (more with the legacy overlay).

## Quick start

```bash
git clone <your fork or this repository> browserlab
cd browserlab
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
docker compose up -d --build
docker compose ps           # wait until app and grid are "healthy" (first start pulls browser images)
# open http://localhost:3000
```

Stop without deleting results: `docker compose down`. Rebuild/restart: `docker compose up -d --build`.
Delete everything including results and screenshots: `docker compose down -v`.

Check the install at any time: `npm run doctor` (needs Node.js 24) or open **Settings & help** in the UI.

## What you get on each platform

| Host | Ready by default | Notes |
|---|---|---|
| Linux / Windows (WSL2) / Intel Mac, amd64 | Firefox 149, Chrome 149, Edge 149 | Add the legacy overlay for Chrome 109, Edge 121, Firefox 115 ESR. |
| Apple Silicon Mac / Linux arm64 | Firefox 149 | Chrome and Edge builds are amd64-only and show **unsupported architecture**. On Apple Silicon Macs, an opt-in emulated mode runs Chrome 109, Edge 121 and Firefox 115 ESR through Rosetta, labelled *Emulated* in every result: [APPLE-SILICON.md](APPLE-SILICON.md). Otherwise use a dedicated amd64 worker. |
| Any | Safari | Never in Docker. Needs a real Mac running the Safari version: [SAFARI-WORKER.md](SAFARI-WORKER.md). |

See [BROWSER-SUPPORT.md](BROWSER-SUPPORT.md) for what has actually been tested where.

## Historical browsers (amd64 hosts)

```bash
docker compose -f compose.yaml -f compose.legacy-amd64.yaml up -d --build
```

This builds the Firefox 115 ESR image from Mozilla's signed archive and pulls the pinned Chrome 109 / Edge 121 images
(~4 GB). Keep using both `-f` options for later `up`/`down` commands.

## Remote amd64 worker

On an Apple Silicon laptop you can keep BrowserLab local and run historical browsers on a Linux amd64 machine:

1. On the amd64 machine: clone the repository and run `docker compose -f compose.worker-amd64.yaml up -d --build`.
   Its Grid listens on that machine's `127.0.0.1:4444` only.
2. On the BrowserLab machine: create `secrets/ssh/id_ed25519` (a dedicated key authorised on the worker) and
   `secrets/ssh/known_hosts` (verify the fingerprint), copy `compose.remote-workers.example.yaml` to
   `compose.remote-workers.yaml`, set the worker host, and add to `.env`:
   `BROWSERLAB_GRID_URLS=local=http://grid:4444,amd64=http://amd64-tunnel:4444`.
3. `docker compose -f compose.yaml -f compose.remote-workers.yaml up -d --build`.

Builds advertised by any configured worker become ready; BrowserLab records which worker and CPU served each session.

## No Docker socket (static mode)

If your environment forbids mounting the Docker socket (for example Docker Desktop Enhanced Container Isolation):

```bash
docker compose -f compose.yaml -f compose.static.yaml up -d
```

One long-lived Firefox container serves one session at a time. See the trade-offs in `compose.static.yaml`.

## Backups

All state lives in the `browserlab_browserlab-data` volume (`/data`: `browserlab.db` plus `evidence/`).

```bash
docker compose stop app
docker run --rm -v browserlab_browserlab-data:/data -v "$PWD":/backup alpine tar czf /backup/browserlab-backup.tgz -C /data .
docker compose start app
```

Restore by extracting into an empty volume the same way.

## Uninstall

`docker compose down -v` removes containers and data. Remove pulled images with `docker image rm` (see
`docker image ls selenium/*` and `browserlab/*`).
