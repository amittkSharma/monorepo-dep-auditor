import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { audit, detectMonorepoKind } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("throws a clear, actionable error for legacy Lerna without a root workspaces field", () => {
  const rootDir = path.join(
    __dirname,
    "fixtures",
    "legacy-lerna-no-workspaces",
  );

  assert.throws(
    () => audit({ rootDir }),
    (error) => {
      assert.match(error.message, /Legacy Lerna setup detected/);
      assert.match(error.message, /"workspaces"/);
      assert.match(error.message, /packages\/\*/);
      return true;
    },
  );
});

test("detectMonorepoKind labels a lerna.json-only repo as Lerna", () => {
  const rootDir = path.join(
    __dirname,
    "fixtures",
    "legacy-lerna-no-workspaces",
  );
  assert.equal(detectMonorepoKind(rootDir), "Lerna");
});

test("detectMonorepoKind labels a fixture with no marker files as Unknown", () => {
  const rootDir = path.join(__dirname, "fixtures", "clean");
  assert.equal(detectMonorepoKind(rootDir), "Unknown");
});
