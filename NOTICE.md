# NOTICE

BrowserLab
Licensed under the Apache License, Version 2.0 (see [LICENSE](LICENSE)).

BrowserLab's source code does not contain or redistribute any web browser binaries.

## Third-party software used by BrowserLab

| Component | Use | Licence |
|---|---|---|
| [Selenium](https://github.com/SeleniumHQ/selenium) and `selenium-webdriver` | WebDriver client and Grid | Apache-2.0 |
| [docker-selenium](https://github.com/SeleniumHQ/docker-selenium) images | Grid, browser nodes, VNC/noVNC inside workers | Apache-2.0 (images contain third-party software under their own licences) |
| [noVNC](https://github.com/novnc/noVNC) (`@novnc/novnc`) | VNC viewer, bundled into the web UI build | MPL-2.0 (source available from the noVNC project) |
| React, React DOM | Web UI | MIT |
| Fastify, `@fastify/websocket`, `@fastify/static` | API server | MIT |
| `better-sqlite3` / SQLite | Database | MIT / public domain |
| `ws` | WebSocket client/server | MIT |
| Zod | Schema validation | MIT |
| JSZip, pako | Grid file transfer archives | MIT (JSZip dual MIT/GPLv3, used under MIT); MIT AND Zlib |
| Node.js base image | Runtime | MIT and others (see the image) |
| Alpine Linux, OpenSSH (tunnel image) | Optional remote-worker tunnels | Various open-source licences |

A full list of production npm dependencies and their licences is checked in CI by `scripts/check-licenses.mjs`.

## Browsers

Browsers are pulled by each installation directly from their publishers' channels, by pinned digest:

- **Google Chrome** and **Microsoft Edge** images are published by the SeleniumHQ docker-selenium project and
  contain the vendors' Linux packages, which are proprietary software under the Google Chrome Terms of Service and
  the Microsoft Edge licence terms respectively.
- **Mozilla Firefox** is distributed under the MPL-2.0; "Firefox" is a trademark of the Mozilla Foundation. The
  Firefox 115 ESR image is **built locally** from Mozilla's signed release archive by
  `browser-images/custom/firefox-115esr/Dockerfile` and is not published by this project.
- **Apple Safari** runs only on Apple hardware owned by the operator and is never packaged.

Browser names are trademarks of their respective owners and are used only to identify the browsers. BrowserLab is not
affiliated with or endorsed by Google, Microsoft, Mozilla or Apple.

## Docker Desktop

BrowserLab is free software. Docker Desktop, which many Windows and macOS users run it on, has its own subscription
terms for some commercial organisations. Docker Engine on Linux has no such terms.
