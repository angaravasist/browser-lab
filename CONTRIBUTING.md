# Contributing

Thanks for helping. BrowserLab stays small on purpose: it reuses Selenium Grid, noVNC and Docker instead of
re-implementing them, and every claim about a browser version must be backed by a real run.

## Development setup

Requirements: Docker with Compose v2.24+, Node.js 24 LTS (`.nvmrc`).

```bash
npm ci
docker compose up -d --build        # real Grid + app on http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
npm run test:grid                   # Grid contract tests against real browser containers
node tests/integration/live-smoke.mjs --catalog firefox-149-linux
npm run test:e2e                    # Playwright drives the BrowserLab UI (npx playwright install chromium once)
```

For API development outside Docker, run the Grid in Compose, open a loopback tunnel to it, and start the API with
`BROWSERLAB_GRID_URLS=local=http://127.0.0.1:<port> node apps/api/src/server.ts` (see docs/TESTING.md).

## Rules for changes

- Keep [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) and the other docs in sync with behaviour.
- Never mark a browser, version, architecture or host as tested or passing unless you ran it; say what you ran.
- Never substitute Chromium for Chrome, WebKit for Safari, or a user-agent string for a real browser version.
- Adding a browser version is a data change: follow [docs/ADD-BROWSER-VERSION.md](docs/ADD-BROWSER-VERSION.md).
- No company-specific data, credentials, proprietary assets or real personal data in the repository or tests.
- New dependencies need a reason a few lines of code would not do.

## Pull requests

Describe what changed, how you tested it (commands and results), and which platforms you could not test.
By contributing you agree that your contributions are licensed under the Apache License 2.0.
