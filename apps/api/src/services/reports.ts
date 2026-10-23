import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import type { Catalog } from './catalog.ts';
import { redactUrl } from './urlPolicy.ts';

export interface ReportFilter {
  projectId?: string; buildLabel?: string; family?: string; catalogId?: string; outcome?: string;
  from?: string; to?: string; tester?: string; limit?: number; offset?: number;
}

export interface ReportRow {
  sessionId: string; project: string | null; environment: string | null; buildLabel: string | null; targetUrl: string;
  brand: string; catalogId: string; channel: string; requestedVersion: string; actualVersion: string | null;
  os: string | null; arch: string | null; image: string | null; imageDigest: string | null; driverVersion: string | null;
  emulation: string | null; verificationLevel: string | null; verificationOk: boolean | null; state: string; outcome: string; notes: string;
  tester: string | null; startedAt: string; endedAt: string | null; checkedAt: string | null;
  failureCode: string | null; failureMessage: string | null; evidenceCount: number;
}

export function queryReport(db: DB, catalog: Catalog, f: ReportFilter): ReportRow[] {
  const where: string[] = [];
  const p: Record<string, unknown> = {};
  const add = (sql: string, k: keyof ReportFilter, v: unknown) => { if (v !== undefined && v !== '') { where.push(sql); p[k] = v; } };
  add('s.project_id = @projectId', 'projectId', f.projectId);
  add('s.build_label = @buildLabel', 'buildLabel', f.buildLabel);
  add('s.browser_build_id = @catalogId', 'catalogId', f.catalogId);
  add(`COALESCE(r.outcome, 'not-run') = @outcome`, 'outcome', f.outcome);
  add('s.started_at >= @from', 'from', f.from);
  add('s.started_at <= @to', 'to', f.to);
  add('COALESCE(r.tester, s.tester) = @tester', 'tester', f.tester);
  if (f.family) { const ids = catalog.entries.filter((e) => e.family === f.family).map((e) => e.id); where.push(`s.browser_build_id IN (${ids.map((_, i) => `@fam${i}`).join(',') || "''"})`); ids.forEach((id, i) => (p[`fam${i}`] = id)); }
  const rows = db.prepare(`SELECT s.*, r.outcome, r.notes, r.tester r_tester, r.checked_at, pr.name project, en.name environment,
      (SELECT COUNT(*) FROM evidence e WHERE e.session_id = s.id) evidence_count
    FROM sessions s LEFT JOIN results r ON r.session_id = s.id LEFT JOIN projects pr ON pr.id = s.project_id LEFT JOIN environments en ON en.id = s.environment_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.started_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...p, limit: Math.min(f.limit ?? 200, 5000), offset: f.offset ?? 0 }) as any[];
  return rows.map((s) => {
    const e = catalog.entries.find((x) => x.id === s.browser_build_id);
    const v = s.verification_json ? JSON.parse(s.verification_json) : null;
    return {
      sessionId: s.id, project: s.project, environment: s.environment, buildLabel: s.build_label, targetUrl: s.target_url,
      brand: e?.brand ?? s.browser_build_id, catalogId: s.browser_build_id, channel: e?.channel ?? '', requestedVersion: s.requested_version,
      actualVersion: s.actual_browser_version, os: s.actual_os, arch: s.actual_arch, image: e?.image ?? null, imageDigest: e?.imageDigest ?? null,
      driverVersion: v?.capabilities?.driverVersion ?? null, emulation: v?.emulation ?? null, verificationLevel: v?.level ?? null, verificationOk: v ? !!v.ok : null,
      state: s.state, outcome: s.outcome ?? 'not-run', notes: s.notes ?? '', tester: s.r_tester ?? s.tester, startedAt: s.started_at, endedAt: s.ended_at,
      checkedAt: s.checked_at, failureCode: s.failure_code, failureMessage: s.failure_message ?? s.navigation_error, evidenceCount: s.evidence_count,
    };
  });
}

const COLUMNS: Array<keyof ReportRow> = ['sessionId', 'project', 'environment', 'buildLabel', 'targetUrl', 'brand', 'catalogId', 'channel', 'requestedVersion', 'actualVersion', 'os', 'arch',
  'image', 'imageDigest', 'driverVersion', 'emulation', 'verificationLevel', 'verificationOk', 'state', 'outcome', 'notes', 'tester', 'startedAt', 'endedAt', 'checkedAt', 'failureCode', 'failureMessage', 'evidenceCount'];

export function toCsv(rows: ReportRow[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const IMAGE_BUDGET = 40 * 1024 * 1024;

/** Self-contained printable HTML (inline CSS, screenshots embedded as data URIs up to a size budget). Print to PDF from the browser. */
export function toHtml(db: DB, evidenceDir: string, rows: ReportRow[], title: string): string {
  let budget = IMAGE_BUDGET;
  const body = rows.map((r) => {
    const ev = db.prepare(`SELECT id, file_basename, mime_type, byte_size, sha256, caption, source, captured_at FROM evidence WHERE session_id = ? ORDER BY captured_at`).all(r.sessionId) as any[];
    const shots = ev.map((e) => {
      let img = '';
      if (e.mime_type === 'image/png' && e.byte_size <= budget) {
        try { img = `<img alt="${esc(e.caption || 'screenshot')}" src="data:image/png;base64,${readFileSync(path.join(evidenceDir, e.file_basename)).toString('base64')}">`; budget -= e.byte_size; } catch { img = '<em>file missing</em>'; }
      }
      return `<figure>${img}<figcaption>${esc(e.caption)} · ${esc(e.source)}${r.emulation ? ' · EMULATED' : ''} · ${esc(e.captured_at)} · sha256 ${esc(e.sha256)}</figcaption></figure>`;
    }).join('');
    return `<section class="${esc(r.outcome)}"><h2>${esc(r.brand)} ${esc(r.requestedVersion)} → <span class="o">${esc(r.outcome.toUpperCase())}</span></h2>
<table><tr><th>Requested</th><td>${esc(r.brand)} ${esc(r.requestedVersion)} (${esc(r.channel)}) · ${esc(r.catalogId)}</td></tr>
<tr><th>Actual</th><td>${esc(r.actualVersion ?? 'not started')} · ${esc(r.os)} / ${esc(r.arch)} · driver ${esc(r.driverVersion)}</td></tr>
${r.emulation ? `<tr><th>Execution</th><td class="emu">EMULATED: ${esc(r.emulation)}. Same browser build, CPU instructions translated; timing may differ from native hardware.</td></tr>` : ''}
<tr><th>Verification</th><td>${r.verificationOk === null ? 'none' : `${esc(r.verificationLevel)} ${r.verificationOk ? 'matched' : 'MISMATCH'}`}</td></tr>
<tr><th>Image</th><td>${esc(r.image)} ${esc(r.imageDigest)}</td></tr>
<tr><th>Target</th><td>${esc(redactUrl(r.targetUrl))}</td></tr>
<tr><th>Project</th><td>${esc(r.project)} ${esc(r.environment)} ${esc(r.buildLabel)}</td></tr>
<tr><th>When</th><td>${esc(r.startedAt)} → ${esc(r.endedAt)} · state ${esc(r.state)} · checked ${esc(r.checkedAt)} by ${esc(r.tester)}</td></tr>
${r.failureMessage ? `<tr><th>Infrastructure note</th><td>${esc(r.failureCode)} ${esc(r.failureMessage)}</td></tr>` : ''}
<tr><th>Notes</th><td><pre>${esc(r.notes)}</pre></td></tr></table>${shots}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1b1f24}h1{font-size:20px}section{border:1px solid #ccd;border-radius:8px;padding:12px 16px;margin:16px 0;break-inside:avoid}
th{text-align:left;vertical-align:top;padding:2px 12px 2px 0;white-space:nowrap;color:#444}td{padding:2px 0}pre{white-space:pre-wrap;margin:0;font:inherit}
img{max-width:100%;border:1px solid #ccd;margin-top:8px}figcaption{font-size:12px;color:#555}.passed .o{color:#176b2c}.failed .o{color:#b3261e}.blocked .o{color:#8a5a00}
.emu{color:#8a5a00;font-weight:700}.note{background:#f4f6f8;padding:8px 12px;border-radius:6px}</style></head><body>
<h1>${esc(title)}</h1><p class="note">Generated ${esc(new Date().toISOString())} by BrowserLab. "Actual" values were read from the running browser (WebDriver capabilities and the browser's own version page). Infrastructure failures are not site failures; untested combinations are not shown as passed. ${rows.length} session(s).</p>
${body || '<p>No sessions match.</p>'}</body></html>`;
}
