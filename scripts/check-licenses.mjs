#!/usr/bin/env node
// Fails if any production dependency is not under an allowed open-source licence (SPDX: one OR-alternative whose AND-parts are all allowed).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0', '0BSD', 'BlueOak-1.0.0', 'Unlicense', 'CC0-1.0', 'Python-2.0', 'Zlib']);
const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const seen = new Map();
(function walk(deps) {
  for (const d of Object.values(deps ?? {})) {
    if (!d.path || seen.has(d.path)) continue;
    const pkg = JSON.parse(readFileSync(path.join(d.path, 'package.json'), 'utf8'));
    seen.set(d.path, { name: `${pkg.name}@${pkg.version}`, license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN', private: pkg.private });
    walk(d.dependencies);
  }
})(tree.dependencies);
const bad = [...seen.values()].filter((p) => !p.private && !p.license.replace(/[()]/g, '').split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((l) => ALLOWED.has(l.trim()))));
for (const p of bad) console.error(`not allowed: ${p.name} (${p.license})`);
console.log(`${seen.size} production packages checked, ${bad.length} not allowed.`);
process.exit(bad.length ? 1 : 0);
