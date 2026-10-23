import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { CatalogSchema, type CatalogEntry } from '@browserlab/shared';
import { checkTargetUrl, redactSecrets, redactUrl } from '../src/services/urlPolicy.ts';
import { evaluate, parseChromiumVersionPage, type Facts } from '../src/selenium/verify.ts';
import { buildCapabilities } from '../src/selenium/capabilities.ts';
import { ByteReader, authenticateUpstream, desEcb, greetViewer, vncAuthResponse } from '../src/selenium/rfbAuth.ts';
import { toCsv } from '../src/services/reports.ts';
import { sanitizeFileName } from '../src/services/sessions.ts';
// @ts-expect-error untyped JS module
import { renderToml, targets, HOST_CONFIG_KEYS } from '../../../scripts/gen-grid-toml.mjs';
// @ts-expect-error noVNC's own DES (independent implementation used as the test oracle)
import { DESECBCipher } from '../../../node_modules/@novnc/novnc/core/crypto/des.js';

const root = new URL('../../../', import.meta.url);
const catalog = CatalogSchema.parse(JSON.parse(readFileSync(new URL('browser-images/catalog.json', root), 'utf8')));
const entry = (id: string) => catalog.entries.find((e) => e.id === id)! as CatalogEntry;
const fixture = (f: string) => readFileSync(new URL(`fixtures/${f}`, import.meta.url), 'utf8');

describe('URL policy', () => {
  it('accepts http/https and normalises', () => {
    expect(checkTargetUrl('  https://example.com/a?b=1 ', false).url).toBe('https://example.com/a?b=1');
  });
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'chrome://version', 'ftp://x', 'example.com', ''])('rejects %s', (u) => {
    expect(() => checkTargetUrl(u, true)).toThrow();
  });
  it('rejects control characters, credentials and over-long URLs', () => {
    expect(() => checkTargetUrl('https://a.com/\u0000', true)).toThrow(/control/);
    expect(() => checkTargetUrl('https://user:pw@a.com/', true)).toThrow(/Credentials/);
    expect(() => checkTargetUrl(`https://a.com/${'x'.repeat(2100)}`, true)).toThrow();
  });
  it('private/local targets only in trusted mode', () => {
    for (const u of ['http://localhost:8080', 'http://10.1.2.3', 'http://192.168.1.5', 'http://172.20.0.1', 'http://host.docker.internal:3000', 'http://app:3000', 'http://[::1]/', 'http://169.254.169.254/'])
      { expect(checkTargetUrl(u, true).private, u).toBe(true); expect(() => checkTargetUrl(u, false), u).toThrow(/Private/); }
    expect(checkTargetUrl('https://example.com', false).private).toBe(false);
    expect(checkTargetUrl('http://172.32.0.1', false).private).toBe(false);
  });
  it('warns (never rewrites) when localhost would mean the browser container', () => {
    const r = checkTargetUrl('http://localhost:5173/', true);
    expect(r.url).toBe('http://localhost:5173/');
    expect(r.warnings[0]).toMatch(/host\.docker\.internal/);
  });
  it('redacts query values and credentials in logs', () => {
    expect(redactUrl('/api/sessions/x/live?token=abc')).toBe('/api/sessions/x/live?token=***');
    expect(redactUrl('https://a.com/p?key=secret#frag')).toBe('https://a.com/p?key=***');
  });
  it('stores URLs with only secret-looking query values masked', () => {
    expect(redactSecrets('https://a.com/p?tenant=acme&page=2&api_key=k&access_token=t&Password=p&code=c'))
      .toBe('https://a.com/p?tenant=acme&page=2&api_key=***&access_token=***&Password=***&code=***');
    expect(redactSecrets('https://a.com/p')).toBe('https://a.com/p');
  });
});

const chromeFacts = (over: Partial<Facts['caps']> = {}, page = fixture('chrome-109-version.txt')): Facts => ({
  caps: { browserName: 'chrome', browserVersion: '109.0.5414.119', platformName: 'linux', 'browserlab:catalogId': 'chrome-109-linux-amd64', chrome: { chromedriverVersion: '109.0.5414.74 (e7c5703604daa9cc128ccf5a5d3e993513758913-refs/branch-heads/5414@{#1172})' }, ...over },
  nodeArch: 'amd64', executable: parseChromiumVersionPage(page), supplementary: { uaBrands: ['Google Chrome', 'Chromium'] },
});

