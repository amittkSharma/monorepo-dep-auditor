import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBannedPackages } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "fixtures", "banned-packages");

test("flags a workspace using an outright-banned package", () => {
  const violations = checkBannedPackages(rootDir, ["request"]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "banned-packages");
  assert.equal(violations[0].dependency, "request");
  assert.deepEqual(violations[0].workspaces, ["packages/uses-banned"]);
});

test("does not flag a workspace whose declared version is outside a banned range", () => {
  const violations = checkBannedPackages(rootDir, [
    { name: "lodash", range: "<4.0.0", reason: "old lodash" },
  ]);

  assert.deepEqual(violations, []);
});

test("flags a workspace whose declared version overlaps a banned range", () => {
  const violations = checkBannedPackages(rootDir, [
    { name: "lodash", range: ">=4.0.0", reason: "test ban" },
  ]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].dependency, "lodash");
  assert.match(violations[0].detail, /test ban/);
  assert.deepEqual(violations[0].workspaces, ["packages/clean"]);
});

test("returns no violations when bannedPackages is empty", () => {
  assert.deepEqual(checkBannedPackages(rootDir, []), []);
});

test("ignorePackage suppresses a banned-package violation from that package", () => {
  const violations = checkBannedPackages(rootDir, ["request"], {
    ignorePackage: ["uses-banned"],
  });

  assert.deepEqual(violations, []);
});
