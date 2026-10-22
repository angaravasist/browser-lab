import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { api, errorText } from '../api.ts';

type Conn = 'connecting' | 'connected' | 'disconnected' | 'elsewhere';

/** Interactive noVNC canvas connected through BrowserLab's same-origin relay with a single-use token. */
export function VncViewer({ sessionId, active, onCapture, onPopout }: { sessionId: string; active: boolean; onCapture?: (png: Blob) => void; onPopout?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [remoteClip, setRemoteClip] = useState('');
  const [clip, setClip] = useState('');

  useEffect(() => {
    if (!active || !box.current) return;
    let cancelled = false;
    setConn('connecting');
    setError('');
    (async () => {
      try {
        const { token } = await api<{ token: string }>('POST', `/api/sessions/${sessionId}/view-token`);
        if (cancelled || !box.current) return;
        const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sessions/${sessionId}/live?token=${encodeURIComponent(token)}`;
        const r = new RFB(box.current, url, { shared: true });
        r.scaleViewport = true;
        r.resizeSession = false; // resizing the viewer never resizes the browser window or desktop
        r.focusOnClick = true;
        r.addEventListener('connect', () => setConn('connected'));
        r.addEventListener('disconnect', () => setConn((c) => (c === 'elsewhere' ? c : 'disconnected')));
        r.addEventListener('clipboard', (e: CustomEvent<{ text: string }>) => setRemoteClip(e.detail.text));
        r.addEventListener('securityfailure', (e: CustomEvent<{ reason?: string }>) => setError(`Desktop authentication failed: ${e.detail.reason ?? ''}`));
        rfb.current = r;
      } catch (e) { setConn('disconnected'); setError(errorText(e)); }
    })();
    return () => { cancelled = true; rfb.current?.disconnect(); rfb.current = null; };
  }, [sessionId, active, attempt]);

  const capture = () => rfb.current && onCapture && rfb.current.toBlob((b: Blob | null) => b && onCapture(b), 'image/png');

  return (
    <div className="viewer-wrap">
      <div className="viewer-bar" role="toolbar" aria-label="Live desktop">
        <span role="status">Desktop: <b>{conn === 'connected' ? 'connected' : conn === 'elsewhere' ? 'open in another tab' : conn}</b></span>
        {focused && conn === 'connected' && <span className="focus-warn">Keyboard goes to the remote browser. Click outside the desktop to release it.</span>}
        <span style={{ flex: 1 }} />
        {conn !== 'connected' && conn !== 'elsewhere' && <button onClick={() => setAttempt((n) => n + 1)}>Reconnect</button>}
        {onCapture && conn === 'connected' && <button onClick={capture} title="Captures the whole remote desktop as shown in the viewer">Capture desktop</button>}
        {onPopout && <button onClick={() => { rfb.current?.disconnect(); setConn('elsewhere'); onPopout(); }}>Open in new tab</button>}
        {conn === 'elsewhere' && <button onClick={() => setAttempt((n) => n + 1)}>Bring back here</button>}
      </div>
      <div ref={box} className="viewer" aria-label="Remote browser desktop. Click to control it with mouse and keyboard." onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      {error && <div className="callout bad" role="alert" style={{ position: 'absolute', bottom: 8, left: 8, right: 8 }}>{error}</div>}
      <details className="viewer-bar" style={{ display: 'block' }}>
        <summary>Clipboard</summary>
        <div className="row" style={{ marginTop: 6 }}>
          <input aria-label="Text to send to the remote clipboard" value={clip} onChange={(e) => setClip(e.target.value)} placeholder="Text to paste remotely" style={{ flex: 1, background: '#1d2126', color: '#fff' }} />
          <button disabled={!clip || conn !== 'connected'} onClick={() => { rfb.current?.clipboardPasteFrom(clip); }}>Send to remote clipboard</button>
          <span>Then press Ctrl+V inside the remote browser.</span>
        </div>
        {remoteClip && <p>Remote clipboard: <code>{remoteClip.slice(0, 500)}</code> <button onClick={() => navigator.clipboard?.writeText(remoteClip)}>Copy locally</button></p>}
      </details>
    </div>
  );
}
