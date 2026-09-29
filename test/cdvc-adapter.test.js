import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { audit } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("detects a single-version mismatch across two workspace packages (cdvc-adapter path)", () => {
  const rootDir = path.join(__dirname, "fixtures", "single-version-mismatch");
  const { violations, monorepoKind } = audit({ rootDir });

  assert.equal(monorepoKind, "Unknown");

  const mismatch = violations.find(
    (v) => v.rule === "single-version" && v.dependency === "left-pad",
  );
  assert.ok(mismatch, "expected a single-version violation for left-pad");
  assert.deepEqual(
    [...mismatch.workspaces].sort(),
    ["packages/pkg-a", "packages/pkg-b"].sort(),
  );
});

test("reports no violations for a fixture with no mismatches and no config", () => {
  const rootDir = path.join(__dirname, "fixtures", "clean");
  const { violations } = audit({ rootDir });

  assert.deepEqual(violations, []);
});

test("ignoreDep suppresses a single-version mismatch for that dependency", () => {
  const rootDir = path.join(__dirname, "fixtures", "single-version-mismatch");
  const { violations } = audit({ rootDir, ignoreDep: ["left-pad"] });

  assert.deepEqual(violations, []);
});

test("ignorePath suppresses a mismatch sourced only from the ignored package", () => {
  const rootDir = path.join(__dirname, "fixtures", "single-version-mismatch");
  const { violations } = audit({ rootDir, ignorePath: ["packages/pkg-b"] });

  assert.deepEqual(
    violations.filter((v) => v.dependency === "left-pad"),
    [],
  );
});

test("a stale ignoreDep (no longer a real mismatch) no-ops instead of throwing", () => {
  const rootDir = path.join(__dirname, "fixtures", "clean");

  assert.doesNotThrow(() => audit({ rootDir, ignoreDep: ["left-pad"] }));
  const { violations } = audit({ rootDir, ignoreDep: ["left-pad"] });
  assert.deepEqual(violations, []);
});

test("a stale ignoreDepPattern (matches nothing mismatching) no-ops instead of throwing", () => {
  const rootDir = path.join(__dirname, "fixtures", "clean");

  assert.doesNotThrow(() => audit({ rootDir, ignoreDepPattern: ["^left-"] }));
});

test("a real ignoreDep still suppresses its mismatch when mixed with a stale one", () => {
  const rootDir = path.join(__dirname, "fixtures", "single-version-mismatch");
  const { violations } = audit({
    rootDir,
    ignoreDep: ["left-pad", "totally-not-a-real-dependency"],
  });

  assert.deepEqual(violations, []);
});
