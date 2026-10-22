// In-process stand-in for Selenium Grid: just enough W3C + Grid endpoints for lifecycle tests.
// It never stands in for real browser evidence; live behaviour is covered by tests/integration against real images.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { WebSocketServer } from 'ws';

export interface StubOptions {
  catalogIds: string[];
  arch?: string;
  /** Capabilities returned for a new session, by catalogue id. */
  caps: (catalogId: string) => Record<string, unknown>;
  /** innerText/about:support facts returned by the executable check. */
  executable: (catalogId: string) => unknown;
}

export interface StubGrid {
  url: string;
  requests: Array<{ method: string; path: string; body: any }>;
  sessions: Map<string, { catalogId: string; url: string; alive: boolean; windows: string[]; current: string }>;
  vncFrames: Buffer[];
  kill(sessionId: string): void;
  close(): Promise<void>;
}

const PNG = readFileSync(new URL('./fixtures/one-pixel.png', import.meta.url));

export async function startStubGrid(opts: StubOptions): Promise<StubGrid> {
  const requests: StubGrid['requests'] = [];
  const sessions: StubGrid['sessions'] = new Map();
  const vncFrames: Buffer[] = [];
  const downloads = new Map<string, Record<string, Buffer>>();
  let n = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : undefined;
    const path = req.url ?? '/';
    requests.push({ method: req.method!, path, body });
    const send = (code: number, value: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ value })); };
    const noSession = () => send(404, { error: 'invalid session id', message: 'No active session with ID', stacktrace: '' });

    if (path === '/status') {
      return send(200, { ready: true, message: 'ok', nodes: [{ availability: 'UP', osInfo: { arch: opts.arch ?? 'amd64', name: 'Linux' },
        slots: opts.catalogIds.map((id) => ({ stereotype: { 'browserlab:catalogId': id }, session: [...sessions.entries()].find(([, s]) => s.catalogId === id && s.alive) ? { sessionId: [...sessions.entries()].find(([, s]) => s.catalogId === id && s.alive)![0] } : null })) }] });
    }
    if (req.method === 'POST' && path === '/session') {
      const catalogId = body.capabilities.alwaysMatch['browserlab:catalogId'];
      if (!opts.catalogIds.includes(catalogId)) return send(500, { error: 'session not created', message: 'No nodes support the capabilities in the request', stacktrace: '' });
      const id = `stub-${++n}`;
      sessions.set(id, { catalogId, url: 'about:blank', alive: true, windows: ['w1'], current: 'w1' });
      return send(200, { sessionId: id, capabilities: { ...opts.caps(catalogId), 'browserlab:catalogId': catalogId } });
    }
    const m = path.match(/^\/session\/([^/]+)(\/.*)?$/);
    if (!m) return send(404, { error: 'unknown command', message: path, stacktrace: '' });
    const s = sessions.get(m[1]);
    const sub = m[2] ?? '';
    if (req.method === 'DELETE' && !sub) { if (s) s.alive = false; return send(200, null); }
    if (!s || !s.alive) return noSession();
    const catalogId = s.catalogId;
    switch (`${req.method} ${sub}`) {
      case 'GET /window': return send(200, s.current);
      case 'POST /window/new': { const h = `w${s.windows.length + 1}`; s.windows.push(h); return send(200, { handle: h, type: 'tab' }); }
      case 'POST /window': s.current = body.handle; return send(200, null);
      case 'DELETE /window': s.windows = s.windows.filter((w) => w !== s.current); return send(200, s.windows);
      case 'POST /url': s.url = body.url; return send(200, null);
      case 'GET /url': return send(200, s.url);
      case 'POST /timeouts': return send(200, null);
      case 'POST /window/rect': return send(200, { x: 0, y: 0, width: body.width ?? 1440, height: body.height ?? 900 });
      case 'GET /screenshot': return send(200, PNG.toString('base64'));
      case 'POST /se/file': {
        const z = await JSZip.loadAsync(Buffer.from(body.file, 'base64'));
        return send(200, `/tmp/stub-upload/${Object.keys(z.files)[0]}`);
      }
      case 'GET /se/files': return send(200, { names: Object.keys(downloads.get(m[1]) ?? {}) });
      case 'POST /se/files': {
        const data = downloads.get(m[1])?.[body.name];
        if (!data) return send(404, { error: 'no such element', message: 'missing', stacktrace: '' });
        const z = new JSZip(); z.file(body.name, data);
        return send(200, { filename: body.name, contents: (await z.generateAsync({ type: 'nodebuffer' })).toString('base64') });
      }
      case 'POST /execute/sync': {
        const script: string = body.script;
        if (script.includes('innerWidth')) return send(200, [1440, 900]);
        if (script.includes('navigatorPlatform')) return send(200, { navigatorPlatform: 'Linux x86_64', uaBrands: ['Chromium'] });
        if (script.includes('innerText') || script.includes('application-box')) return send(200, opts.executable(catalogId));
        if (script.includes('__stub_download__')) { downloads.set(m[1], { 'report.txt': Buffer.from('stub download') }); return send(200, null); }
        return send(200, null);
      }
      default: return send(404, { error: 'unknown command', message: `${req.method} ${sub}`, stacktrace: '' });
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const m = req.url?.match(/^\/session\/([^/]+)\/se\/vnc$/);
    if (!m || !sessions.get(m[1])?.alive) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(Buffer.from('RFB 003.008\n'));
      ws.on('message', (d: Buffer) => vncFrames.push(Buffer.from(d)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`, requests, sessions, vncFrames,
    kill: (id) => { const s = sessions.get(id); if (s) s.alive = false; },
    close: () => new Promise((r) => { wss.clients.forEach((c) => c.terminate()); server.closeAllConnections(); server.close(() => r()); }),
  };
}
