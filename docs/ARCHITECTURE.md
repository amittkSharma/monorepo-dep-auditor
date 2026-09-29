# Architecture

## What this package is

A thin companion to `check-dependency-version-consistency` (cdvc). cdvc owns workspace
discovery and single-version consistency. This package adds exactly two rules cdvc doesn't do,
normalizes all results into one `Violation` shape, and renders that shape 5 ways.

## Module list

| File | Responsibility |
|---|---|
| `src/types.ts` | `Violation`, `AuditorConfig`, `BannedPackageEntry`, `MonorepoKind` types |
| `src/audit.ts` | Orchestrates: legacy-Lerna guard → kind detection → config load → run cdvc + both rules → merge violations |
| `src/cdvc-adapter.ts` | Converts `CDVC.getDependencies()` (filtered to `isMismatching`) into `Violation[]` |
| `src/resolve-installed-version.ts` | Shared: resolves what's actually installed for a dependency from a given workspace's `package.json`, via `createRequire`; also exports `isYarnPnp()` so callers can detect and degrade gracefully (see [YARN_PNP.md](YARN_PNP.md)) |
| `src/rules/banned-packages.ts` | Config-driven policy check: outright bans, or semver-range bans checked against the actually-installed version where resolvable |
| `src/rules/peer-consistency.ts` | Checks declared `peerDependencies` against what's actually resolvable |
| `src/config.ts` | Loads `monorepo-dep-auditor.config.json`, or returns `{}` if absent |
| `src/monorepo-kind.ts` | Detects Turbo/Nx/Lerna for report labels; throws on legacy-Lerna edge case |
| `src/reporters/*.ts` | 5 pure functions, `(violations, meta) => string` |
| `src/reporters/escape-html.ts` | Shared HTML-escaping helper, used by every interpolated value in `html.ts` |
| `src/cli.ts` | `node:util` `parseArgs` wrapper around `audit()` + a reporter; `--root-dir` overrides the default `process.cwd()` target |
| `src/index.ts` | Public Node API surface (barrel export) |

## Data flow

1. `audit(options)` resolves `rootDir` (default `process.cwd()`; the CLI's `--root-dir` flag is
   the only thing that ever overrides that default — everything downstream of this step takes
   `rootDir` as a plain argument and never looks at where `monorepo-dep-auditor` itself is
   installed, which is what makes a global install work against an arbitrary target repo).
2. `assertNotLegacyLerna(rootDir)` — throws early if this is the one unsupported edge case (see below).
3. `detectMonorepoKind(rootDir)` — cosmetic label only, no effect on discovery.
4. `loadConfig(configPath)` — reads `monorepo-dep-auditor.config.json`, or `{}` if missing. A
   relative `configPath` (from `--config`) resolves against `rootDir`, not the CLI's cwd — the
   same rule the default path already followed, kept consistent now that `--root-dir` means
   `rootDir` and cwd can differ.
5. `AuditOptions` fields (CLI flags / Node API args) are merged over the config file's same-named
   fields, field-by-field (`options.x ?? config.x`), then split into `packageIgnoreOptions`
   (`ignorePackage`/`ignorePath` + pattern variants) and the superset `ignoreOptions` (adds
   `ignoreDep`/`ignoreDepPattern`) — see the pass-through note below for why they're split.
6. `cdvcToViolations(rootDir, { ...ignoreOptions, depType, fix })` — always runs. Before
   constructing the real `CDVC`, it runs a throwaway `CDVC` pass without `ignoreDep`/
   `ignoreDepPattern` to see what's actually mismatching, then drops any ignore entry that
   doesn't match a real mismatch (see below) before wrapping `new CDVC(rootDir, options)`.
7. `checkBannedPackages(rootDir, config.bannedPackages, packageIgnoreOptions)` — only runs if
   `bannedPackages` is set. For a range-based ban, each declaring workspace's actually-resolved
   version is checked via `resolve-installed-version.ts` before falling back to the declared
   spec (see below).
8. `checkPeerConsistency(rootDir, packageIgnoreOptions)` — only runs if `checkPeerConsistency: true`.
9. All three arrays are concatenated into one `Violation[]` and returned with `monorepoKind`.
10. The CLI picks a reporter function by `--format` and renders that array; exit code is `1` if it's non-empty.

Both `checkBannedPackages` and `checkPeerConsistency` construct their own `CDVC` instance with
a specific `depType` filter (`Options.depType`) plus whatever `packageIgnoreOptions` was passed —
this reuses cdvc's own workspace discovery and manifest reading (which dependency each workspace
declares, and at what path) instead of a second glob-based workspace walker. Both then do the one
part cdvc never does, via the shared `resolve-installed-version.ts`: for a given workspace's
`package.json` path and a dependency name, it resolves what's *actually on disk* via
`createRequire(pathToWorkspacePackageJson).resolve(depName)`, walks up from the resolved file to
find the dependency's own `package.json` (matched by `name`, since the entry file can be nested
arbitrarily deep, and to detect when an override aliased the name to a different package entirely
— capped at 20 directories up), and reads its `version`. If that first attempt throws — a
CLI-only package with no `main`/`exports`, only `bin`, has no requirable entry file at all —
it falls back to resolving `` `${depName}/package.json` `` directly, which Node can locate by
package name without needing an entry point. `checkPeerConsistency` compares the resolved version
against the declared peer range with `semver.satisfies()`; if both resolution attempts throw,
that's reported as a distinct "peer dependency not installed" violation, not a version mismatch —
they're different failure modes.

### Why `banned-packages` checks resolved versions, not just declared specs

