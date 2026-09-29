import { CDVC } from "check-dependency-version-consistency";
import type {
  CdvcDependencyType,
  CdvcIgnoreOptions,
  Violation,
} from "./types.js";

/**
 * cdvc throws if an `ignoreDep`/`ignoreDepPattern` entry doesn't match a dependency that's
 * actually mismatching right now (`dependency-versions.js`'s `filterOutIgnoredDependencies`).
 * That's a reasonable guard for a one-off CLI run, but it means a stale ignore (the mismatch it
 * was written for got fixed) crashes every future audit until someone notices and removes it.
 * We run a throwaway `CDVC` pass without those two options to see what's actually mismatching,
 * then only forward the entries that still apply — a stale entry becomes a silent no-op instead
 * of a crash.
 */
function dropStaleIgnoreDeps(
  rootDir: string,
  options: { depType?: CdvcDependencyType[] } & CdvcIgnoreOptions,
): Pick<CdvcIgnoreOptions, "ignoreDep" | "ignoreDepPattern"> {
  const { ignoreDep = [], ignoreDepPattern = [], ...rest } = options;
  if (ignoreDep.length === 0 && ignoreDepPattern.length === 0) {
    return {};
  }

  const mismatchingNames = new CDVC(rootDir, rest)
    .getDependencies()
    .filter((dependency) => dependency.isMismatching)
    .map((dependency) => dependency.name);

  return {
    ignoreDep: ignoreDep.filter((name) => mismatchingNames.includes(name)),
    ignoreDepPattern: ignoreDepPattern.filter((pattern) =>
      mismatchingNames.some((name) => new RegExp(pattern).test(name)),
    ),
  };
}

/**
 * Known simplification: cdvc's public `Dependency` shape (`getDependencies()`) doesn't expose
 * which dependency *type* (e.g. `resolutions` vs `dependencies`) a mismatching version came
 * from — that information lives only in cdvc's private internals. So we can't cleanly split
 * 'root-pinned' (resolutions-sourced) from 'single-version' without reaching into cdvc's
 * private fields, which we won't do. Everything cdvc reports is emitted as 'single-version'.
 */
export function cdvcToViolations(
  rootDir: string,
  options?: {
    fix?: boolean;
    depType?: CdvcDependencyType[];
  } & CdvcIgnoreOptions,
): Violation[] {
  const cdvc = new CDVC(rootDir, {
    ...options,
    ...dropStaleIgnoreDeps(rootDir, options ?? {}),
  });

  return cdvc
    .getDependencies()
    .filter((dependency) => dependency.isMismatching)
    .map((dependency) => ({
      rule: "single-version" as const,
      dependency: dependency.name,
      detail: `Found ${dependency.versions.length} different versions: ${dependency.versions
        .map(
          (versionEntry) =>
            `${versionEntry.version} (${versionEntry.packages.map((pkg) => pkg.pathRelative).join(", ")})`,
        )
        .join("; ")}`,
      workspaces: dependency.versions.flatMap((versionEntry) =>
        versionEntry.packages.map((pkg) => pkg.pathRelative),
      ),
    }));
}