describe('browser identity verification', () => {
  it('parses the real chrome://version and edge://version pages', () => {
    expect(parseChromiumVersionPage(fixture('chrome-109-version.txt'))).toEqual({ product: 'Google Chrome', version: '109.0.5414.119', officialBuild: true, path: '/opt/google/chrome/google-chrome' });
    expect(parseChromiumVersionPage(fixture('edge-121-version.txt'))).toEqual({ product: 'Microsoft Edge', version: '121.0.2277.128', officialBuild: true, path: '/opt/microsoft/msedge/microsoft-edge-base' });
  });
  it('accepts genuine Google Chrome 109 at executable level', () => {
    const v = evaluate(entry('chrome-109-linux-amd64'), chromeFacts());
    expect(v.mismatches).toEqual([]);
    expect(v.level).toBe('executable');
  });
  it('rejects Chromium 109 even though WebDriver says "chrome" and the version matches', () => {
    const chromium = fixture('chrome-109-version.txt').replace('Google Chrome\t109.0.5414.119 (Official Build)', 'Chromium\t109.0.5414.119 (Developer Build)');
    const v = evaluate(entry('chrome-109-linux-amd64'), chromeFacts({}, chromium));
    expect(v.ok).toBe(false);
    expect(v.mismatches.join()).toMatch(/Chromium/);
    expect(v.mismatches.join()).toMatch(/official/);
  });
  it('does not trust user-agent brands either way', () => {
    const f = chromeFacts();
    f.supplementary = { uaBrands: ['Chromium'] };
    expect(evaluate(entry('chrome-109-linux-amd64'), f).ok).toBe(true);
  });
  it('rejects wrong version, wrong driver, wrong arch, wrong catalogue slot', () => {
    expect(evaluate(entry('chrome-109-linux-amd64'), chromeFacts({ browserVersion: '109.0.5414.120' })).ok).toBe(false);
    expect(evaluate(entry('chrome-109-linux-amd64'), chromeFacts({ chrome: { chromedriverVersion: '110.0.1' } })).mismatches.join()).toMatch(/driver/);
    expect(evaluate(entry('chrome-109-linux-amd64'), { ...chromeFacts(), nodeArch: 'arm64' }).mismatches.join()).toMatch(/architecture/);
    expect(evaluate(entry('chrome-109-linux-amd64'), chromeFacts({ 'browserlab:catalogId': 'chrome-149-linux-amd64' })).ok).toBe(false);
    expect(evaluate(entry('chrome-109-linux-amd64'), { ...chromeFacts(), executable: {} }).mismatches.join()).toMatch(/could not read/);
  });
  it('accepts Edge 121 (WebDriver reports browserName "MicrosoftEdge")', () => {
    const v = evaluate(entry('edge-121-linux-amd64'), { caps: { browserName: 'MicrosoftEdge', browserVersion: '121.0.2277.128', platformName: 'linux', msedge: { msedgedriverVersion: '121.0.2277.128 (33d3)' } }, nodeArch: 'amd64', executable: parseChromiumVersionPage(fixture('edge-121-version.txt')) });
    expect(v.mismatches).toEqual([]);
  });
  const ff = (version: string, exeVersion: string, channel: string): Facts => ({ caps: { browserName: 'firefox', browserVersion: version, platformName: 'linux', 'moz:geckodriverVersion': '0.37.1', 'moz:buildID': '20240101' }, nodeArch: 'amd64', executable: { product: 'Firefox', version: exeVersion, channel, path: '/opt/firefox/firefox-bin' } });
  it('distinguishes Firefox 115 ESR from Firefox 115 release by update channel', () => {
    expect(evaluate(entry('firefox-115esr-linux-amd64'), ff('115.43.1', '115.43.1esr', 'esr')).mismatches).toEqual([]);
    const releaseAsEsr = evaluate(entry('firefox-115esr-linux-amd64'), ff('115.43.1', '115.43.1', 'release'));
    expect(releaseAsEsr.ok).toBe(false);
    expect(releaseAsEsr.mismatches.join()).toMatch(/update channel "release" is not "esr"/);
    expect(evaluate(entry('firefox-115-release-linux-amd64'), ff('115.0.3', '115.0.3', 'release')).ok).toBe(true);
    expect(evaluate(entry('firefox-115-release-linux-amd64'), ff('115.43.1', '115.43.1esr', 'esr')).ok).toBe(false);
  });
  it('Safari is capability-level only and says so', () => {
    const v = evaluate(entry('safari-16-mac'), { caps: { browserName: 'Safari', browserVersion: '16.6', platformName: 'mac' } });
    expect(v).toMatchObject({ ok: true, level: 'capabilities' });
    expect(evaluate(entry('safari-16-mac'), { caps: { browserName: 'Safari', browserVersion: '17.0', platformName: 'mac' } }).ok).toBe(false);
  });
});

describe('capabilities allowlist', () => {
  it('builds only catalogue-derived capabilities', () => {
    expect(buildCapabilities(entry('chrome-109-linux-amd64'))).toEqual({ browserName: 'chrome', platformName: 'linux', 'browserlab:catalogId': 'chrome-109-linux-amd64', unhandledPromptBehavior: 'ignore', 'se:vncEnabled': true, 'se:downloadsEnabled': true });
    expect(buildCapabilities(entry('edge-121-linux-amd64')).browserName).toBe('MicrosoftEdge');
    expect(Object.keys(buildCapabilities(entry('safari-16-mac')))).toEqual(['browserName', 'platformName', 'browserlab:catalogId', 'unhandledPromptBehavior']);
  });
});

