import { afterAll, beforeAll, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/dependency-audit.mjs");
const ADVISORY = "GHSA-cfgh-jmpq-rvwx";
let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "dependency-audit-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const via = {
  source: 1,
  name: "globlib",
  title: "globlib amplification",
  url: `https://github.com/advisories/${ADVISORY}`,
  severity: "moderate",
  range: ">=2.0.0 <3.0.1",
};
// Two audit entries (the vulnerable package and a parent) share one root advisory.
const audit = {
  auditReportVersion: 2,
  vulnerabilities: {
    globlib: { name: "globlib", via: [via], effects: ["linter", "packer"], nodes: ["node_modules/globlib", "node_modules/packer/node_modules/globlib"] },
    linter: { name: "linter", via: ["globlib"], effects: [], nodes: ["node_modules/linter"] },
  },
};
const lockfile = (prodPacker = false) => ({
  lockfileVersion: 3,
  packages: {
    "": { devDependencies: { linter: "^1.0.0", packer: "^1.0.0" } },
    "node_modules/linter": { version: "1.0.0", dev: true, dependencies: { globlib: "^2.1.0" } },
    "node_modules/globlib": { version: "2.4.0", dev: true },
    "node_modules/packer": { version: "1.2.0", dev: !prodPacker, dependencies: { globlib: "~2.0.0" } },
    "node_modules/packer/node_modules/globlib": { version: "2.0.9", dev: !prodPacker },
  },
});
const exception = (overrides: Record<string, string> = {}) => ({
  advisory: ADVISORY,
  package: "globlib",
  scope: "development",
  reviewed: "2026-11-01",
  reviewBy: "2027-01-31",
  reason: "Default optimization level; trusted patterns.",
  exitCriteria: "Parents accept globlib >=3.0.1.",
  ...overrides,
});

function run(name: string, inputs: { audit?: unknown; lockfile?: unknown; exceptions: unknown; lockfilePath?: string }, today = "2026-11-09") {
  const file = (suffix: string, value: unknown) => {
    const target = path.join(dir, `${name}-${suffix}.json`);
    writeFileSync(target, JSON.stringify(value));
    return target;
  };
  const result = spawnSync(process.execPath, [
    SCRIPT,
    "--audit-json", file("audit", inputs.audit ?? audit),
    "--lockfile", inputs.lockfilePath ?? file("lock", inputs.lockfile ?? lockfile()),
    "--exceptions", file("exceptions", inputs.exceptions),
    "--today", today,
    "--json",
  ], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr, report: result.stdout ? JSON.parse(result.stdout) : undefined };
}

test("groups audit entries by root advisory and accepts a current dev-only exception", () => {
  const { status, report } = run("accepted", { exceptions: { version: 1, exceptions: [exception()] } });
  expect(status).toBe(0);
  expect(report.advisories).toHaveLength(1);
  const [advisory] = report.advisories;
  expect(advisory).toMatchObject({ id: ADVISORY, package: "globlib", status: "accepted", effects: ["linter", "packer"] });
  // Nested copies resolve to the nearest node_modules, as Node does.
  expect(advisory.copies).toEqual([
    { path: "node_modules/globlib", version: "2.4.0", dev: true, requiredBy: ["linter@1.0.0 requires ^2.1.0"] },
    { path: "node_modules/packer/node_modules/globlib", version: "2.0.9", dev: true, requiredBy: ["packer@1.2.0 requires ~2.0.0"] },
  ]);
});

test("fails on an advisory without a reviewed exception", () => {
  const { status, report } = run("unreviewed", { exceptions: { version: 1, exceptions: [] } });
  expect(status).toBe(1);
  expect(report.advisories[0].status).toBe("review-required");
  expect(report.advisories[0].problems[0]).toMatch(/No reviewed exception/);
});

test("fails once the exception review date has passed", () => {
  const { status, report } = run("expired", { exceptions: { version: 1, exceptions: [exception()] } }, "2027-02-01");
  expect(status).toBe(1);
  expect(report.advisories[0].problems).toEqual(["Exception review expired on 2027-01-31; re-review it."]);
});

test("a development exception never covers a production copy", () => {
  const { status, report } = run("production", { lockfile: lockfile(true), exceptions: { version: 1, exceptions: [exception()] } });
  expect(status).toBe(1);
  expect(report.advisories[0].problems.join("\n")).toContain("node_modules/packer/node_modules/globlib@2.0.9 is not development-only");
});

test("reports stale exceptions without failing", () => {
  const { status, report } = run("stale", {
    audit: { auditReportVersion: 2, vulnerabilities: {} },
    exceptions: { version: 1, exceptions: [exception()] },
  });
  expect(status).toBe(0);
  expect(report.staleExceptions).toEqual([`${ADVISORY} (globlib)`]);
});

test("rejects malformed or production-scoped registers as invalid input", () => {
  for (const [name, register] of [
    ["prod-scope", { version: 1, exceptions: [exception({ scope: "production" })] }],
    ["no-exit", { version: 1, exceptions: [{ ...exception(), exitCriteria: "" }] }],
    ["bad-id", { version: 1, exceptions: [exception({ advisory: "CVE-2026-1" })] }],
    ["bad-dates", { version: 1, exceptions: [exception({ reviewBy: "2026-01-01" })] }],
    ["duplicate", { version: 1, exceptions: [exception(), exception()] }],
    ["no-version", { exceptions: [] }],
  ] as const) {
    const { status, stderr } = run(name, { exceptions: register });
    expect(status, name).toBe(2);
    expect(stderr, name).toMatch(/^dependency-audit: /);
  }
});

test("repository register is valid and every minimatch copy covered by its exception is dev-only", () => {
  // Offline guard: rebuild the minimatch finding from the real lockfile, so this fails if a
  // vulnerable copy (>=7 <11.0.1) ever becomes a production dependency.
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const vulnerable = Object.entries(lock.packages as Record<string, { version: string }>)
    .filter(([key, meta]) => key.endsWith("node_modules/minimatch") && /^(7|8|9|10)\.|^11\.0\.0$/.test(meta.version))
    .map(([key]) => key);
  expect(vulnerable.length).toBeGreaterThan(0);
  const register = JSON.parse(readFileSync("security/dependency-exceptions.json", "utf8"));
  const { status, report } = run("repository", {
    audit: {
      auditReportVersion: 2,
      vulnerabilities: { minimatch: { name: "minimatch", via: [{ ...via, name: "minimatch", url: "https://github.com/advisories/GHSA-g3hv-75wg-m249", range: ">=7.0.0 <11.0.1" }], effects: [], nodes: vulnerable } },
    },
    lockfilePath: path.resolve("package-lock.json"),
    exceptions: register,
  }, register.exceptions[0].reviewed);
  expect(status).toBe(0);
  expect(report.advisories[0].copies.every((copy: { dev: boolean }) => copy.dev)).toBe(true);
});
