# Safari worker (real Mac)

Safari cannot run in Docker or on Linux, and WebKit builds (for example Playwright's) are not Safari. Testing Safari 16
needs a Mac that actually runs Safari 16. BrowserLab treats such a Mac as a remote worker: Selenium drives Safari through
Apple's `safaridriver`, and you control the Mac's real desktop through macOS Screen Sharing (VNC), both reached over SSH.

**Status:** the adapter is implemented and unit-tested, but has **not been run against a real Safari 16 Mac** (the
development Mac has Safari 27). The catalogue entry `safari-16-mac` therefore stays *not provisioned* until you complete
the validation in step 9 on your hardware.

## How a Safari session works (and why it differs)

Apple isolates WebDriver sessions in special windows (orange address field) covered by a transparent **glass pane**
that blocks mouse and keyboard input. If a person interacts, Safari offers to stop the automation session; stopping it
**permanently disconnects WebDriver**, and the window stays open for manual use. BrowserLab therefore runs Safari in two
phases:

1. **Automated phase** – WebDriver starts Safari, BrowserLab verifies the Safari version from WebDriver capabilities,
   sizes the window, opens your URL and can take WebDriver screenshots.
2. **Manual phase (handover)** – in the live desktop you click into the Safari window and confirm *Stop Session*.
   BrowserLab notices the detached driver (badge "Manual control") and keeps the session open. From now on screenshots
   are **desktop captures** of the whole Mac screen, labelled `vnc-desktop` in evidence and reports.

Not available for Safari: file staging after handover, download retrieval, executable-level version verification
(identity is capability-level and labelled as such).

## 1. Hardware and OS

- A Mac that can run **macOS 12 Monterey or macOS 13 Ventura**; Safari 16.0–16.6 shipped for both. Apple silicon or Intel.
- Turn off automatic macOS/Safari updates and Rapid Security Responses on this Mac, or Safari will move past 16.
  BrowserLab re-checks the version on every launch and refuses a mismatch.
- Use it only for BrowserLab. It shows its whole desktop to whoever uses BrowserLab.

## 2. Dedicated user and desktop

1. Create a standard (non-admin) user, e.g. `browserlab`, with no Apple ID, iCloud, Keychain passwords or personal data.
2. System Settings → Users & Groups → *Automatically log in as* `browserlab` (requires FileVault off on this Mac).
   Safari automation and the VNC view both need **this user's logged-in desktop**; a Mac at the login window cannot run
   Safari sessions.
3. Prevent locking: Lock Screen → *Start Screen Saver* never, *Turn display off* never, *Require password* never for this
   user; Energy → prevent automatic sleeping; or `sudo pmset -a sleep 0 displaysleep 0 disksleep 0`.
   If the screen locks, the viewer shows the lock screen and launches fail with a start error.
4. Focus / Do Not Disturb permanently on, so notifications do not cover pages or leak into captures.
5. Use a single display at a normal resolution (e.g. 1920×1080).

## 3. Enable Safari automation

```bash
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' /Applications/Safari.app/Contents/Info.plist   # must print 16.x
safaridriver --version
sudo safaridriver --enable          # admin password, once
```

Also in Safari (as `browserlab`): Settings → Advanced → *Show Develop menu*, then Develop → *Allow Remote Automation*.

## 4. Selenium server as a LaunchAgent (in the logged-in session)

Install Java 21 and download `selenium-server-4.51.0.jar` from the SeleniumHQ GitHub releases (check its published
checksum). Create `~/browserlab/safari.toml`:

```toml
[server]
host = "127.0.0.1"
port = 4444

[node]
detect-drivers = false
max-sessions = 1
session-timeout = 300

[[node.driver-configuration]]
display-name = "Safari 16"
webdriver-executable = "/usr/bin/safaridriver"
max-sessions = 1
stereotype = '{"browserName": "safari", "platformName": "mac", "browserlab:catalogId": "safari-16-mac"}'
```

Create `~/Library/LaunchAgents/org.browserlab.safari-grid.plist` (a **LaunchAgent**, not a LaunchDaemon and not an SSH
session, so Safari opens on the logged-in desktop):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.browserlab.safari-grid</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/java</string><string>-jar</string><string>/Users/browserlab/browserlab/selenium-server-4.51.0.jar</string>
    <string>standalone</string><string>--config</string><string>/Users/browserlab/browserlab/safari.toml</string>
  </array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/browserlab/browserlab/grid.log</string>
  <key>StandardErrorPath</key><string>/Users/browserlab/browserlab/grid.log</string>
</dict></plist>
```

`launchctl load ~/Library/LaunchAgents/org.browserlab.safari-grid.plist`, then `curl -s 127.0.0.1:4444/status` on the Mac.

## 5. Screen Sharing (VNC) – authentication and transport

1. System Settings → General → Sharing → **Screen Sharing** on; *Allow access for*: only `browserlab`.
2. In its (i) options enable *VNC viewers may control screen with password* and set a password. BrowserLab keeps it
   server-side (`BROWSERLAB_SAFARI_VNC_PASSWORD`) and authenticates for the viewer; it never reaches a browser.
3. Legacy VNC passwords are weak (8 characters, DES) and the protocol is unencrypted. **Never expose port 5900 or 4444
   to the network.** Reach them only through SSH (step 6) and block direct access, e.g. with a pf rule allowing 5900 only
   from 127.0.0.1, or by keeping the Mac on an isolated network. (Recommended, not verified by this project.)
4. Only one person can usefully control one desktop: BrowserLab allows one Safari session per Mac and one controlling
   viewer at a time. Do not use the Mac locally while it serves BrowserLab.

## 6. SSH access and BrowserLab configuration

On the Mac: System Settings → Sharing → **Remote Login** on, only for `browserlab`; key-based login only.

On the BrowserLab host, put a dedicated key and verified `known_hosts` in `./secrets/ssh/`, copy
`compose.remote-workers.example.yaml` to `compose.remote-workers.yaml` (set `browserlab@<mac-host>` in `mac-tunnel`), and
add to `.env`:

```dotenv
BROWSERLAB_GRID_URLS=local=http://grid:4444,mac=http://mac-tunnel:4444
BROWSERLAB_SAFARI_VNC=mac-tunnel:5900
BROWSERLAB_SAFARI_VNC_PASSWORD=<Screen Sharing VNC password>
BROWSERLAB_SAFARI_VALIDATION_MODE=true
```

`docker compose -f compose.yaml -f compose.remote-workers.yaml up -d --build`

## 7. Check the worker

`npm run doctor` should list `safari-16-mac` as `ready` with "VALIDATION MODE".

## 8. Automated part

```bash
node tests/integration/live-smoke.mjs --catalog safari-16-mac
```

Exit code 2 means the automated checks passed and the manual handover still needs a person. Anything else is a failure.

## 9. Manual validation (required before Safari is marked ready)

In the BrowserLab UI, launch Safari 16 on `http://app:3000/fixture/index.html?color=11c95d` and confirm each item:

1. The live desktop shows the **same** Safari window (green fixture page, orange address field) – not another user's
   session or the login window.
2. Click into the window, confirm *Stop Session*; the toolbar shows **Manual control**.
3. Type in the Name field, choose an option, tick the checkbox, submit; click links; scroll; open a new tab.
4. **Capture desktop** and check the evidence thumbnail.
5. Save a result, end the session, close the leftover Safari window with Cmd-W in the viewer, then launch a second
   session to make sure no stray window blocks it.

Only if every item worked: set `"interactiveVerifiedAt": "<ISO date>"` on `safari-16-mac` in
`browser-images/catalog.json`, record the Mac model, macOS, Safari and `safaridriver` versions in
[BROWSER-SUPPORT.md](BROWSER-SUPPORT.md), remove `BROWSERLAB_SAFARI_VALIDATION_MODE`, and rebuild:
`docker compose up -d --build`. If anything failed, leave it unverified and open an issue with what you saw.

## Known limitations

- Whole Mac desktop is visible in the viewer and in desktop captures.
- Screen locking, sleep, notifications or a logged-out user break sessions.
- After handover, BrowserLab cannot close the Safari window; close it in the viewer before the next session.
- A macOS or Safari update changes the version; launches then fail identity verification until you update the catalogue.
