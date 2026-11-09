// Reviewed dependency-advisory gate.
//
// Groups `npm audit` output by root advisory, shows every installed copy and the
// lockfile packages that require it, and compares the result with the reviewed
// exception register. It fails on unreviewed advisories, expired reviews and
// "development" exceptions whose affected copies are no longer dev-only.
//
// Usage: node scripts/dependency-audit.mjs [--audit-json FILE] [--lockfile FILE]
//          [--exceptions FILE] [--today YYYY-MM-DD] [--json]
// Without --audit-json it runs `npm audit --json --package-lock-only` (registry access).
// Exit codes: 0 = every advisory reviewed, 1 = review required, 2 = invalid input.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GHSA = /GHSA(-[23456789cfghjmpqrvwx]{4}){3}/;

class InputError extends Error {}

function parseArgs(argv) {
  const options = { lockfile: 'package-lock.json', exceptions: 'security/dependency-exceptions.json', json: false };
  const valued = { '--audit-json': 'auditJson', '--lockfile': 'lockfile', '--exceptions': 'exceptions', '--today': 'today' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (valued[arg] && argv[i + 1] !== undefined) options[valued[arg]] = argv[++i];
    else throw new InputError(`Unknown or incomplete argument: ${arg}`);
  }
  options.today ??= new Date().toISOString().slice(0, 10);
  if (!DATE.test(options.today)) throw new InputError('--today must be YYYY-MM-DD');
  return options;
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new InputError(`Cannot read ${label} ${file}: ${error.message}`);
  }
}

function runNpmAudit() {
  // npm audit exits 1 when it finds vulnerabilities; the JSON on stdout is still the result.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    return execFileSync(npm, ['audit', '--json', '--package-lock-only'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' });
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw new InputError(`npm audit did not return a report: ${error.message}`);
  }
}

export function validateExceptions(register) {
  if (register?.version !== 1 || !Array.isArray(register.exceptions)) throw new InputError('Exception register must be {"version":1,"exceptions":[...]}');
  const seen = new Set();
  for (const [index, entry] of register.exceptions.entries()) {
    const where = `exceptions[${index}]`;
    for (const field of ['advisory', 'package', 'scope', 'reviewed', 'reviewBy', 'reason', 'exitCriteria']) {
      if (typeof entry?.[field] !== 'string' || !entry[field].trim()) throw new InputError(`${where}.${field} is required`);
    }
    if (!GHSA.test(entry.advisory) || entry.advisory !== entry.advisory.match(GHSA)[0]) throw new InputError(`${where}.advisory must be a GHSA identifier`);
    // Production exceptions are deliberately unsupported: shipped code needs a fix, not a waiver.
    if (entry.scope !== 'development') throw new InputError(`${where}.scope must be "development"`);
    if (!DATE.test(entry.reviewed) || !DATE.test(entry.reviewBy) || entry.reviewBy < entry.reviewed) throw new InputError(`${where} needs YYYY-MM-DD dates with reviewBy on or after reviewed`);
    const key = `${entry.advisory}|${entry.package}`;
    if (seen.has(key)) throw new InputError(`${where} duplicates ${key}`);
    seen.add(key);
  }
  return register.exceptions;
}

