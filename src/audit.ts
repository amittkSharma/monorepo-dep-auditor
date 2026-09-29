import fs from "node:fs";
import path from "node:path";
import { cdvcToViolations } from "./cdvc-adapter.js";
import { countWorkspacePackages } from "./count-packages.js";
import { loadConfig } from "./config.js";
import { assertNotLegacyLerna, detectMonorepoKind } from "./monorepo-kind.js";
import { checkBannedPackages } from "./rules/banned-packages.js";
import { checkPeerConsistency } from "./rules/peer-consistency.js";
import type {
  CdvcDependencyType,
  CdvcIgnoreOptions,
  CdvcPackageIgnoreOptions,
  MonorepoKind,
  Violation,
} from "./types.js";

export type AuditOptions = {
  /** Workspace root directory. Defaults to process.cwd(). */
  rootDir?: string;
  /** Path to monorepo-dep-auditor.config.json, resolved against `rootDir` if relative. Defaults to `<rootDir>/monorepo-dep-auditor.config.json`. */
  configPath?: string;
  /** Delegates to `new CDVC(rootDir, { fix: true })`. Has no effect on our own two rules. */
  fix?: boolean;
  /** Overrides the config file's `depType`. Only affects cdvc's single-version check. */
  depType?: CdvcDependencyType[];
} & CdvcIgnoreOptions;

/** cdvc's own ignore-option arrays default to `[]` internally via object spread — a key present
 * with value `undefined` overrides that default with `undefined` and crashes cdvc's `.map()`
 * calls on it. Drop unset keys instead of passing them through. */
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

export type AuditResult = {
  violations: Violation[];
  monorepoKind: MonorepoKind;
  repoName: string;
  packageCount: number;
};

function readRepoName(rootDir: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
    );
    if (typeof pkg.name === "string" && pkg.name.length > 0) {
      return pkg.name;
    }
  } catch {
    // Falls through to the directory-name default below.
  }
  return path.basename(rootDir);
}

export function audit(options: AuditOptions = {}): AuditResult {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());

  assertNotLegacyLerna(rootDir);
  const monorepoKind = detectMonorepoKind(rootDir);

  const configPath = options.configPath
    ? path.resolve(rootDir, options.configPath)
    : path.join(rootDir, "monorepo-dep-auditor.config.json");
  const config = loadConfig(configPath);

  // ignoreDep/ignoreDepPattern only ever go to the single-version check (see CdvcIgnoreOptions
  // doc comment) — ignorePackage/ignorePath (+ patterns) are safe to share with every rule.
  const packageIgnoreOptions = omitUndefined<CdvcPackageIgnoreOptions>({
    ignorePackage: options.ignorePackage ?? config.ignorePackage,
    ignorePackagePattern:
      options.ignorePackagePattern ?? config.ignorePackagePattern,
    ignorePath: options.ignorePath ?? config.ignorePath,
    ignorePathPattern: options.ignorePathPattern ?? config.ignorePathPattern,
  });
  const ignoreOptions = omitUndefined<CdvcIgnoreOptions>({
    ...packageIgnoreOptions,
    ignoreDep: options.ignoreDep ?? config.ignoreDep,
    ignoreDepPattern: options.ignoreDepPattern ?? config.ignoreDepPattern,
  });
  const depType = options.depType ?? config.depType;

  const violations: Violation[] = [
    ...cdvcToViolations(rootDir, {
      ...ignoreOptions,
      depType,
      ...(options.fix ? { fix: true } : undefined),
    }),
    ...(config.bannedPackages
      ? checkBannedPackages(
          rootDir,
          config.bannedPackages,
          packageIgnoreOptions,
        )
      : []),
    ...(config.checkPeerConsistency
      ? checkPeerConsistency(rootDir, packageIgnoreOptions)
      : []),
  ];

  return {
    violations,
    monorepoKind,
    repoName: readRepoName(rootDir),
    packageCount: countWorkspacePackages(rootDir),
  };
}
