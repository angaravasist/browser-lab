import { VIEWPORT_PRESETS } from '@browserlab/shared';

export interface Viewport { width: number; height: number }

export function ViewportPicker({ value, onChange }: { value: Viewport; onChange: (v: Viewport) => void }) {
  const preset = VIEWPORT_PRESETS.find((p) => p.width === value.width && p.height === value.height)?.id ?? 'custom';
  return (
    <div className="grid">
      <label className="field">Viewport
        <select value={preset} onChange={(e) => { const p = VIEWPORT_PRESETS.find((x) => x.id === e.target.value); if (p) onChange({ width: p.width, height: p.height }); }}>
          {VIEWPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
        <small>Sets the real browser window's page area. It is not device or touch emulation.</small>
      </label>
      {preset === 'custom' && (
        <div className="row">
          <label className="field">Width <input type="number" min={320} max={1920} value={value.width} onChange={(e) => onChange({ ...value, width: Number(e.target.value) })} /></label>
          <label className="field">Height <input type="number" min={480} max={1080} value={value.height} onChange={(e) => onChange({ ...value, height: Number(e.target.value) })} /></label>
          <small className="muted">320–1920 × 480–1080</small>
        </div>
      )}
    </div>
  );
}
