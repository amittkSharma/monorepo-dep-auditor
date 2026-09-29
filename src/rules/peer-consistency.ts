import path from "node:path";
import { CDVC } from "check-dependency-version-consistency";
import semver from "semver";
import {
  isYarnPnp,
  resolveInstalledVersion,
} from "../resolve-installed-version.js";
import type { CdvcPackageIgnoreOptions, Violation } from "../types.js";

/**
 * The one genuinely new algorithm in this package: cdvc only ever compares *declared* ranges
 * across manifests, it never reads what's actually resolved/installed. This checks each
 * workspace's declared peerDependencies range against what `node:module`'s `createRequire`
 * can actually resolve from that workspace's location.
 */
export function checkPeerConsistency(
  rootDir: string,
  packageIgnoreOptions?: CdvcPackageIgnoreOptions,
): Violation[] {
  if (isYarnPnp(rootDir)) {
    // Every resolution attempt fails under PnP (see isYarnPnp's doc comment), which would
    // otherwise report every single peer dependency as "not installed" — a false positive on
    // every workspace, not a real finding. Skip cleanly instead of reporting that. See
    // docs/YARN_PNP.md.
    console.warn(
      "monorepo-dep-auditor: Yarn PnP detected — peer-consistency check skipped " +
        "(can't resolve installed versions without the PnP loader). See docs/YARN_PNP.md.",
    );
    return [];
  }

  // Reuses cdvc's discovery + manifest reading to find every workspace's declared
  // peerDependencies (name + range + which workspace declared it) — no separate glob walker.
  const cdvc = new CDVC(rootDir, {
    depType: ["peerDependencies"],
    ...packageIgnoreOptions,
  });
  const dependencies = cdvc.getDependencies();
  const violations: Violation[] = [];

  for (const dependency of dependencies) {
    for (const versionEntry of dependency.versions) {
      const declaredRange = versionEntry.version;

      for (const pkg of versionEntry.packages) {
        const pkgJsonPath = path.join(
          rootDir,
          pkg.pathRelative,
          "package.json",
        );
        const resolvedVersion = resolveInstalledVersion(
          pkgJsonPath,
          dependency.name,
        );

        if (resolvedVersion === null) {
          // Distinct failure mode from a version mismatch: nothing is resolvable at all.
          violations.push({
            rule: "peer-consistency",
            dependency: dependency.name,
            detail: `Peer dependency not installed: "${dependency.name}" (declared range "${declaredRange}") could not be resolved from "${pkg.pathRelative}"`,
            workspaces: [pkg.pathRelative],
          });
          continue;
        }

        if (!semver.satisfies(resolvedVersion, declaredRange)) {
          violations.push({
            rule: "peer-consistency",
            dependency: dependency.name,
            detail: `Peer dependency version mismatch: "${dependency.name}" declared range "${declaredRange}" is not satisfied by installed version "${resolvedVersion}" at "${pkg.pathRelative}"`,
            workspaces: [pkg.pathRelative],
          });
        }
      }
    }
  }

  return violations;
}
