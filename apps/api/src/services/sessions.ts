import JSZip from 'jszip';
import webdriver from 'selenium-webdriver';
import { ACTIVE_STATES, EMULATION_LABEL, FINAL_STATES, type CatalogEntry, type CreateSession, type SessionState, type SessionView, type Verification } from '@browserlab/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db/index.ts';
import { now, uuid } from '../db/index.ts';
import type { Config } from '../config.ts';
import { AppError, fail } from '../errors.ts';
import type { Catalog } from './catalog.ts';
import type { EvidenceStore } from './evidence.ts';
import { checkTargetUrl, redactSecrets, redactUrl } from './urlPolicy.ts';
import { createDriver, deleteGridSession, gridHasSession, gridStatus, sessionCaps, vncWsUrl, gridCommand, type Driver } from '../selenium/grid.ts';
import { buildCapabilities } from '../selenium/capabilities.ts';
import { collectFacts, evaluate } from '../selenium/verify.ts';
import type { LiveTarget } from '../selenium/liveRelay.ts';

const { error: wdError } = webdriver;
const ACTIVE_SQL = ACTIVE_STATES.map((s) => `'${s}'`).join(',');
const isFinal = (s: string) => (FINAL_STATES as readonly string[]).includes(s);
const QUIT_TIMEOUT_MS = 90_000;

/** Allowed predecessors for each state. Every change goes through transition(), which enforces this atomically. */
const FROM: Record<SessionState, SessionState[]> = {
  requested: [], validating: ['requested'], queued: ['validating', 'requested'],
  provisioning: ['queued'], starting: ['provisioning'], verifying: ['starting'], running: ['verifying'],
  closing: ['queued', 'provisioning', 'starting', 'verifying', 'running'],
  completed: ['closing'],
  'failed-to-start': ['requested', 'validating', 'queued', 'provisioning', 'starting', 'verifying', 'closing'],
  expired: ['closing', 'running'],
  interrupted: ['queued', 'provisioning', 'starting', 'verifying', 'running', 'closing'],
  'closed-with-error': ['closing'],
};

interface Live { driver?: Driver; gridUrl: string; entry: CatalogEntry; keepalive?: NodeJS.Timeout; sockets: Set<() => void>; currentUrl?: string; cancelled?: boolean }
export interface SessionRow {
  id: string; project_id: string | null; environment_id: string | null; browser_build_id: string; worker_id: string; target_url: string;
  requested_version: string; actual_browser_version: string | null; actual_os: string | null; actual_arch: string | null; grid_session_id: string | null;
  state: SessionState; driver_state: 'attached' | 'detached' | 'none'; started_at: string; ended_at: string | null; last_activity_at: string;
  failure_code: string | null; failure_message: string | null; navigation_error: string | null; viewport_width: number; viewport_height: number;
  effective_width: number | null; effective_height: number | null; build_label: string | null; tester: string | null; verification_json: string | null;
}

export class SessionService {
  private live = new Map<string, Live>();
  private timer?: NodeJS.Timeout;
  private db: DB; private cfg: Config; private catalog: Catalog; private evidence: EvidenceStore; private log: FastifyBaseLogger;

  constructor(db: DB, cfg: Config, catalog: Catalog, evidence: EvidenceStore, log: FastifyBaseLogger) {
    this.db = db; this.cfg = cfg; this.catalog = catalog; this.evidence = evidence; this.log = log;
  }

  row(id: string): SessionRow {
    return (this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined) ?? fail('NOT_FOUND', 'Session not found.');
  }

