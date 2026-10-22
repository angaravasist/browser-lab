import { useEffect, useState } from 'react';
import { OUTCOMES, VIEWPORT_PRESETS, type SessionView } from '@browserlab/shared';
import { api, errorText } from '../api.ts';
import { VncViewer } from '../components/VncViewer.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { FileTransfer } from '../components/FileTransfer.tsx';
import { ViewportPicker } from '../components/ViewportPicker.tsx';

const STEPS = [['queued', 'Reserved a session slot'], ['provisioning', 'Starting a disposable browser container'], ['starting', 'Browser started'], ['verifying', 'Verifying the exact browser build'], ['running', 'Opening your URL']] as const;
const FINAL = ['completed', 'failed-to-start', 'expired', 'interrupted', 'closed-with-error'];

function useSession(id: string) {
  const [s, setS] = useState<SessionView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false, n = 0;
    const tick = async () => {
      try {
        const v = await api<SessionView>('GET', `/api/sessions/${id}${n++ % 5 === 0 ? '?refresh=1' : ''}`);
        if (stop) return;
        setS(v); setError('');
        if (FINAL.includes(v.state)) return;
      } catch (e) { setError(errorText(e)); }
      if (!stop) setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [id]);
  return { s, setS, error };
}

function Remaining({ until }: { until: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!until) return null;
  const ms = Math.max(0, Date.parse(until) - now);
  return <span title="Ends at the idle or maximum session limit, whichever comes first">⏱ {Math.floor(ms / 60000)}:{String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')} left</span>;
}

export function Session({ id }: { id: string }) {
  const { s, setS, error } = useSession(id);
  const [drawer, setDrawer] = useState(true);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState({ outcome: 'not-run', notes: '', checklist: '' });
  const [resultLoaded, setResultLoaded] = useState(false);
  const [vp, setVp] = useState({ width: 1440, height: 900 });

  const loadEvidence = () => api<any[]>('GET', `/api/sessions/${id}/evidence`).then(setEvidence).catch(() => undefined);
  useEffect(() => { loadEvidence(); }, [id]);
  useEffect(() => {
    if (s && !resultLoaded) { setResultLoaded(true); if (s.result) setResult({ outcome: s.result.outcome, notes: s.result.notes, checklist: s.result.checklist }); setVp(s.viewport); }
  }, [s]);

  if (!s) return <main className="page">{error ? <div className="callout bad" role="alert">{error}</div> : <p>Loading session…</p>}</main>;
  const running = s.state === 'running';
  const attached = s.driver === 'attached';
  const act = async (fn: () => Promise<unknown>, done?: string) => { setMsg(''); try { await fn(); if (done) setMsg(done); } catch (e) { setMsg(errorText(e)); } };

  if (!running && !FINAL.includes(s.state)) {
    const idx = STEPS.findIndex(([k]) => k === s.state);
    return (
      <main className="page">
        <h1>Launching {s.brand} {s.requestedVersion}</h1>
        <ol className="progress" aria-live="polite">{STEPS.map(([k, label], i) => <li key={k} className={i < idx ? 'done' : i === idx ? 'now' : ''}>{label}</li>)}</ol>
        <p className="muted">The first launch of a browser build can take a while if its image is still downloading.</p>
        <button onClick={() => act(async () => setS(await api('DELETE', `/api/sessions/${id}`)))}>Cancel</button>
      </main>
    );
  }

  const v = s.verification;
  const identity = (
    <section aria-label="Browser identity">
      <h3>Browser identity</h3>
      <dl className="kv">
        <dt>Requested</dt><dd>{s.brand} {s.requestedVersion}</dd>
        <dt>Actual</dt><dd>{s.actualBrowserVersion ?? 'not started'}{v?.executable?.channel ? ` (${v.executable.channel} channel)` : ''}</dd>
        <dt>OS / CPU</dt><dd>{s.actualOs ?? '—'} / {s.actualArch ?? '—'}</dd>
        <dt>Driver</dt><dd>{v?.capabilities.driverVersion ?? '—'}</dd>
        <dt>Verified</dt><dd>{v ? <>{v.ok ? <span className="badge b-ready">Matched</span> : <span className="badge b-failed">Mismatch</span>} {v.level === 'executable' ? "browser's own version page + WebDriver" : v.level === 'capabilities' ? 'WebDriver capabilities only' : 'none'}</> : '—'}</dd>
      </dl>
      {v && !v.ok && <ul>{v.mismatches.map((m) => <li key={m}>{m}</li>)}</ul>}
      <details><summary>Diagnostics</summary>
        <dl className="kv">
          <dt>Catalogue</dt><dd className="mono">{v?.provenance.catalogId}</dd>
          <dt>Image</dt><dd className="mono">{v?.provenance.image} {v?.provenance.imageDigest}</dd>
          <dt>Executable</dt><dd className="mono">{v?.executable?.product} {v?.executable?.version} {v?.executable?.path}</dd>
          <dt>UA data</dt><dd className="mono">{v?.supplementary?.navigatorPlatform} {v?.supplementary?.uaBrands?.join(', ')} (informational only)</dd>
        </dl>
      </details>
    </section>
  );

  const resultEditor = (
    <section aria-label="Result">
      <h3>Result</h3>
      <div className="grid">
        <label className="field">Outcome
          <select value={result.outcome} onChange={(e) => setResult({ ...result, outcome: e.target.value })}>
            {OUTCOMES.map((o) => <option key={o} value={o} disabled={o === 'passed' && !s.actualBrowserVersion}>{o}</option>)}
          </select>
        </label>
        <label className="field">Notes<textarea value={result.notes} onChange={(e) => setResult({ ...result, notes: e.target.value })} /></label>
        <label className="field">Checklist <small>(optional)</small><textarea value={result.checklist} onChange={(e) => setResult({ ...result, checklist: e.target.value })} placeholder={'- Login page renders\n- Form submits'} /></label>
        <button className="primary" onClick={() => act(async () => setS(await api('POST', `/api/sessions/${id}/result`, result)), 'Result saved.')}>Save result</button>
        {s.result && <small className="muted">Saved {new Date(s.result.checkedAt).toLocaleString()}</small>}
      </div>
    </section>
  );

  const evidenceList = (
    <section aria-label="Evidence">
      <h3>Evidence ({evidence.length})</h3>
      {running && (
        <div className="row">
          <button disabled={!attached} onClick={() => act(async () => { await api('POST', `/api/sessions/${id}/screenshot`, {}); await loadEvidence(); }, 'Screenshot saved.')}>Screenshot (page viewport)</button>
        </div>
      )}
      <div className="thumbs">
        {evidence.map((e) => e.mime_type === 'image/png'
          ? <a key={e.id} href={`/api/evidence/${e.id}/download`} target="_blank" rel="noreferrer" title={`${e.source} · ${e.captured_at} · sha256 ${e.sha256}`}><img src={`/api/evidence/${e.id}/download`} alt={`${e.source} capture ${new Date(e.captured_at).toLocaleTimeString()}`} /></a>
          : <a key={e.id} href={`/api/evidence/${e.id}/download?download=1`}>{e.caption || 'file'}</a>)}
      </div>
    </section>
  );

  if (!running) {
    return (
      <main className="page">
        <h1>{s.brand} {s.requestedVersion} <StatusBadge value={s.state} /></h1>
        {s.failureMessage && <div className={`callout ${s.state === 'completed' ? '' : 'bad'}`} role="status"><b>{s.failureCode ?? 'Note'}:</b> {s.failureMessage}{s.state === 'failed-to-start' || s.state === 'interrupted' ? ' This is an infrastructure or identity problem, not a site compatibility failure.' : ''}</div>}
        <p>Target: <code>{s.targetUrl}</code> · started {new Date(s.startedAt).toLocaleString()}{s.endedAt ? ` · ended ${new Date(s.endedAt).toLocaleString()}` : ''}</p>
        <div className="grid two"><div className="card">{identity}</div><div className="card">{resultEditor}</div></div>
        <div className="card">{evidenceList}</div>
        {msg && <p role="status">{msg}</p>}
        <a className="btn" href="#/">New test</a>
      </main>
    );
  }

  return (
    <div className="session">
      <div className="toolbar" role="toolbar" aria-label="Session">
        <b>{s.brand} {s.actualBrowserVersion}</b>
        <span>{s.actualOs}/{s.actualArch}</span>
        <span className="url" title={s.currentUrl ?? s.targetUrl}>{s.currentUrl ?? s.targetUrl}</span>
        <span>Viewport {s.effectiveViewport ? `${s.effectiveViewport.width}×${s.effectiveViewport.height}` : '—'}</span>
        {s.buildLabel && <span>Build {s.buildLabel}</span>}
        {s.driver === 'detached' && <span className="badge b-blocked" title="WebDriver detached after Safari handover">Manual control</span>}
        <Remaining until={s.expiresAt} />
        <span style={{ flex: 1 }} />
        <button disabled={!attached} onClick={() => act(async () => { await api('POST', `/api/sessions/${id}/screenshot`, {}); await loadEvidence(); }, 'Screenshot saved.')}>Screenshot</button>
        <button onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>{drawer ? 'Hide panel' : 'Show panel'}</button>
        <button className="danger" onClick={() => act(async () => { if (confirm('End this session? The browser and its container are discarded; results and evidence are kept.')) setS(await api('DELETE', `/api/sessions/${id}`)); })}>End session</button>
      </div>
      <div className={`workspace${drawer ? '' : ' collapsed'}`}>
        <VncViewer sessionId={id} active={running}
          onCapture={(png) => act(async () => { await api('POST', `/api/sessions/${id}/desktop-capture`, png, { 'content-type': 'image/png', 'x-caption': encodeURIComponent('Full desktop capture') }); await loadEvidence(); }, 'Desktop capture saved.')}
          onPopout={() => window.open(`#/viewer/${id}`, '_blank', 'noopener')} />
        {drawer && (
          <aside className="drawer" aria-label="Session details">
            {msg && <p role="status" className="callout">{msg}</p>}
            {s.failureMessage && <div className="callout warn">{s.failureMessage}</div>}
            {s.family === 'safari' && attached && (
              <section className="callout warn"><b>Safari manual control.</b> Safari blocks input to WebDriver-controlled windows. Click into the window on the desktop and confirm “Stop Session” to take manual control. Screenshots then come from the desktop capture and file staging is no longer possible.</section>
            )}
            <p className="muted">Use the remote browser's own address bar, tabs and back button. Target: <code>{s.targetUrl}</code></p>
            {identity}
            {resultEditor}
            {evidenceList}
            <section aria-label="Files"><h3>Files</h3><FileTransfer sessionId={id} uploads={s.capabilities.uploads} downloads={s.capabilities.downloads} attached={attached} /></section>
            {s.capabilities.windowResize && attached && (
              <section aria-label="Viewport"><h3>Viewport</h3>
                <ViewportPicker value={vp} onChange={setVp} />
                <button onClick={() => act(async () => setS(await api('POST', `/api/sessions/${id}/viewport`, vp)), 'Viewport applied.')}>Apply viewport</button>
                <small className="muted">Changes the browser window, not page zoom. Presets: {VIEWPORT_PRESETS.map((p) => `${p.width}×${p.height}`).join(', ')}.</small>
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

export function PopoutViewer({ id }: { id: string }) {
  const [s, setS] = useState<SessionView | null>(null);
  useEffect(() => { api<SessionView>('GET', `/api/sessions/${id}`).then(setS).catch(() => undefined); }, [id]);
  return (
    <div style={{ height: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <div className="toolbar"><b>{s ? `${s.brand} ${s.actualBrowserVersion}` : 'BrowserLab'}</b> <span className="muted">Full-size viewer. Results and screenshots are in the original tab.</span> <a href={`#/session/${id}`}>Back to session</a></div>
      <VncViewer sessionId={id} active={true} />
    </div>
  );
}
