import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateSessionSchema, ResultSchema, ViewportSchema, OUTCOMES } from '@browserlab/shared';
import { issueViewToken } from '../selenium/liveRelay.ts';
import { isPng } from '../services/evidence.ts';
import { queryReport } from '../services/reports.ts';
import { fail } from '../errors.ts';
import type { Ctx } from './context.ts';

type P = { Params: { id: string } };
const ListQuery = z.object({
  projectId: z.string().optional(), family: z.string().optional(), outcome: z.enum(OUTCOMES).optional(), buildLabel: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(), tester: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).default(0),
});

export function sessionRoutes(app: FastifyInstance, { sessions, evidence, db, catalog, cfg }: Ctx) {
  app.post('/api/sessions', async (req, reply) => reply.code(202).send(await sessions.create(CreateSessionSchema.parse(req.body))));
  app.get('/api/sessions', async (req) => queryReport(db, catalog, ListQuery.parse(req.query)));
  app.get<P & { Querystring: { refresh?: string } }>('/api/sessions/:id', async (req) => {
    if (req.query.refresh) await sessions.refreshUrl(req.params.id);
    return sessions.view(req.params.id);
  });
  app.delete<P>('/api/sessions/:id', async (req) => sessions.close(req.params.id));
  app.post<P>('/api/sessions/:id/heartbeat', async (req, reply) => { sessions.heartbeat(req.params.id); return reply.code(204).send(); });
  app.post<P>('/api/sessions/:id/viewport', async (req) => sessions.setViewport(req.params.id, ViewportSchema.parse(req.body)));
  app.post<P>('/api/sessions/:id/screenshot', async (req, reply) => {
    const b = z.object({ caption: z.string().max(500).optional() }).parse(req.body ?? {});
    return reply.code(201).send(await sessions.screenshot(req.params.id, b.caption));
  });
  // Whole-desktop capture taken by the viewer (needed for Safari after manual handover). Stored labelled as 'vnc-desktop'.
  app.post<P>('/api/sessions/:id/desktop-capture', { bodyLimit: cfg.maxScreenshotBytes }, async (req, reply) => {
    const png = req.body as Buffer;
    if (!Buffer.isBuffer(png) || !isPng(png)) fail('INVALID_REQUEST', 'Body must be a PNG image (Content-Type: image/png).');
    const caption = typeof req.headers['x-caption'] === 'string' ? decodeURIComponent(req.headers['x-caption']).slice(0, 500) : undefined;
    return reply.code(201).send(sessions.desktopCapture(req.params.id, png, caption));
  });
  app.post<P>('/api/sessions/:id/result', async (req) => sessions.saveResult(req.params.id, ResultSchema.parse(req.body)));
  app.post<P>('/api/sessions/:id/view-token', async (req) => { sessions.liveTarget(req.params.id); return { token: issueViewToken(req.params.id), expiresInSeconds: 60 }; });
  app.get<P>('/api/sessions/:id/evidence', async (req) => { sessions.row(req.params.id); return evidence.list(req.params.id); });
}
