// Grid contract regression suite: the permanent form of the 2026-10-22 upstream spike.
// Requires `docker compose up -d grid`. Reaches the private Grid through a temporary loopback-only socat tunnel.
// Run: npm run test:grid   (env CATALOG_ID selects the image to exercise; default firefox-149-linux)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { connectRfb, near } from './rfb.mjs';

const CATALOG_ID = process.env.CATALOG_ID ?? 'firefox-149-linux';
const BROWSER_NAME = process.env.BROWSER_NAME ?? 'firefox';
const MAX_SESSIONS = Number(process.env.BROWSERLAB_MAX_CONCURRENT_SESSIONS ?? 2);
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
let tunnel, G;

before(async () => {
  const net = docker('inspect', '-f', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}', docker('compose', 'ps', '-q', 'grid'));
  tunnel = docker('run', '-d', '--rm', '--network', net, '-p', '127.0.0.1::4444', '--entrypoint', 'socat', 'browserlab/grid:local', 'TCP-L:4444,fork,reuseaddr', 'TCP:grid:4444');
  G = `http://${docker('port', tunnel, '4444')}`;
  for (let i = 0; i < 40; i++) { try { if ((await (await fetch(`${G}/status`)).json()).value.ready) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error('grid not ready');
});
after(() => { if (tunnel) docker('rm', '-f', tunnel); });

const wd = async (method, path, body) => (await fetch(G + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const newSession = (catalogId) => wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: BROWSER_NAME, platformName: 'linux', 'browserlab:catalogId': catalogId, 'se:vncEnabled': true, 'se:downloadsEnabled': true } } });

test('status: slots capped, session timeout configured, every slot pinned to a catalogue id', async () => {
  const { value } = await wd('GET', '/status');
  const slots = value.nodes.flatMap((n) => n.slots);
  assert.equal(value.nodes[0].maxSessions, MAX_SESSIONS);
  assert.equal(value.nodes[0].sessionTimeout, 300000);
  assert.ok(slots.length > 0);
  for (const s of slots) assert.match(s.stereotype['browserlab:catalogId'], /^[a-z0-9.-]+$/);
  assert.ok(['aarch64', 'amd64', 'x86_64'].includes(value.nodes[0].osInfo.arch));
});

test('unknown catalogue id is rejected, never substituted', async () => {
  const r = await newSession('does-not-exist-linux');
  assert.equal(r.value.sessionId, undefined);
  assert.equal(r.value.error, 'session not created');
});

test('live session: same desktop, bidirectional VNC, uploads, downloads, hardened container, cleanup', async () => {
  const before = new Set(docker('ps', '-q', '--filter', 'name=browser-').split('\n').filter(Boolean));
  const s = await newSession(CATALOG_ID);
  const id = s.value.sessionId;
  assert.ok(id, JSON.stringify(s).slice(0, 500));
  try {
    const caps = s.value.capabilities;
    assert.equal(caps['browserlab:catalogId'], CATALOG_ID);
    assert.equal(caps['se:vnc'], `ws://grid:4444/session/${id}/se/vnc`);

    // Hardened container: no binds/mounts/ports/privileges, private network only.
    const cid = docker('ps', '-q', '--filter', 'name=browser-').split('\n').find((c) => c && !before.has(c));
    const info = JSON.parse(docker('inspect', cid))[0];
    assert.equal(info.HostConfig.Privileged, false);
    assert.deepEqual(info.HostConfig.Binds ?? [], []);
    assert.deepEqual(info.Mounts ?? [], []);
    assert.deepEqual(Object.keys(info.HostConfig.PortBindings ?? {}), []);
    assert.deepEqual(info.HostConfig.Devices ?? [], []);
    assert.deepEqual(info.HostConfig.CapAdd ?? [], []);
    assert.ok(!JSON.stringify(info).includes('docker.sock'), 'docker.sock must never reach a browser container');
    assert.match(info.HostConfig.NetworkMode, /browserlab/);
    assert.ok((info.HostConfig.ExtraHosts ?? []).some((h) => h.startsWith('host.docker.internal:')));

    const color = [17, 201, 93];
    const html = `<body style="margin:0;background:rgb(${color})"><input id=i onclick="document.title='clicked'" style="position:fixed;left:25%;top:25%;width:50%;height:50%;font-size:40px;background:rgb(${color});border:0;appearance:none;outline:none">`
      + `<a id=d download="contract.txt" href="data:text/plain,browserlab-download">d</a>`;
    await wd('POST', `/session/${id}/url`, { url: 'data:text/html,' + encodeURIComponent(html) });
    await wd('POST', `/session/${id}/window/maximize`, {});

    const rfb = await connectRfb(`${G.replace('http', 'ws')}/session/${id}/se/vnc`);
    assert.equal(rfb.version, 'RFB 003.008\n');
    // Off-centre: x11vnc draws the pointer into the framebuffer at the initial centre position.
    let px;
    for (let i = 0; i < 20 && !near(px ?? [-99, -99, -99], color); i++) { if (i) await new Promise((r) => setTimeout(r, 500)); px = await rfb.pixel(Math.round(rfb.width * 0.4), Math.round(rfb.height * 0.6)); }
    assert.ok(near(px, color), `WebDriver page must be visible on the VNC desktop (got ${px})`);
    await rfb.click(rfb.width / 2, rfb.height / 2);
    await rfb.type('vnc ok');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal((await wd('GET', `/session/${id}/title`)).value, 'clicked');
    assert.equal((await wd('POST', `/session/${id}/execute/sync`, { script: 'return document.getElementById("i").value', args: [] })).value, 'vnc ok');
    rfb.close();

    const zip = new JSZip(); zip.file('upload-contract.txt', 'browserlab-upload');
    const up = await wd('POST', `/session/${id}/se/file`, { file: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64') });
    assert.match(up.value, /upload-contract\.txt$/);

    await wd('POST', `/session/${id}/execute/sync`, { script: 'document.getElementById("d").click()', args: [] });
    let names = [];
    for (let i = 0; i < 20 && !names.includes('contract.txt'); i++) { await new Promise((r) => setTimeout(r, 500)); names = (await wd('GET', `/session/${id}/se/files`)).value.names ?? []; }
    assert.ok(names.includes('contract.txt'), `downloads: ${names}`);
    const dl = await wd('POST', `/session/${id}/se/files`, { name: 'contract.txt' });
    const z = await JSZip.loadAsync(Buffer.from(dl.value.contents, 'base64'));
    assert.equal(await z.file('contract.txt').async('string'), 'browserlab-download');
  } finally {
    await wd('DELETE', `/session/${id}`);
  }
  for (let i = 0; i < 30; i++) {
    if (!docker('ps', '-q', '--filter', 'name=browser-').split('\n').some((c) => c && !before.has(c))) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.fail('browser container not removed after session delete');
});
