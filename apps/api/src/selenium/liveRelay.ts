// Same-origin WebSocket relay from the BrowserLab viewer to exactly one session's VNC stream.
// No upstream address ever comes from the client: it is looked up from the stored BrowserLab session.
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import WebSocket from 'ws';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.ts';
import { ByteReader, authenticateUpstream, greetViewer } from './rfbAuth.ts';

export type LiveTarget =
  | { kind: 'grid'; url: string }
  | { kind: 'tcp'; host: string; port: number; password: string };

export interface LiveDeps {
  liveTarget(sessionId: string): LiveTarget; // throws AppError when the session is not running
  touch(sessionId: string): void;
  trackSocket(sessionId: string, close: () => void): () => void;
  allowedOrigin(req: FastifyRequest): boolean;
}

const TOKEN_TTL_MS = 60_000;
const tokens = new Map<string, { sessionId: string; expires: number }>();

export function issueViewToken(sessionId: string): string {
  for (const [t, v] of tokens) if (v.expires < Date.now()) tokens.delete(t);
  const token = randomBytes(24).toString('base64url');
  tokens.set(token, { sessionId, expires: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Single use: a token is deleted on first presentation, valid or not. */
export function consumeViewToken(token: string | undefined, sessionId: string): boolean {
  if (!token) return false;
  const v = tokens.get(token);
  tokens.delete(token);
  return !!v && v.sessionId === sessionId && v.expires >= Date.now();
}

export function registerLiveRoute(app: FastifyInstance, deps: LiveDeps) {
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/sessions/:id/live', {
    websocket: true,
    preValidation: async (req) => {
      const tokenOk = consumeViewToken(req.query.token, req.params.id); // burn it even if the Origin check fails
      if (!deps.allowedOrigin(req)) throw new AppError('FORBIDDEN_ORIGIN', 'Viewer connections must come from the BrowserLab page itself.');
      if (!tokenOk) throw new AppError('VIEWER_UNAVAILABLE', 'Viewer token missing, expired or already used. Reload the viewer.');
      deps.liveTarget(req.params.id);
    },
  }, (client, req) => {
    const id = req.params.id;
    let target: LiveTarget;
    try { target = deps.liveTarget(id); } catch { client.close(4001, 'session not running'); return; }
    let closed = false;
    let lastTouch = 0;
    const closers: Array<() => void> = [];
    const close = (code = 1000, reason = '') => {
      if (closed) return;
      closed = true;
      closers.forEach((c) => c());
      if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    };
    closers.push(deps.trackSocket(id, () => close(4002, 'session ended')));
    const ping = setInterval(() => {
      if ((client as WebSocket & { alive?: boolean }).alive === false) return client.terminate();
      (client as WebSocket & { alive?: boolean }).alive = false;
      client.ping();
    }, 30_000);
    closers.push(() => clearInterval(ping));
    client.on('pong', () => { (client as WebSocket & { alive?: boolean }).alive = true; });
    client.on('close', () => close());
    client.on('error', () => close());
    const userInput = () => { if (Date.now() - lastTouch > 15_000) { lastTouch = Date.now(); deps.touch(id); } };

    if (target.kind === 'grid') {
      const pending: Buffer[] = [];
      const up = new WebSocket(target.url, { perMessageDeflate: false });
      closers.push(() => up.close());
      client.on('message', (d: Buffer) => { userInput(); if (up.readyState === WebSocket.OPEN) up.send(d); else pending.push(d); });
      up.on('open', () => { for (const d of pending.splice(0)) up.send(d); });
      up.on('message', (d: Buffer) => { if (client.readyState === WebSocket.OPEN) client.send(d); });
      up.on('close', () => close(4003, 'browser desktop closed'));
      up.on('error', () => close(4004, 'browser desktop unreachable'));
      return;
    }

    const sock = net.connect(target.port, target.host);
    closers.push(() => sock.destroy());
    const upR = new ByteReader();
    const viewR = new ByteReader();
    let piping = false;
    sock.on('data', (d) => (piping ? client.send(d) : upR.push(d)));
    sock.on('error', (e) => { upR.fail(e); close(4004, 'worker desktop unreachable'); });
    sock.on('close', () => close(4003, 'worker desktop closed'));
    client.on('message', (d: Buffer) => { if (piping) { userInput(); sock.write(d); } else viewR.push(d); });
    (async () => {
      await authenticateUpstream(upR, (b) => sock.write(b), target.password);
      await greetViewer(viewR, (b) => client.send(b));
      piping = true;
      const early = upR.drain(); if (early.length) client.send(early);
      const fromViewer = viewR.drain(); if (fromViewer.length) sock.write(fromViewer);
    })().catch((e: Error) => { req.log.warn({ session: id, err: e.message }, 'viewer handshake failed'); close(4005, 'desktop authentication failed'); });
  });
}
