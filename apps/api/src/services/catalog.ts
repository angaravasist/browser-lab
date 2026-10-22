import { readFileSync } from 'node:fs';
import { CatalogSchema, ACTIVE_STATES, type BrowserBuild, type CatalogEntry, type Family } from '@browserlab/shared';
import type { DB } from '../db/index.ts';
import { now } from '../db/index.ts';
import type { Config } from '../config.ts';
import { fail } from '../errors.ts';
import { gridStatus, type GridStatus } from '../selenium/grid.ts';

const ACTIVE_SQL = ACTIVE_STATES.map((s) => `'${s}'`).join(',');
const byVersionDesc = (a: CatalogEntry, b: CatalogEntry) => Number(b.requestedVersion) - Number(a.requestedVersion);

export class Catalog {
  readonly entries: CatalogEntry[];
  readonly gridRelease: string;
  private probe: { at: number; status: Record<string, GridStatus | Error> } | null = null;
  private db: DB;
  private cfg: Config;

  constructor(cfg: Config, db: DB) {
    this.cfg = cfg;
    this.db = db;
    const parsed = CatalogSchema.parse(JSON.parse(readFileSync(cfg.catalogPath, 'utf8')));
    const ids = new Set<string>();
    for (const e of parsed.entries) { if (ids.has(e.id)) throw new Error(`duplicate catalogue id ${e.id}`); ids.add(e.id); new RegExp(e.versionMatch); }
    this.entries = parsed.entries;
    this.gridRelease = parsed.gridRelease;
  }

  get(id: string): CatalogEntry {
    return this.entries.find((e) => e.id === id) ?? fail('BROWSER_NOT_PROVISIONED', `Unknown browser build "${id}".`);
  }

  gridUrl(worker: string): string {
    return this.cfg.grids[worker] ?? fail('WORKER_OFFLINE', `Worker "${worker}" is not configured (BROWSERLAB_GRID_URLS).`);
  }

  async gridStatuses(force = false): Promise<Record<string, GridStatus | Error>> {
    if (!force && this.probe && Date.now() - this.probe.at < this.cfg.probeCacheMs) return this.probe.status;
    const status: Record<string, GridStatus | Error> = {};
    await Promise.all(Object.entries(this.cfg.grids).map(async ([name, url]) => {
      try { status[name] = await gridStatus(url); } catch (e) { status[name] = e as Error; }
    }));
    const upsert = this.db.prepare(`INSERT INTO workers (id, provider, os, architecture, capabilities_json, last_seen, status) VALUES (@id, @provider, @os, @arch, @caps, @seen, @status)
      ON CONFLICT(id) DO UPDATE SET os = excluded.os, architecture = excluded.architecture, capabilities_json = excluded.capabilities_json, last_seen = COALESCE(excluded.last_seen, workers.last_seen), status = excluded.status`);
    for (const [name, s] of Object.entries(status)) {
      const node = s instanceof Error ? undefined : s.nodes[0];
      upsert.run({ id: name, provider: 'selenium-grid', os: node?.os ?? null, arch: node?.arch ?? null, caps: JSON.stringify({ catalogIds: node ? [...new Set(node.slots.map((x) => x.catalogId).filter(Boolean))] : [] }), seen: s instanceof Error ? null : now(), status: s instanceof Error ? 'offline' : s.ready ? 'online' : 'not-ready' });
    }
    this.probe = { at: Date.now(), status };
    return status;
  }

