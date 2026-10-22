import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from './context.ts';

export function evidenceRoutes(app: FastifyInstance, { evidence }: Ctx) {
  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/evidence/:id/download', async (req, reply) => {
    const { row, path } = evidence.file(req.params.id);
    const inline = row.mime_type === 'image/png' && !req.query.download;
    const name = row.mime_type === 'image/png' ? `browserlab-${row.id}.png` : (row.caption || `browserlab-${row.id}.bin`).replace(/[^\w.\- ()]/g, '_');
    return reply
      .header('content-type', row.mime_type === 'image/png' ? 'image/png' : 'application/octet-stream')
      .header('content-length', row.byte_size)
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`)
      .header('x-content-sha256', row.sha256)
      .send(createReadStream(path));
  });
}
