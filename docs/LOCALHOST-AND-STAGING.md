# Testing localhost apps, staging and private networks

The remote browser runs inside a container (or on another machine), so addresses mean what they mean **there**.

| You type | Inside the browser container it means | Use instead |
|---|---|---|
| `http://localhost:5173` | the browser container itself (nothing listens there) | `http://host.docker.internal:5173` |
| `http://127.0.0.1:8080` | the browser container itself | `http://host.docker.internal:8080` |
| `http://host.docker.internal:PORT` | your computer (the Docker host) | – |
| `https://staging.example.com` | resolved by Docker's DNS from the host's network | – |

BrowserLab warns when you enter `localhost`/`127.x` but **never rewrites URLs**, because that would change what is
being tested (cookies, CORS, OAuth redirect URIs and HTTPS certificates are tied to the hostname).

## Making your local app reachable

1. Start the app listening on all interfaces, not only loopback (e.g. `vite --host 0.0.0.0`, `next dev -H 0.0.0.0`,
   `rails s -b 0.0.0.0`). On Docker Desktop, apps bound to 127.0.0.1 are often still reachable via
   `host.docker.internal`; on Linux they are not.
2. Use `http://host.docker.internal:PORT`. Docker Desktop (Windows/macOS) provides this name; on Linux, BrowserLab adds
   `host.docker.internal:host-gateway` to the Grid and every browser container it starts.
3. Check from the browser network: `npm run doctor -- --check-url http://host.docker.internal:PORT`.
4. Your app may need to allow the `host.docker.internal` host name (dev-server host checks, CORS, OAuth redirect URIs).

## Remote workers

A browser on a dedicated amd64 worker or a Safari Mac resolves names from **that** machine's network.
`host.docker.internal` then means the worker, not your computer. Use a hostname or IP of your dev machine that the worker
can reach, or a shared staging URL.

## Staging behind VPN, proxies and private CAs

- **VPN:** Docker Desktop containers usually use the host's VPN routes; Docker Engine on Linux does too unless the VPN
  restricts forwarding. Test with `npm run doctor -- --check-url <url>`.
- **Corporate HTTP proxy:** browsers in the containers do not inherit your desktop proxy settings. Set the proxy in the
  remote browser's own settings during the session, or provide a custom image with proxy configuration.
- **Private certificate authorities:** BrowserLab never disables certificate validation. A browser will show its
  normal certificate error page, which is a genuine result. To trust an internal CA, build a derived image that
  imports the CA (docker-selenium documents `add-cert-helper.sh`) and register it as a new catalogue entry.

## Private-network policy

`BROWSERLAB_TRUSTED_PRIVATE_URLS=true` (default) allows localhost and private-range targets, which local testing needs.
Anyone who can use BrowserLab can therefore make a browser reach your internal network. Keep BrowserLab on loopback, or
set it to `false` if untrusted people can reach it.