A range-based ban compared only against declared specs (what cdvc reads) has a real blind spot:
npm `overrides`, Yarn `resolutions`, and pnpm's own overrides can all make the version actually
installed for a workspace differ from what it declares. Compared against declared specs alone,
that's both a false negative (an override pulls in a banned version despite a declared range that
looks safe) and a false positive (an override moves the installed version out of the ban despite
a declared range that overlaps it). `bannedRangeViolations` in `banned-packages.ts` resolves the
actual installed version per declaring workspace via `resolve-installed-version.ts` and prefers
that over the declared spec whenever one resolves, falling back to the old declared-spec check
only when nothing resolves (most commonly: before `npm install` has run). This deliberately
doesn't extend to parsing `overrides`/`resolutions`/pnpm-overrides as manifest fields — the
resolved-version check is affected by all three automatically without this package needing to
understand any of their (differently shaped) syntaxes. It also deliberately doesn't extend to
`single-version`: that check's job is manifest-hygiene (do workspaces *declare* the same range),
which is a different question from what's installed, so it's left untouched.

### Why `ignoreDep`/`ignoreDepPattern` are split out of `packageIgnoreOptions`

cdvc's own `filterOutIgnoredDependencies` throws unless an ignored dependency is *also* a
cross-manifest version mismatch (`check-dependency-version-consistency/dist/lib/dependency-versions.js`).
That's a reasonable guard for cdvc's own single-version CLI (catches stale/typo'd ignores), but
it doesn't transfer to this package's other two rules: a banned package is usually declared at
one consistent version everywhere (not a mismatch), and peer-consistency compares
declared-vs-*installed*, which is unrelated to cross-manifest agreement entirely. Forwarding a
single-version-scoped `ignoreDep` into `banned-packages`'s or `peer-consistency`'s own `CDVC`
call would make an unrelated ignore crash the whole audit run. `ignorePackage`/`ignorePath` (+
patterns) don't have this coupling — cdvc only validates that the named package/path exists in
the workspace at all, which holds regardless of which rule is asking — so those four are shared
via `CdvcPackageIgnoreOptions` across all three rule sources, while `ignoreDep`/`ignoreDepPattern`
live only in the superset `CdvcIgnoreOptions` used by `cdvcToViolations`.

### Why stale `ignoreDep`/`ignoreDepPattern` entries no-op instead of throwing

cdvc's own guard (above) means an `ignoreDep` written for a mismatch that's since been fixed
crashes every future run until someone notices and removes it — annoying in a config file that's
supposed to be set-and-forget. `cdvc-adapter.ts`'s `dropStaleIgnoreDeps` works around this using
only cdvc's public API: it constructs a throwaway `CDVC` without `ignoreDep`/`ignoreDepPattern` to
get the current list of actually-mismatching dependency names via `getDependencies()`, filters
the requested ignore entries down to ones that still match, and only forwards those to the real
`CDVC` call. This costs one extra `CDVC` construction (same workspace, no extra I/O beyond what
the real call does anyway) whenever `ignoreDep`/`ignoreDepPattern` is non-empty; skipped entirely
otherwise.

## Two design decisions worth flagging

### (a) `node:test` instead of this repo's usual Jest

This repo's other packages use Jest. This one deliberately doesn't. `monorepo-dep-auditor` is
meant to be published standalone to the public npm registry, and its dependency footprint
matters more than internal consistency with this repo's other packages — `node:test` is
zero-dependency (built into Node ≥18) and the test suite here doesn't need anything Jest offers
over it (mocking, snapshotting). This is a one-time divergence, not something to propagate to
other packages in this repo.

### (b) Legacy Lerna gets an actionable error, not a second discovery engine

Turbo, modern Nx, and modern Lerna all resolve workspaces via the package manager's
`workspaces` field — cdvc already reads that. The only gap is legacy Lerna repos with a
`lerna.json` `packages` array but no root `workspaces` field. Reimplementing Lerna's glob
resolution here would mean maintaining a second, parallel discovery engine for one edge case,
forever, in a package whose whole design point is *not* owning workspace discovery. Lerna
itself supports running alongside npm/Yarn workspaces, so the fix is on the user's side: add a
`workspaces` field to root `package.json` mirroring `lerna.json`'s `packages` array. This
package's job is to detect the gap and say so clearly, not to silently pretend it works.

## Known simplifications

- **`root-pinned` is never emitted.** The `Violation.rule` type includes `'root-pinned'` for
  cdvc mismatches sourced from Yarn `resolutions`, but cdvc's public `Dependency` shape
  (`getDependencies()`) doesn't expose which dependency *type* a mismatching version came from.
  Distinguishing this would require reaching into cdvc's private internals, which this package
  doesn't do. Everything from cdvc is currently emitted as `'single-version'`.
- **cdvc's own `single-version` check still doesn't account for `overrides`/`resolutions`/
  pnpm-overrides** — it's a declared-spec comparison by design (see "Why `banned-packages` checks
  resolved versions" above for why that's intentional, not just inherited from cdvc).
  `banned-packages`'s range-based bans no longer have this gap.
- **Yarn Berry's PnP mode breaks resolution-based checks** (`peer-consistency`, and
  `banned-packages`'s range-based bans) since there's no `node_modules` for
  `createRequire(...).resolve()` to find anything in. `isYarnPnp()` in
  `resolve-installed-version.ts` detects this and both checks degrade with a warning rather than
  silently false-flagging or missing things — see [YARN_PNP.md](YARN_PNP.md).
- **`semver` is a direct dependency**, not imported via cdvc's transitive copy — it's tiny,
  zero-dependency, and stable, and importing a transitive dependency by path is fragile across
  cdvc version bumps.
