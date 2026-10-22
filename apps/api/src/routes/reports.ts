import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OUTCOMES } from '@browserlab/shared';
import { queryReport, toCsv, toHtml } from '../services/reports.ts';
import type { Ctx } from './context.ts';

const Filter = z.object({
  projectId: z.string().optional(), buildLabel: z.string().optional(), family: z.string().optional(), catalogId: z.string().optional(),
  outcome: z.enum(OUTCOMES).optional(), from: z.string().optional(), to: z.string().optional(), tester: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000), offset: z.coerce.number().int().min(0).default(0),
});

export function reportRoutes(app: FastifyInstance, { db, catalog, evidence }: Ctx) {
  app.get('/api/reports', async (req) => queryReport(db, catalog, Filter.parse(req.query)));
  app.get<{ Querystring: Record<string, string> }>('/api/reports/export', async (req, reply) => {
    const format = z.enum(['json', 'csv', 'html']).parse(req.query.format ?? 'json');
    const rows = queryReport(db, catalog, Filter.parse(req.query));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reply.header('content-disposition', `attachment; filename="browserlab-report-${stamp}.${format}"`);
    if (format === 'csv') return reply.type('text/csv; charset=utf-8').send(toCsv(rows));
    if (format === 'html') return reply.type('text/html; charset=utf-8').send(toHtml(db, evidence.dir, rows, 'BrowserLab compatibility report'));
    return { format: 'browserlab-report/v1', generatedAt: new Date().toISOString(), rows };
  });
}
