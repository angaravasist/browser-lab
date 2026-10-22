import { useEffect, useState } from 'react';
import { FAMILIES, OUTCOMES } from '@browserlab/shared';
import { api, errorText } from '../api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';

export function Results() {
  const [projects, setProjects] = useState<any[]>([]);
  const [f, setF] = useState({ projectId: '', family: '', outcome: '', buildLabel: '', tester: '', from: '', to: '' });
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, k === 'to' ? `${v}T23:59:59.999Z` : v])).toString();
  useEffect(() => { api<any[]>('GET', '/api/projects').then(setProjects).catch(() => undefined); }, []);
  useEffect(() => { api<any[]>('GET', `/api/reports?${qs}`).then(setRows).catch((e) => setError(errorText(e))); }, [qs]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <main className="page">
      <h1>Results</h1>
      <div className="card row">
        <label className="field">Project<select value={f.projectId} onChange={set('projectId')}><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field">Browser<select value={f.family} onChange={set('family')}><option value="">All</option>{FAMILIES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field">Outcome<select value={f.outcome} onChange={set('outcome')}><option value="">All</option>{OUTCOMES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field">Build label<input value={f.buildLabel} onChange={set('buildLabel')} size={10} /></label>
        <label className="field">Tester<input value={f.tester} onChange={set('tester')} size={10} /></label>
        <label className="field">From<input type="date" value={f.from} onChange={set('from')} /></label>
        <label className="field">To<input type="date" value={f.to} onChange={set('to')} /></label>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span>Export:</span>
        {(['json', 'csv', 'html'] as const).map((fmt) => <a key={fmt} className="btn" href={`/api/reports/export?format=${fmt}&${qs}`}>{fmt.toUpperCase()}</a>)}
        <small className="muted">For PDF, open the HTML report and use your browser's Print → Save as PDF.</small>
      </div>
      {error && <div className="callout bad" role="alert">{error}</div>}
      <div className="card scroll-x">
        <table><thead><tr><th>When</th><th>Outcome</th><th>Requested</th><th>Actual</th><th>OS/CPU</th><th>Project</th><th>Build</th><th>Target</th><th>Evidence</th><th>State</th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.sessionId}>
              <td><a href={`#/session/${r.sessionId}`}>{new Date(r.startedAt).toLocaleString()}</a></td>
              <td><StatusBadge value={r.outcome} /></td>
              <td>{r.brand} {r.requestedVersion}</td>
              <td>{r.actualVersion ?? '—'} {r.verificationOk === false && <StatusBadge value="verification-failed" />}</td>
              <td>{r.os ?? '—'}/{r.arch ?? '—'}</td>
              <td>{r.project ?? '—'}{r.environment ? ` · ${r.environment}` : ''}</td>
              <td>{r.buildLabel ?? ''}</td>
              <td className="mono" style={{ maxWidth: 260 }}>{r.targetUrl}</td>
              <td>{r.evidenceCount}</td>
              <td><StatusBadge value={r.state} title={r.failureMessage ?? ''} /></td>
            </tr>
          ))}
        </tbody></table>
        {!rows.length && <p className="muted">No sessions match.</p>}
      </div>
    </main>
  );
}
