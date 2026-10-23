# Testing older browsers on an Apple Silicon Mac

Google Chrome 109, Microsoft Edge 121 and Firefox 115 ESR only exist as Intel/AMD (amd64) Linux builds. On an Apple
Silicon Mac (M1–M5) BrowserLab can run them through Docker Desktop's Rosetta emulation. This is **opt-in**, and every
result from these browsers is labelled **Emulated** in the app, the session page, the results list and every report.

**What "emulated" means:** it is the genuine vendor browser (same build, same version check as on Intel/AMD), but the
Mac translates its processor instructions. Pages render and scripts run the same way; speed and timing can differ
from real Intel/AMD hardware. Treat results as good compatibility evidence, not as proof on Intel/AMD hardware.

## 1. Before you start

- macOS on an Apple Silicon Mac, and [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/).
- Docker Desktop → Settings → General: **"Use Rosetta for x86_64/amd64 emulation on Apple Silicon"** must be on.
  Without it Docker falls back to a much slower emulator.
- Docker Desktop → Settings → Resources: give Docker at least **8 GB of memory**.
- About **6 GB of free disk**. The first start downloads the browsers (about 4 GB).
- Apple has said it will reduce Rosetta in future macOS versions; if a macOS update removes it, this mode stops working.

## 2. Install and start

```bash
git clone https://github.com/angaravasist/browser-lab.git browserlab
cd browserlab
cp .env.example .env
docker compose -f compose.yaml -f compose.apple-silicon-legacy.yaml up -d --build
```

Wait until everything is healthy (the first start can take 10–20 minutes):

```bash
docker compose -f compose.yaml -f compose.apple-silicon-legacy.yaml ps
```

Open **http://localhost:3000** → **Browser environments**. Chrome 109, Edge 121 and Firefox 115 ESR should show
**Ready** with an **Emulated** badge. Chrome 149, Edge 149 and Firefox 115 release show "unsupported architecture";
that is expected in this mode.

Keep using both `-f` options for every later command, for example to stop:

```bash
docker compose -f compose.yaml -f compose.apple-silicon-legacy.yaml down
```

`down` keeps your results; `down -v` deletes them.

## 3. Test

1. **Quick test** → enter your site's URL → pick the browser and version → **Launch real browser**.
   A yellow "Emulated" note confirms the mode before you launch.
2. Use the live desktop with your mouse and keyboard. Click inside it to give it the keyboard; click outside to
   release it.
3. Take screenshots, record **Passed / Failed / Blocked** with notes, end the session, and export from **Results**.

Tips:

- One session per browser at a time. Each browser starts in a few seconds; actions feel a little slower than native.
- **Edge 121** shows a "Personalize your web experience" panel about 30 seconds after it starts. Close it (Escape or
  its close button) before using the keyboard on the page.
- **File uploads:** stage the file in the session's *Files* panel, open the page's file chooser, press **Ctrl+L**,
  type the shown path, wait a moment, then press **Enter** (or click **Open**). Dialogs open more slowly under
  emulation.
- **An app running on your own Mac:** use `http://host.docker.internal:PORT`, not `localhost`.
- **Firefox 115 ESR** turns the built-in demo address `http://app:3000/...` into HTTPS, so the demo page does not load
  there. Real sites with normal hostnames are unaffected.
- Old browsers have known security holes: test only sites you trust, with test accounts and no real personal data.

## 4. Safari 16

BrowserLab cannot provide Safari 16 on this Mac: Safari 16 runs only on macOS 12 or 13, and current Apple Silicon Macs
cannot install a macOS that old. The usual route is a **macOS 13 Ventura virtual machine** (for example in the free
UTM app; Apple's licence allows macOS virtual machines on Apple hardware), keeping Safari at 16.x by declining the
Safari 17 update, and testing directly in the virtual machine's window. This has **not** been verified by this
project. Otherwise use an older Mac on macOS 12/13. See [SAFARI-WORKER.md](SAFARI-WORKER.md) for connecting such a Mac to
BrowserLab.

## Troubleshooting

- A browser shows **Offline** or **Busy**: wait for `docker compose ... ps` to report it healthy; a previous session
  may still be closing.
- Everything is very slow: check the Rosetta setting in step 1.
- Anything else: [TROUBLESHOOTING.md](TROUBLESHOOTING.md), or run `npm run doctor` (needs Node.js 24).