// Resolve a dependency name the way Node does from a lockfile package path.
function resolveFrom(packages, fromPath, name) {
  let base = fromPath;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return undefined;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

function requiredBy(packages, node, name) {
  const result = [];
  for (const [path, meta] of Object.entries(packages)) {
    const declared = { ...meta.dependencies, ...meta.optionalDependencies, ...meta.peerDependencies };
    if (declared[name] !== undefined && resolveFrom(packages, path, name) === node) {
      const label = path ? `${meta.name ?? path.slice(path.lastIndexOf('node_modules/') + 13)}@${meta.version}` : '(root)';
      result.push(`${label} requires ${declared[name]}`);
    }
  }
  return result.sort();
}

export function evaluate(audit, lockfile, exceptions, today) {
  if (typeof audit?.vulnerabilities !== 'object' || audit.vulnerabilities === null) throw new InputError('Audit report has no vulnerabilities object (npm audit v7+ JSON expected)');
  const packages = lockfile?.packages;
  if (typeof packages !== 'object' || packages === null) throw new InputError('Lockfile has no packages object (lockfileVersion 2+ expected)');

  const advisories = new Map();
  for (const vulnerability of Object.values(audit.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object') continue; // string entries point at another package's advisory
      const id = String(via.url ?? '').match(GHSA)?.[0] ?? `npm-${via.source}`;
      const key = `${id}|${via.name}`;
      const advisory = advisories.get(key) ?? { id, package: via.name, title: via.title, severity: via.severity, range: via.range, nodes: new Set(), effects: new Set() };
      for (const node of vulnerability.nodes ?? []) advisory.nodes.add(node);
      for (const effect of vulnerability.effects ?? []) advisory.effects.add(effect);
      advisories.set(key, advisory);
    }
  }

  const byKey = new Map(exceptions.map((entry) => [`${entry.advisory}|${entry.package}`, entry]));
  const results = [...advisories.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, advisory]) => {
    const copies = [...advisory.nodes].sort().map((node) => {
      const meta = packages[node];
      return { path: node, version: meta?.version ?? 'missing-from-lockfile', dev: meta?.dev === true, requiredBy: meta ? requiredBy(packages, node, advisory.package) : [] };
    });
    const exception = byKey.get(key);
    const problems = [];
    if (!exception) problems.push('No reviewed exception: fix the dependency or record a reviewed development-only exception.');
    else {
      if (exception.reviewBy < today) problems.push(`Exception review expired on ${exception.reviewBy}; re-review it.`);
      for (const copy of copies) if (!copy.dev) problems.push(`${copy.path}@${copy.version} is not development-only; a development exception cannot cover it.`);
      if (copies.length === 0) problems.push('Audit reported no installed copies; cannot confirm development-only scope.');
    }
    const { nodes: _nodes, effects, ...rest } = advisory;
    return { ...rest, effects: [...effects].sort(), copies, status: problems.length ? 'review-required' : 'accepted', problems, exception: exception ?? null };
  });

  const stale = exceptions.filter((entry) => !advisories.has(`${entry.advisory}|${entry.package}`)).map((entry) => `${entry.advisory} (${entry.package})`).sort();
  return { today, ok: results.every((result) => result.status === 'accepted'), advisories: results, staleExceptions: stale };
}

function render(report) {
  const lines = [`Dependency advisory review (${report.today})`];
  if (report.advisories.length === 0) lines.push('No advisories reported by npm audit.');
  for (const advisory of report.advisories) {
    lines.push('', `${advisory.status === 'accepted' ? 'ACCEPTED' : 'REVIEW REQUIRED'}: ${advisory.id} ${advisory.package} ${advisory.range} [${advisory.severity}]`, `  ${advisory.title}`);
    for (const copy of advisory.copies) {
      lines.push(`  copy ${copy.path}@${copy.version} (${copy.dev ? 'dev-only' : 'PRODUCTION'})`);
      for (const parent of copy.requiredBy) lines.push(`    <- ${parent}`);
    }
    if (advisory.effects.length) lines.push(`  audit effects: ${advisory.effects.join(', ')}`);
    if (advisory.exception) lines.push(`  exception reviewed ${advisory.exception.reviewed}, review by ${advisory.exception.reviewBy}`, `  exit criteria: ${advisory.exception.exitCriteria}`);
    for (const problem of advisory.problems) lines.push(`  ! ${problem}`);
  }
  for (const entry of report.staleExceptions) lines.push('', `NOTE: exception ${entry} no longer matches an audit finding; remove it from the register.`);
  lines.push('', report.ok ? 'PASS: every reported advisory has a current reviewed exception.' : 'FAIL: advisory review required.');
  return lines.join('\n');
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const audit = options.auditJson ? readJson(options.auditJson, 'audit report') : JSON.parse(runNpmAudit());
    const lockfile = readJson(options.lockfile, 'lockfile');
    const exceptions = validateExceptions(readJson(options.exceptions, 'exception register'));
    const report = evaluate(audit, lockfile, exceptions, options.today);
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    console.error(`dependency-audit: ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
