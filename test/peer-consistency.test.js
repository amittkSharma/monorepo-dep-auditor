import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkPeerConsistency } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "fixtures", "peer-consistency");

test("flags an installed peer dependency version that violates the declared range", () => {
  const violations = checkPeerConsistency(rootDir);

  const versionMismatch = violations.find(
    (v) => v.dependency === "some-peer-lib",
  );
  assert.ok(versionMismatch, "expected a violation for some-peer-lib");
  assert.equal(versionMismatch.rule, "peer-consistency");
  assert.match(versionMismatch.detail, /declared range "\^2\.0\.0"/);
  assert.match(versionMismatch.detail, /installed version "1\.0\.0"/);
  assert.deepEqual(versionMismatch.workspaces, ["packages/consumer"]);
});

test('reports a distinct "not installed" violation when the peer dependency cannot be resolved', () => {
  const violations = checkPeerConsistency(rootDir);

  const notInstalled = violations.find(
    (v) => v.dependency === "totally-missing-lib",
  );
  assert.ok(notInstalled, "expected a violation for totally-missing-lib");
  assert.match(notInstalled.detail, /not installed/i);
  assert.deepEqual(notInstalled.workspaces, ["packages/consumer2"]);
});

test("ignorePath suppresses peer-consistency violations from that workspace", () => {
  const violations = checkPeerConsistency(rootDir, {
    ignorePath: ["packages/consumer"],
  });

  assert.deepEqual(
    violations.filter((v) => v.dependency === "some-peer-lib"),
    [],
  );
});

test("resolves a CLI-only peer dependency (no main/exports, only bin) via its package.json instead of false-flagging it as not installed", () => {
  const violations = checkPeerConsistency(rootDir);

  const cliOnlyViolation = violations.find(
    (v) => v.dependency === "cli-only-lib",
  );
  assert.equal(
    cliOnlyViolation,
    undefined,
    "cli-only-lib satisfies its declared range and is installed — expected no violation",
  );
});

test("the two failure modes produce different detail text", () => {
  const violations = checkPeerConsistency(rootDir);
  const versionMismatch = violations.find(
    (v) => v.dependency === "some-peer-lib",
  );
  const notInstalled = violations.find(
    (v) => v.dependency === "totally-missing-lib",
  );

  assert.notEqual(versionMismatch.detail, notInstalled.detail);
});
