import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBannedPackages } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "fixtures", "banned-packages-overrides");

test("flags a banned version pulled in only via an override (declared range is safe on its own)", () => {
  const violations = checkBannedPackages(rootDir, [
    { name: "some-lib", range: ">=2.0.0", reason: "test ban" },
  ]);

  const forFalseNegative = violations.find((v) =>
    v.workspaces.includes("packages/false-negative"),
  );
  assert.ok(
    forFalseNegative,
    "expected a violation for the workspace whose installed version is banned despite a safe declared range",
  );
  assert.match(forFalseNegative.detail, /Installed version banned/);
  assert.match(forFalseNegative.detail, /2\.5\.0/);
});

test("groups multiple workspaces with the same declared spec but different resolved banned versions into one violation", () => {
  const violations = checkBannedPackages(rootDir, [
    { name: "some-lib", range: ">=2.0.0", reason: "test ban" },
  ]);

  const grouped = violations.find(
    (v) =>
      v.workspaces.includes("packages/false-negative") &&
      v.workspaces.includes("packages/false-negative-2"),
  );
  assert.ok(
    grouped,
    "expected false-negative and false-negative-2 (same declared spec, different resolved versions) in one violation",
  );
  assert.match(grouped.detail, /2\.5\.0/);
  assert.match(grouped.detail, /3\.0\.0/);
});

test("does not flag a workspace whose overlapping declared range was overridden to a safe installed version", () => {
  const violations = checkBannedPackages(rootDir, [
    { name: "some-lib", range: ">=2.0.0", reason: "test ban" },
  ]);

  const forFalsePositive = violations.find((v) =>
    v.workspaces.includes("packages/false-positive"),
  );
  assert.equal(
    forFalsePositive,
    undefined,
    "override moved the installed version out of the banned range — should not be flagged",
  );
});

test("falls back to the declared-spec check when nothing is installed to resolve", () => {
  const violations = checkBannedPackages(rootDir, [
    { name: "some-lib", range: ">=2.0.0", reason: "test ban" },
  ]);

  const forNoNodeModules = violations.find((v) =>
    v.workspaces.includes("packages/no-node-modules"),
  );
  assert.ok(
    forNoNodeModules,
    "expected the pre-install fallback to still flag an overlapping declared range",
  );
  assert.match(forNoNodeModules.detail, /Declared spec/);
});
