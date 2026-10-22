import Fastify, { type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { loadConfig, type Config } from './config.ts';
import { openDb } from './db/index.ts';
import { AppError } from './errors.ts';
import { Catalog } from './services/catalog.ts';
import { EvidenceStore } from './services/evidence.ts';
import { SessionService } from './services/sessions.ts';
import { redactUrl } from './services/urlPolicy.ts';
import { registerLiveRoute } from './selenium/liveRelay.ts';
import { healthRoutes } from './routes/health.ts';
import { buildRoutes } from './routes/builds.ts';
import { projectRoutes } from './routes/projects.ts';
import { sessionRoutes } from './routes/sessions.ts';
import { transferRoutes } from './routes/transfers.ts';
import { evidenceRoutes } from './routes/evidence.ts';
import { reportRoutes } from './routes/reports.ts';
import type { Ctx } from './routes/context.ts';

const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

export async function buildApp(cfg: Config = loadConfig()) {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: {
      level: cfg.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      // URLs can carry viewer tokens or third-party secrets in query strings.
      serializers: { req: (r: FastifyRequest) => ({ method: r.method, url: redactUrl(r.url) }) },
    },
  });
  const db = openDb(path.join(cfg.dataDir, 'browserlab.db'));
  const catalog = new Catalog(cfg, db);
  const evidence = new EvidenceStore(cfg.dataDir, db);
  const sessions = new SessionService(db, cfg, catalog, evidence, app.log);
  const ctx: Ctx = { db, cfg, catalog, sessions, evidence };

  // A loopback listener can still be targeted by DNS rebinding if Host is trusted blindly.
  // "app" is BrowserLab's internal Docker hostname used by the built-in fixture.
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'app']);
  const proxyHosts = new Set(cfg.publicOrigins.map((origin) => new URL(origin).hostname.toLowerCase()));
  const allowedHost = (rawHost: string | undefined): boolean => {
    // Reject malformed Host values without accidentally matching ordinary letters (e.g. the "s" in localhost).
    if (!rawHost || /\s/.test(rawHost) || ['@', '/', '\\', '#', '?', ','].some((part) => rawHost.includes(part))) return false;
    try {
      const hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
      return localHosts.has(hostname) || proxyHosts.has(hostname);
    } catch { return false; }
  };
  const allowedOrigin = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (!origin || !allowedHost(req.headers.host)) return false;
    if (cfg.publicOrigins.includes(origin)) return true;
    try {
      const url = new URL(origin);
      return ['http:', 'https:'].includes(url.protocol) && url.host === req.headers.host;
    } catch { return false; }
  };

  app.addContentTypeParser(['application/octet-stream', 'image/png'], { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  // CSRF guard: browsers send Origin on cross-site writes; the API is same-origin only.
  app.addHook('onRequest', async (req) => {
    if (!allowedHost(req.headers.host))
      throw new AppError('FORBIDDEN_ORIGIN', 'Untrusted Host header. Use localhost or a configured trusted origin.');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && !allowedOrigin(req))
      throw new AppError('FORBIDDEN_ORIGIN', 'Cross-origin requests are not allowed.');
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', CSP);
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.', details: err.issues } });
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 413 || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: { code: 'TRANSFER_TOO_LARGE', message: 'Request body too large.' } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: 'INVALID_REQUEST', message: e.message } });
    req.log.error({ err: e.message }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal error; see server logs.' } });
  });

  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  healthRoutes(app, ctx);
  buildRoutes(app, ctx);
  projectRoutes(app, ctx);
  sessionRoutes(app, ctx);
  transferRoutes(app, ctx);
  evidenceRoutes(app, ctx);
  reportRoutes(app, ctx);
  registerLiveRoute(app, {
    liveTarget: (id) => sessions.liveTarget(id),
    touch: (id) => sessions.touch(id),
    trackSocket: (id, close) => sessions.trackSocket(id, close),
    allowedOrigin,
  });
  if (existsSync(cfg.fixtureDir)) await app.register(fastifyStatic, { root: cfg.fixtureDir, prefix: '/fixture/', decorateReply: false });
  if (existsSync(cfg.webDist)) await app.register(fastifyStatic, { root: cfg.webDist, prefix: '/', decorateReply: false });

  app.addHook('onReady', async () => {
    const n = await sessions.reconcile();
    if (n) app.log.warn(`${n} session(s) left open by a previous run were released and marked interrupted`);
    evidence.cleanup(cfg.retentionDays);
    sessions.startTimers();
  });
  const retention = setInterval(() => evidence.cleanup(cfg.retentionDays), 6 * 3600_000);
  app.addHook('onClose', async () => { clearInterval(retention); await sessions.shutdown(); db.close(); });
  return app;
}

if (import.meta.main) {
  const cfg = loadConfig();
  const app = await buildApp(cfg);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { void app.close().then(() => process.exit(0)); });
  await app.listen({ port: cfg.port, host: cfg.host });
}
