import type { CatalogEntry } from '@browserlab/shared';

const GRID_BROWSER_NAME = { chrome: 'chrome', edge: 'MicrosoftEdge', firefox: 'firefox', safari: 'safari' } as const;
/** browserName the remote end reports back after session creation. */
export const REPORTED_BROWSER_NAME = { chrome: 'chrome', edge: 'msedge', firefox: 'firefox', safari: 'safari' } as const;

/**
 * The only place W3C capabilities are built. Everything comes from the trusted catalogue entry;
 * no client-supplied capability, image, video or bind option can reach the Grid.
 */
export function buildCapabilities(entry: CatalogEntry): Record<string, unknown> {
  const caps: Record<string, unknown> = {
    browserName: GRID_BROWSER_NAME[entry.family],
    platformName: entry.platformName,
    'browserlab:catalogId': entry.id,
    // A person drives the browser: WebDriver must never accept or dismiss the page's alert/confirm dialogs.
    unhandledPromptBehavior: 'ignore',
  };
  if (entry.provider === 'selenium-docker') {
    caps['se:vncEnabled'] = true;
    caps['se:downloadsEnabled'] = entry.capabilities.downloads;
  }
  return caps;
}
