import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { buildApp } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { parseChromiumVersionPage } from '../src/selenium/verify.ts';
import { startStubGrid, type StubGrid } from './stubGrid.ts';

const chromePage = readFileSync(new URL('fixtures/chrome-109-version.txt', import.meta.url), 'utf8');
type App = Awaited<ReturnType<typeof buildApp>>;
let grid: StubGrid, app: App, dir: string, esrServedByRelease = false;

async function makeApp(env: Record<string, string> = {}) {
  const cfg = loadConfig({ BROWSERLAB_DATA_DIR: dir, BROWSERLAB_GRID_URLS: `local=${grid.url}`, BROWSERLAB_LOG_LEVEL: 'silent', BROWSERLAB_WEB_DIST: '/nonexistent', BROWSERLAB_MAX_CONCURRENT_SESSIONS: '2', ...env });
  cfg.keepaliveMs = 200;
  cfg.probeCacheMs = 0;
  cfg.sweepMs = 100;
  const a = await buildApp(cfg);
  await a.ready();
  return a;
}
const json = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { host: 'localhost:3000', ...headers } });
  return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body, raw: r };
};
const launch = (catalogId: string, extra: object = {}) => json('POST', '/api/sessions', { targetUrl: 'http://app:3000/fixture/index.html', target: { catalogId }, viewport: { width: 1440, height: 900 }, ...extra });
async function until(id: string, states: string[]) {
  for (let i = 0; i < 100; i++) { const s = (await json('GET', `/api/sessions/${id}`)).body; if (states.includes(s.state)) return s; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`session never reached ${states}`);
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'browserlab-test-'));
  esrServedByRelease = false;
  grid = await startStubGrid({
    catalogIds: ['chrome-109-linux-amd64', 'firefox-115esr-linux-amd64'],
    caps: (id) => id.startsWith('chrome')
      ? { browserName: 'chrome', browserVersion: '109.0.5414.119', platformName: 'linux', chrome: { chromedriverVersion: '109.0.5414.74 (e7c)' } }
      : { browserName: 'firefox', browserVersion: esrServedByRelease ? '115.0.3' : '115.43.1', platformName: 'linux', 'moz:geckodriverVersion': '0.37.1' },
    executable: (id) => id.startsWith('chrome') ? chromePage
      : esrServedByRelease ? { product: 'Firefox', version: '115.0.3', channel: 'release' } : { product: 'Firefox', version: '115.43.1esr', channel: 'esr' },
  });
  app = await makeApp();
});
afterEach(async () => { await app.close(); await grid.close(); rmSync(dir, { recursive: true, force: true }); });

