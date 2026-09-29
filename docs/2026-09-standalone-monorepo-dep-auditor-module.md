> **Superseded** by [`2026-09-extend-check-dependency-version-consistency.md`](./2026-09-extend-check-dependency-version-consistency.md) — a from-scratch build turned out unnecessary once `check-dependency-version-consistency` was found to already cover ~80% of this scope; the new doc extends it instead (upstream PRs + a thin companion package). Kept here for the prior-art comparison only.

# `monorepo-dep-auditor` — Architecture & Implementation Plan

A standalone, independently-published npm package. Not tied to any one consuming repo — designed to be installed by any Turborepo, Nx, or Lerna monorepo, running on **either Yarn or npm** underneath. (A companion doc, [`2026-09-cross-package-dependency-version-audit-precommit.md`](./2026-09-cross-package-dependency-version-audit-precommit.md), covers a Yarn-only native-`yarn constraints` shortcut for a single repo already on Yarn Berry — that's a different, narrower option, not a dependency of this plan.)

**Registry & name:** publishes to the **public npm registry**, unscoped. Checked live against `registry.npmjs.org` while writing this doc (2026-09-22) — `monorepo-dep-auditor` is unpublished/available (`404` on lookup), as are a few fallbacks (`dep-auditor`, `workspace-dep-auditor`, `cross-package-dep-auditor`). Re-check immediately before the actual `npm publish`, since availability can change between now and then. License: MIT (standard default for a public CLI tool; swap if the project needs something else).

## 1. What "independent module" means here (design goals)

| Goal | Concretely |
|---|---|
| Works with Turborepo, Nx, Lerna, or plain workspaces | One discovery layer with adapters per tool (§4) — the rule engine never knows which tool it's running under |
| **Works with both Yarn and npm** | The tool only ever reads `package.json` / `pnpm-workspace.yaml` / `lerna.json` and writes `package.json` — it never shells out to `yarn` or `npm` for install/resolution. Yarn's and npm's `workspaces` field share the same shape (array or `{ packages: [...] }`), so one adapter (`workspaces-field`, §4) covers both with no branching. The one place the two package managers genuinely differ — how a root-level pinned override is declared (`resolutions` for Yarn vs. `overrides` for npm) — is handled explicitly in the `root-pinned` rule (§6), which checks both keys rather than assuming one. Package-manager identity (reading `packageManager` in root `package.json`, or which lockfile is present) is used **only** for `init`'s log line ("detected: npm workspaces") — never for branching discovery or rule logic. |
| Easy integration | `npx monorepo-dep-auditor init` detects the repo's hook manager and prints the one line to add. Never installs its own hook manager. |
| Minimal dependencies | One runtime dependency total (`fast-glob`, justified in §5). Everything else is Node stdlib. |
| Complete validation + verification | Four-stage pipeline (detect → evaluate → report → fix) where `--fix` always re-runs detect+evaluate before exiting, so the tool never reports success on an unverified fix (§6) |
| Configurable, not hardcoded | Rules and exceptions live in a config file the consuming repo owns, not in the package (§5) |

**Explicit non-goals (out of scope, don't build):** CVE/vulnerability scanning (that's `npm audit`/`osv-scanner`'s job), license compliance (a separate tool/problem), auto-upgrading to latest versions (that's Renovate/Dependabot's job — this tool only *aligns* versions that already exist somewhere in the repo, it never fetches a newer one from the registry), pnpm-only edge cases beyond basic `pnpm-workspace.yaml` parsing (pnpm support is present per §4 but Yarn/npm are the two package managers this plan is scoped and tested against first).

## 2. The problem this solves, restated as a product requirement

A monorepo has N independently-versioned workspace manifests. Nothing enforces that two workspaces declaring the same dependency name agree on its version. Drift is invisible until it causes a bug, and by the time Renovate or a human notices, it's already merged. Requirement: **catch the drift at commit time, locally, before it reaches the remote.**

## 3. Architecture

```
Consumer monorepo (Turborepo / Nx / Lerna / plain workspaces)
│
│  .husky/pre-commit  (or lefthook.yml / simple-git-hooks / native .git/hooks)
│      → npx monorepo-dep-auditor check --staged
│
▼
┌─────────────────────────────────────────────────────────────────┐
│                    monorepo-dep-auditor (CLI)                   │
│                                                                   │
│  bin/dep-auditor.js                                              │
│    └─ parseArgs(process.argv)        [node:util, stdlib]         │
│         └─ dispatch: init | check | fix                          │
│                                                                   │
│  ┌────────────────┐   ┌─────────────────────┐                    │
│  │ Config Loader  │──▶│ Workspace Discovery  │                    │
│  │ (§5)           │   │ (§4 — tool adapters) │                    │
│  └────────────────┘   └──────────┬──────────┘                    │
│                                    ▼                              │
│                        ┌──────────────────────┐                  │
│                        │ Manifest Parser       │                  │
│                        │ (reads package.json,  │                  │
│                        │  sniffs indent style) │                  │
│                        └──────────┬───────────┘                  │
│                                    ▼                              │
│                        ┌──────────────────────┐                  │
│                        │ Dependency Graph      │                  │
│                        │ Map<depName,          │                  │
│                        │     Map<version,      │                  │
│                        │         workspace[]>> │                  │
│                        └──────────┬───────────┘                  │
│                                    ▼                              │
│                        ┌──────────────────────┐                  │
│                        │ Rule Engine (§6)      │                  │
│                        │ - single-version      │                  │
│                        │ - root-pinned         │                  │
│                        │ - banned-package      │                  │
│                        │ - peer-consistency    │                  │
│                        └──────────┬───────────┘                  │
│                                    ▼                              │
│                          Violation[]                              │
│                          ╱              ╲                         │
│                 ┌───────────────┐  ┌───────────────┐              │
│                 │ Reporter      │  │ Fix Engine     │              │
│                 │ (TTY / JSON)  │  │ (--fix only)   │              │
│                 └───────┬───────┘  └───────┬───────┘              │
│                         │                   │  rewrites            │
│                         │                   │  package.json,       │
│                         │                   ▼  then RE-RUNS        │
│                         │           Discovery→Graph→Rules          │
│                         │                   │  to verify            │
│                         ▼                   ▼                      │
│                    exit code 0/1     exit code 0/1                 │
└─────────────────────────────────────────────────────────────────┘
```

Every box above is a separate module with one exported function — swappable and independently testable (e.g., a fifth monorepo tool later is one new adapter file, zero changes elsewhere).

## 4. Workspace discovery — how "find every package.json" actually differs per tool

This is the part that has to be right, because Turborepo/Nx/Lerna don't each invent their own package list — they mostly delegate to the underlying package manager. Detection order (first match wins):

| Priority | Source file | Used by | What's read |
|---|---|---|---|
| 1 | `pnpm-workspace.yaml` | pnpm (any orchestrator on top) | `packages:` glob list (supports `!exclude/**`) |
| 2 | root `package.json` → `workspaces` | **Yarn and npm identically** (same field, same two shapes — this is the adapter that makes Yarn/npm support a non-issue), and by extension most Turborepo/Nx repos (Turborepo has no workspace concept of its own — it reads the package manager's) | array form or `{ packages: [...] }` form |
| 3 | `lerna.json` → `packages` | Lerna (pre-v6 standalone mode) | glob list, same shape as `workspaces` |
| 4 | `nx.json` → `projects` (legacy map) | old Nx (pre-workspaces-based Nx) | explicit `{ projectName: "path" }` map |
| — | none found | — | error: "can't auto-detect workspaces — set `workspaceGlobs` in config" |

`turbo.json` and modern `nx.json` are read **only** to log "detected: Turborepo" / "detected: Nx" for `init`'s printed summary — they don't change discovery logic, because by the time you're on Turborepo or modern Nx, priority 1/2 already found everything.

Each adapter returns the same shape regardless of source: `WorkspaceInfo[] = { name, path, packageJsonPath }[]`. The rule engine and everything downstream never checks which adapter ran.

## 5. Config — one file, the consuming repo owns it

`dep-auditor.config.json` (or `.js`/`.cjs` for computed config) at the consumer's repo root. Falls back to a `"depAudit"` key in root `package.json` if no standalone file exists (same rc-style precedence ESLint used before flat config — familiar to engineers, zero extra parsing library).

```jsonc
{
  "workspaceGlobs": null,        // null = auto-detect via §4; set to override
  "rules": {
    "single-version": { "enabled": true, "exceptions": [] },   // dependency names allowed to diverge on purpose
    "root-pinned": { "enabled": false },                       // reads BOTH root "resolutions" (Yarn) and "overrides" (npm) automatically — no key to configure
    "banned-packages": {
      "enabled": true,
      "packages": [
        // string form = banned entirely, any version:
        "request",
        // object form = banned only in a version range, with a reason surfaced in the report:
        { "name": "lodash", "range": "<4.17.21", "reason": "prototype pollution advisory" }
      ]
    },
    "peer-consistency": { "enabled": true }
  }
}
```

Only one runtime dependency exists in this whole tool: **`fast-glob`**, used solely to expand `workspaceGlobs` patterns. Rejected the zero-dependency alternative (hand-rolled glob matcher) on purpose: real `pnpm-workspace.yaml`/`lerna.json` configs use negation (`!packages/legacy/**`) and brace patterns that a hand-rolled matcher gets subtly wrong — and silent wrong-discovery in a *validation* tool is worse than one well-audited dependency (same size trade-off, `fast-glob` is correct on the edge cases; a hand-rolled version is the flimsier one).

## 6. Validation & verification pipeline (the part that makes `--fix` trustworthy)

Four stages, and **stage 4 always re-runs stages 1–3** — this is the "complete validation and verification" requirement, not just a fix-and-hope:

1. **Detect** — discovery (§4) → parse every manifest → build `Map<depName, Map<version, workspaceName[]>>`.
2. **Evaluate** — run each enabled rule (§ below) against the graph → `Violation[]`, each with `{ rule, dependency, conflictingVersions, workspaces }`.
3. **Report** — human table on TTY; `--json` for CI log parsing; exit code 1 if any violation, 0 otherwise. `check` mode stops here.
4. **Fix** (`--fix` only) — for each violation, compute the canonical version (majority vote, or the `root-pinned` rule's declared value if that rule fired), rewrite each offending `package.json` preserving its original indentation, **then immediately re-run steps 1–3 in-process**. If the re-check still finds violations (e.g., a version the rule can't reconcile automatically, like two disjoint major ranges with no override), `--fix` exits 1 and prints exactly which ones need a human — it never claims success it didn't verify.

Rules (each is a ~20-line pure function `(graph, config) => Violation[]`, same shape as the `yarn.config.cjs` loop from the companion doc, just package-manager-independent):

- **single-version** (default on) — every workspace declaring dependency X must resolve to the same range, unless X is in `exceptions`.
- **root-pinned** (opt-in) — if the root manifest declares a version for X in **either** `resolutions` (Yarn's key) **or** `overrides` (npm's key) — checked unconditionally, both are read regardless of which package manager the repo uses — every workspace must match that exact value instead of majority vote.
- **banned-packages** (default on, empty list) — flag any workspace depending on a listed package. Two entry forms: a bare string bans the package outright (any version); `{ name, range, reason }` bans only a version range and surfaces `reason` in the violation report (e.g. a known-CVE range or a deprecated package the org has moved off). Ships v1, list starts empty — has no effect until the consuming repo populates it.
- **peer-consistency** (opt-in) — a workspace's declared `peerDependencies` range must be satisfied by what every consumer of that workspace actually has installed.

## 7. CLI surface

```
dep-auditor init            # detect tool + hook manager, write default config, print integration snippet
dep-auditor check           # staged package.json files only (default — the "localized" requirement)
dep-auditor check --all     # every workspace, ignores git staging (for CI full-repo runs)
dep-auditor check --json                # machine-readable report
dep-auditor check --format=markdown     # writes a .md report (PR-comment / CI job-summary friendly)
dep-auditor check --format=csv          # writes a .csv report (opens directly in Excel/Sheets)
dep-auditor check --format=html         # writes a self-contained .html report (CI artifact, opens in any browser)
dep-auditor check --format=markdown --out=report.md   # default filename if --out omitted: dep-audit-report.<ext>
dep-auditor fix             # apply + re-verify (§6 stage 4)
dep-auditor fix --dry-run   # print the diff, write nothing
```

**Report formats: table (default TTY), JSON, Markdown, CSV, HTML — no `.xlsx`.** All five are generated from the same `Violation[]` the rule engine already produces, so this is a set of formatters, not a new pipeline. Markdown is a table of `{ rule | dependency | versions | workspaces }` with a one-line summary heading — pastes straight into a PR comment or shows up as a GitHub Actions job summary. CSV is the same rows, comma-escaped — opens in Excel/Sheets/Numbers with zero conversion step. HTML is a single self-contained file — inline `<style>` only, no external CDN/font/JS requests (so it works as an air-gapped CI artifact and doesn't phone home), grouped by rule using native `<details>`/`<summary>` for collapsible sections instead of any client-side JS.

**HTML-specific security requirement, not optional:** every interpolated value (dependency name, version string, workspace name, a `banned-packages` `reason`) originates from someone's `package.json` — in principle attacker-controllable if this ever runs against a third-party or untrusted repo. The HTML reporter must run every value through a single shared `escapeHtml()` helper before interpolating it into markup; skipping this on any field turns "dependency audit report" into a stored-XSS vector the moment someone opens it in a browser. This is the one report format that gets its own test asserting a dependency literally named `<img src=x onerror=alert(1)>` renders as inert text, not markup.

Deliberately **not** shipping real `.xlsx` generation: every library that writes actual Excel workbooks (`exceljs`, `xlsx`/SheetJS) is a nontrivial dependency with its own security history (SheetJS has had real CVEs — prototype pollution, ReDoS) — adding one would contradict this package's own "minimal dependencies" pillar for a format that CSV already covers for the realistic use case ("hand this to someone who wants to filter/sort in a spreadsheet"). *(ponytail: CSV instead of `.xlsx` is a deliberate corner cut — ceiling is no multi-sheet/styled workbooks; upgrade path is adding `exceljs` as an explicit opt-in `--format=xlsx` if a real need for sheets/formulas/formatting shows up.)*

`init` never writes a hook file itself. It detects what's already present (`.husky/`, `lefthook.yml`, `simple-git-hooks` key in `package.json`, or plain `.git/hooks/`) and prints the exact one-liner to paste for that specific setup — e.g. a `lint-staged` entry if Husky+lint-staged is present, a `lefthook.yml` snippet if Lefthook is present, or a raw shell line for a bare `.git/hooks/pre-commit`. Zero new hook infrastructure forced on any consumer.

## 8. Package layout

```
dep-auditor/
├── src/
│   ├── cli.ts                  # parseArgs + dispatch
│   ├── config/load.ts
│   ├── discovery/
│   │   ├── index.ts            # priority chain from §4
│   │   ├── pnpm.ts
│   │   ├── workspaces-field.ts  # covers Yarn/npm/Turborepo/most-Nx
│   │   ├── lerna.ts
│   │   └── nx-legacy.ts
│   ├── graph/build.ts
│   ├── rules/
│   │   ├── single-version.ts
│   │   ├── root-pinned.ts
│   │   ├── banned-packages.ts
│   │   └── peer-consistency.ts
│   ├── fix/apply.ts             # rewrite + preserve indent
│   ├── report/{table,json,markdown,csv,html}.ts   # all five render the same Violation[]; html.ts owns escapeHtml()
│   └── init/detect-hook-manager.ts
├── test/
│   ├── fixtures/{turborepo,nx,lerna,plain-yarn,pnpm}/   # tiny sample monorepos
│   └── *.test.ts                # node:test
├── bin/dep-auditor.js           # shebang, requires dist/cli.js
├── package.json
└── tsconfig.json
```

## 9. Technical stack — every choice justified against "less dependencies"

| Concern | Choice | Why not the heavier default |
|---|---|---|
| Language | TypeScript → `tsc` to plain CJS, no bundler | Bundler (esbuild/tsup) is unnecessary at this file count; `tsc` alone ships `.js` + `.d.ts` |
| CLI parsing | `node:util` `parseArgs` (stdlib) | Six flags total — `commander`/`yargs` would be the heaviest dependency in the package for the least reason |
| Glob expansion | `fast-glob` (the one dependency) | Justified in §5 — correctness on negation/brace patterns real configs use |
| Git staged files | `child_process.execFileSync('git', [...])` (stdlib) | Running inside a git hook guarantees git is on PATH; no git library needed |
| Config search | ~30-line custom loader | Avoids `cosmiconfig`; search order is 2 filenames + 1 `package.json` key, doesn't need a general-purpose library |
| Manifest edits | `JSON.parse`/`stringify` + tiny indent-sniff (reads first indented line's leading whitespace) | Avoids `detect-indent`; preserves existing formatting so `--fix` diffs stay minimal |
| Terminal output | manual ANSI codes gated on `process.stdout.isTTY` | Avoids `chalk`/`picocolors` for ~4 colors total |
| Markdown / CSV / HTML reports | hand-rolled string templating (stdlib) over the same `Violation[]` the table/JSON reporters use; HTML uses a single shared `escapeHtml()` on every interpolated value | No `.xlsx` — rejected `exceljs`/`xlsx` (SheetJS) specifically because both are heavy, security-sensitive dependencies for a package whose value prop is minimal dependencies; CSV covers "open in a spreadsheet" without one. No client-side JS framework for HTML either — native `<details>`/`<summary>` covers the one interaction (collapse/expand) needed |
| Tests | `node:test` + `node:assert` (stdlib) | No devDependency test framework needed for this size |
| Registry | Public npm registry, unscoped package name | Widest reach for a tool meant to install into *any* Turborepo/Nx/Lerna repo, not just one org's private feed |
| Package manager support | Yarn + npm both, verified via the `workspaces-field` adapter and dual-key `root-pinned` rule (§4/§6) | No separate code paths per package manager — one adapter covers both by construction |
| License | MIT + `LICENSE` file, `"license"` field in `package.json` | Required for a public npm package; permissive license removes friction for adopters |
| Versioning | manual semver + `CHANGELOG.md` | Add `changesets` only once there are multiple external contributors |

**Total runtime dependency count: 1** (`fast-glob`). Everything else is Node.js stdlib.

## 10. Testing & CI (the "verification" the package itself needs)

- **Per-adapter unit tests**: one fixture monorepo per tool/package-manager combo in `test/fixtures/` (turborepo-yarn, turborepo-npm, nx-yarn, nx-npm, lerna, plain-yarn, plain-npm, pnpm) — each a handful of real `package.json`/`turbo.json`/`nx.json`/`lerna.json`/`pnpm-workspace.yaml` files, asserting discovery returns the right workspace list **and** that the yarn- and npm-flavored fixtures for the same tool produce identical results (proves the Yarn/npm-agnostic claim, not just asserts it).
- **Rule engine unit tests**: construct a graph in-memory (no filesystem), assert each rule's violations match expected output — fast, no fixtures needed. Include one test with `resolutions` set and one with `overrides` set, asserting `root-pinned` behaves identically either way.
- **Fix idempotency test**: run `fix` on a fixture with induced drift, assert zero violations remain, then run `fix` again and assert it makes **no further changes** (a fix that isn't idempotent is a bug).
- **CLI integration test**: spawn the built CLI as a real subprocess (`node:child_process`) against a temp-dir copy of each fixture, assert exit codes and `--json` output shape.
- **Dogfooding**: this package's own repo runs its own pre-commit hook using itself — the most-exercised integration test there is, runs on every commit to the tool itself.
- **CI matrix**: run the full test suite across current Node LTS versions (e.g. 18.x, 20.x, 22.x) — a public package can't assume a specific consumer's Node version, so the matrix is the compatibility contract, not a single pinned version.

## 11. Rollout & effort estimate

| Phase | Work | Time |
|---|---|---|
| 1 | Scaffold package (new standalone repo), `workspaces-field` (Yarn+npm) + `pnpm` adapters, **single-version rule, banned-packages rule**, check command, table reporter | 4–5 hrs |
| 2 | `fix` command + re-verify step, indent-preserving writer, fix idempotency test | 2 hrs |
| 3 | `lerna` + `nx-legacy` adapters, their fixtures | 1.5 hrs |
| 4 | `init` command + hook-manager detection + config scaffolding | 1.5 hrs |
| 5 | `root-pinned` (dual `resolutions`/`overrides`) + `peer-consistency` rules | 1.5 hrs |
| 6 | Markdown + CSV + HTML reporters (`--format=markdown\|csv\|html`, `--out`), shared `escapeHtml()` + its XSS-escaping test | 1.5 hrs |
| 7 | Yarn-fixture and npm-fixture parity tests for every adapter (proves the cross-package-manager requirement) | 1 hr |
| 8 | CI pipeline (GitHub Actions, Node LTS matrix), publish v0.1.0 to public npm | 1 hr |
| **Total** | | **~12.5–13.5 hrs** across a couple of sessions |

## 12. Open questions (need a decision before Phase 1, not before this doc)

1. **Name** — `monorepo-dep-auditor` was unpublished as of the live registry check in this doc's header; re-verify at publish time (`npm view monorepo-dep-auditor` should 404).
2. **Repo location** — recommendation: a brand-new standalone repository, not a workspace inside any existing monorepo. Since it's published independently to public npm with its own license/README/CI/versioning, embedding it inside another repo's workspace would just mean extracting it later anyway.
3. **`banned-packages` initial list** — the rule ships enabled in Phase 1 (moved up from the earlier deferred plan), but its `packages` list starts empty. Someone needs to decide what actually goes in it (deprecated internal libs? known-CVE ranges pulled from a prior audit?) before it does anything useful in a real repo.