describe('catalogue and generated Grid TOML', () => {
  it('catalogue entries are unique with valid regexes; the four acceptance targets exist as data', () => {
    expect(new Set(catalog.entries.map((e) => e.id)).size).toBe(catalog.entries.length);
    for (const e of catalog.entries) expect(() => new RegExp(e.versionMatch)).not.toThrow();
    for (const id of ['chrome-109-linux-amd64', 'firefox-115esr-linux-amd64', 'edge-121-linux-amd64', 'safari-16-mac']) expect(entry(id)).toBeTruthy();
    expect(entry('safari-16-mac').interactiveVerifiedAt).toBeUndefined();
  });
  it('committed TOML files match the catalogue (run npm run catalog:toml)', () => {
    for (const [file, toml] of Object.entries(targets(catalog) as Record<string, string>)) expect(readFileSync(new URL(file, root), 'utf8'), file).toBe(toml);
  });
  it('never propagates binds, devices or the socket; keeps fast reject and keepalive-based timeout', () => {
    expect(HOST_CONFIG_KEYS).not.toContain('Binds');
    for (const toml of Object.values(targets(catalog) as Record<string, string>)) {
      expect(toml.replace(/^#.*$/gm, '')).not.toMatch(/Binds|devices|docker\.sock|Privileged/);
      expect(toml).toContain('url = "http://127.0.0.1:2375"');
      expect(toml).toContain('video-image = "false"');
      expect(toml).toContain('reject-unsupported-caps = true');
      expect(toml).toMatch(/session-timeout = 300/);
    }
  });
  it('arm64 grids never list amd64-only images; pinned images carry digests', () => {
    const arm = renderToml(catalog, 'arm64', 'legacy') as string;
    expect(arm).toContain('firefox-149-linux');
    expect(arm).not.toMatch(/chrome|edge|115/);
    const amd = renderToml(catalog, 'amd64', 'legacy') as string;
    for (const id of ['chrome-109-linux-amd64', 'edge-121-linux-amd64', 'firefox-115esr-linux-amd64']) expect(amd).toContain(id);
    expect(amd).toMatch(/# pin selenium\/standalone-chrome:109\.0\S* sha256:eba35b7b/);
    expect(renderToml(catalog, 'amd64', 'default')).not.toContain('chrome-109');
  });
});

describe('RFB auth termination', () => {
  it('DES primitive matches the FIPS 46 test vector', () => {
    expect(desEcb(Buffer.from('0123456789abcdef'.repeat(3), 'hex'), Buffer.from('4e6f772069732074', 'hex')).toString('hex')).toBe('3fa40e8a984d4815');
  });
  it('VNC challenge response matches noVNC\'s independent DES implementation', async () => {
    const challenge = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    for (const pw of ['secret', 'p@ss', '12345678', 'longerthan8chars']) {
      const key = new Array(8).fill(0).map((_, i) => pw.charCodeAt(i) || 0);
      const oracle = Buffer.from(DESECBCipher.importKey(key).encrypt(null, new Uint8Array(challenge)));
      expect(vncAuthResponse(challenge, pw).toString('hex'), pw).toBe(oracle.toString('hex'));
    }
  });
  it('authenticates upstream with the password and offers the viewer only security None', async () => {
    const challenge = Buffer.alloc(16, 7);
    let got: Buffer | null = null;
    const server = net.createServer((sock) => {
      const r = new ByteReader();
      sock.on('data', (d) => r.push(d));
      (async () => {
        sock.write('RFB 003.889\n'); await r.read(12);
        sock.write(Buffer.from([2, 30, 2])); expect((await r.read(1))[0]).toBe(2);
        sock.write(challenge); got = await r.read(16);
        sock.write(Buffer.from([0, 0, 0, got.equals(vncAuthResponse(challenge, 'macpw')) ? 0 : 1]));
      })();
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    const sock = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
    const r = new ByteReader();
    sock.on('data', (d) => r.push(d));
    await authenticateUpstream(r, (b) => sock.write(b), 'macpw');
    expect(got).not.toBeNull();
    sock.destroy();
    const sock2 = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
    const r2 = new ByteReader();
    sock2.on('data', (d) => r2.push(d));
    await expect(authenticateUpstream(r2, (b) => sock2.write(b), 'wrong')).rejects.toThrow(/rejected/);
    sock2.destroy(); server.close();

    const viewerOut: Buffer[] = [];
    const vr = new ByteReader();
    const greeting = greetViewer(vr, (b) => viewerOut.push(b));
    vr.push(Buffer.from('RFB 003.008\n')); vr.push(Buffer.from([1]));
    await greeting;
    expect(Buffer.concat(viewerOut).toString('hex')).toBe(Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([1, 1, 0, 0, 0, 0])]).toString('hex'));
  });
});

describe('exports and file names', () => {
  it('CSV guards against spreadsheet formula injection and quotes properly', () => {
    const csv = toCsv([{ sessionId: 's1', notes: '=HYPERLINK("x")', targetUrl: 'https://a.com/?a=1,2', outcome: 'passed' } as any]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"https://a.com/?a=1,2"');
  });
  it('sanitises staged file names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\x\\rep<ort>.pdf')).toBe('rep_ort_.pdf');
    expect(() => sanitizeFileName('../')).toThrow();
  });
});