  async builds(force = false): Promise<BrowserBuild[]> {
    const statuses = await this.gridStatuses(force);
    const active = new Map((this.db.prepare(`SELECT browser_build_id id, COUNT(*) n FROM sessions WHERE state IN (${ACTIVE_SQL}) GROUP BY browser_build_id`).all() as Array<{ id: string; n: number }>).map((r) => [r.id, r.n]));
    const totalActive = [...active.values()].reduce((a, b) => a + b, 0);
    const verified = new Map((this.db.prepare('SELECT id, verified_status, verification_message, actual_version, last_verified_at FROM browser_builds').all() as any[]).map((r) => [r.id, r]));
    return this.entries.map((e) => {
      const v = verified.get(e.id);
      // Any configured worker that advertises this exact build may serve it (e.g. a dedicated amd64 worker); else the entry's default worker explains why not.
      const worker = Object.entries(statuses).find(([, st]) => !(st instanceof Error) && st.nodes.some((n) => n.slots.some((x) => x.catalogId === e.id)))?.[0] ?? e.worker;
      const base = { ...e, worker, activeSessions: active.get(e.id) ?? 0, lastVerifiedVersion: v?.actual_version ?? undefined, lastVerifiedAt: v?.last_verified_at ?? undefined };
      const s = statuses[worker];
      const at = this.probe ? new Date(this.probe.at).toISOString() : undefined;
      const mk = (availability: BrowserBuild['availability'], reason: string, workerArch?: string): BrowserBuild => ({ ...base, availability, reason, workerArch, lastProbeAt: at });
      if (!s) return mk('offline', `Worker "${e.worker}" is not configured. ${e.provider === 'safari-relay' ? 'Safari needs a separate Mac worker: see docs/SAFARI-WORKER.md. Not run: compatible macOS host unavailable.' : 'Add it to BROWSERLAB_GRID_URLS.'}`);
      if (s instanceof Error) return mk('offline', `Worker "${e.worker}" is unreachable (GRID_UNAVAILABLE).`);
      const node = s.nodes.find((n) => n.slots.some((x) => x.catalogId === e.id));
      const arch = node?.arch ?? s.nodes[0]?.arch;
      if (!node) {
        if (arch && !e.architectures.includes(arch as 'amd64')) return mk('unsupported-architecture', `Needs ${e.architectures.join(' or ')}; this worker is ${arch}. Use a dedicated ${e.architectures[0]} worker (docs/INSTALLATION.md#remote-amd64-worker). Emulation is not offered.`, arch);
        return mk('not-provisioned', e.gridProfile === 'legacy' ? 'Not in the active Grid profile. Start with compose.legacy-amd64.yaml (docs/ADD-BROWSER-VERSION.md).' : 'This worker does not advertise this build.', arch);
      }
      if (e.provider === 'safari-relay') {
        if (!this.cfg.safariVnc) return mk('not-provisioned', 'No live Mac desktop configured (BROWSERLAB_SAFARI_VNC). Manual testing needs one; see docs/SAFARI-WORKER.md.', arch);
        if (!e.interactiveVerifiedAt && process.env.BROWSERLAB_SAFARI_VALIDATION_MODE !== 'true')
          return mk('not-provisioned', 'Safari worker reachable but no interactive run has been recorded. Run the validation in docs/SAFARI-WORKER.md first.', arch);
      }
      if (v?.verified_status === 'verification-failed') return mk('verification-failed', `Last start did not match: ${v.verification_message}. Refresh to retry.`, arch);
      if (base.activeSessions >= e.maxConcurrentSessions || totalActive >= this.cfg.maxConcurrent || !node.slots.some((x) => x.catalogId === e.id && !x.busy))
        return mk('busy', 'All sessions for this build are in use. End a session or wait.', arch);
      const validation = e.provider === 'safari-relay' && !e.interactiveVerifiedAt ? 'VALIDATION MODE: not yet verified interactively.' : '';
      return mk('ready', validation || 'Ready to launch.', arch);
    });
  }

  /** Clears a previous verification failure so the next launch re-verifies deliberately. */
  resetVerification() { this.db.prepare(`UPDATE browser_builds SET verified_status = 'unverified' WHERE verified_status = 'verification-failed'`).run(); this.probe = null; }

  /** Resolves a launch target to one catalogue entry. "newest-provisioned" means newest READY build here, not the vendor's latest release. */
  async resolve(target: { catalogId: string } | { family: Family; strategy: 'newest-provisioned' } | { family: Family; strategy: 'minimum'; projectId: string }): Promise<CatalogEntry> {
    if ('catalogId' in target) return this.get(target.catalogId);
    const ready = (await this.builds()).filter((b) => b.family === target.family && b.availability === 'ready');
    if (target.strategy === 'newest-provisioned') {
      return ready.filter((b) => b.channel === 'stable').sort(byVersionDesc)[0] ?? fail('BROWSER_NOT_PROVISIONED', `No ${target.family} build is ready on any worker.`);
    }
    const t = this.db.prepare(`SELECT channel, requested_version v, target_os os FROM browser_targets WHERE project_id = ? AND family = ? AND kind = 'minimum'`).get(target.projectId, target.family) as { channel: string; v: string; os: string } | undefined;
    if (!t) fail('INVALID_REQUEST', `The project has no minimum ${target.family} version in its policy.`);
    const all = this.entries.filter((e) => e.family === target.family && e.channel === t!.channel && e.requestedVersion === t!.v && e.platformName === t!.os);
    if (!all.length) fail('BROWSER_NOT_PROVISIONED', `No catalogue build exists for ${target.family} ${t!.v} ${t!.channel} on ${t!.os}. See docs/ADD-BROWSER-VERSION.md.`);
    return all.find((e) => ready.some((r) => r.id === e.id)) ?? all[0];
  }
}
