import { useEffect, useState } from 'react';
import type { BrowserBuild } from '@browserlab/shared';
import { api, errorText } from '../api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';

export function Environments() {
  const [builds, setBuilds] = useState<BrowserBuild[]>([]);
  const [grid, setGrid] = useState('');
  const [msg, setMsg] = useState('');
  const load = (refresh = false) => api<{ builds: BrowserBuild[]; gridRelease: string }>(refresh ? 'POST' : 'GET', refresh ? '/api/browser-builds/refresh' : '/api/browser-builds')
    .then((r) => { setBuilds(r.builds); setGrid(r.gridRelease); setMsg(refresh ? 'Workers re-probed.' : ''); }).catch((e) => setMsg(errorText(e)));
  useEffect(() => { load(); }, []);
  return (
    <main className="page">
      <h1>Browser environments</h1>
      <p className="muted">Every build below is a pinned, real vendor browser image from the catalogue (<code>browser-images/catalog.json</code>), Selenium Grid {grid}. A build launches only when its worker confirms it is provisioned; the exact version is checked again at every launch. To add a version, see <code>docs/ADD-BROWSER-VERSION.md</code>.</p>
      <div className="row" style={{ marginBottom: 12 }}><button onClick={() => load(true)}>Re-probe workers</button>{msg && <span role="status">{msg}</span>}</div>
      <div className="card scroll-x">
        <table><thead><tr><th>Browser</th><th>Channel</th><th>OS / CPU</th><th>Worker</th><th>Status</th><th>Last verified</th><th>Capabilities</th><th>Image (diagnostics)</th></tr></thead><tbody>
          {builds.map((b) => (
            <tr key={b.id}>
              <td><b>{b.brand} {b.requestedVersion}</b><br /><small className="muted">{b.id}</small></td>
              <td>{b.channel}</td>
              <td>{b.platformName} / {b.architectures.join(', ')}{b.workerArch && <><br /><small className="muted">worker is {b.workerArch}</small></>}</td>
              <td>{b.worker}<br /><small className="muted">{b.activeSessions} active / max {b.maxConcurrentSessions}</small></td>
              <td><StatusBadge value={b.availability} /><br /><small>{b.reason}</small></td>
              <td>{b.lastVerifiedVersion ? <>{b.lastVerifiedVersion}<br /><small className="muted">{new Date(b.lastVerifiedAt!).toLocaleString()}</small></> : <small className="muted">never launched here</small>}</td>
              <td><small>{Object.entries(b.capabilities).map(([k, v]) => `${k}: ${v ? 'yes' : 'no'}`).join(', ')}</small></td>
              <td className="mono"><small>{b.image ?? '—'}<br />{b.imageDigest ?? (b.buildRecipe ? `built locally: ${b.buildRecipe}` : '')}<br /><a href={b.sourceUrl} target="_blank" rel="noreferrer">source</a></small></td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </main>
  );
}
