// semver picked as a direct dependency rather than reached-into via cdvc's transitive copy:
// it's tiny, zero-dependency, extremely stable with no CVE history, and importing a
// transitive dependency by path is fragile across cdvc version bumps.

import path from "node:path";
import { CDVC } from "check-dependency-version-consistency";
import semver from "semver";
import {
  isYarnPnp,
  resolveInstalledVersion,
} from "../resolve-installed-version.js";
import type {
  BannedPackageEntry,
  CdvcPackageIgnoreOptions,
  Violation,
} from "../types.js";

const CHECKED_DEP_TYPES = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type BannedRangeVersionEntry = {
  version: string;
  packages: readonly { pathRelative: string }[];
};

/** Config-driven policy check: ban a package outright, or ban only versions matching a range. */
export function checkBannedPackages(
  rootDir: string,
  bannedPackages: readonly BannedPackageEntry[],
  packageIgnoreOptions?: CdvcPackageIgnoreOptions,
): Violation[] {
  if (bannedPackages.length === 0) {
    return [];
  }

  const hasRangeBan = bannedPackages.some(
    (entry) => typeof entry !== "string" && entry.range !== undefined,
  );
  const pnp = hasRangeBan && isYarnPnp(rootDir);
  if (pnp) {
    // Every resolution attempt fails under PnP (see isYarnPnp's doc comment), so range-based
    // bans fall back to the declared-spec-only check for every workspace — not wrong (that
    // check is the same one this package used before it could resolve installed versions at
    // all), just degraded: an override that moves a version into/out of the banned range won't
    // be caught. See docs/YARN_PNP.md. Warn once instead of leaving this silent.
    console.warn(
      "monorepo-dep-auditor: Yarn PnP detected — banned-packages range checks fall back to " +
        "declared-spec only (can't resolve installed versions without the PnP loader). See docs/YARN_PNP.md.",
    );
  }

  // Reuses cdvc's own workspace discovery + manifest reading (via getDependencies()) instead of
  // building a second glob-based workspace walker just for this rule.
  const cdvc = new CDVC(rootDir, {
    depType: [...CHECKED_DEP_TYPES],
    ...packageIgnoreOptions,
  });
  const dependencies = cdvc.getDependencies();
  const violations: Violation[] = [];

  for (const entry of bannedPackages) {
    const name = typeof entry === "string" ? entry : entry.name;
    const range = typeof entry === "string" ? undefined : entry.range;
    const reason = typeof entry === "string" ? undefined : entry.reason;

    const dependency = dependencies.find(
      (candidate) => candidate.name === name,
    );
    if (!dependency) {
      continue;
    }

    for (const versionEntry of dependency.versions) {
      if (range === undefined) {
        // Outright ban: any declared use is a violation regardless of what's actually
        // installed — there's no "safe version" for an outright ban to fall out of via an
        // override, so checking the resolved version wouldn't change the outcome.
        violations.push({
          rule: "banned-packages",
          dependency: name,
          detail: `Package is banned outright (declared as "${versionEntry.version}")${reason ? `: ${reason}` : ""}`,
          workspaces: versionEntry.packages.map((pkg) => pkg.pathRelative),
        });
        continue;
      }

      violations.push(
        ...bannedRangeViolations(
          rootDir,
          name,
          range,
          reason,
          versionEntry,
          pnp,
        ),
      );
    }
  }

  return violations;
}

/**
 * npm `overrides` (and Yarn `resolutions`, and pnpm's own overrides) can make the version
 * actually installed for a workspace differ from what that workspace declares — cdvc only ever
 * reads the declared spec, so a range-based ban compared against declared specs alone can both
 * miss a banned version an override pulled in (false negative) and flag a declared spec an
 * override already moved out of the banned range (false positive). Rather than parsing any of
 * those three differently-shaped override fields ourselves, we check what's actually resolvable
 * on disk per workspace (same technique `peer-consistency` uses) and prefer that over the
 * declared spec whenever it's available, falling back to the declared-spec check only when
 * nothing resolves (e.g. `npm install` hasn't run yet).
 */
function bannedRangeViolations(
  rootDir: string,
  name: string,
  range: string,
  reason: string | undefined,
  versionEntry: BannedRangeVersionEntry,
  skipResolution: boolean,
): Violation[] {
  const bannedByVersion = new Map<string, string[]>();
  let anyResolved = false;

  for (const pkg of versionEntry.packages) {
    const pkgJsonPath = path.join(rootDir, pkg.pathRelative, "package.json");
    // Under PnP, resolution always fails anyway (see isYarnPnp) — skip the attempt rather than
    // spending an FS round trip per workspace just to get null back every time.
    const resolvedVersion = skipResolution
      ? null
      : resolveInstalledVersion(pkgJsonPath, name);
    const effectiveVersion = resolvedVersion ?? versionEntry.version;
    const isBanned =
      resolvedVersion !== null
        ? installedVersionIsBanned(resolvedVersion, range)
        : rangeOverlapsBannedRange(versionEntry.version, range);

    if (!isBanned) {
      continue;
    }
    if (resolvedVersion !== null) {
      anyResolved = true;
    }
    const paths = bannedByVersion.get(effectiveVersion) ?? [];
    paths.push(pkg.pathRelative);
    bannedByVersion.set(effectiveVersion, paths);
  }

  if (bannedByVersion.size === 0) {
    return [];
  }

  const workspaces = [...bannedByVersion.values()].flat();
  const detail = anyResolved
    ? `Installed version banned by range "${range}": ${[...bannedByVersion]
        .map(([version, paths]) => `${version} (${paths.join(", ")})`)
        .join("; ")}${reason ? `: ${reason}` : ""}`
    : `Declared spec "${versionEntry.version}" overlaps banned range "${range}"${reason ? `: ${reason}` : ""}`;

  return [{ rule: "banned-packages", dependency: name, detail, workspaces }];
}

function rangeOverlapsBannedRange(
  declaredSpec: string,
  bannedRange: string,
): boolean {
  try {
    return semver.intersects(declaredSpec, bannedRange, {
      includePrerelease: true,
    });
  } catch {
    // Declared spec isn't a parseable semver range (e.g. "workspace:^", a git url, "latest") —
    // we can't determine overlap, so don't flag it as a range-based ban match.
    return false;
  }
}

function installedVersionIsBanned(
  version: string,
  bannedRange: string,
): boolean {
  try {
    return semver.satisfies(version, bannedRange, { includePrerelease: true });
  } catch {
    // Not a parseable version — conservatively don't flag it as a match.
    return false;
  }
}
