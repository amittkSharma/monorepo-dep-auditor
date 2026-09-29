import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { MonorepoKind } from "./types.js";

/** Purely a friendly one-line label for report headers ("Detected: Turborepo"). Turbo has no
 * workspace concept of its own (always delegates to the package manager's `workspaces` field),
 * and modern Nx/Lerna both also rely on it — so cdvc's existing workspaces-field discovery
 * already covers all three in the common case. We don't build a second discovery engine here. */
export function detectMonorepoKind(rootDir: string): MonorepoKind {
  if (existsSync(path.join(rootDir, "turbo.json"))) {
    return "Turborepo";
  }
  if (existsSync(path.join(rootDir, "nx.json"))) {
    return "Nx";
  }
  if (existsSync(path.join(rootDir, "lerna.json"))) {
    return "Lerna";
  }
  return "Unknown";
}

/**
 * The one real edge case: legacy Lerna repos with a `lerna.json` `packages` array but no
 * `workspaces` field in root package.json. cdvc's discovery only reads `workspaces`
 * (npm/Yarn form) or `pnpm-workspace.yaml`, so it would silently find zero packages here.
 *
 * ponytail: deliberately NOT reimplementing lerna.json `packages` glob resolution — that would
 * be a second, parallel workspace-discovery engine for one legacy edge case. Lerna supports
 * running alongside npm/Yarn workspaces even in legacy setups, so the actionable fix is for the
 * user to add a `workspaces` field mirroring their `lerna.json` `packages` array; we just detect
 * the gap and throw a clear error instead of silently doing nothing.
 */
export function assertNotLegacyLerna(rootDir: string): void {
  const lernaJsonPath = path.join(rootDir, "lerna.json");
  if (!existsSync(lernaJsonPath)) {
    return;
  }

  const rootPackageJsonPath = path.join(rootDir, "package.json");
  const rootPackageJson = JSON.parse(
    readFileSync(rootPackageJsonPath, "utf8"),
  ) as {
    workspaces?: unknown;
  };
  if (rootPackageJson.workspaces) {
    return;
  }

  const lerna = JSON.parse(readFileSync(lernaJsonPath, "utf8")) as {
    packages?: string[];
  };
  const packages = Array.isArray(lerna.packages)
    ? lerna.packages
    : ["packages/*"];

  throw new Error(
    `Legacy Lerna setup detected: "${lernaJsonPath}" exists but root package.json has no ` +
      '"workspaces" field. monorepo-dep-auditor (and the underlying ' +
      "check-dependency-version-consistency package) only discover workspaces via the package " +
      'manager\'s "workspaces" field, not lerna.json directly. Add this to your root ' +
      `package.json to fix it:\n\n  "workspaces": ${JSON.stringify(packages)}\n\n` +
      '(mirroring your lerna.json "packages" array) — Lerna supports running alongside npm/Yarn ' +
      "workspaces, including in legacy setups.",
  );
}
