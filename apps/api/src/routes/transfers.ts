import type { FastifyInstance } from 'fastify';
import { fail } from '../errors.ts';
import type { Ctx } from './context.ts';

type P = { Params: { id: string } };
type PN = { Params: { id: string; name: string } };

export function transferRoutes(app: FastifyInstance, { sessions, cfg }: Ctx) {
  // Stages one local file inside the remote browser's node; the user then picks it in the browser's own file chooser.
  app.post<P>('/api/sessions/:id/files', { bodyLimit: cfg.maxTransferBytes }, async (req, reply) => {
    const name = req.headers['x-filename'];
    if (typeof name !== 'string' || !name) fail('INVALID_REQUEST', 'Missing X-Filename header.');
    if (!Buffer.isBuffer(req.body)) fail('INVALID_REQUEST', 'Body must be the raw file (Content-Type: application/octet-stream).');
    return reply.code(201).send(await sessions.upload(req.params.id, decodeURIComponent(name as string), req.body as Buffer));
  });
  app.get<P>('/api/sessions/:id/downloads', async (req) => ({ names: await sessions.downloads(req.params.id) }));
  app.get<PN>('/api/sessions/:id/downloads/:name', async (req, reply) => {
    const f = await sessions.download(req.params.id, req.params.name);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${f.name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .send(f.data);
  });
  app.post<PN>('/api/sessions/:id/downloads/:name/evidence', async (req, reply) => reply.code(201).send(await sessions.saveDownloadAsEvidence(req.params.id, req.params.name)));
}
