// Terminates VNC password authentication server-side so the password never reaches the browser.
// Upstream (e.g. macOS Screen Sharing over an SSH tunnel) gets RFB 3.8 + VNC auth; the viewer is offered security type None.
import { createCipheriv } from 'node:crypto';

/** VNC uses DES with each key byte's bits reversed. 3DES-EDE with K1=K2=K3 is single DES and is in OpenSSL's default provider. */
export function vncAuthResponse(challenge: Buffer, password: string): Buffer {
  const key = Buffer.alloc(8);
  Buffer.from(password, 'latin1').copy(key, 0, 0, 8);
  for (let i = 0; i < 8; i++) {
    let b = key[i], r = 0;
    for (let j = 0; j < 8; j++) { r = (r << 1) | (b & 1); b >>= 1; }
    key[i] = r;
  }
  return desEcb(Buffer.concat([key, key, key]), challenge);
}

export function desEcb(key24: Buffer, data: Buffer): Buffer {
  const c = createCipheriv('des-ede3-ecb', key24, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

/** Buffered reader over a push-based byte source. */
export class ByteReader {
  private buf = Buffer.alloc(0);
  private waiter: (() => void) | null = null;
  private error: Error | null = null;
  push(chunk: Buffer) { this.buf = Buffer.concat([this.buf, chunk]); this.waiter?.(); }
  fail(err: Error) { this.error = err; this.waiter?.(); }
  async read(n: number, timeoutMs = 10_000): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      if (this.error) throw this.error;
      if (Date.now() > deadline) throw new Error('VNC handshake timed out');
      await new Promise<void>((r) => { this.waiter = r; setTimeout(r, 250); });
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
  drain(): Buffer { const b = this.buf; this.buf = Buffer.alloc(0); return b; }
}

/** Client side of RFB 3.8 with VNC authentication (type 2). Resolves once the upstream accepted the password. */
export async function authenticateUpstream(r: ByteReader, write: (b: Buffer) => void, password: string) {
  const version = (await r.read(12)).toString('latin1');
  if (!/^RFB \d{3}\.\d{3}\n$/.test(version)) throw new Error('upstream is not a VNC server');
  write(Buffer.from('RFB 003.008\n'));
  const n = (await r.read(1))[0];
  if (n === 0) throw new Error(`VNC server refused connection: ${(await r.read((await r.read(4)).readUInt32BE(0))).toString()}`);
  const types = [...(await r.read(n))];
  if (!types.includes(2)) throw new Error(`VNC server does not offer password authentication (offers ${types.join(',')})`);
  write(Buffer.from([2]));
  write(vncAuthResponse(await r.read(16), password));
  if ((await r.read(4)).readUInt32BE(0) !== 0) throw new Error('VNC password rejected by the worker');
}

/** Server side towards the viewer: RFB 3.8 offering only security type None. */
export async function greetViewer(r: ByteReader, write: (b: Buffer) => void) {
  write(Buffer.from('RFB 003.008\n'));
  await r.read(12);
  write(Buffer.from([1, 1]));
  if ((await r.read(1))[0] !== 1) throw new Error('viewer chose an unsupported security type');
  write(Buffer.from([0, 0, 0, 0]));
}
