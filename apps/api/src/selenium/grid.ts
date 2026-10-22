// Thin layer over the official selenium-webdriver binding and Grid's /status endpoint.
import webdriver from 'selenium-webdriver';
import http from 'selenium-webdriver/http/index.js';
import command from 'selenium-webdriver/lib/command.js';

const { WebDriver, Capabilities } = webdriver;
export type Driver = InstanceType<typeof WebDriver>;
const { Command, Name } = command;

export interface GridSlot { catalogId?: string; busy: boolean; sessionId?: string }
export interface GridNode { arch: string; os: string; slots: GridSlot[]; availability: string }
export interface GridStatus { ready: boolean; nodes: GridNode[] }

/** Normalises CPU names reported by Java/Docker/Node to amd64 | arm64. */
export const normArch = (a: string | undefined) => (a ? ({ x86_64: 'amd64', amd64: 'amd64', aarch64: 'arm64', arm64: 'arm64' } as Record<string, string>)[a.toLowerCase()] ?? a : undefined);

export async function gridStatus(url: string, timeoutMs = 3000): Promise<GridStatus> {
  const r = await fetch(`${url}/status`, { signal: AbortSignal.timeout(timeoutMs) });
  const { value } = (await r.json()) as { value: { ready: boolean; nodes?: Array<Record<string, any>> } };
  return {
    ready: value.ready,
    nodes: (value.nodes ?? []).map((n) => ({
      arch: normArch(n.osInfo?.arch) ?? 'unknown',
      os: String(n.osInfo?.name ?? 'unknown'),
      availability: String(n.availability ?? 'UP'),
      slots: (n.slots ?? []).map((s: any) => ({ catalogId: s.stereotype?.['browserlab:catalogId'], busy: !!s.session, sessionId: s.session?.sessionId })),
    })),
  };
}

/** Grid-specific commands (uploads, managed downloads) the typings do not describe. */
export const gridCommand = async (driver: Driver, name: 'UPLOAD_FILE' | 'GET_DOWNLOADABLE_FILES' | 'DOWNLOAD_FILE', params: Record<string, unknown> = {}): Promise<any> => {
  const cmd = new Command((Name as unknown as Record<string, string>)[name]);
  for (const [k, v] of Object.entries(params)) cmd.setParameter(k, v);
  return driver.execute(cmd);
};

const executor = (url: string) => new http.Executor(new http.HttpClient(url));

export async function createDriver(gridUrl: string, caps: Record<string, unknown>): Promise<Driver> {
  const driver = WebDriver.createSession(executor(gridUrl), new Capabilities(caps));
  await driver.getSession();
  return driver;
}

/** Capability map returned by the remote end, as a plain object. */
export async function sessionCaps(driver: Driver): Promise<Record<string, any>> {
  const caps = await driver.getCapabilities();
  return Object.fromEntries([...caps.keys()].map((k) => [k, caps.get(k)]));
}

export async function deleteGridSession(gridUrl: string, sessionId: string) {
  await fetch(`${gridUrl}/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE', signal: AbortSignal.timeout(90_000) }).catch(() => undefined);
}

/** True if the Grid still holds this session (or cannot be asked, which is treated as "maybe still there"). */
export async function gridHasSession(gridUrl: string, sessionId: string): Promise<boolean> {
  try { return (await gridStatus(gridUrl)).nodes.some((n) => n.slots.some((s) => s.sessionId === sessionId)); } catch { return true; }
}

export const vncWsUrl = (gridUrl: string, sessionId: string) => `${gridUrl.replace(/^http/, 'ws')}/session/${encodeURIComponent(sessionId)}/se/vnc`;
