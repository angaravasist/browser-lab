# Browser support truth table

Status words, strictly:

- **configured** – in the catalogue with a pinned image; BrowserLab will try it on a compatible worker.
- **image-verified** – the pinned image's real executable was inspected (`--version`, package name, channel file).
- **tested** – a real interactive session ran through BrowserLab (live smoke and/or UI E2E) on the stated host.
- **unsupported** – cannot run on that architecture/host; BrowserLab says so instead of launching.
- **not run** – no compatible host was available. Never treated as passing.

"Emulated diagnostic" means an amd64 image was started under Docker Desktop's emulation on Apple Silicon only to read
real values for the parsers; such runs are **not** test evidence and BrowserLab itself never launches emulated builds.

Last updated: 2026-10-22. Selenium Grid 4.51.0 (`20261010` images).

| Catalogue id | Browser (actual build) | OS / CPU | Provenance | Status | How verified |
|---|---|---|---|---|---|
| `firefox-149-linux` | Mozilla Firefox 149.0.2, release channel, geckodriver 0.37.1 | Linux arm64 | `selenium/standalone-firefox@sha256:755de91a…` | **tested** (2026-10-22, macOS 27 / Apple Silicon, Docker Desktop 28.4) | Grid contract suite; live smoke 28/28 incl. restart; UI E2E; static no-socket mode smoke 24/24 |
| `firefox-149-linux` | same | Linux amd64 | same multi-arch digest | configured; CI `live-default` | — |
| `chrome-149-linux-amd64` | Google Chrome 149.0.7827.200, ChromeDriver 149.0.7827.155 | Linux amd64 | `selenium/standalone-chrome@sha256:a8a74fee…` | image-verified; CI `live-default` | `google-chrome --version` in the pinned image |
| `edge-149-linux-amd64` | Microsoft Edge 149.0.4022.98 | Linux amd64 | `selenium/standalone-edge@sha256:8b3af731…` | image-verified; CI `live-default` | `microsoft-edge --version` |
| `chrome-109-linux-amd64` | **Google Chrome 109.0.5414.119** (`google-chrome-stable` deb), ChromeDriver 109.0.5414.74 | Linux amd64 | `selenium/standalone-chrome@sha256:eba35b7b…` | image-verified; live **not run** here (no amd64 host); CI `live-legacy` | `--version`, `dpkg -l`; `chrome://version` read in an emulated diagnostic ("Google Chrome … (Official Build)") |
| `edge-121-linux-amd64` | **Microsoft Edge 121.0.2277.128** (`microsoft-edge-stable`), msedgedriver 121.0.2277.128 | Linux amd64 | `selenium/standalone-edge@sha256:f81b8609…` | image-verified; live **not run** here; CI `live-legacy` | `--version`, `dpkg -l`; `edge://version` emulated diagnostic |
| `firefox-115esr-linux-amd64` | **Mozilla Firefox 115.43.1esr**, `esr` channel, geckodriver 0.37.1 | Linux amd64 | Built locally: Mozilla `firefox-115.43.1esr.tar.bz2`, SHA256SUMS signed by key `14F26682…D98F0353` | image-verified (build asserts version + `esr` channel); live **not run** here; CI `live-legacy` | Build log; emulated diagnostic: WebDriver `115.43.1`, about:support `115.43.1esr` / `esr` |
| `firefox-115-release-linux-amd64` | Mozilla Firefox 115.0.3, **release** channel (control: not ESR) | Linux amd64 | `selenium/standalone-firefox@sha256:cac2a022…` | image-verified; CI `live-legacy` | `--version`, `channel-prefs.js` = release |
| any `*-amd64` | — | Linux arm64 | — | **unsupported** (reported as `unsupported-architecture`) | API + UI + CI `live-arm64` |
| `safari-16-mac` | Apple Safari 16.x | macOS 12/13 (real Mac) | Operator-installed Safari + `safaridriver` | **not run — compatible macOS host unavailable** | The development Mac has Safari 27 only. See [SAFARI-WORKER.md](SAFARI-WORKER.md). |

## Platforms (BrowserLab app itself)

| Host | Status |
|---|---|
| macOS 27, Apple Silicon, Docker Desktop 28.4 | **tested** (all suites above) |
| Linux amd64 (GitHub `ubuntu-latest`) | configured in CI (`live-default`, `live-legacy`); results appear once the repository runs CI |
| Linux arm64 (GitHub `ubuntu-24.04-arm`) | configured in CI (`live-arm64`) |
| Windows 11 + Docker Desktop (WSL2) | **not run** (no hardware). Expected to work: Linux containers only, Compose-native install, no shell scripts required. |
| macOS Intel | **not run** (no hardware). |

## Known restrictions

- Viewport presets resize a desktop browser window; "mobile-sized" is not phone or touch emulation.
- The live desktop is 1920×1080; viewports are limited to that size.
- Uploads: stage the file in the session panel, then choose it in the remote browser's own file dialog.
- Downloads: listed and retrievable for Chrome/Edge/Firefox via Grid managed downloads. **Safari: unsupported.**
- Clipboard: local → remote paste via the viewer's Clipboard box (X11 clipboard); remote → local text is shown when
  the remote clipboard changes. Images/files on the clipboard are unsupported.
- Safari: manual control requires breaking Safari's WebDriver "glass pane" (handover); after that, screenshots come
  from the desktop capture and file staging is no longer possible.
- "Newest provisioned" means the newest build installed and ready in this BrowserLab. BrowserLab never claims a build
  is the vendor's latest release; compare with the vendors' release pages.
- Testing a minimum version does not prove intermediate versions; add them to the policy explicitly.
