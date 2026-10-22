#!/usr/bin/env node
// End-to-end smoke through BrowserLab only (REST API + same-origin VNC relay), against a real browser.
// Usage: node tests/integration/live-smoke.mjs --catalog firefox-149-linux [--base http://127.0.0.1:3000]
//        [--fixture http://app:3000/fixture] [--restart]   (--restart also checks persistence + interruption via docker compose)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { connectRfb, near, KEY } from './rfb.mjs';

const { values: a } = parseArgs({ options: {
  catalog: { type: 'string', default: 'firefox-149-linux' }, base: { type: 'string', default: 'http://127.0.0.1:3000' },
  fixture: { type: 'string', default: 'http://app:3000/fixture' }, restart: { type: 'boolean', default: false },
} });
const BASE = a.base, ORIGIN = new URL(BASE).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash('sha256').update(b).digest('hex');
let step = 0;
const ok = (msg) => console.log(`ok ${++step} - ${msg}`);
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); ok(msg); };
async function api(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { origin: ORIGIN, ...(body && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body && (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
  const type = r.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(data?.error ?? '').slice(0, 300)}`);
  return data;
}
async function waitFor(fn, what, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`FAILED: timed out waiting for ${what}`); await sleep(500); }
}
const currentUrl = async (id) => (await api('GET', `/api/sessions/${id}?refresh=1`)).currentUrl ?? '';
async function launch(catalogId, url, vp = { width: 1366, height: 768 }) {
  const { id } = await api('POST', '/api/sessions', { targetUrl: url, target: { catalogId }, viewport: vp, tester: 'smoke' });
  const s = await waitFor(async () => { const v = await api('GET', `/api/sessions/${id}`); return v.state === 'running' || ['failed-to-start', 'interrupted', 'closed-with-error'].includes(v.state) ? v : null; }, 'session start', 300_000);
  if (s.state !== 'running') throw new Error(`FAILED: session ${s.state}: ${s.failureCode} ${s.failureMessage}`);
  return s;
}
async function viewer(id) {
  const { token } = await api('POST', `/api/sessions/${id}/view-token`);
  return connectRfb(`${BASE.replace(/^http/, 'ws')}/api/sessions/${id}/live?token=${token}`, { headers: { origin: ORIGIN } });
}

const health = await api('GET', '/api/health');
check(health.status === 'ok' && health.db === 'ok', 'health endpoint reports ok');
const build = (await api('GET', '/api/browser-builds')).builds.find((b) => b.id === a.catalog);
check(build?.availability === 'ready', `build ${a.catalog} is ready (${build?.availability}: ${build?.reason})`);

const color = '11c95d';
const fixture = `${a.fixture}/index.html`;
const s = await launch(a.catalog, `${fixture}?color=${color}`);
ok(`session ${s.id} running: ${s.brand} ${s.actualBrowserVersion} on ${s.actualOs}/${s.actualArch}`);
check(s.verification?.ok === true, `identity verified (${s.verification?.level}): ${JSON.stringify(s.verification?.executable ?? s.verification?.capabilities)}`);
check(new RegExp(build.versionMatch).test(s.actualBrowserVersion), `actual version ${s.actualBrowserVersion} matches ${build.versionMatch}`);
if (build.family !== 'safari') check(s.verification.level === 'executable', 'executable-level verification recorded');
check(s.effectiveViewport?.width === 1366 && s.effectiveViewport?.height === 768, `effective viewport ${JSON.stringify(s.effectiveViewport)}`);
check((await currentUrl(s.id)).startsWith(fixture), 'target URL loaded');

// Viewer authorisation: tokens are single-use and Origin-bound.
const { token } = await api('POST', `/api/sessions/${s.id}/view-token`);
await connectRfb(`${BASE.replace(/^http/, 'ws')}/api/sessions/${s.id}/live?token=${token}`, { headers: { origin: 'http://evil.example' } }).then(() => { throw new Error('FAILED: foreign origin accepted'); }, (e) => check(/40[13]/.test(e.message), `foreign Origin rejected (${e.message})`));
await connectRfb(`${BASE.replace(/^http/, 'ws')}/api/sessions/${s.id}/live?token=${token}`, { headers: { origin: ORIGIN } }).then(() => { throw new Error('FAILED: reused token accepted'); }, (e) => check(/40\d/.test(e.message), `used token rejected (${e.message})`));

const rfb = await viewer(s.id);
check(rfb.width > 0, `live desktop ${rfb.width}x${rfb.height} via BrowserLab relay`);
if (build.family === 'safari') {
  // Safari blocks input to WebDriver-controlled windows (glass pane); manual control needs a human handover.
  const shotS = await api('POST', `/api/sessions/${s.id}/screenshot`, { caption: 'safari smoke' });
  check(shotS.sha256, 'WebDriver screenshot before handover');
  rfb.close();
  await api('DELETE', `/api/sessions/${s.id}`);
  console.log(`\nPARTIAL: ${step} automated checks for ${a.catalog}. Manual handover NOT verified.`);
  console.log('Next: launch Safari from the UI, take manual control (docs/SAFARI-WORKER.md), type/click/scroll, capture the desktop,');
  console.log('then record interactiveVerifiedAt in browser-images/catalog.json only if all of that worked.');
  process.exit(2);
}
const target = [0x11, 0xc9, 0x5d];
const px = await waitFor(async () => { const p = await rfb.pixel(1100, 500); return near(p, target) ? p : null; }, 'fixture colour on the VNC desktop', 15_000);
check(near(px, target), 'WebDriver page is the page on the VNC desktop (colour marker)');

// Keyboard: focus heading, Tab into the name field, type, Enter submits the form (navigation).
await rfb.click(1100, 150);
await rfb.tap(KEY.Tab);
await rfb.type('smoke');
await rfb.tap(KEY.Return);
check(await waitFor(async () => (await currentUrl(s.id)).includes('name=smoke'), 'form submission'), 'keyboard input + form submit navigated to page2?name=smoke');
// Mouse: click the large link.
await sleep(800);
await rfb.click(1100, 500);
check(await waitFor(async () => (await currentUrl(s.id)).includes('clicked=1'), 'pointer click'), 'pointer click followed a link');

// Upload: stage a file, then pick it in the browser's own file chooser through the viewer.
const uploadBody = Buffer.from(`browserlab smoke ${Date.now()}\n`);
const up = await api('POST', `/api/sessions/${s.id}/files`, uploadBody, { 'content-type': 'application/octet-stream', 'x-filename': 'smoke-upload.txt' });
check(up.remotePath.endsWith('smoke-upload.txt'), `upload staged at ${up.remotePath}`);
await sleep(800);
await rfb.click(1100, 150);
for (let i = 0; i < 4; i++) await rfb.tap(KEY.Tab);
await rfb.tap(0x20);
await sleep(2500);
await rfb.combo(KEY.Control, 0x6c);
await sleep(500);
await rfb.type(up.remotePath);
await rfb.tap(KEY.Return);
check(await waitFor(async () => (await currentUrl(s.id)).includes('uploaded=smoke-upload.txt'), 'file chooser upload', 20_000), 'file chosen in the native file dialog reached the page');

// Download via the browser's own address bar, then retrieve through BrowserLab.
await rfb.combo(KEY.Control, 0x6c);
await sleep(400);
await rfb.type(`${fixture}?autodownload=1`);
await rfb.tap(KEY.Return);
await waitFor(async () => (await api('GET', `/api/sessions/${s.id}/downloads`)).names.includes('sample-download.txt'), 'download to appear', 20_000);
const dl = await api('GET', `/api/sessions/${s.id}/downloads/sample-download.txt`);
const expected = readFileSync(new URL('../fixtures/site/sample-download.txt', import.meta.url));
check(sha(dl) === sha(expected), 'downloaded file retrieved with matching sha256');

const shot = await api('POST', `/api/sessions/${s.id}/screenshot`, { caption: 'smoke screenshot' });
const img = await api('GET', `/api/evidence/${shot.id}/download`);
check(sha(img) === shot.sha256 && img.subarray(1, 4).toString() === 'PNG', `screenshot stored (${shot.byte_size} bytes, sha256 ${shot.sha256.slice(0, 12)}…)`);
await api('POST', `/api/sessions/${s.id}/result`, { outcome: 'passed', notes: 'Automated smoke: keyboard, mouse, upload, download, screenshot.', checklist: '' });

const report = await api('GET', `/api/reports/export?format=json&catalogId=${a.catalog}`);
const row = report.rows.find((r) => r.sessionId === s.id);
check(row?.outcome === 'passed' && row.actualVersion === s.actualBrowserVersion && row.requestedVersion === s.requestedVersion, 'JSON export has requested vs actual identity and outcome');
const csv = (await api('GET', `/api/reports/export?format=csv&catalogId=${a.catalog}`)).toString();
check(csv.includes(s.id) && csv.split('\r\n')[0].includes('actualVersion'), 'CSV export contains the session');
const html = (await api('GET', `/api/reports/export?format=html&catalogId=${a.catalog}`)).toString();
check(html.includes(s.actualBrowserVersion) && html.includes('data:image/png;base64,'), 'HTML export is self-contained with screenshots');

const closedP = rfb.closed;
const closed = await api('DELETE', `/api/sessions/${s.id}`);
check(closed.state === 'completed', 'session closed (completed)');
check((await Promise.race([closedP, sleep(5000).then(() => 'open')])) !== 'open', 'viewer socket closed with the session');
check((await api('DELETE', `/api/sessions/${s.id}`)).state === 'completed', 'close is idempotent');

if (a.restart) {
  const browsers = () => new Set(execFileSync('docker', ['ps', '-q', '--filter', 'name=browser-'], { encoding: 'utf8' }).split('\n').filter(Boolean));
  const existing = browsers();
  const s2 = await launch(a.catalog, fixture);
  execFileSync('docker', ['compose', 'restart', 'app'], { stdio: 'ignore' });
  await waitFor(async () => { try { return (await api('GET', '/api/health')).status === 'ok'; } catch { return false; } }, 'app restart', 60_000);
  const after = await api('GET', `/api/sessions/${s2.id}`);
  check(after.state === 'interrupted' && after.result === null, 'session open during restart marked interrupted (not passed)');
  const kept = await api('GET', `/api/sessions/${s.id}`);
  check(kept.result?.outcome === 'passed' && kept.evidenceCount >= 1, 'results and evidence persisted across restart');
  check((await api('GET', `/api/evidence/${shot.id}/download`)).length === shot.byte_size, 'evidence file readable after restart');
  await waitFor(() => [...browsers()].every((c) => existing.has(c)), 'browser containers released', 60_000);
  ok('the interrupted session\'s browser container was removed');
}
console.log(`\nPASS: ${step} checks for ${a.catalog}`);
process.exit(0);
