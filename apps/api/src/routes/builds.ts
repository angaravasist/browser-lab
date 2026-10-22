import type { FastifyInstance } from 'fastify';
import type { Ctx } from './context.ts';

let lastRefresh = 0;

export function buildRoutes(app: FastifyInstance, { catalog }: Ctx) {
  app.get('/api/browser-builds', async () => ({ gridRelease: catalog.gridRelease, builds: await catalog.builds() }));

  // Re-probes trusted, configured workers only. Never pulls or runs an image.
  app.post('/api/browser-builds/refresh', async (_req, reply) => {
    if (Date.now() - lastRefresh < 5000) return reply.code(429).send({ error: { code: 'CONFLICT', message: 'Refresh at most every 5 seconds.' } });
    lastRefresh = Date.now();
    catalog.resetVerification();
    return { gridRelease: catalog.gridRelease, builds: await catalog.builds(true) };
  });
}
