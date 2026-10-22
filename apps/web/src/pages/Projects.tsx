import { useEffect, useState } from 'react';
import { FAMILIES, type PolicyTarget } from '@browserlab/shared';
import { api, errorText } from '../api.ts';
import { go } from '../router.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';

export function Projects() {
  const [list, setList] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const load = () => api<any[]>('GET', '/api/projects').then(setList).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, []);
  const create = async () => { try { const p = await api('POST', '/api/projects', { name, description: '' }); go(`/project/${p.id}`); } catch (e) { setError(errorText(e)); } };
  const importFile = async (f?: File) => {
    if (!f) return;
    try { const p = await api('POST', '/api/projects/import', JSON.parse(await f.text())); go(`/project/${p.id}`); } catch (e) { setError(`Import failed: ${errorText(e)}`); }
  };
  return (
    <main className="page">
      <h1>Projects</h1>
      <div className="card row">
        <label className="field" style={{ flex: 1 }}>New project name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <button className="primary" disabled={!name.trim()} onClick={create}>Create project</button>
        <label className="btn">Import JSON<input type="file" accept="application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} /></label>
      </div>
      {error && <div className="callout bad" role="alert">{error}</div>}
      <div className="card">
        {list.length ? (
          <table><thead><tr><th>Name</th><th>Description</th><th>Sessions</th><th>Updated</th></tr></thead>
            <tbody>{list.map((p) => <tr key={p.id}><td><a href={`#/project/${p.id}`}>{p.name}</a></td><td>{p.description}</td><td>{p.sessions}</td><td>{new Date(p.updated_at).toLocaleString()}</td></tr>)}</tbody></table>
        ) : <p className="muted">No projects yet. A project holds environments (URLs) and a browser support policy. Quick tests do not need one.</p>}
      </div>
    </main>
  );
}

const blankTarget: PolicyTarget = { family: 'chrome', channel: 'stable', requestedVersion: '', targetOs: 'linux', kind: 'minimum', required: true };

