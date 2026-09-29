# Extend `check-dependency-version-consistency` — Revised Plan

Supersedes [`2026-09-standalone-monorepo-dep-auditor-module.md`](./2026-09-standalone-monorepo-dep-auditor-module.md), which planned a from-scratch package. That plan is dropped in favor of this one after finding a mature existing package that already solves most of the problem — see that doc's final state for the prior-art comparison that triggered this change. Everything below is grounded by reading the real source of [`bmish/check-dependency-version-consistency`](https://github.com/bmish/check-dependency-version-consistency) directly from its `main` branch on 2026-09-22 (package.json, README, and every file under `lib/`) — not from memory or assumption.

## 0. What's actually already there (read from source, not guessed)

| Capability | Status | Evidence |
|---|---|---|
| Workspace discovery (npm/Yarn `workspaces` field, `pnpm-workspace.yaml`, nested workspaces, negation globs via `globby`) | **Fully built**, mature | `lib/package.ts` (`workspacePatterns` getter reads both forms), `lib/workspace.ts` (`accumulatePackages`, `expandWorkspaces` with `!exclude` handling) |
| Single-version consistency check across `dependencies`, `devDependencies`, `optionalDependencies`, `resolutions` (Yarn) | **Fully built**, default-on | `lib/defaults.ts` `DEFAULT_DEP_TYPES`; `lib/dependency-versions.ts` `calculateVersionsForEachDependency` |
| `peerDependencies` consistency | Built, **opt-in** (`--dep-type peerDependencies`) | `lib/defaults.ts` comment links a real maintainer discussion (issue #402) on why it's excluded by default — this is a deliberate scope decision, not an oversight |
| `--fix` (rewrite mismatched versions to the highest seen) | **Fully built**, preserves file formatting | `lib/dependency-versions.ts` `fixVersionsMismatching` + `writeDependencyVersion` (uses `edit-json-file`, respects trailing-newline) |
| Local-workspace-package freshness (package A must depend on package B's *current* local version, not a stale published one) | **Fully built** — a check our original plan didn't even have | `calculateDependenciesAndVersions`'s `isLocalPackageVersion`/`hasIncompatibilityWithLocalPackageVersion` logic |
| Node API (`CDVC` class: `getDependencies()`, `getDependency(name)`, `hasMismatchingDependencies*`) | **Fully built**, ESM, typed | `lib/cdvc.ts` — this means we can `import` it as a library, not just spawn its CLI |
| npm `overrides` support | **Missing.** Only `resolutions` (Yarn) exists in the type enum | `lib/types.ts` `DEPENDENCY_TYPE` has no `overrides` key; confirmed by reading the enum directly |
| Any machine-readable output (JSON, or any `--format`/`--reporter` flag) | **Missing entirely.** Only two human-readable string renderers exist | `lib/output.ts` has exactly `dependenciesToMismatchSummary()` and `dependenciesToFixedSummary()`, both built on the `table` package; `lib/cli.ts` has no `--json`/`--format` option at all |
| `banned-packages` (policy/allowlist rule) | **Doesn't exist, not requested** | GitHub issue search for "banned" against this repo returns 0 results |
| `peer-consistency` (a workspace's declared `peerDependencies` range is satisfied by what's *actually installed*, not just "same string across manifests") | **Doesn't exist** — architecturally different from what cdvc does | cdvc only ever reads declared manifests (`package.json[type]`); it never reads `node_modules` or a lockfile to check what's actually resolved |

This is the same conclusion the prior doc reached, now with line-level citations instead of a general impression.

## 1. The actual gaps, and where each one belongs

Splitting strictly by whether a gap fits cdvc's own stated purpose ("Ensures dependencies are on consistent versions across a monorepo") — because the maintainer has already shown scope discipline once (the peerDependencies default-exclusion), so a PR that fits their stated purpose has a real chance of landing, and one that doesn't should not be forced in.

| Gap | Fits cdvc's stated scope? | Track |
|---|---|---|
| npm `overrides` support | Yes — same *kind* of check as existing `resolutions` support, just npm's equivalent mechanism | **A — upstream PR** |
| JSON / Markdown / CSV / HTML report output | Yes — `CDVC` already returns structured data; these are renderers parallel to the two that already exist | **A — upstream PR** |
| `banned-packages` | No — a policy/allowlist check, not a "consistency" check | **B — companion package** |
| `peer-consistency` (installed-satisfies-declared-range) | No — requires reading resolved/installed state, which is a different architecture than cdvc's manifest-only design | **B — companion package** |
| `init` / hook-manager auto-detection | Orthogonal — packaging/DX, not a consistency check | **B — companion package** |

## 2. Track A — upstream PRs to `check-dependency-version-consistency`

### 2.1 PR 1 — npm `overrides` support

Not purely mechanical — worth being honest about the one real complication found while reading the source:

- `resolutions` (Yarn) and the fields cdvc already reads (`dependencies`, etc.) are all flat `{ [name]: versionString }` maps. `recordDependencyVersionsForPackageJson` in `lib/dependency-versions.ts` assumes exactly that shape (`Object.entries(package_.packageJson[type] ?? {})`, treating each value as a version string).
- npm's `overrides` field supports a **nested** form for overriding a dependency only within a specific parent's dependency tree:
  ```json
  { "overrides": { "foo": "1.0.0", "bar": { ".": "1.0.0", "baz": "2.0.0" } } }
  ```
  Feeding a nested object straight into the existing flat-map logic would record the object itself as a "version," which is wrong.
- **Recommendation for v1 of this PR:** only support the flat top-level form (`{ [name]: versionString }`), and skip/warn on nested-object entries with a one-line note in the README about the limitation. This covers the large majority of real-world `overrides` usage (simple version pins) without taking on the complexity of flattening nested overrides into synthetic per-parent entries. Expand later if someone actually needs it.

Concrete diff, now that the exact touch points are confirmed by reading the source:

1. `lib/types.ts` — add `overrides: 'overrides'` to `DEPENDENCY_TYPE`.
2. `lib/defaults.ts` — **do not** add to `DEFAULT_DEP_TYPES` initially; make it opt-in via `--dep-type overrides`, mirroring the existing `peerDependencies` precedent, so no existing user's CI starts failing on a minor/patch release.
3. `lib/dependency-versions.ts` — in `recordDependencyVersionsForPackageJson`, skip (with a warning, not a throw) any `overrides` entry whose value is an object rather than a string, per the recommendation above.
4. `lib/dependency-versions.ts` `fixVersionsMismatching` — the hardcoded write-back type list (`[devDependencies, dependencies, optionalDependencies, peerDependencies, resolutions]`) needs `DEPENDENCY_TYPE.overrides` added, or `--fix` will silently never touch a workspace's `overrides` entries even after this PR.
5. Tests: mirror whatever fixture tests exist for `resolutions`, swap in `overrides`; add one fixture with **both** `resolutions` and `overrides` present across different packages, proving Yarn- and npm-style pinning are recognized side by side (this is the concrete proof of the Yarn/npm-parity requirement).

Estimate: 3–4 hrs including the nested-override edge-case handling and tests.

### 2.2 PR 2 — Markdown / CSV / HTML report formats (JSON comes almost free)

- New files: `lib/reporters/json.ts`, `markdown.ts`, `csv.ts`, `html.ts` — each a pure function `(dependencies: Dependencies) => string`, same shape as the two existing functions in `lib/output.ts`. JSON is `JSON.stringify(dependencies, null, 2)` plus a stable key order — the cheapest of the four.
- `html.ts` owns a single shared `escapeHtml()` used on every interpolated value (dependency name, version, package path) — same reasoning as before: this data ultimately comes from someone's `package.json`, and a public tool with real users is a bigger blast radius for a missed-escaping bug than a private script would be. Gets its own test asserting a dependency name like `<img src=x onerror=alert(1)>` renders as inert text.
- `lib/cli.ts` — add `--reporter <table|json|markdown|csv|html>` (default `table`), so existing behavior for existing users is completely unchanged unless they opt in.
- `lib/cdvc.ts` — expose the new renderers as additional public methods (`toJSON()`, `toMarkdown()`, `toCSV()`, `toHTML()`) so library consumers — including our own Track B package — get them without spawning a subprocess.
- No `.xlsx`: same reasoning as the original plan — `exceljs`/`xlsx` are heavy, security-sensitive dependencies for a maintainer who currently ships **zero** runtime dependencies beyond `commander`/`globby`/`semver`/etc.; CSV already covers "open this in a spreadsheet."

Estimate: 4–5 hrs (four renderers + CLI/API wiring + tests, HTML's escaping test included).

### 2.3 Process, not just code

This maintainer visibly discusses scope before merging (the peerDependencies default-exclusion has a linked issue). Open an issue proposing each PR's shape **before** writing code, wait for a signal it's wanted, then submit the PR. Skipping straight to a PR risks exactly the kind of scope pushback that peerDependencies already went through once.

## 3. Track B — thin companion package for what genuinely doesn't fit upstream

Working name: `cdvc-policy` (placeholder — check npm-name availability before committing to it, same live-registry-check discipline as the original doc).

- **Real dependency, not a fork or subprocess wrapper:** `import { CDVC } from 'check-dependency-version-consistency'`, calling its actual Node API.
- Adds exactly the two rules that don't fit upstream's scope:
  - **`banned-packages`** — string entries ban a package outright; `{ name, range, reason }` entries ban a version range with a reason surfaced in the report.
  - **`peer-consistency`** — reads what's actually resolved (via the local lockfile or `node_modules`) and checks it satisfies each workspace's declared `peerDependencies` range. This is the one piece of real new logic in this whole plan; everything else is either upstream's existing code or a thin renderer.
- **`init` command** — hook-manager auto-detection (Husky/lefthook/simple-git-hooks/plain `.git/hooks`), same design as the original doc, now gluing together `CDVC` + the two new rules + (once Track A lands) the upstream reporters into one CLI a consumer runs from a pre-commit hook.
- **Not blocked on Track A merging:** `CDVC.getDependencies()` is public today. Track B can render its own internal JSON/Markdown/CSV/HTML immediately, as a stopgap, then delete that internal rendering code and delegate to the upstream reporters once Track A ships — a deletion, not a rewrite, when that happens.
- **No re-implementing what upstream already does well:** `--ignore-dep`, `--ignore-package`, `--ignore-path`, etc. are passed straight through to the underlying `CDVC` options object, not reinvented.

## 4. Technical stack (revised — genuinely smaller now)

| Concern | Track A (PRs) | Track B (companion package) |
|---|---|---|
| New runtime dependencies | None — working inside cdvc's existing TS/ESM/Vitest/ESLint setup | **One**: `check-dependency-version-consistency` itself. `fast-glob`/`globby` no longer needed at all in our own code — inherited for free via the dependency |
| Language/build | Matches cdvc's existing TypeScript + `tsc` build | Same conventions, own small `package.json` |
| Tests | `vitest` (cdvc's existing framework — match house style, don't introduce a second one) | `node:test` is still fine here since it's a separate small package |
| License | MIT (cdvc's own) | MIT |

## 5. Revised effort estimate

| Item | Time |
|---|---|
| Track A — PR 1 (`overrides` support, incl. nested-override edge case + tests) | 3–4 hrs |
| Track A — PR 2 (JSON/Markdown/CSV/HTML reporters + CLI/API wiring + HTML escaping test) | 4–5 hrs |
| Track A — issue write-ups before each PR (process overhead, mostly calendar time not engineering time) | ~1 hr |
| Track B — `banned-packages` rule | 1.5 hrs |
| Track B — `peer-consistency` rule (the one genuinely new algorithm in this plan — needs to read resolved/installed state) | 2.5–3 hrs |
| Track B — `init` command + hook-manager detection + config scaffolding | 1.5 hrs |
| Track B — stopgap reporters (deleted once Track A ships) | 1 hr |
| **Total** | **~15–17 hrs**, but split across two artifacts: Track A becomes public contribution history on a 181K-weekly-download package; Track B is a small, easy-to-maintain package with a real dependency doing the heavy lifting instead of owning it |

(Slightly more total hours than the from-scratch estimate — the honest tradeoff of doing this properly through two coordinated tracks instead of one codebase. What's smaller is the *ongoing maintenance surface*: Track B only owns ~2 genuinely novel rules and some glue, not workspace discovery, not the core consistency algorithm, not four of five report renderers.)

## 6. Open questions

1. **Confirm Track A is wanted before writing code** — open the two issues (overrides support, reporter formats) and see whether the maintainer engages, same as they did for peerDependencies.
2. **Track B package name** — `cdvc-policy` is a placeholder; verify availability on the public npm registry before committing.
3. **`overrides` default-on vs. opt-in** — recommended opt-in initially (§2.1); revisit once it's shipped and used without issues.
4. **If Track A PRs are rejected or stall** — Track B can still get JSON output today via `CDVC.getDependencies()` directly (already public), so the companion package's value doesn't depend on Track A landing; it's just less clean (implements its own renderers permanently instead of delegating) if it never does.
