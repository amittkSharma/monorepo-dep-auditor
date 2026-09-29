import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const MAX_PACKAGE_JSON_WALK_UP = 20;

/**
 * Yarn Berry's PnP mode replaces `node_modules` with a `.pnp.cjs`/`.pnp.mjs` loader hook that
 * this package's plain `createRequire(...).resolve()` calls never see (nothing installs that
 * hook into our process) — every resolution attempt fails there, indistinguishable from "not
 * installed". See docs/YARN_PNP.md for the full impact and options for real support; this
 * detector only lets callers skip the check cleanly instead of reporting false positives.
 */
export function isYarnPnp(rootDir: string): boolean {
  return (
    existsSync(path.join(rootDir, ".pnp.cjs")) ||
    existsSync(path.join(rootDir, ".pnp.mjs"))
  );
}

/**
 * What's actually resolvable on disk for `depName` from the given workspace's own
 * `package.json` location — the ground truth after npm `overrides`, Yarn `resolutions`, or
 * pnpm's own overrides have all been applied, without this package needing to understand any
 * of those three (differently-shaped) manifest fields itself. Returns `null` if nothing
 * resolves, or if what resolves isn't recognizably `depName`'s own package (e.g. it was aliased
 * to a different package under the hood — see `findOwnPackageJson`).
 */
export function resolveInstalledVersion(
  fromPackageJsonPath: string,
  depName: string,
): string | null {
  const requireFromWorkspace = createRequire(fromPackageJsonPath);

  try {
    const resolvedEntryFile = requireFromWorkspace.resolve(depName);
    const installedPackageJsonPath = findOwnPackageJson(
      resolvedEntryFile,
      depName,
    );
    if (installedPackageJsonPath) {
      return readInstalledVersion(installedPackageJsonPath);
    }
  } catch {
    // require.resolve(depName) throws for a package with no requirable entry point at all
    // (only a `bin` field, no `main`/`exports` — e.g. a CLI-only lint/format tool declared as
    // a peerDependency). Fall through and ask Node to resolve its package.json directly
    // instead, which doesn't need an entry file to exist.
  }

  try {
    return readInstalledVersion(
      requireFromWorkspace.resolve(`${depName}/package.json`),
    );
  } catch {
    // Genuinely not installed, or an `exports` map that blocks package.json access.
    return null;
  }
}

function readInstalledVersion(packageJsonPath: string): string | null {
  const installedPackageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as { version?: string };
  return typeof installedPackageJson.version === "string"
    ? installedPackageJson.version
    : null;
}

/** The resolved entry file (e.g. `dist/index.js`) can be nested arbitrarily deep inside the
 * dependency's own package, so the first package.json found while walking up isn't necessarily
 * the dependency's own manifest (could belong to a nested/scoped sub-package, or — if an
 * `overrides`/`resolutions` entry aliased this name to a completely different package — to that
 * other package entirely). Match on `name` to be sure, walking up at most
 * MAX_PACKAGE_JSON_WALK_UP directories.
 * ponytail: fixed walk-up cap rather than walking to filesystem root — raise it if a real
 * dependency turns out to nest its entry point deeper than this. */
function findOwnPackageJson(
  resolvedFilePath: string,
  depName: string,
): string | null {
  let dir = path.dirname(resolvedFilePath);

  for (let i = 0; i < MAX_PACKAGE_JSON_WALK_UP; i++) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const candidatePackageJson = JSON.parse(
          readFileSync(candidate, "utf8"),
        ) as { name?: string };
        if (candidatePackageJson.name === depName) {
          return candidate;
        }
      } catch {
        // Malformed package.json along the way — keep walking up.
      }
    }
    const parentDir = path.dirname(dir);
    if (parentDir === dir) {
      break;
    }
    dir = parentDir;
  }

  return null;
}
