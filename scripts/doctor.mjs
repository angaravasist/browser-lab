#!/usr/bin/env node
// Host-side diagnostics (works on Windows, macOS, Linux). Read-only unless --fix is given.
// Usage: npm run doctor [-- --fix] [-- --check-url http://host.docker.internal:8080]
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { fix: { type: 'boolean', default: false }, 'check-url': { type: 'string' } } });
const port = process.env.BROWSERLAB_PORT ?? '3000';
let problems = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (code, m, fix) => { problems++; console.log(`  FAIL  [${code}] ${m}${fix ? `\n        → ${fix}` : ''}`); };
const info = (m) => console.log(`  info  ${m}`);
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };

console.log('BrowserLab doctor');
const arch = run('docker', ['info', '--format', '{{.Architecture}} {{.OSType}} {{.ServerVersion}}']);
if (!arch) { bad('DOCKER_NOT_RUNNING', 'Docker is not reachable.', 'Start Docker Desktop / the Docker service, then: docker compose up -d --build'); process.exit(1); }
ok(`Docker ${arch}`);
if (/aarch64|arm64/.test(arch)) info('ARM64 host: historical Chrome/Edge builds are amd64-only and show as "unsupported architecture". Use a dedicated amd64 worker (docs/INSTALLATION.md).');

const ps = run('docker', ['compose', 'ps', '--format', 'json']);
const services = ps ? ps.split('\n').filter(Boolean).flatMap((l) => { const v = JSON.parse(l); return Array.isArray(v) ? v : [v]; }) : [];
for (const name of ['app', 'grid']) {
  const s = services.find((x) => x.Service === name);
  if (!s) bad('WORKER_OFFLINE', `Service "${name}" is not running.`, 'docker compose up -d --build');
  else if (s.Health && s.Health !== 'healthy') bad(name === 'grid' ? 'GRID_UNAVAILABLE' : 'WORKER_OFFLINE', `Service "${name}" is ${s.Health}.`, `docker compose logs ${name}` + (name === 'grid' ? ' (first start pulls browser images; wait a few minutes)' : ''));
  else ok(`service ${name} ${s.State}${s.Health ? ` (${s.Health})` : ''}`);
  for (const p of s?.Publishers ?? []) if (p.PublishedPort && !['127.0.0.1', '::1'].includes(p.URL)) bad('EXPOSED_PORT', `${name} publishes port ${p.PublishedPort} on ${p.URL || 'all interfaces'}.`, 'Keep BROWSERLAB_BIND_HOST=127.0.0.1 unless you deliberately run trusted-LAN mode.');
  if (name === 'grid' && (s?.Publishers ?? []).some((p) => p.PublishedPort)) bad('EXPOSED_PORT', 'Selenium Grid is published to the host.', 'Remove the ports: entry for grid.');
}

try {
  const h = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) })).json();
  ok(`API healthy, database ${h.db}, Selenium Grid ${h.gridRelease}`);
  for (const w of h.workers) {
    if (w.status === 'ready') ok(`worker "${w.name}" ready (${w.os} ${w.arch}, ${w.slots} slots)`);
    else bad(w.code ?? 'WORKER_OFFLINE', `worker "${w.name}" is ${w.status}.`, 'Check BROWSERLAB_GRID_URLS and the worker logs.');
  }
  const { builds } = await (await fetch(`http://127.0.0.1:${port}/api/browser-builds`)).json();
  for (const b of builds) info(`${b.availability.padEnd(24)} ${b.brand} ${b.requestedVersion}${b.channel === 'esr' ? ' ESR' : ''} (${b.id})${b.availability === 'ready' ? '' : ` — ${b.reason}`}`);
  if (!builds.some((b) => b.availability === 'ready')) bad('VERSION_UNAVAILABLE', 'No browser build is ready.', 'docker compose logs grid');
} catch { bad('GRID_UNAVAILABLE', `BrowserLab API not reachable on http://127.0.0.1:${port}.`, 'docker compose up -d --build; docker compose logs app'); }

// Orphans: Grid-started browser containers that no Grid session owns (e.g. after a Grid crash).
const status = run('docker', ['compose', 'exec', '-T', 'grid', 'curl', '-s', 'http://127.0.0.1:4444/status']);
const owned = new Set();
if (status) for (const n of JSON.parse(status).value.nodes ?? []) for (const s of n.slots) if (s.session) owned.add(s.session.capabilities?.['se:containerName']);
const containers = (run('docker', ['ps', '--filter', 'name=browser-', '--filter', 'label=com.docker.compose.project=browserlab', '--format', '{{.ID}} {{.Names}} {{.CreatedAt}}']) ?? '').split('\n').filter(Boolean);
for (const line of containers) {
  const [id, name, ...created] = line.split(' ');
  const hostname = run('docker', ['inspect', '-f', '{{.Config.Hostname}}', id]);
  const age = Date.now() - Date.parse(created.slice(0, 2).join('T') + created[2]);
  if (owned.has(hostname) || !(age > 120_000)) continue;
  if (a.fix) { run('docker', ['rm', '-f', id]); info(`removed orphaned browser container ${name}`); }
  else bad('ORPHAN_CONTAINER', `Browser container ${name} is not owned by any Grid session.`, 'npm run doctor -- --fix');
}
if (!containers.length) ok('no stray browser containers');

if (a['check-url']) {
  const code = run('docker', ['compose', 'exec', '-T', 'grid', 'curl', '-s', '-o', '/dev/null', '-m', '10', '-w', '%{http_code}', a['check-url']]);
  if (code && code !== '000') ok(`${a['check-url']} reachable from the browser network (HTTP ${code})`);
  else bad('HOST_URL_NOT_REACHABLE', `${a['check-url']} is not reachable from the browser network.`, 'Use http://host.docker.internal:PORT for apps on this computer, make the app listen on 0.0.0.0, and see docs/LOCALHOST-AND-STAGING.md.');
}
console.log(problems ? `\n${problems} problem(s) found.` : '\nNo problems found.');
process.exit(problems ? 1 : 0);