describe('session lifecycle against a stub grid', () => {
  it('create -> verify -> navigate -> screenshot -> result -> close, with only allowlisted capabilities', async () => {
    const r = await launch('chrome-109-linux-amd64', { capabilities: { 'se:recordVideo': true }, image: 'evil/image' });
    expect(r.status).toBe(202);
    const s = await until(r.body.id, ['running', 'failed-to-start']);
    expect(s).toMatchObject({ state: 'running', actualBrowserVersion: '109.0.5414.119', actualArch: 'amd64', driver: 'attached' });
    expect(s.verification).toMatchObject({ ok: true, level: 'executable', executable: parseChromiumVersionPage(chromePage) });
    const sent = grid.requests.find((q) => q.method === 'POST' && q.path === '/session')!.body.capabilities.alwaysMatch;
    expect(Object.keys(sent).sort()).toEqual(['browserName', 'browserlab:catalogId', 'platformName', 'se:downloadsEnabled', 'se:vncEnabled']);
    // the user's tab never visited the internal version page
    expect(grid.requests.filter((q) => q.path.endsWith('/url') && q.method === 'POST').map((q) => q.body.url)).toEqual(['chrome://version', 'http://app:3000/fixture/index.html']);

    const shot = await json('POST', `/api/sessions/${s.id}/screenshot`, { caption: 'home' });
    expect(shot.status).toBe(201);
    const file = await app.inject({ url: `/api/evidence/${shot.body.id}/download`, headers: { host: 'localhost:3000' } });
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect((await json('POST', `/api/sessions/${s.id}/result`, { outcome: 'passed', notes: 'ok' })).body.result.outcome).toBe('passed');

    const closed = await json('DELETE', `/api/sessions/${s.id}`);
    expect(closed.body.state).toBe('completed');
    expect(grid.requests.some((q) => q.method === 'DELETE' && q.path === `/session/${grid.sessions.keys().next().value}`)).toBe(true);
    expect((await json('DELETE', `/api/sessions/${s.id}`)).body.state).toBe('completed'); // idempotent
    expect((await json('GET', '/api/reports?outcome=passed')).body).toHaveLength(1);
  });

  it('persists redacted URL query parameters but navigates the exact original URL', async () => {
    const secret = 'never-save-this-value';
    const targetUrl = `http://app:3000/fixture/index.html?auth=${secret}`;
    const r = await launch('chrome-109-linux-amd64', { targetUrl });
    const s = await until(r.body.id, ['running']);
    expect(s.targetUrl).toContain('auth=***');
    expect(s.targetUrl).not.toContain(secret);
    expect(grid.requests.some((x) => x.method === 'POST' && x.path.endsWith('/url') && x.body.url === targetUrl)).toBe(true);
    expect(JSON.stringify((await json('GET', '/api/reports')).body)).not.toContain(secret);
  });

  it('close: a failed quit is clean if the Grid released the browser, an error if it did not', async () => {
    grid.deleteFailure = 'released';
    const a = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    expect((await json('DELETE', `/api/sessions/${a.id}`)).body).toMatchObject({ state: 'completed', failureCode: null });
    grid.deleteFailure = 'stuck';
    const b = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    expect((await json('DELETE', `/api/sessions/${b.id}`)).body).toMatchObject({ state: 'closed-with-error', failureCode: 'GRID_UNAVAILABLE' });
  });

  it('identity mismatch stops the browser and marks verification-failed, never passed', async () => {
    esrServedByRelease = true;
    const r = await launch('firefox-115esr-linux-amd64');
    const s = await until(r.body.id, ['failed-to-start', 'running']);
    expect(s.state).toBe('failed-to-start');
    expect(s.failureCode).toBe('BROWSER_VERSION_MISMATCH');
    expect(s.failureMessage).toMatch(/update channel "release" is not "esr"/);
    expect([...grid.sessions.values()].every((x) => !x.alive)).toBe(true);
    expect((await json('POST', `/api/sessions/${s.id}/result`, { outcome: 'passed' })).status).toBe(400);
    const b = (await json('GET', '/api/browser-builds')).body.builds.find((x: any) => x.id === 'firefox-115esr-linux-amd64');
    expect(b.availability).toBe('verification-failed');
    expect((await launch('firefox-115esr-linux-amd64')).body.error.code).toBe('BROWSER_VERSION_MISMATCH');
  });

  it('reports honest availability: unsupported architecture, offline worker, not provisioned', async () => {
    const builds = (await json('GET', '/api/browser-builds')).body.builds as any[];
    const by = (id: string) => builds.find((b) => b.id === id);
    expect(by('chrome-109-linux-amd64').availability).toBe('ready');
    expect(by('edge-121-linux-amd64').availability).toBe('not-provisioned');
    expect(by('safari-16-mac').availability).toBe('offline');
    expect(by('safari-16-mac').reason).toMatch(/compatible macOS host unavailable/);
    expect((await launch('edge-121-linux-amd64')).body.error.code).toBe('BROWSER_NOT_PROVISIONED');
    await app.close();
    await grid.close();
    grid = await startStubGrid({ catalogIds: ['firefox-149-linux'], arch: 'aarch64', caps: () => ({}), executable: () => ({}) });
    app = await makeApp();
    const arm = (await json('GET', '/api/browser-builds')).body.builds as any[];
    expect(arm.find((b) => b.id === 'chrome-109-linux-amd64')).toMatchObject({ availability: 'unsupported-architecture', workerArch: 'arm64' });
    expect((await launch('chrome-109-linux-amd64')).body.error.code).toBe('UNSUPPORTED_ARCH');
    await app.close();
    app = await makeApp({ BROWSERLAB_GRID_URLS: 'local=http://127.0.0.1:9' });
    expect((await json('GET', '/api/browser-builds')).body.builds[0].availability).toBe('offline');
  });

  it('serves a build from whichever configured worker advertises it (arm64 laptop + amd64 worker)', async () => {
    await app.close();
    const arm = await startStubGrid({ catalogIds: ['firefox-149-linux'], arch: 'aarch64', caps: () => ({}), executable: () => ({}) });
    app = await makeApp({ BROWSERLAB_GRID_URLS: `local=${arm.url},amd64=${grid.url}` });
    const builds = (await json('GET', '/api/browser-builds')).body.builds as any[];
    expect(builds.find((b) => b.id === 'chrome-109-linux-amd64')).toMatchObject({ availability: 'ready', worker: 'amd64', workerArch: 'amd64' });
    expect(builds.find((b) => b.id === 'edge-121-linux-amd64')).toMatchObject({ availability: 'unsupported-architecture', worker: 'local' });
    const s = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    expect(s.actualArch).toBe('amd64');
    expect(grid.sessions.size).toBe(1);
    expect(arm.sessions.size).toBe(0);
    await app.close();
    await arm.close();
    app = await makeApp();
  });

  it('enforces capacity atomically under concurrent launches', async () => {
    await app.close();
    app = await makeApp({ BROWSERLAB_MAX_CONCURRENT_SESSIONS: '1' });
    const [a, b] = await Promise.all([launch('chrome-109-linux-amd64'), launch('firefox-115esr-linux-amd64')]);
    const codes = [a, b].map((r) => r.status).sort();
    expect(codes).toEqual([202, 429]);
    expect([a, b].find((r) => r.status === 429)!.body.error.code).toBe('NO_SESSION_CAPACITY');
  });

  it('worker loss mid-session -> interrupted; saved evidence kept; nothing passed', async () => {
    const s = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    await json('POST', `/api/sessions/${s.id}/screenshot`, {});
    grid.kill([...grid.sessions.keys()][0]);
    const after = await until(s.id, ['interrupted']);
    expect(after).toMatchObject({ failureCode: 'SESSION_INTERRUPTED', result: null, evidenceCount: 1 });
  });

  it('restart recovery releases grid sessions and marks them interrupted', async () => {
    const s = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    const gridId = [...grid.sessions.keys()][0];
    const crashed = app;
    app = await makeApp(); // a second process on the same data directory, as after a crash
    expect((await json('GET', `/api/sessions/${s.id}`)).body).toMatchObject({ state: 'interrupted', failureCode: 'SESSION_INTERRUPTED' });
    expect(grid.sessions.get(gridId)!.alive).toBe(false);
    await crashed.close();
  });

  it('expires idle sessions and releases the browser', async () => {
    await app.close();
    app = await makeApp({ BROWSERLAB_IDLE_TIMEOUT_MINUTES: '0' });
    const s = await until((await launch('chrome-109-linux-amd64')).body.id, ['running', 'expired']);
    const after = await until(s.id, ['expired']);
    expect(after.failureMessage).toBe('Idle timeout reached.');
    expect([...grid.sessions.values()].every((x) => !x.alive)).toBe(true);
  });

  it('uploads and downloads go through Grid with caps and validation', async () => {
    const s = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    const up = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/files`, payload: Buffer.from('hello'), headers: { host: 'localhost:3000', 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent('../../rep ort.txt') } });
    expect(up.json()).toEqual({ name: 'rep ort.txt', remotePath: '/tmp/stub-upload/rep ort.txt' });
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/files`, payload: Buffer.alloc(26 * 1024 * 1024), headers: { host: 'localhost:3000', 'content-type': 'application/octet-stream', 'x-filename': 'big.bin' } })).statusCode).toBe(413);
    expect((await json('GET', `/api/sessions/${s.id}/downloads`)).body.names).toEqual([]);
    expect((await json('GET', `/api/sessions/${s.id}/downloads/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    const gridId = [...grid.sessions.keys()][0];
    await fetch(`${grid.url}/session/${gridId}/execute/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script: '__stub_download__', args: [] }) });
    const dl = await app.inject({ url: `/api/sessions/${s.id}/downloads/report.txt`, headers: { host: 'localhost:3000' } });
    expect(dl.body).toBe('stub download');
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    const ev = await json('POST', `/api/sessions/${s.id}/downloads/report.txt/evidence`);
    expect(ev.body).toMatchObject({ source: 'browser-download', mime_type: 'application/octet-stream' });
  });
});

