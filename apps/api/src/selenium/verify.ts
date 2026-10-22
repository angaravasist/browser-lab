// Layered browser identity: provenance + WebDriver capabilities + the browser's own version page.
// User-agent data is recorded as supplementary only (Firefox reports x86_64 on arm64; Chrome freezes UA minor versions).
import type { CatalogEntry, Verification } from '@browserlab/shared';
import type { Driver } from './grid.ts';

export interface ExecutableFacts { product?: string; version?: string; channel?: string; officialBuild?: boolean; path?: string }

/** Parses chrome://version or edge://version innerText. */
export function parseChromiumVersionPage(text: string): ExecutableFacts {
  const m = text.match(/^(Google Chrome|Microsoft Edge|Chromium)[^\S\n]*\t?\s*(\d+\.\d+\.\d+\.\d+)\s*\(([^)]*)\)/m);
  return {
    product: m?.[1],
    version: m?.[2],
    officialBuild: m ? /^official build$/i.test(m[3]) : undefined,
    path: text.match(/^Executable path\t(.+)$/im)?.[1]?.trim(),
  };
}

const FIREFOX_SUPPORT_SCRIPT = `const g = (id) => (document.getElementById(id) || {}).textContent?.trim();
return { product: g('application-box'), version: g('version-box'), channel: g('updatechannel-box'), path: g('binary-box'), buildId: g('buildid-box') };`;

async function readExecutable(driver: Driver, entry: CatalogEntry): Promise<ExecutableFacts & { buildId?: string }> {
  // A throwaway tab keeps the user's tab history free of internal pages.
  const original = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  try {
    if (entry.family === 'firefox') {
      await driver.get('about:support');
      for (let i = 0; i < 20; i++) {
        const f = (await driver.executeScript(FIREFOX_SUPPORT_SCRIPT)) as ExecutableFacts & { buildId?: string };
        if (f.version) return f;
        await new Promise((r) => setTimeout(r, 250));
      }
      return {};
    }
    await driver.get(entry.family === 'edge' ? 'edge://version' : 'chrome://version');
    return parseChromiumVersionPage((await driver.executeScript('return document.body.innerText')) as string);
  } finally {
    await driver.close();
    await driver.switchTo().window(original);
  }
}

const DRIVER_VERSION_KEYS = ['chrome', 'msedge'] as const;
const EXPECTED_BROWSER_NAMES: Record<CatalogEntry['family'], string[]> = {
  chrome: ['chrome'], edge: ['msedge', 'microsoftedge'], firefox: ['firefox'], safari: ['safari'],
};

export interface Facts {
  caps: Record<string, any>;
  nodeArch?: string;
  executable?: ExecutableFacts & { buildId?: string };
  supplementary?: Verification['supplementary'];
}

export async function collectFacts(driver: Driver, caps: Record<string, any>, entry: CatalogEntry, nodeArch?: string): Promise<Facts> {
  const facts: Facts = { caps, nodeArch };
  try {
    facts.supplementary = (await driver.executeScript(
      'return { navigatorPlatform: navigator.platform, uaBrands: navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand) : undefined }',
    )) as Facts['supplementary'];
  } catch { /* supplementary only */ }
  if (entry.family !== 'safari') facts.executable = await readExecutable(driver, entry);
  return facts;
}

/** Pure decision: does the running browser match the catalogue entry exactly? */
export function evaluate(entry: CatalogEntry, facts: Facts): Verification {
  const c = facts.caps;
  const mismatches: string[] = [];
  const driverVersion = c['moz:geckodriverVersion'] ?? DRIVER_VERSION_KEYS.map((k) => c[k]?.[`${k === 'chrome' ? 'chromedriver' : 'msedgedriver'}Version`]).find(Boolean);
  const browserVersion: string | undefined = c.browserVersion;

  if (!EXPECTED_BROWSER_NAMES[entry.family].includes(String(c.browserName ?? '').toLowerCase())) mismatches.push(`browserName "${c.browserName}" is not ${entry.brand}`);
  if (!browserVersion || !new RegExp(entry.versionMatch).test(browserVersion)) mismatches.push(`browserVersion "${browserVersion}" does not match ${entry.versionMatch}`);
  const platform = String(c.platformName ?? '').toLowerCase();
  if (!(platform === entry.platformName || (entry.platformName === 'mac' && ['mac', 'macos', 'darwin'].includes(platform)))) mismatches.push(`platformName "${c.platformName}" is not ${entry.platformName}`);
  if (c['browserlab:catalogId'] !== undefined && c['browserlab:catalogId'] !== entry.id) mismatches.push(`served by catalogue slot "${c['browserlab:catalogId']}"`);
  if (facts.nodeArch && !entry.architectures.includes(facts.nodeArch as 'amd64' | 'arm64')) mismatches.push(`worker architecture ${facts.nodeArch} not in ${entry.architectures.join('/')}`);
  if (driverVersion && entry.driverVersion && !entry.driverVersion.includes(String(driverVersion).split(' ')[0])) mismatches.push(`driver ${driverVersion} is not ${entry.driverVersion}`);

  const x = facts.executable;
  let level: Verification['level'] = 'capabilities';
  if (entry.family !== 'safari') {
    if (!x?.version) mismatches.push('could not read the browser executable version page');
    else {
      level = 'executable';
      if (entry.executableProduct && x.product !== entry.executableProduct) mismatches.push(`executable product "${x.product}" is not "${entry.executableProduct}"`);
      // about:support shows ESR builds as e.g. "115.43.1esr"; the channel is checked separately below.
      if (x.version.replace(/esr$/, '') !== browserVersion) mismatches.push(`executable version ${x.version} differs from WebDriver ${browserVersion}`);
      if (entry.family !== 'firefox' && x.officialBuild !== true) mismatches.push('not an official vendor build');
      if (entry.updateChannel && x.channel !== entry.updateChannel) mismatches.push(`update channel "${x.channel}" is not "${entry.updateChannel}"`);
    }
  }

  return {
    level,
    ok: mismatches.length === 0,
    mismatches,
    provenance: { catalogId: entry.id, image: entry.image, imageDigest: entry.imageDigest, sourceUrl: entry.sourceUrl, buildRecipe: entry.buildRecipe },
    capabilities: { browserName: c.browserName, browserVersion, platformName: c.platformName, driverVersion: driverVersion ? String(driverVersion) : undefined, buildId: c['moz:buildID'], nodeArch: facts.nodeArch },
    executable: x ? { product: x.product, version: x.version, channel: x.channel, officialBuild: x.officialBuild, path: x.path } : undefined,
    supplementary: facts.supplementary,
  };
}