export function ProjectDetail({ id }: { id: string }) {
  const [p, setP] = useState<any>(null);
  const [matrix, setMatrix] = useState<any[]>([]);
  const [env, setEnv] = useState({ name: '', baseUrl: '', isDefault: false });
  const [policy, setPolicy] = useState<PolicyTarget[]>([]);
  const [msg, setMsg] = useState('');
  const load = async () => {
    try {
      const d = await api('GET', `/api/projects/${id}`);
      setP(d); setPolicy(d.policy);
      setMatrix(await api('GET', `/api/projects/${id}/matrix`));
    } catch (e) { setMsg(errorText(e)); }
  };
  useEffect(() => { load(); }, [id]);
  const act = async (fn: () => Promise<unknown>, done = 'Saved.') => { try { await fn(); setMsg(done); await load(); } catch (e) { setMsg(errorText(e)); } };
  if (!p) return <main className="page">{msg ? <div className="callout bad">{msg}</div> : 'Loading…'}</main>;

  return (
    <main className="page">
      <h1>{p.name}</h1>
      {msg && <p role="status" className="callout">{msg}</p>}
      <div className="card grid">
        <h2>Details</h2>
        <label className="field">Name<input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && act(() => api('PATCH', `/api/projects/${id}`, { name: e.target.value }))} /></label>
        <label className="field">Description<textarea defaultValue={p.description} onBlur={(e) => e.target.value !== p.description && act(() => api('PATCH', `/api/projects/${id}`, { description: e.target.value }))} /></label>
        <div className="row">
          <a className="btn" href={`/api/projects/${id}/export`}>Export policy JSON</a>
          <button className="danger" onClick={() => confirm(`Delete project “${p.name}”? Its environments and policy are deleted. Past sessions, results and screenshots are kept without the project link.`) && act(async () => { await api('DELETE', `/api/projects/${id}`); go('/projects'); })}>Delete project</button>
        </div>
        <small className="muted">Projects never store credentials. Sign in through the remote browser with test accounts.</small>
      </div>

      <div className="card grid">
        <h2>Environments</h2>
        <table><thead><tr><th>Name</th><th>URL</th><th>Default</th><th /></tr></thead><tbody>
          {p.environments.map((e: any) => <tr key={e.id}><td>{e.name}</td><td><code>{e.baseUrl}</code></td><td>{e.isDefault ? 'yes' : ''}</td>
            <td><button className="danger" onClick={() => confirm(`Delete environment “${e.name}”?`) && act(() => api('DELETE', `/api/projects/${id}/environments/${e.id}`))}>Delete</button></td></tr>)}
        </tbody></table>
        <div className="row">
          <label className="field">Name<input value={env.name} onChange={(e) => setEnv({ ...env, name: e.target.value })} placeholder="staging" /></label>
          <label className="field" style={{ flex: 1 }}>URL<input value={env.baseUrl} onChange={(e) => setEnv({ ...env, baseUrl: e.target.value })} placeholder="https://staging.example.com" /></label>
          <label className="row"><input type="checkbox" checked={env.isDefault} onChange={(e) => setEnv({ ...env, isDefault: e.target.checked })} /> Default</label>
          <button disabled={!env.name || !env.baseUrl} onClick={() => act(async () => { await api('POST', `/api/projects/${id}/environments`, env); setEnv({ name: '', baseUrl: '', isDefault: false }); })}>Add environment</button>
        </div>
        <small className="muted">Production URLs only if you deliberately add them. Testing one version does not prove intermediate versions work.</small>
      </div>

      <div className="card grid">
        <h2>Browser support policy</h2>
        <div className="scroll-x"><table><thead><tr><th>Browser</th><th>Channel</th><th>Version</th><th>OS</th><th>Kind</th><th>Required</th><th /></tr></thead><tbody>
          {policy.map((t, i) => {
            const set = (patch: Partial<PolicyTarget>) => setPolicy(policy.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <tr key={i}>
                <td><select aria-label="Browser" value={t.family} onChange={(e) => set({ family: e.target.value as PolicyTarget['family'], targetOs: e.target.value === 'safari' ? 'mac' : 'linux' })}>{FAMILIES.map((f) => <option key={f}>{f}</option>)}</select></td>
                <td><select aria-label="Channel" value={t.channel} onChange={(e) => set({ channel: e.target.value as PolicyTarget['channel'] })}><option>stable</option><option>esr</option><option>beta</option></select></td>
                <td><input aria-label="Major version" value={t.requestedVersion} disabled={t.kind === 'newest-provisioned'} onChange={(e) => set({ requestedVersion: e.target.value })} size={6} /></td>
                <td><select aria-label="OS" value={t.targetOs} onChange={(e) => set({ targetOs: e.target.value as PolicyTarget['targetOs'] })}><option>linux</option><option>mac</option></select></td>
                <td><select aria-label="Kind" value={t.kind} onChange={(e) => set({ kind: e.target.value as PolicyTarget['kind'], requestedVersion: e.target.value === 'newest-provisioned' ? 'newest' : t.requestedVersion })}><option value="minimum">minimum</option><option value="exact">exact</option><option value="newest-provisioned">newest provisioned</option></select></td>
                <td><input type="checkbox" aria-label="Required" checked={t.required} onChange={(e) => set({ required: e.target.checked })} /></td>
                <td><button onClick={() => setPolicy(policy.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            );
          })}
        </tbody></table></div>
        <div className="row">
          <button onClick={() => setPolicy([...policy, blankTarget])}>Add target</button>
          <button className="primary" disabled={policy.some((t) => !t.requestedVersion)} onClick={() => act(() => api('PUT', `/api/projects/${id}/policy`, { targets: policy }))}>Save policy</button>
        </div>
        <small className="muted">ESR is a separate channel: Firefox 115 ESR is not Firefox 115. Within a major version BrowserLab tests the exact patch build provisioned in the catalogue and records it.</small>
      </div>

      <div className="card">
        <h2>Compatibility matrix</h2>
        {matrix.length ? (
          <div className="scroll-x"><table><thead><tr><th>Target</th><th>Build</th><th>Availability</th><th>Latest result</th><th>Actual version</th><th>Tested</th><th>Evidence</th><th /></tr></thead><tbody>
            {matrix.map((m, i) => (
              <tr key={i}>
                <td>{m.target.family} {m.target.kind === 'newest-provisioned' ? 'newest provisioned' : `${m.target.kind} ${m.target.requestedVersion}${m.target.channel === 'esr' ? ' ESR' : ''}`} · {m.target.targetOs}{m.target.required ? '' : ' (optional)'}</td>
                <td>{m.build ? `${m.build.brand} ${m.build.requestedVersion}` : '—'}</td>
                <td><StatusBadge value={m.availability} /><br /><small className="muted">{m.availability !== 'ready' ? m.reason : ''}</small></td>
                <td>{m.last ? <a href={`#/session/${m.last.sessionId}`}><StatusBadge value={m.last.outcome} /></a> : <StatusBadge value="not-run" />}{m.last?.failure && <><br /><small className="muted">{m.last.failure}</small></>}</td>
                <td>{m.last?.actualVersion ?? '—'}</td>
                <td>{m.last ? new Date(m.last.testedAt).toLocaleDateString() : '—'}</td>
                <td>{m.last?.evidence ?? 0}</td>
                <td>{m.build && m.availability === 'ready' && <a className="btn" href={`#/?project=${id}&build=${m.build.id}`}>Launch</a>}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="muted">Add policy targets to see the matrix. Unavailable is not the same as failed.</p>}
      </div>
    </main>
  );
}