describe('live viewer relay', () => {
  it('requires same Origin and a single-use token, relays bytes, and closes with the session', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const s = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    const token = async () => (await json('POST', `/api/sessions/${s.id}/view-token`)).body.token as string;
    const connect = (t: string, origin: string) => new Promise<WebSocket>((res, rej) => {
      const ws = new WebSocket(`ws://${base}/api/sessions/${s.id}/live?token=${t}`, { headers: { origin } });
      ws.once('open', () => res(ws)); ws.once('unexpected-response', (_q, r) => rej(new Error(String(r.statusCode)))); ws.once('error', rej);
    });
    await expect(connect('nope', `http://${base}`)).rejects.toThrow('409');
    const t1 = await token();
    await expect(connect(t1, 'http://evil.example')).rejects.toThrow('403');
    await expect(connect(t1, `http://${base}`)).rejects.toThrow('409'); // burned by the failed attempt
    await expect(connect(await token(), '')).rejects.toThrow('403');
    const ws = await connect(await token(), `http://${base}`);
    const first = await new Promise<Buffer>((r) => ws.once('message', (d: Buffer) => r(d)));
    expect(first.toString()).toBe('RFB 003.008\n');
    ws.send(Buffer.from('RFB 003.008\n'));
    await new Promise((r) => setTimeout(r, 100));
    expect(grid.vncFrames.map(String)).toContain('RFB 003.008\n');
    // a second viewer takes over the desktop
    const closedFirst = new Promise<number>((r) => ws.once('close', (c) => r(c)));
    const ws2 = await connect(await token(), `http://${base}`);
    expect(await closedFirst).toBe(4002);
    const closed = new Promise<number>((r) => ws2.once('close', (c) => r(c)));
    await json('DELETE', `/api/sessions/${s.id}`);
    expect(await closed).toBe(4002);
    await expect(json('POST', `/api/sessions/${s.id}/view-token`).then((r) => r.status)).resolves.toBe(409);
  });

  it('rejects DNS-rebinding Host headers even when Origin appears same-site', async () => {
    expect((await json('GET', '/api/health', undefined, { host: 'attacker.example:3000' })).status).toBe(403);
    expect((await json('POST', '/api/projects', { name: 'bad' }, { host: 'attacker.example:3000', origin: 'http://attacker.example:3000' })).status).toBe(403);
    expect((await json('GET', '/api/health', undefined, { host: '127.0.0.1:3000' })).status).toBe(200);
    expect((await json('GET', '/api/health', undefined, { host: 'app:3000' })).status).toBe(200);
  });

  it('rejects cross-origin writes (CSRF guard)', async () => {
    expect((await json('POST', '/api/projects', { name: 'x' }, { origin: 'http://evil.example' })).status).toBe(403);
  });
});

