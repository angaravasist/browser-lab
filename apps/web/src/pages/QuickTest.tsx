import { useEffect, useMemo, useState } from 'react';
import type { BrowserBuild, Family } from '@browserlab/shared';
import { api, errorText } from '../api.ts';
import { go } from '../router.tsx';
import { FamilyCards, VersionSelect } from '../components/BrowserPicker.tsx';
import { ViewportPicker, type Viewport } from '../components/ViewportPicker.tsx';

type Strategy = 'custom' | 'minimum' | 'newest-provisioned';
const store = { get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export function QuickTest() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const [builds, setBuilds] = useState<BrowserBuild[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [project, setProject] = useState<any>(null);
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [envId, setEnvId] = useState('');
  const [url, setUrl] = useState('');
  const [family, setFamily] = useState<Family>('firefox');
  const [catalogId, setCatalogId] = useState(params.get('build') ?? '');
  const [strategy, setStrategy] = useState<Strategy>('custom');
  const [viewport, setViewport] = useState<Viewport>({ width: 1440, height: 900 });
  const [buildLabel, setBuildLabel] = useState('');
  const [tester, setTester] = useState(store.get('browserlab.tester'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ builds: BrowserBuild[] }>('GET', '/api/browser-builds').then((r) => {
      setBuilds(r.builds);
      const pre = r.builds.find((b) => b.id === catalogId);
      if (pre) setFamily(pre.family);
      else { const first = r.builds.find((b) => b.availability === 'ready'); if (first) { setFamily(first.family); setCatalogId(first.id); } }
    }).catch((e) => setError(errorText(e)));
    api<any[]>('GET', '/api/projects').then(setProjects).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!projectId) { setProject(null); setStrategy('custom'); return; }
    api('GET', `/api/projects/${projectId}`).then((p) => {
      setProject(p);
      const env = p.environments.find((e: any) => e.isDefault) ?? p.environments[0];
      if (env) { setEnvId(env.id); setUrl(env.baseUrl); }
    }).catch((e) => setError(errorText(e)));
  }, [projectId]);

  const familyBuilds = builds.filter((b) => b.family === family);
  const minimumTarget = project?.policy.find((t: any) => t.family === family && t.kind === 'minimum');
  const resolved: BrowserBuild | undefined = useMemo(() => {
    if (strategy === 'custom') return builds.find((b) => b.id === catalogId && b.family === family);
    if (strategy === 'newest-provisioned') return familyBuilds.filter((b) => b.availability === 'ready' && b.channel === 'stable').sort((a, b) => Number(b.requestedVersion) - Number(a.requestedVersion))[0];
    return minimumTarget && familyBuilds.find((b) => b.channel === minimumTarget.channel && b.requestedVersion === minimumTarget.requestedVersion && b.platformName === minimumTarget.targetOs);
  }, [strategy, catalogId, family, builds, project]);

  const urlProblem = (() => { if (!url) return 'Enter the web application URL.'; try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? '' : 'Only http:// and https:// URLs can be tested.'; } catch { return 'Enter a full URL including http:// or https://.'; } })();
  const isLocalhost = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(url);
  const canLaunch = !urlProblem && resolved?.availability === 'ready' && !busy;

  const launch = async () => {
    setBusy(true); setError('');
    store.set('browserlab.tester', tester);
    try {
      const r = await api<{ id: string }>('POST', '/api/sessions', {
        targetUrl: url, target: { catalogId: resolved!.id }, viewport,
        projectId: projectId || undefined, environmentId: envId || undefined, buildLabel: buildLabel || undefined, tester: tester || undefined,
      });
      go(`/session/${r.id}`);
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };

  return (
    <main className="page">
      <h1>Quick test</h1>
      <div className="card grid">
        <div className="grid two">
          <label className="field">Saved project <small>(optional)</small>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project — quick test</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {project && (
            <label className="field">Environment
              <select value={envId} onChange={(e) => { setEnvId(e.target.value); const env = project.environments.find((x: any) => x.id === e.target.value); if (env) setUrl(env.baseUrl); }}>
                <option value="">Custom URL</option>
                {project.environments.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="field">Web application URL
          <input type="url" inputMode="url" placeholder="https://staging.example.com" value={url} onChange={(e) => { setUrl(e.target.value); setEnvId(''); }} aria-invalid={!!url && !!urlProblem} />
          {url && urlProblem && <small role="alert" style={{ color: 'var(--bad)' }}>{urlProblem}</small>}
        </label>
        {isLocalhost && <div className="callout warn"><b>localhost</b> inside the remote browser means its own container, not your computer. For an app running on your computer use <code>http://host.docker.internal:PORT</code>. BrowserLab does not rewrite URLs for you.</div>}
      </div>

      <div className="card grid">
        <h2>Browser</h2>
        <FamilyCards builds={builds} value={family} onChange={(f) => { setFamily(f); setCatalogId(builds.find((b) => b.family === f && b.availability === 'ready')?.id ?? ''); }} />
        {project && (
          <div className="row" role="radiogroup" aria-label="Version strategy">
            {(['minimum', 'newest-provisioned', 'custom'] as Strategy[]).map((s) => (
              <label key={s} className="row"><input type="radio" name="strategy" checked={strategy === s} onChange={() => setStrategy(s)} />
                {s === 'minimum' ? `Project minimum${minimumTarget ? ` (${minimumTarget.requestedVersion}${minimumTarget.channel === 'esr' ? ' ESR' : ''})` : ' (none set)'}` : s === 'newest-provisioned' ? 'Newest provisioned in BrowserLab' : 'Custom'}
              </label>
            ))}
          </div>
        )}
        {strategy === 'custom' ? <VersionSelect builds={builds} family={family} value={catalogId} onChange={setCatalogId} />
          : <p>Resolves to: <b>{resolved ? `${resolved.brand} ${resolved.requestedVersion}` : 'nothing'}</b> {resolved && <span className="muted">— {resolved.reason}</span>}</p>}
        {strategy === 'newest-provisioned' && <small className="muted">“Newest provisioned” is the newest version installed and ready in this BrowserLab, not necessarily the vendor's latest release.</small>}
        {resolved?.emulation && <div className="callout warn"><b>Emulated:</b> {resolved.emulation}. This is the genuine browser build, but its CPU instructions are translated, so speed and timing can differ from real Intel/AMD hardware. Results are labelled as emulated.</div>}
        {resolved && <p className="muted">Runs on {resolved.platformName} / {resolved.workerArch ?? resolved.architectures.join(' or ')} · worker “{resolved.worker}”. The exact version is verified after launch.</p>}
        {resolved && resolved.availability !== 'ready' && <div className="callout warn" role="status"><b>Cannot launch:</b> {resolved.reason}</div>}
      </div>

      <div className="card grid two">
        <ViewportPicker value={viewport} onChange={setViewport} />
        <div className="grid">
          <label className="field">Build / release label <small>(optional)</small><input value={buildLabel} onChange={(e) => setBuildLabel(e.target.value)} maxLength={100} placeholder="e.g. 2.4.1-rc1" /></label>
          <label className="field">Tester nickname <small>(optional, not a login)</small><input value={tester} onChange={(e) => setTester(e.target.value)} maxLength={60} /></label>
        </div>
      </div>

      {error && <div className="callout bad" role="alert">{error}</div>}
      <button className="primary" disabled={!canLaunch} onClick={launch}>{busy ? 'Launching…' : 'Launch real browser'}</button>
    </main>
  );
}
