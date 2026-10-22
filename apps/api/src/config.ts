import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const grids: Record<string, string> = {};
  for (const pair of (env.BROWSERLAB_GRID_URLS || 'local=http://localhost:4444').split(',')) {
    const [name, url] = pair.split('=').map((s) => s.trim());
    if (!name || !url || !/^https?:\/\//.test(url)) throw new Error(`Invalid BROWSERLAB_GRID_URLS entry: ${pair}`);
    grids[name] = url.replace(/\/$/, '');
  }
  const safariVnc = env.BROWSERLAB_SAFARI_VNC ? env.BROWSERLAB_SAFARI_VNC.split(':') : null;
  const cfg = {
    dataDir: path.resolve(env.BROWSERLAB_DATA_DIR || path.join(repoRoot, 'data')),
    port: num(env.BROWSERLAB_PORT, 3000),
    // Loopback unless told otherwise; the container image sets 0.0.0.0 and Compose publishes on 127.0.0.1 only.
    host: env.BROWSERLAB_LISTEN_HOST || '127.0.0.1',
    grids,
    maxConcurrent: num(env.BROWSERLAB_MAX_CONCURRENT_SESSIONS, 2),
    idleMs: num(env.BROWSERLAB_IDLE_TIMEOUT_MINUTES, 30) * 60_000,
    maxSessionMs: num(env.BROWSERLAB_MAX_SESSION_MINUTES, 120) * 60_000,
    trustedPrivateUrls: (env.BROWSERLAB_TRUSTED_PRIVATE_URLS ?? 'true') === 'true',
    retentionDays: num(env.BROWSERLAB_RETENTION_DAYS, 30),
    maxTransferBytes: num(env.BROWSERLAB_MAX_TRANSFER_MB, 25) * 1024 * 1024,
    maxScreenshotBytes: 25 * 1024 * 1024,
    logLevel: env.BROWSERLAB_LOG_LEVEL || 'info',
    /** Extra allowed browser origins (comma separated) for reverse-proxy setups; same-origin is always allowed. */
    publicOrigins: (env.BROWSERLAB_PUBLIC_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    safariVnc: safariVnc ? { host: safariVnc[0], port: Number(safariVnc[1] || 5900) } : null,
    safariVncPassword: env.BROWSERLAB_SAFARI_VNC_PASSWORD || '',
    catalogPath: env.BROWSERLAB_CATALOG || path.join(repoRoot, 'browser-images/catalog.json'),
    webDist: env.BROWSERLAB_WEB_DIST || path.join(repoRoot, 'apps/web/dist'),
    fixtureDir: env.BROWSERLAB_FIXTURE_DIR || path.join(repoRoot, 'tests/fixtures/site'),
    sessionStartTimeoutMs: num(env.BROWSERLAB_SESSION_START_TIMEOUT_SECONDS, 240) * 1000,
    keepaliveMs: 60_000,
    sweepMs: 30_000,
    probeCacheMs: 10_000,
  };
  if (!(cfg.maxConcurrent >= 1 && cfg.maxConcurrent <= 16)) throw new Error('BROWSERLAB_MAX_CONCURRENT_SESSIONS must be 1-16');
  return cfg;
}
export type Config = ReturnType<typeof loadConfig>;