describe('projects, policy, matrix, import/export', () => {
  it('CRUD with one default environment, policy matrix with honest availability, round-trip export', async () => {
    const p = (await json('POST', '/api/projects', { name: 'Demo', description: 'generic' })).body;
    expect((await json('POST', `/api/projects/${p.id}/environments`, { name: 'staging', baseUrl: 'https://staging.example.com', isDefault: true })).status).toBe(201);
    await json('POST', `/api/projects/${p.id}/environments`, { name: 'local', baseUrl: 'http://host.docker.internal:8080', isDefault: true });
    expect((await json('POST', `/api/projects/${p.id}/environments`, { name: 'bad', baseUrl: 'javascript:alert(1)' })).body.error.code).toBe('INVALID_URL');
    const envs = (await json('GET', `/api/projects/${p.id}`)).body.environments;
    expect(envs.filter((e: any) => e.isDefault).map((e: any) => e.name)).toEqual(['local']);
    const targets = [
      { family: 'chrome', channel: 'stable', requestedVersion: '109', targetOs: 'linux', kind: 'minimum', required: true },
      { family: 'firefox', channel: 'esr', requestedVersion: '115', targetOs: 'linux', kind: 'minimum', required: true },
      { family: 'edge', channel: 'stable', requestedVersion: '121', targetOs: 'linux', kind: 'minimum', required: true },
      { family: 'safari', channel: 'stable', requestedVersion: '16', targetOs: 'mac', kind: 'minimum', required: true },
      { family: 'chrome', channel: 'stable', requestedVersion: '99', targetOs: 'linux', kind: 'exact', required: false },
    ];
    expect((await json('PUT', `/api/projects/${p.id}/policy`, { targets })).status).toBe(200);
    const m = (await json('GET', `/api/projects/${p.id}/matrix`)).body as any[];
    expect(m.map((r) => r.availability)).toEqual(['ready', 'ready', 'not-provisioned', 'offline', 'not-provisioned']);
    expect(m[4].reason).toMatch(/No catalogue build/);
    expect(m.every((r) => r.last === null)).toBe(true);

    const minimum = await json('POST', '/api/sessions', { targetUrl: 'https://staging.example.com', target: { family: 'firefox', strategy: 'minimum', projectId: p.id }, viewport: { width: 1440, height: 900 }, projectId: p.id });
    const s = await until(minimum.body.id, ['running']);
    expect(s.catalogId).toBe('firefox-115esr-linux-amd64');
    expect(s.requestedVersion).toBe('115 ESR');
    expect((await json('GET', `/api/projects/${p.id}/matrix`)).body[1].last.outcome).toBe('not-run');

    const exported = (await json('GET', `/api/projects/${p.id}/export`)).body;
    expect(JSON.stringify(exported)).not.toMatch(/password|cookie|token/i);
    const imported = (await json('POST', '/api/projects/import', exported)).body;
    expect(imported.policy).toHaveLength(5);
    expect(imported.environments).toHaveLength(2);

    expect((await json('DELETE', `/api/projects/${p.id}`)).status).toBe(204);
    expect((await json('GET', `/api/sessions/${s.id}`)).body.projectId).toBeNull(); // history kept
  });

  it('newest-provisioned resolves to the newest READY stable build, never ESR or unprovisioned', async () => {
    const r = await json('POST', '/api/sessions', { targetUrl: 'https://example.com', target: { family: 'chrome', strategy: 'newest-provisioned' }, viewport: { width: 1440, height: 900 } });
    expect((await until(r.body.id, ['running'])).catalogId).toBe('chrome-109-linux-amd64');
    expect((await json('POST', '/api/sessions', { targetUrl: 'https://example.com', target: { family: 'edge', strategy: 'newest-provisioned' }, viewport: { width: 1440, height: 900 } })).body.error.code).toBe('BROWSER_NOT_PROVISIONED');
  });
});

describe('evidence store safety and migrations', () => {
  it('rejects unknown/traversal evidence ids and non-PNG desktop captures; migrations are idempotent', async () => {
    expect((await json('GET', '/api/evidence/..%2F..%2Fbrowserlab.db/download')).status).toBe(404);
    const s = await until((await launch('chrome-109-linux-amd64')).body.id, ['running']);
    const bad = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/desktop-capture`, payload: Buffer.from('not a png'), headers: { host: 'localhost:3000', 'content-type': 'image/png' } });
    expect(bad.statusCode).toBe(400);
    const png = readFileSync(new URL('fixtures/one-pixel.png', import.meta.url));
    const ok = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/desktop-capture`, payload: png, headers: { host: 'localhost:3000', 'content-type': 'image/png', 'x-caption': 'desk' } });
    expect(ok.json()).toMatchObject({ source: 'vnc-desktop', caption: 'desk' });
    await app.close();
    app = await makeApp(); // reopen: migrations already applied
    expect((await json('GET', '/api/health')).body.db).toBe('ok');
  });
});
