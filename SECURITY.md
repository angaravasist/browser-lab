# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository's
Security tab (private vulnerability reporting). Do not open a public issue for security problems. Include the
version or commit, your host OS/architecture, and steps to reproduce. We aim to acknowledge reports within 7 days.

## What BrowserLab is (and is not)

BrowserLab is a **single-user, trusted-local developer tool**. It deliberately runs **old, unpatched browsers**
(for example Chrome 109, Edge 121, Firefox 115 ESR) that have known, public vulnerabilities.

- Only browse sites you trust, with test accounts and synthetic data.
- Do not run BrowserLab on a Docker host that also runs production workloads or holds production secrets.
- The default Dynamic Grid mounts the Docker socket into the upstream Selenium container. That is equivalent to
  root on the Docker host. BrowserLab's own API never receives it. Use `compose.static.yaml` where socket mounts
  are not acceptable.
- By default only `127.0.0.1:3000` is published. Selenium Grid (4444), VNC (5900/7900) and the Docker socket are
  never published. Exposing BrowserLab to a network without authentication and TLS is not supported.

See [docs/SECURITY-AND-PRIVACY.md](docs/SECURITY-AND-PRIVACY.md) for the full threat model.

## Supported versions

Security fixes are made on the latest release only.
