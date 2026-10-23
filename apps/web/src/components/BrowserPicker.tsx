import { FAMILIES, type BrowserBuild, type Family } from '@browserlab/shared';
import { StatusBadge } from './StatusBadge.tsx';

const NAMES: Record<Family, [string, string]> = {
  chrome: ['Google Chrome', 'Blink'], firefox: ['Mozilla Firefox', 'Gecko'], edge: ['Microsoft Edge', 'Blink'], safari: ['Apple Safari', 'WebKit'],
};

export const buildLabel = (b: BrowserBuild) => `${b.brand} ${b.requestedVersion}${b.channel === 'esr' ? ' ESR' : ''} · ${b.platformName}/${b.architectures.join('+')}${b.emulation ? ' · emulated' : ''}`;

export function FamilyCards({ builds, value, onChange }: { builds: BrowserBuild[]; value: Family; onChange: (f: Family) => void }) {
  return (
    <div className="families" role="group" aria-label="Browser">
      {FAMILIES.map((f) => {
        const ready = builds.filter((b) => b.family === f && b.availability === 'ready').length;
        return (
          <button key={f} type="button" className="family" aria-pressed={value === f} onClick={() => onChange(f)}>
            <b>{NAMES[f][0]}</b>
            <small>{NAMES[f][1]} · {ready ? `${ready} ready` : 'none ready'}</small>
          </button>
        );
      })}
    </div>
  );
}

export function VersionSelect({ builds, family, value, onChange }: { builds: BrowserBuild[]; family: Family; value: string; onChange: (id: string) => void }) {
  const list = builds.filter((b) => b.family === family);
  const chosen = list.find((b) => b.id === value);
  return (
    <label className="field">Version
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a version…</option>
        {list.map((b) => <option key={b.id} value={b.id}>{buildLabel(b)} — {b.availability === 'ready' ? 'ready' : b.availability.replace(/-/g, ' ')}</option>)}
      </select>
      {chosen && <span className="row"><StatusBadge value={chosen.availability} /> <small>{chosen.reason}</small></span>}
    </label>
  );
}
