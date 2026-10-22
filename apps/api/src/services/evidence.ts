import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import { now, uuid } from '../db/index.ts';
import { fail } from '../errors.ts';

export type EvidenceSource = 'webdriver-viewport' | 'vnc-desktop' | 'browser-download';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_NAME = /^[0-9a-f-]{36}\.(png|bin)$/;

export const isPng = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(PNG_MAGIC);

export class EvidenceStore {
  readonly dir: string;
  private db: DB;
  constructor(dataDir: string, db: DB) {
    this.dir = path.join(dataDir, 'evidence');
    this.db = db;
    mkdirSync(this.dir, { recursive: true });
  }

  save(sessionId: string, data: Buffer, opts: { mime: string; source: EvidenceSource; caption?: string; actualVersion: string | null; maxBytes: number; originalName?: string }) {
    if (data.length > opts.maxBytes) fail('TRANSFER_TOO_LARGE', `Evidence exceeds ${Math.round(opts.maxBytes / 1048576)} MB.`);
    if (opts.mime === 'image/png' && !isPng(data)) fail('EVIDENCE_CAPTURE_FAILED', 'Screenshot is not a PNG image.');
    const id = uuid();
    const basename = `${id}.${opts.mime === 'image/png' ? 'png' : 'bin'}`;
    const file = path.join(this.dir, basename);
    // Atomic: a crash never leaves a half-written file under the final name.
    writeFileSync(`${file}.tmp`, data, { flag: 'wx' });
    renameSync(`${file}.tmp`, file);
    const row = {
      id, session_id: sessionId, file_basename: basename, mime_type: opts.mime, byte_size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'), captured_at: now(),
      caption: (opts.caption ?? opts.originalName ?? '').slice(0, 500), actual_browser_version: opts.actualVersion, source: opts.source,
    };
    try {
      this.db.prepare(`INSERT INTO evidence (id, session_id, file_basename, mime_type, byte_size, sha256, captured_at, caption, actual_browser_version, source)
        VALUES (@id, @session_id, @file_basename, @mime_type, @byte_size, @sha256, @captured_at, @caption, @actual_browser_version, @source)`).run(row);
    } catch (e) { rmSync(file, { force: true }); throw e; }
    return row;
  }

  list(sessionId: string) {
    return this.db.prepare('SELECT * FROM evidence WHERE session_id = ? ORDER BY captured_at').all(sessionId) as EvidenceRow[];
  }

  /** Resolves a download strictly by DB id; the file name never comes from the request. */
  file(id: string): { row: EvidenceRow; path: string } {
    const row = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as EvidenceRow | undefined;
    if (!row || !SAFE_NAME.test(row.file_basename)) return fail('NOT_FOUND', 'Evidence not found.');
    const p = path.join(this.dir, row.file_basename);
    if (!existsSync(p)) return fail('NOT_FOUND', 'Evidence file is missing on disk (deleted or retention-cleaned).');
    return { row, path: p };
  }

  /** Deletes files with no DB row (crash leftovers) and rows past retention. */
  cleanup(retentionDays: number) {
    const known = new Set((this.db.prepare('SELECT file_basename f FROM evidence').all() as Array<{ f: string }>).map((r) => r.f));
    for (const f of readdirSync(this.dir)) if (!known.has(f)) rmSync(path.join(this.dir, f), { force: true });
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const old = this.db.prepare('SELECT e.id, e.file_basename f FROM evidence e JOIN sessions s ON s.id = e.session_id WHERE s.ended_at IS NOT NULL AND s.ended_at < ?').all(cutoff) as Array<{ id: string; f: string }>;
    const del = this.db.prepare('DELETE FROM evidence WHERE id = ?');
    for (const r of old) { del.run(r.id); rmSync(path.join(this.dir, r.f), { force: true }); }
    return old.length;
  }
}

export interface EvidenceRow {
  id: string; session_id: string; file_basename: string; mime_type: string; byte_size: number; sha256: string;
  captured_at: string; caption: string; actual_browser_version: string | null; source: EvidenceSource;
}
