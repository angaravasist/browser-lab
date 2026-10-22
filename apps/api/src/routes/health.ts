import type { FastifyInstance } from 'fastify';
import { ACTIVE_STATES } from '@browserlab/shared';
import type { Ctx } from './context.ts';

export function healthRoutes(app: FastifyInstance, { db, cfg, catalog }: Ctx) {
  // No secrets: grid URLs are reported by worker name only.
  app.get('/api/health', async () => {
    const statuses = await catalog.gridStatuses();
    const active = (db.prepare(`SELECT COUNT(*) n FROM sessions WHERE state IN (${ACTIVE_STATES.map((s) => `'${s}'`).join(',')})`).get() as { n: number }).n;
    return {
      status: 'ok',
      db: (db.prepare('SELECT 1 ok').get() as { ok: number }).ok === 1 ? 'ok' : 'error',
      gridRelease: catalog.gridRelease,
      workers: Object.entries(statuses).map(([name, s]) => (s instanceof Error
        ? { name, status: 'offline', code: 'GRID_UNAVAILABLE' }
        : { name, status: s.ready ? 'ready' : 'not-ready', arch: s.nodes[0]?.arch, os: s.nodes[0]?.os, slots: s.nodes.reduce((n, x) => n + x.slots.length, 0) })),
      sessions: { active, max: cfg.maxConcurrent },
      limits: { idleMinutes: cfg.idleMs / 60000, maxSessionMinutes: cfg.maxSessionMs / 60000, maxTransferMB: cfg.maxTransferBytes / 1048576, retentionDays: cfg.retentionDays, trustedPrivateUrls: cfg.trustedPrivateUrls },
      safari: { desktopConfigured: !!cfg.safariVnc },
    };
  });
}
