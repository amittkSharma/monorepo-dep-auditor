import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, "..", "dist", "cli.js");

test("CLI exits 1 with valid JSON output when violations exist", () => {
  const cwd = path.join(__dirname, "fixtures", "single-version-mismatch");
  const result = spawnSync(process.execPath, [cliPath, "--format", "json"], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed.violations));
  assert.ok(parsed.violations.length > 0);
});

test("CLI exits 0 with no violations for a clean fixture", () => {
  const cwd = path.join(__dirname, "fixtures", "clean");
  const result = spawnSync(process.execPath, [cliPath, "--format", "json"], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.violations, []);
});

test("--ignore-dep suppresses a single-version mismatch for that dependency", () => {
  const cwd = path.join(__dirname, "fixtures", "single-version-mismatch");
  const result = spawnSync(
    process.execPath,
    [cliPath, "--format", "json", "--ignore-dep", "left-pad"],
    { cwd, encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.violations, []);
});

test("--root-dir points the audit at a repo other than the CLI's cwd", () => {
  const targetRepo = path.join(
    __dirname,
    "fixtures",
    "single-version-mismatch",
  );
  const result = spawnSync(
    process.execPath,
    [cliPath, "--format", "json", "--root-dir", targetRepo],
    { cwd: __dirname, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.violations.some((v) => v.dependency === "left-pad"),
    "expected the left-pad mismatch from the target repo, not the cwd",
  );
});

test("a relative --config resolves against --root-dir, not the CLI's cwd", () => {
  const targetRepo = path.join(__dirname, "fixtures", "banned-packages");
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--format",
      "json",
      "--root-dir",
      targetRepo,
      "--config",
      "custom.config.json",
    ],
    { cwd: __dirname, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.violations.some(
      (v) => v.rule === "banned-packages" && v.dependency === "request",
    ),
    "expected custom.config.json (relative to --root-dir) to be loaded and enable the banned-packages check",
  );
});
