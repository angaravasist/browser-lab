import { isIP } from 'node:net';
import { fail } from '../errors.ts';

export interface UrlCheck { url: string; private: boolean; warnings: string[] }

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'host.docker.internal' || h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.lan')) return true;
  if (!h.includes('.') && !isIP(h)) return true; // single-label names resolve on private networks only
  if (isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(h) === 6) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/** Validates a URL the user asks a remote browser to open. Never rewrites it. */
export function checkTargetUrl(raw: string, trustedPrivate: boolean): UrlCheck {
  const input = raw.trim();
  if (!input || input.length > 2048) fail('INVALID_URL', 'URL must be 1-2048 characters.');
  // Control characters can smuggle different meanings past logs and parsers.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) fail('INVALID_URL', 'URL contains control characters.');
  let u: URL;
  try { u = new URL(input); } catch { return fail('INVALID_URL', 'Not a valid absolute URL. Include http:// or https://.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') fail('INVALID_URL', `Only http and https URLs are allowed (got ${u.protocol}).`);
  if (u.username || u.password) fail('INVALID_URL', 'Credentials in URLs are not allowed; sign in through the remote browser instead.');
  const priv = isPrivateHost(u.hostname);
  if (priv && !trustedPrivate) fail('INVALID_URL', 'Private and local network URLs are disabled (BROWSERLAB_TRUSTED_PRIVATE_URLS=false).');
  const warnings: string[] = [];
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.startsWith('127.') || h.endsWith('.localhost'))
    warnings.push('LOCALHOST_IN_CONTAINER: "localhost" here means the browser container itself, not your computer. For an app running on your computer use http://host.docker.internal:<port>.');
  return { url: u.href, private: priv, warnings };
}

/** For logs: keeps origin and path, masks query values (they often carry tokens). */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, 'http://x');
    for (const k of [...u.searchParams.keys()]) u.searchParams.set(k, '***');
    u.username = ''; u.password = ''; u.hash = '';
    return raw.startsWith('/') ? u.pathname + u.search : u.href;
  } catch { return '[unparseable url]'; }
}

const SECRET_PARAM = /token|key|secret|pass|auth|session|sig|code|credential|jwt/i;

/** For storage: masks only query values whose names look like secrets, so the tested page stays identifiable. */
export function redactSecrets(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, '***');
  return u.href;
}
