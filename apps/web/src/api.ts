import type { ApiError } from '@browserlab/shared';

export class RequestError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function api<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer;
  const r = await fetch(path, {
    method,
    headers: { ...(body !== undefined && !isRaw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
  });
  if (r.status === 204) return undefined as T;
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const e = (data as ApiError)?.error;
    throw new RequestError(r.status, e?.code ?? 'INTERNAL', e?.message ?? `Request failed (${r.status})`, e?.details);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof RequestError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : String(e));
