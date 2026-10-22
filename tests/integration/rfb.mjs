// Minimal RFB (VNC) client over WebSocket for tests: handshake (security None), pointer/key input, 1-pixel framebuffer reads.
export async function connectRfb(url, { headers } = {}) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(url, { headers });
  let buf = Buffer.alloc(0);
  let wake = null;
  ws.on('message', (d) => { buf = Buffer.concat([buf, d]); wake?.(); });
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); ws.once('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); });
  const need = async (n) => {
    const deadline = Date.now() + 15000;
    while (buf.length < n) {
      if (Date.now() > deadline) throw new Error(`RFB timeout waiting for ${n} bytes`);
      await new Promise((r) => { wake = r; setTimeout(r, 200); });
    }
    const out = buf.subarray(0, n); buf = buf.subarray(n); return out;
  };
  const version = (await need(12)).toString();
  ws.send(Buffer.from('RFB 003.008\n'));
  const n = (await need(1))[0];
  const types = [...(await need(n))];
  if (!types.includes(1)) throw new Error(`no None security offered: ${types}`);
  ws.send(Buffer.from([1]));
  const secResult = (await need(4)).readUInt32BE(0);
  if (secResult !== 0) throw new Error(`security failed ${secResult}`);
  ws.send(Buffer.from([1])); // ClientInit: shared
  const init = await need(24);
  const width = init.readUInt16BE(0), height = init.readUInt16BE(2);
  const pf = { bpp: init[4], bigEndian: init[6] === 1, rMax: init.readUInt16BE(8), gMax: init.readUInt16BE(10), bMax: init.readUInt16BE(12), rShift: init[14], gShift: init[15], bShift: init[16] };
  await need(init.readUInt32BE(20)); // desktop name
  ws.send(Buffer.from([2, 0, 0, 1, 0, 0, 0, 0])); // SetEncodings: raw only
  const send = (b) => ws.send(Buffer.from(b));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = {
    version, types, width, height, closed, ws,
    pointer(mask, x, y) { const b = Buffer.alloc(6); b[0] = 5; b[1] = mask; b.writeUInt16BE(x, 2); b.writeUInt16BE(y, 4); send(b); },
    async click(x, y) { api.pointer(0, x, y); await sleep(150); api.pointer(1, x, y); await sleep(80); api.pointer(0, x, y); await sleep(250); },
    key(down, keysym) { const b = Buffer.alloc(8); b[0] = 4; b[1] = down ? 1 : 0; b.writeUInt32BE(keysym, 4); send(b); },
    async tap(keysym) { api.key(true, keysym); api.key(false, keysym); await sleep(40); },
    async type(text) { for (const c of text) await api.tap(c.codePointAt(0)); },
    async combo(mod, keysym) { api.key(true, mod); await api.tap(keysym); api.key(false, mod); await sleep(80); },
    /** Reads one pixel; returns [r,g,b] scaled to 0-255. */
    async pixel(x, y) {
      const req = Buffer.alloc(10); req[0] = 3; req[1] = 0; req.writeUInt16BE(x, 2); req.writeUInt16BE(y, 4); req.writeUInt16BE(1, 6); req.writeUInt16BE(1, 8); send(req);
      for (;;) {
        const type = (await need(1))[0];
        if (type === 0) {
          await need(1); const rects = (await need(2)).readUInt16BE(0);
          let px = null;
          for (let i = 0; i < rects; i++) {
            const h = await need(12); const w = h.readUInt16BE(4), hh = h.readUInt16BE(6), enc = h.readInt32BE(8);
            if (enc !== 0) throw new Error(`unexpected encoding ${enc}`);
            const data = await need(w * hh * (pf.bpp / 8));
            const v = pf.bpp === 32 ? (pf.bigEndian ? data.readUInt32BE(0) : data.readUInt32LE(0)) : (pf.bigEndian ? data.readUInt16BE(0) : data.readUInt16LE(0));
            px ??= [((v >> pf.rShift) & pf.rMax) * 255 / pf.rMax, ((v >> pf.gShift) & pf.gMax) * 255 / pf.gMax, ((v >> pf.bShift) & pf.bMax) * 255 / pf.bMax].map(Math.round);
          }
          if (px) return px;
        } else if (type === 2) { /* bell */ } else if (type === 3) { await need(3); await need((await need(4)).readUInt32BE(0)); } else throw new Error(`unexpected server message ${type}`);
      }
    },
    close() { ws.close(); },
  };
  return api;
}

export const KEY = { Return: 0xff0d, Control: 0xffe3, Tab: 0xff09, End: 0xff57, Escape: 0xff1b };
export const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
