/** Normalized shape every rule (cdvc-backed or our own) reports into, so all 5 reporters
 * only need to be written once. */
export type Violation = {
  rule:
    | "single-version"
    | "root-pinned"
    | "banned-packages"
    | "peer-consistency";
  dependency: string;
  /** Human-readable specifics, varies per rule. */
  detail: string;
  /** Workspace-relative paths involved in this violation. */
  workspaces: string[];
};

export type MonorepoKind = "Turborepo" | "Nx" | "Lerna" | "Unknown";

/** Passed to every reporter alongside the `Violation[]` array. */
export type ReportMeta = {
  monorepoKind: MonorepoKind;
  /** Root package.json's `name`, or the rootDir's basename if unnamed. */
  repoName: string;
  /** Workspace packages resolved from the root package.json's `workspaces` field. */
  packageCount: number;
  /** ISO 8601 timestamp of when the report was rendered. */
  generatedAt: string;
};

/** A plain string bans the package outright (any version). An object bans only versions
 * matching `range`. */
export type BannedPackageEntry =
  | string
  | {
      name: string;
      range?: string;
      reason?: string;
    };

/** Mirrors cdvc's own `Options` dependency-type union. Not imported from cdvc directly — its
 * package `exports` only expose the `CDVC` class, not this type. */
export type CdvcDependencyType =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies"
  | "resolutions";

/** `ignorePackage`/`ignorePath` (+ pattern variants) filter cdvc's workspace discovery itself,
 * so they're safe to share across every rule that builds a `CDVC` instance — single-version,
 * banned-packages, and peer-consistency. cdvc only throws if the named package/path doesn't
 * exist in the workspace at all, regardless of which rule is asking. */
export type CdvcPackageIgnoreOptions = {
  ignorePackage?: string[];
  ignorePackagePattern?: string[];
  ignorePath?: string[];
  ignorePathPattern?: string[];
};

/** `ignoreDep`/`ignoreDepPattern` only apply to cdvc's single-version check. cdvc throws unless
 * the ignored dependency is *also* a cross-manifest version mismatch — a coupling that doesn't
 * hold for banned-packages (a banned dep is usually a single consistent version) or
 * peer-consistency (declared-vs-installed, unrelated to cross-manifest agreement). Forwarding
 * these to those rules' own `CDVC` instances would make an unrelated ignore crash the run. */
export type CdvcIgnoreOptions = {
  ignoreDep?: string[];
  ignoreDepPattern?: string[];
} & CdvcPackageIgnoreOptions;

export type AuditorConfig = {
  bannedPackages?: BannedPackageEntry[];
  checkPeerConsistency?: boolean;
  /** Which dependency types cdvc's single-version check compares across manifests. Only affects
   * that check — banned-packages and peer-consistency each fix their own depType. */
  depType?: CdvcDependencyType[];
} & CdvcIgnoreOptions;
