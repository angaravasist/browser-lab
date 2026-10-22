import { useState } from 'react';
import { api, errorText } from '../api.ts';

/** Stage a local file for the remote browser's file chooser; list and fetch files the remote browser downloaded. */
export function FileTransfer({ sessionId, uploads, downloads, attached }: { sessionId: string; uploads: boolean; downloads: boolean; attached: boolean }) {
  const [staged, setStaged] = useState<Array<{ name: string; remotePath: string }>>([]);
  const [names, setNames] = useState<string[] | null>(null);
  const [msg, setMsg] = useState('');
  if (!attached) return <p className="muted">File transfer needs the WebDriver connection, which ends after manual handover (Safari). Stage files before handing over.</p>;

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setMsg('Uploading…');
    try {
      const r = await api<{ name: string; remotePath: string }>('POST', `/api/sessions/${sessionId}/files`, await f.arrayBuffer(), { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) });
      setStaged((s) => [...s, r]);
      setMsg('');
    } catch (e) { setMsg(errorText(e)); }
  };
  const refresh = async () => { try { setNames((await api<{ names: string[] }>('GET', `/api/sessions/${sessionId}/downloads`)).names); setMsg(''); } catch (e) { setMsg(errorText(e)); } };
  const keep = async (n: string) => { try { await api('POST', `/api/sessions/${sessionId}/downloads/${encodeURIComponent(n)}/evidence`); setMsg(`Saved ${n} as evidence.`); } catch (e) { setMsg(errorText(e)); } };

  return (
    <div className="grid">
      {uploads ? (
        <div>
          <label className="field">Stage a file for upload <input type="file" onChange={(e) => upload(e.target.files?.[0])} /></label>
          <small className="muted">The file is copied into this session's browser container only and deleted when the session ends. In the remote page, open the file chooser, press Ctrl+L and type the path below (or send it with the viewer's Clipboard box and press Ctrl+V).</small>
          {staged.map((s) => (
            <p key={s.remotePath}><code>{s.remotePath}</code> <button onClick={() => navigator.clipboard?.writeText(s.remotePath)}>Copy path</button></p>
          ))}
        </div>
      ) : <p className="muted">Uploads: unsupported for this browser build.</p>}
      {downloads ? (
        <div>
          <button onClick={refresh}>List files the remote browser downloaded</button>
          {names && !names.length && <p className="muted">No downloads yet.</p>}
          {names?.map((n) => (
            <p key={n}><a href={`/api/sessions/${sessionId}/downloads/${encodeURIComponent(n)}`} download>{n}</a> <button onClick={() => keep(n)}>Save as evidence</button></p>
          ))}
        </div>
      ) : <p className="muted">Downloads: unsupported for this browser build.</p>}
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}
