import { Fragment, useEffect, useState } from 'react';
import { api, errorText } from '../api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';

export function Settings() {
  const [h, setH] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { api('GET', '/api/health').then(setH).catch((e) => setError(errorText(e))); }, []);
  return (
    <main className="page">
      <h1>Settings & help</h1>
      {error && <div className="callout bad">{error}</div>}
      {h && (
        <div className="grid two">
          <div className="card">
            <h2>Health</h2>
            <dl className="kv">
              <dt>API</dt><dd><StatusBadge value={h.status === 'ok' ? 'ready' : 'offline'} /></dd>
              <dt>Database</dt><dd>{h.db}</dd>
              <dt>Selenium Grid</dt><dd>{h.gridRelease}</dd>
              {h.workers.map((w: any) => <Fragment key={w.name}><dt>Worker “{w.name}”</dt><dd><StatusBadge value={w.status === 'ready' ? 'ready' : 'offline'} /> {w.os ?? ''} {w.arch ?? ''} {w.slots !== undefined ? `· ${w.slots} slots` : w.code}</dd></Fragment>)}
              <dt>Sessions</dt><dd>{h.sessions.active} active of {h.sessions.max}</dd>
              <dt>Safari desktop</dt><dd>{h.safari.desktopConfigured ? 'configured' : 'not configured (needs a Mac worker)'}</dd>
            </dl>
          </div>
          <div className="card">
            <h2>Limits</h2>
            <p className="muted">Set in <code>.env</code> and applied with <code>docker compose up -d</code>.</p>
            <dl className="kv">
              <dt>Idle timeout</dt><dd>{h.limits.idleMinutes} min <code>BROWSERLAB_IDLE_TIMEOUT_MINUTES</code></dd>
              <dt>Max session</dt><dd>{h.limits.maxSessionMinutes} min <code>BROWSERLAB_MAX_SESSION_MINUTES</code></dd>
              <dt>Concurrent sessions</dt><dd>{h.sessions.max} <code>BROWSERLAB_MAX_CONCURRENT_SESSIONS</code></dd>
              <dt>File transfer cap</dt><dd>{h.limits.maxTransferMB} MB <code>BROWSERLAB_MAX_TRANSFER_MB</code></dd>
              <dt>Evidence retention</dt><dd>{h.limits.retentionDays > 0 ? `${h.limits.retentionDays} days after a session ends` : 'kept forever'} <code>BROWSERLAB_RETENTION_DAYS</code></dd>
              <dt>Private/local URLs</dt><dd>{h.limits.trustedPrivateUrls ? 'allowed (trusted local tester mode)' : 'blocked'} <code>BROWSERLAB_TRUSTED_PRIVATE_URLS</code></dd>
            </dl>
          </div>
        </div>
      )}
      <div className="card">
        <h2>Help</h2>
        <ul>
          <li><b>Testing an app on your own computer:</b> use <code>http://host.docker.internal:PORT</code>; <code>localhost</code> inside the remote browser is the browser's container. See <code>docs/LOCALHOST-AND-STAGING.md</code>.</li>
          <li><b>Missing a version or “unsupported architecture”:</b> historical Chrome/Edge builds are Linux amd64 only. Use an amd64 worker; see <code>docs/BROWSER-SUPPORT.md</code> and <code>docs/ADD-BROWSER-VERSION.md</code>.</li>
          <li><b>Safari</b> needs a real Mac running the Safari version you want: <code>docs/SAFARI-WORKER.md</code>.</li>
          <li><b>Security:</b> legacy browsers have unpatched vulnerabilities. Only test sites you trust, with test accounts and synthetic data. Screenshots may contain sensitive data and stay on this machine. See <code>docs/SECURITY-AND-PRIVACY.md</code>.</li>
          <li><b>Troubleshooting:</b> <code>docs/TROUBLESHOOTING.md</code>, or run <code>npm run doctor</code>.</li>
        </ul>
        <p className="muted">BrowserLab is free, open-source (Apache-2.0) software with no accounts, analytics or telemetry. Browser names are trademarks of their owners and are used only to identify the browsers.</p>
      </div>
    </main>
  );
}
