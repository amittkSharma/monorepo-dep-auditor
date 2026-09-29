import assert from "node:assert/strict";
import path from "node:path";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBannedPackages, checkPeerConsistency } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "fixtures", "yarn-pnp");

test("peer-consistency skips (not false-flags) every peer under Yarn PnP, and warns once", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const violations = checkPeerConsistency(rootDir);
    assert.deepEqual(violations, []);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /Yarn PnP detected/);
  } finally {
    warn.mock.restore();
  }
});

test("banned-packages range ban falls back to declared-spec under Yarn PnP, and warns once", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const violations = checkBannedPackages(rootDir, [
      { name: "some-lib", range: ">=2.0.0" },
    ]);
    assert.equal(violations.length, 1);
    assert.match(violations[0].detail, /Declared spec/);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /Yarn PnP detected/);
  } finally {
    warn.mock.restore();
  }
});

test("banned-packages outright ban is unaffected by Yarn PnP and does not warn", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    // Declared under both "dependencies" and "peerDependencies" in the fixture, so two entries.
    const violations = checkBannedPackages(rootDir, ["some-lib"]);
    assert.equal(violations.length, 2);
    assert.ok(violations.every((v) => /banned outright/.test(v.detail)));
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    warn.mock.restore();
  }
});
