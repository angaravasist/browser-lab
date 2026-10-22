import type { FastifyInstance } from 'fastify';
import { EnvironmentSchema, PolicySchema, ProjectExportSchema, ProjectSchema, type PolicyTarget } from '@browserlab/shared';
import { now, uuid } from '../db/index.ts';
import { fail } from '../errors.ts';
import { checkTargetUrl } from '../services/urlPolicy.ts';
import type { Ctx } from './context.ts';

type P = { Params: { id: string } };

export function projectRoutes(app: FastifyInstance, { db, cfg, catalog }: Ctx) {
  const project = (id: string) => (db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any) ?? fail('NOT_FOUND', 'Project not found.');
  const envs = (id: string) => (db.prepare('SELECT id, name, base_url baseUrl, is_default isDefault, created_at createdAt FROM environments WHERE project_id = ? ORDER BY name').all(id) as any[]).map((e) => ({ ...e, isDefault: !!e.isDefault }));
  const policy = (id: string): PolicyTarget[] => (db.prepare('SELECT family, channel, requested_version requestedVersion, target_os targetOs, kind, required FROM browser_targets WHERE project_id = ? ORDER BY family, requested_version').all(id) as any[]).map((t) => ({ ...t, required: !!t.required }));

  const insertEnv = (projectId: string, e: { name: string; baseUrl: string; isDefault: boolean }) => {
    const url = checkTargetUrl(e.baseUrl, cfg.trustedPrivateUrls).url;
    const id = uuid();
    db.transaction(() => {
      if (e.isDefault) db.prepare('UPDATE environments SET is_default = 0 WHERE project_id = ?').run(projectId);
      db.prepare('INSERT INTO environments (id, project_id, name, base_url, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, e.name, url, e.isDefault ? 1 : 0, now());
    })();
    return id;
  };
  const replacePolicy = (projectId: string, targets: PolicyTarget[]) => db.transaction(() => {
    db.prepare('DELETE FROM browser_targets WHERE project_id = ?').run(projectId);
    const ins = db.prepare('INSERT INTO browser_targets (id, project_id, family, channel, requested_version, target_os, kind, required, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const t of targets) ins.run(uuid(), projectId, t.family, t.channel, t.requestedVersion, t.targetOs, t.kind, t.required ? 1 : 0, now());
  })();

  app.get('/api/projects', async () => db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) sessions FROM projects p ORDER BY p.updated_at DESC`).all());
  app.post('/api/projects', async (req, reply) => {
    const b = ProjectSchema.parse(req.body);
    const id = uuid(), t = now();
    db.prepare('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, b.name, b.description, t, t);
    return reply.code(201).send(project(id));
  });
  app.get<P>('/api/projects/:id', async (req) => ({ ...project(req.params.id), environments: envs(req.params.id), policy: policy(req.params.id) }));
  app.patch<P>('/api/projects/:id', async (req) => {
    project(req.params.id);
    const b = ProjectSchema.partial().parse(req.body);
    db.prepare('UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ? WHERE id = ?').run(b.name ?? null, b.description ?? null, now(), req.params.id);
    return project(req.params.id);
  });
  // Deleting a project keeps its session history (project link is cleared) so evidence is never silently lost.
  app.delete<P>('/api/projects/:id', async (req, reply) => { project(req.params.id); db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id); return reply.code(204).send(); });

  app.get<P>('/api/projects/:id/environments', async (req) => { project(req.params.id); return envs(req.params.id); });
  app.post<P>('/api/projects/:id/environments', async (req, reply) => {
    project(req.params.id);
    const id = insertEnv(req.params.id, EnvironmentSchema.parse(req.body));
    return reply.code(201).send(envs(req.params.id).find((e) => e.id === id));
  });
  app.patch<{ Params: { id: string; envId: string } }>('/api/projects/:id/environments/:envId', async (req) => {
    const b = EnvironmentSchema.partial().parse(req.body);
    const cur = (db.prepare('SELECT * FROM environments WHERE id = ? AND project_id = ?').get(req.params.envId, req.params.id) as any) ?? fail('NOT_FOUND', 'Environment not found.');
    const url = b.baseUrl ? checkTargetUrl(b.baseUrl, cfg.trustedPrivateUrls).url : cur.base_url;
    db.transaction(() => {
      if (b.isDefault) db.prepare('UPDATE environments SET is_default = 0 WHERE project_id = ?').run(req.params.id);
      db.prepare('UPDATE environments SET name = ?, base_url = ?, is_default = ? WHERE id = ?').run(b.name ?? cur.name, url, b.isDefault === undefined ? cur.is_default : b.isDefault ? 1 : 0, cur.id);
    })();
    return envs(req.params.id).find((e) => e.id === cur.id);
  });
  app.delete<{ Params: { id: string; envId: string } }>('/api/projects/:id/environments/:envId', async (req, reply) => {
    const r = db.prepare('DELETE FROM environments WHERE id = ? AND project_id = ?').run(req.params.envId, req.params.id);
    if (!r.changes) fail('NOT_FOUND', 'Environment not found.');
    return reply.code(204).send();
  });

  app.get<P>('/api/projects/:id/policy', async (req) => { project(req.params.id); return { targets: policy(req.params.id) }; });
  app.put<P>('/api/projects/:id/policy', async (req) => {
    project(req.params.id);
    const b = PolicySchema.parse(req.body);
    replacePolicy(req.params.id, b.targets);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), req.params.id);
    return { targets: policy(req.params.id) };
  });

  app.get<P>('/api/projects/:id/matrix', async (req) => {
    project(req.params.id);
    const builds = await catalog.builds();
    const latest = db.prepare(`SELECT s.id, s.state, s.actual_browser_version, s.started_at, s.failure_code, s.failure_message, r.outcome, r.checked_at,
        (SELECT COUNT(*) FROM evidence e WHERE e.session_id = s.id) evidence
      FROM sessions s LEFT JOIN results r ON r.session_id = s.id WHERE s.project_id = ? AND s.browser_build_id = ? ORDER BY s.started_at DESC LIMIT 1`);
    return policy(req.params.id).map((t) => {
      const candidates = t.kind === 'newest-provisioned'
        ? builds.filter((b) => b.family === t.family && b.platformName === t.targetOs && b.channel === 'stable' && b.availability === 'ready').sort((a, b) => Number(b.requestedVersion) - Number(a.requestedVersion)).slice(0, 1)
        : builds.filter((b) => b.family === t.family && b.channel === t.channel && b.requestedVersion === t.requestedVersion && b.platformName === t.targetOs);
      if (!candidates.length) return { target: t, build: null, availability: 'not-provisioned', reason: t.kind === 'newest-provisioned' ? `No ${t.family} build is ready on any worker.` : 'No catalogue build exists for this version. See docs/ADD-BROWSER-VERSION.md.', last: null };
      const b = candidates.find((c) => c.availability === 'ready') ?? candidates[0];
      const last = latest.get(req.params.id, b.id) as any;
      return {
        target: t, build: { id: b.id, brand: b.brand, requestedVersion: b.requestedVersion, channel: b.channel, architectures: b.architectures, workerArch: b.workerArch }, availability: b.availability, reason: b.reason,
        last: last ? { sessionId: last.id, state: last.state, outcome: last.outcome ?? 'not-run', actualVersion: last.actual_browser_version, testedAt: last.checked_at ?? last.started_at, evidence: last.evidence, failure: last.failure_message } : null,
      };
    });
  });

  // Export/import policy and environments only; never credentials or results.
  app.get<P>('/api/projects/:id/export', async (req, reply) => {
    const p = project(req.params.id);
    reply.header('content-disposition', `attachment; filename="browserlab-project-${p.name.replace(/[^\w-]+/g, '_').slice(0, 40)}.json"`);
    return { format: 'browserlab-project/v1', project: { name: p.name, description: p.description }, environments: envs(p.id).map(({ name, baseUrl, isDefault }) => ({ name, baseUrl, isDefault })), policy: { targets: policy(p.id) } };
  });
  app.post('/api/projects/import', { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const b = ProjectExportSchema.parse(req.body);
    const id = uuid(), t = now();
    db.transaction(() => {
      db.prepare('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, b.project.name, b.project.description, t, t);
      for (const e of b.environments) insertEnv(id, e);
      replacePolicy(id, b.policy.targets);
    })();
    return reply.code(201).send({ ...project(id), environments: envs(id), policy: policy(id) });
  });
}