  transition(id: string, to: SessionState, fields: Partial<SessionRow> = {}): boolean {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`);
    if (isFinal(to)) sets.push('ended_at = @ended_at');
    const sql = `UPDATE sessions SET state = @to${sets.length ? ', ' + sets.join(', ') : ''} WHERE id = @id AND state IN (${FROM[to].map((s) => `'${s}'`).join(',') || "''"})`;
    return this.db.prepare(sql).run({ ...fields, to, id, ended_at: now() }).changes > 0;
  }

  async create(input: CreateSession): Promise<{ id: string; warnings: string[] }> {
    const url = checkTargetUrl(input.targetUrl, this.cfg.trustedPrivateUrls);
    const entry = await this.catalog.resolve(input.target);
    const build = (await this.catalog.builds()).find((b) => b.id === entry.id)!;
    if (build.availability !== 'ready') {
      const code = ({ 'unsupported-architecture': 'UNSUPPORTED_ARCH', offline: 'WORKER_OFFLINE', busy: 'NO_SESSION_CAPACITY', 'verification-failed': 'BROWSER_VERSION_MISMATCH' } as const)[build.availability as 'offline'] ?? 'BROWSER_NOT_PROVISIONED';
      fail(code, build.reason);
    }
    const gridUrl = this.catalog.gridUrl(build.worker);
    if (input.projectId && !this.db.prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId)) fail('NOT_FOUND', 'Project not found.');
    if (input.environmentId && !this.db.prepare('SELECT id FROM environments WHERE id = ? AND project_id IS ?').get(input.environmentId, input.projectId ?? null)) fail('NOT_FOUND', 'Environment not found in this project.');

    const id = uuid();
    // Capacity check and reservation in one transaction: two concurrent launches cannot both take the last slot.
    this.db.transaction(() => {
      const total = (this.db.prepare(`SELECT COUNT(*) n FROM sessions WHERE state IN (${ACTIVE_SQL})`).get() as { n: number }).n;
      const forEntry = (this.db.prepare(`SELECT COUNT(*) n FROM sessions WHERE state IN (${ACTIVE_SQL}) AND browser_build_id = ?`).get(entry.id) as { n: number }).n;
      if (total >= this.cfg.maxConcurrent) fail('NO_SESSION_CAPACITY', `All ${this.cfg.maxConcurrent} session slots are in use. End a session first.`);
      if (forEntry >= entry.maxConcurrentSessions) fail('NO_SESSION_CAPACITY', `${entry.brand} ${entry.requestedVersion} allows ${entry.maxConcurrentSessions} concurrent session(s).`);
      const t = now();
      this.db.prepare(`INSERT INTO sessions (id, project_id, environment_id, browser_build_id, worker_id, target_url, requested_version, state, started_at, last_activity_at, viewport_width, viewport_height, build_label, tester)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`).run(id, input.projectId ?? null, input.environmentId ?? null, entry.id, build.worker, redactSecrets(url.url),
        `${entry.requestedVersion}${entry.channel === 'esr' ? ' ESR' : ''}`, t, t, input.viewport.width, input.viewport.height, input.buildLabel ?? null, input.tester ?? null);
    })();
    this.live.set(id, { gridUrl, entry, sockets: new Set() });
    this.start(id, entry, url.url, input.viewport).catch((e) => this.log.error({ session: id, err: (e as Error).message }, 'session start crashed'));
    return { id, warnings: url.warnings };
  }

  private async start(id: string, entry: CatalogEntry, url: string, vp: { width: number; height: number }) {
    const live = this.live.get(id)!;
    const startFail = async (code: string, message: string) => {
      if (live.driver) await this.quietQuit(live.driver);
      this.transition(id, 'failed-to-start', { failure_code: code, failure_message: message, driver_state: 'none' });
      this.release(id);
    };
    this.transition(id, 'provisioning');
    let driver: Driver;
    try {
      const pending = createDriver(live.gridUrl, buildCapabilities(entry));
      // If we give up waiting, still quit the session whenever it does arrive: no orphaned containers.
      const timeout = new Promise<never>((_, rej) => setTimeout(() => { pending.then((d) => this.quietQuit(d), () => undefined); rej(new AppError('SESSION_START_TIMEOUT', `The browser did not start within ${this.cfg.sessionStartTimeoutMs / 1000}s. The first launch of a build may still be pulling its image; try again shortly.`)); }, this.cfg.sessionStartTimeoutMs));
      driver = await Promise.race([pending, timeout]);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err instanceof AppError) return startFail(err.code, err.message);
      const msg = err.message ?? String(e);
      if (/ECONNREFUSED|ENOTFOUND|fetch failed|EAI_AGAIN|socket hang up/i.test(msg)) return startFail('GRID_UNAVAILABLE', 'The browser grid is not reachable. Check `docker compose ps`.');
      if (err instanceof wdError.SessionNotCreatedError) return startFail('BROWSER_NOT_PROVISIONED', `The grid could not start ${entry.brand} ${entry.requestedVersion}: ${msg.split('\n')[0]}`);
      return startFail('GRID_UNAVAILABLE', msg.split('\n')[0]);
    }
    live.driver = driver;
    const gridId = (await driver.getSession()).getId();
    if (live.cancelled || !this.transition(id, 'starting', { grid_session_id: gridId, driver_state: 'attached' })) { await this.quietQuit(driver); this.release(id); return; }

    try {
      this.transition(id, 'verifying');
      const caps = await sessionCaps(driver);
      let nodeArch: string | undefined;
      try { nodeArch = (await gridStatus(live.gridUrl)).nodes.find((n) => n.slots.some((s) => s.sessionId === gridId))?.arch; } catch { /* recorded as unknown */ }
      const verdict = evaluate(entry, await collectFacts(driver, caps, entry, nodeArch));
      if (this.cfg.emulatedWorkers.has(this.row(id).worker_id)) verdict.emulation = EMULATION_LABEL;
      this.recordVerification(entry, verdict, caps);
      if (!verdict.ok) return await startFail('BROWSER_VERSION_MISMATCH', `Started browser does not match ${entry.brand} ${entry.requestedVersion}: ${verdict.mismatches.join('; ')}`);
      this.db.prepare('UPDATE sessions SET actual_browser_version = ?, actual_os = ?, actual_arch = ?, verification_json = ? WHERE id = ?')
        .run(verdict.capabilities.browserVersion ?? null, String(caps.platformName ?? entry.platformName), nodeArch ?? null, JSON.stringify(verdict), id);

      if (entry.capabilities.windowResize) await this.applyViewport(id, driver, vp);
      await driver.manage().setTimeouts({ pageLoad: 60_000 });
      let navError: string | null = null;
      try { await driver.get(url); } catch (e) { navError = `Navigation failed: ${(e as Error).message.split('\n')[0]}. The browser is running; troubleshoot manually.`; }
      if (live.cancelled || !this.transition(id, 'running', { navigation_error: navError, last_activity_at: now() })) { await this.quietQuit(driver); this.release(id); return; }
      live.keepalive = setInterval(() => this.keepalive(id).catch((e) => this.log.warn({ session: id, err: (e as Error).message }, 'keepalive failed')), this.cfg.keepaliveMs);
      this.log.info({ session: id, build: entry.id, url: redactUrl(url) }, 'session running');
    } catch (e) {
      await startFail('GRID_UNAVAILABLE', `Browser started but setup failed: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  private recordVerification(entry: CatalogEntry, v: Verification, caps: Record<string, any>) {
    this.db.prepare(`INSERT INTO browser_builds (id, family, channel, requested_version, actual_version, driver_version, os, arch, image_ref, image_digest, worker_id, last_verified_at, verified_status, verification_message)
      VALUES (@id, @family, @channel, @rv, @av, @dv, @os, @arch, @img, @dig, @worker, @at, @status, @msg)
      ON CONFLICT(id) DO UPDATE SET actual_version = excluded.actual_version, driver_version = excluded.driver_version, os = excluded.os, arch = excluded.arch,
        image_ref = excluded.image_ref, image_digest = excluded.image_digest, last_verified_at = excluded.last_verified_at, verified_status = excluded.verified_status, verification_message = excluded.verification_message`)
      .run({ id: entry.id, family: entry.family, channel: entry.channel, rv: entry.requestedVersion, av: v.capabilities.browserVersion ?? null, dv: v.capabilities.driverVersion ?? null,
        os: String(caps.platformName ?? ''), arch: v.capabilities.nodeArch ?? null, img: entry.image ?? null, dig: entry.imageDigest ?? null, worker: entry.worker, at: now(),
        status: v.ok ? `verified-${v.level}` : 'verification-failed', msg: v.ok ? null : v.mismatches.join('; ') });
  }

  private async applyViewport(id: string, driver: Driver, vp: { width: number; height: number }) {
    // Window size includes browser chrome; measure the real viewport and correct once.
    await driver.manage().window().setRect({ x: 0, y: 0, width: vp.width, height: vp.height });
    const inner = async () => (await driver.executeScript('return [window.innerWidth, window.innerHeight]')) as [number, number];
    let [w, h] = await inner();
    if (w !== vp.width || h !== vp.height) {
      await driver.manage().window().setRect({ width: vp.width + (vp.width - w), height: vp.height + (vp.height - h) });
      [w, h] = await inner();
    }
    this.db.prepare('UPDATE sessions SET viewport_width = ?, viewport_height = ?, effective_width = ?, effective_height = ? WHERE id = ?').run(vp.width, vp.height, w, h, id);
  }

  private async keepalive(id: string) {
    const live = this.live.get(id);
    if (!live?.driver) return;
    try {
      live.currentUrl = await live.driver.getCurrentUrl();
    } catch (e) {
      if (this.live.get(id) !== live) return; // session already ended or service shutting down
      const r = this.row(id);
      if (r.state !== 'running') return;
      clearInterval(live.keepalive);
      if (live.entry.family === 'safari') {
        // Expected after the user breaks Safari's automation glass pane: manual control continues over VNC.
        this.db.prepare(`UPDATE sessions SET driver_state = 'detached' WHERE id = ?`).run(id);
        live.driver = undefined;
        return;
      }
      this.log.warn({ session: id, err: (e as Error).message.split('\n')[0] }, 'browser lost');
      await this.end(id, 'interrupted', 'SESSION_INTERRUPTED', 'The browser or its worker stopped responding. Any saved result and evidence are kept; nothing was marked passed.');
    }
  }

  heartbeat(id: string) {
    const r = this.row(id);
    if (r.state !== 'running') fail('SESSION_NOT_RUNNING', `Session is ${r.state}.`);
    this.touch(id);
  }
  touch(id: string) { this.db.prepare(`UPDATE sessions SET last_activity_at = ? WHERE id = ? AND state = 'running'`).run(now(), id); }

  /** User-initiated close. Idempotent. */
  async close(id: string) {
    const r = this.row(id);
    if (isFinal(r.state)) return this.view(id);
    await this.end(id, 'completed');
    return this.view(id);
  }

  private async end(id: string, final: 'completed' | 'expired' | 'interrupted', code?: string, message?: string) {
    const r = this.row(id);
    const live = this.live.get(id);
    if (live) live.cancelled = true;
    if (!this.transition(id, 'closing')) { if (!isFinal(this.row(id).state)) this.transition(id, final, { failure_code: code ?? null, failure_message: message ?? null }); return; }
    let quitError: string | null = null;
    if (live?.driver) {
      // Grid answers quit only after the browser container has stopped, which takes 5-30 s on small CI runners.
      try { await Promise.race([live.driver.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error('quit timed out')), QUIT_TIMEOUT_MS))]); }
      catch (e) { quitError = (e as Error).message.split('\n')[0]; }
    }
    if ((quitError || !live?.driver) && r.grid_session_id) {
      const gridUrl = live?.gridUrl ?? this.catalog.gridUrl(r.worker_id);
      await deleteGridSession(gridUrl, r.grid_session_id);
      // Only an error if the browser is really still there; a released session is a clean close.
      if (quitError && !(await gridHasSession(gridUrl, r.grid_session_id))) quitError = null;
    }
    const detachedSafari = r.driver_state === 'detached';
    const ok = this.transition(id, quitError && !detachedSafari && final === 'completed' ? 'closed-with-error' : final, {
      driver_state: 'none',
      failure_code: code ?? (quitError && !detachedSafari ? 'GRID_UNAVAILABLE' : null),
      failure_message: message ?? (detachedSafari ? 'Safari was under manual control; close the automation window on the Mac (Cmd-W) before the next session.' : quitError),
    });
    if (!ok) this.transition(id, 'closed-with-error', { driver_state: 'none', failure_message: 'Unexpected state during close.' });
    this.release(id);
  }

  private release(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    clearInterval(live.keepalive);
    live.sockets.forEach((c) => c());
    this.live.delete(id);
  }

  private async quietQuit(d: Driver) { await d.quit().catch(() => undefined); }

  private runningDriver(id: string): { live: Live; row: SessionRow; driver: Driver } {
    const row = this.row(id);
    const live = this.live.get(id);
    if (row.state !== 'running' || !live) fail('SESSION_NOT_RUNNING', `Session is ${row.state}.`);
    if (!live!.driver) fail('SESSION_NOT_RUNNING', 'The browser is under manual control (WebDriver detached); use the desktop capture instead.');
    return { live: live!, row, driver: live!.driver! };
  }

  async setViewport(id: string, vp: { width: number; height: number }) {
    const { driver, live } = this.runningDriver(id);
    if (!live.entry.capabilities.windowResize) fail('INVALID_REQUEST', 'This browser build does not support window resizing.');
    await this.applyViewport(id, driver, vp);
    this.touch(id);
    return this.view(id);
  }

  async screenshot(id: string, caption?: string) {
    const { driver, row } = this.runningDriver(id);
    let data: Buffer;
    try { data = Buffer.from(await driver.takeScreenshot(), 'base64'); } catch (e) { return fail('EVIDENCE_CAPTURE_FAILED', `Screenshot failed: ${(e as Error).message.split('\n')[0]}`); }
    this.touch(id);
    return this.evidence.save(id, data, { mime: 'image/png', source: 'webdriver-viewport', caption, actualVersion: row.actual_browser_version, maxBytes: this.cfg.maxScreenshotBytes });
  }

  /** Viewer framebuffer capture (whole remote desktop). Used for Safari after manual handover; labelled as such. */
  desktopCapture(id: string, png: Buffer, caption?: string) {
    const row = this.row(id);
    if (row.state !== 'running') fail('SESSION_NOT_RUNNING', `Session is ${row.state}.`);
    this.touch(id);
    return this.evidence.save(id, png, { mime: 'image/png', source: 'vnc-desktop', caption, actualVersion: row.actual_browser_version, maxBytes: this.cfg.maxScreenshotBytes });
  }

  async upload(id: string, rawName: string, data: Buffer): Promise<{ remotePath: string; name: string }> {
    const { driver, live } = this.runningDriver(id);
    if (!live.entry.capabilities.uploads) fail('TRANSFER_UNSUPPORTED', `${live.entry.brand} on this worker does not support file staging.`);
    if (!data.length) fail('INVALID_REQUEST', 'Empty file.');
    const name = sanitizeFileName(rawName);
    const zip = new JSZip();
    zip.file(name, data);
    const remotePath = (await gridCommand(driver, 'UPLOAD_FILE', { file: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64') })) as string;
    this.touch(id);
    return { remotePath, name };
  }

  async downloads(id: string): Promise<string[]> {
    const { driver, live } = this.runningDriver(id);
    if (!live.entry.capabilities.downloads) fail('TRANSFER_UNSUPPORTED', `${live.entry.brand} on this worker does not support download retrieval.`);
    const r = (await gridCommand(driver, 'GET_DOWNLOADABLE_FILES')) as { names?: string[] };
    return r.names ?? [];
  }

  async download(id: string, name: string): Promise<{ name: string; data: Buffer }> {
    if (!(await this.downloads(id)).includes(name)) fail('NOT_FOUND', 'No such downloaded file in this session.');
    const { driver } = this.runningDriver(id);
    const r = (await gridCommand(driver, 'DOWNLOAD_FILE', { name })) as { contents: string };
    if (r.contents.length > this.cfg.maxTransferBytes * 1.4) fail('TRANSFER_TOO_LARGE', `Download exceeds ${this.cfg.maxTransferBytes / 1048576} MB.`);
    const zip = await JSZip.loadAsync(Buffer.from(r.contents, 'base64'));
    const files = Object.values(zip.files).filter((f) => !f.dir);
    const f = files.length === 1 ? files[0] : fail('EVIDENCE_CAPTURE_FAILED', 'Unexpected download archive layout.');
    // Check the declared size before inflating so a zip bomb cannot exhaust memory.
    if (((f as any)._data?.uncompressedSize ?? 0) > this.cfg.maxTransferBytes) fail('TRANSFER_TOO_LARGE', `Download exceeds ${this.cfg.maxTransferBytes / 1048576} MB.`);
    const data = await f.async('nodebuffer');
    if (data.length > this.cfg.maxTransferBytes) fail('TRANSFER_TOO_LARGE', `Download exceeds ${this.cfg.maxTransferBytes / 1048576} MB.`);
    this.touch(id);
    return { name: sanitizeFileName(name), data };
  }

  async saveDownloadAsEvidence(id: string, name: string) {
    const { data, name: safe } = await this.download(id, name);
    return this.evidence.save(id, data, { mime: 'application/octet-stream', source: 'browser-download', originalName: safe, actualVersion: this.row(id).actual_browser_version, maxBytes: this.cfg.maxTransferBytes });
  }

  saveResult(id: string, input: { outcome: string; notes: string; checklist: string; tester?: string }) {
    const r = this.row(id);
    if (input.outcome === 'passed' && !r.actual_browser_version) fail('INVALID_REQUEST', 'A session whose browser never started and verified cannot be marked passed.');
    this.db.prepare(`INSERT INTO results (id, session_id, outcome, notes, checklist, tester, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET outcome = excluded.outcome, notes = excluded.notes, checklist = excluded.checklist, tester = excluded.tester, checked_at = excluded.checked_at`)
      .run(uuid(), id, input.outcome, input.notes, input.checklist, input.tester ?? r.tester, now());
    if (r.state === 'running') this.touch(id);
    return this.view(id);
  }

  liveTarget(id: string): LiveTarget {
    const r = this.row(id);
    const live = this.live.get(id);
    if (r.state !== 'running' || !live || !r.grid_session_id) fail('VIEWER_UNAVAILABLE', `Session is ${r.state}; there is no live desktop.`);
    if (live!.entry.provider === 'safari-relay') {
      const v = this.cfg.safariVnc ?? fail('VIEWER_UNAVAILABLE', 'No Mac desktop configured (BROWSERLAB_SAFARI_VNC).');
      return { kind: 'tcp', host: v.host, port: v.port, password: this.cfg.safariVncPassword };
    }
    return { kind: 'grid', url: vncWsUrl(live!.gridUrl, r.grid_session_id!) };
  }

  trackSocket(id: string, close: () => void) {
    const live = this.live.get(id);
    if (!live) { close(); return () => undefined; }
    // One controlling viewer per desktop: a new viewer (e.g. a pop-out tab) takes over from the previous one.
    live.sockets.forEach((c) => c());
    live.sockets.clear();
    live.sockets.add(close);
    return () => live.sockets.delete(close);
  }

  view(id: string): SessionView {
    const r = this.row(id);
    const entry = this.catalog.entries.find((e) => e.id === r.browser_build_id);
    const res = this.db.prepare('SELECT outcome, notes, checklist, tester, checked_at FROM results WHERE session_id = ?').get(id) as any;
    const evidenceCount = (this.db.prepare('SELECT COUNT(*) n FROM evidence WHERE session_id = ?').get(id) as { n: number }).n;
    const last = Date.parse(r.last_activity_at);
    const verification: Verification | null = r.verification_json ? JSON.parse(r.verification_json) : null;
    return {
      id: r.id, state: r.state, driver: r.driver_state, catalogId: r.browser_build_id, family: entry?.family ?? 'chrome', brand: entry?.brand ?? r.browser_build_id,
      requestedVersion: r.requested_version, actualBrowserVersion: r.actual_browser_version, actualOs: r.actual_os, actualArch: r.actual_arch,
      targetUrl: r.target_url, currentUrl: this.live.get(id)?.currentUrl ?? null, projectId: r.project_id, environmentId: r.environment_id,
      buildLabel: r.build_label, tester: r.tester, viewport: { width: r.viewport_width, height: r.viewport_height },
      effectiveViewport: r.effective_width ? { width: r.effective_width, height: r.effective_height! } : null,
      startedAt: r.started_at, endedAt: r.ended_at, lastActivityAt: r.last_activity_at,
      expiresAt: r.state === 'running' ? new Date(Math.min(last + this.cfg.idleMs, Date.parse(r.started_at) + this.cfg.maxSessionMs)).toISOString() : null,
      failureCode: r.failure_code, failureMessage: r.failure_message ?? r.navigation_error, verification, emulation: verification?.emulation ?? null,
      result: res ? { outcome: res.outcome, notes: res.notes, checklist: res.checklist, tester: res.tester, checkedAt: res.checked_at } : null,
      evidenceCount, capabilities: entry?.capabilities ?? { screenshots: false, windowResize: false, uploads: false, downloads: false, clipboard: false },
    };
  }

  /** Refreshes the current URL immediately (used by GET /sessions/:id when asked). */
  async refreshUrl(id: string) {
    const live = this.live.get(id);
    if (live?.driver && this.row(id).state === 'running') { try { live.currentUrl = await live.driver.getCurrentUrl(); } catch { /* keepalive handles loss */ } }
  }

  /** After an API restart no in-memory driver exists: release every Grid session we left behind and say so honestly. */
  async reconcile() {
    const stale = this.db.prepare(`SELECT * FROM sessions WHERE state IN (${ACTIVE_SQL})`).all() as SessionRow[];
    for (const r of stale) {
      const url = this.cfg.grids[r.worker_id];
      if (url && r.grid_session_id) await deleteGridSession(url, r.grid_session_id);
      this.db.prepare(`UPDATE sessions SET state = 'interrupted', driver_state = 'none', ended_at = ?, failure_code = 'SESSION_INTERRUPTED', failure_message = ? WHERE id = ?`)
        .run(now(), 'BrowserLab restarted while this session was open; its browser was released. Saved results and evidence are kept.', r.id);
    }
    return stale.length;
  }

  sweep() {
    const t = Date.now();
    for (const r of this.db.prepare(`SELECT * FROM sessions WHERE state IN (${ACTIVE_SQL})`).all() as SessionRow[]) {
      if (r.state === 'running') {
        if (t - Date.parse(r.started_at) > this.cfg.maxSessionMs) void this.end(r.id, 'expired', 'SESSION_EXPIRED', 'Maximum session duration reached.');
        else if (t - Date.parse(r.last_activity_at) > this.cfg.idleMs) void this.end(r.id, 'expired', 'SESSION_EXPIRED', 'Idle timeout reached.');
      } else if (!this.live.has(r.id) && r.state !== 'closing') {
        this.transition(r.id, 'failed-to-start', { failure_code: 'SESSION_INTERRUPTED', failure_message: 'Start was interrupted.' });
      }
    }
  }

  startTimers() { this.timer = setInterval(() => this.sweep(), this.cfg.sweepMs); }
  async shutdown() {
    clearInterval(this.timer);
    await Promise.all([...this.live.keys()].map((id) => this.end(id, 'interrupted', 'SESSION_INTERRUPTED', 'BrowserLab was stopped.').catch(() => undefined)));
  }

}

export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(0, 120).trim();
  return clean || fail('INVALID_REQUEST', 'Invalid file name.');
}
