# Changelog

## 0.1.0 (unreleased)

First complete version.

- Manual browser compatibility testing on real, pinned browser images through Selenium Dynamic Grid 4.51.0.
- Live, interactive desktop (mouse, keyboard, clipboard paste) in the web UI via noVNC, relayed same-origin with
  single-use tokens; one controlling viewer per desktop.
- Layered browser identity verification on every launch: catalogue provenance (image digest), WebDriver capabilities
  and driver version, and the browser's own version page (product, official build, update channel).
- Catalogue: Firefox 149, Chrome 149, Edge 149; legacy overlay with Google Chrome 109, Microsoft Edge 121,
  Firefox 115 ESR (built locally from Mozilla's signed archive) and Firefox 115 release; Safari 16 Mac adapter.
- Screenshots, whole-desktop captures, results, notes, checklists; file staging for uploads and retrieval of
  browser downloads; JSON/CSV/self-contained HTML reports.
- Projects with environments, support policies and a compatibility matrix; JSON import/export.
- Static no-Docker-socket mode, dedicated amd64 worker and SSH-tunnelled remote workers.
- `npm run doctor` diagnostics.
