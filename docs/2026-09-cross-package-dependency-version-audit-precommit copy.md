# Cross-Package Dependency Version Audit — Pre-Commit Gate — Implementation Plan

Grounded in this repo's actual state (checked directly, not assumed):

- Package manager: **Yarn 4.15.0 (Berry)**, `.yarnrc.yml` present, `packageManager` pinned in root `package.json`.
- Monorepo orchestrator: **Turborepo** (`turbo.json`), not Nx — the problem statement mentioned "Turborepo/Nx" generically; this repo is Turborepo only. Nothing below depends on Nx.
- **54** workspace `package.json` files across `packages/frontend/*`, `packages/backend/*`, `packages/common/*`, `scripts/*`.
- `.husky/pre-commit` already exists and runs `yarn lint-staged`. `package.json` already has a `lint-staged` block (currently only Biome on `*.{js,jsx,ts,tsx,json}`).
- Renovate is already configured (`.renovateconfig.js`) — it opens PRs to bump deps repo-wide, asynchronously, **after** merge. It does not stop a drifting version from being committed today.
- No existing dependency-version tool in the repo (checked `package.json` for `syncpack`, `manypkg`, `depcheck`, `constraints` — none present).

---

## 1. The problem, in plain words

Each workspace (each microservice/package) has its own `package.json`. Nothing stops two workspaces from declaring different versions of the same dependency — e.g. `dcc-api-med-products` on `axios@1.6.0` and `dcc-api-med-systems` on `axios@1.7.2`. Turborepo builds each workspace somewhat independently, so this drift goes unnoticed until it causes a real bug (behavior differs between services, duplicate installs bloat `yarn.lock`, a security patch lands in one service but not its neighbor).

Renovate will *eventually* open a PR to reconcile this — but that's a post-hoc cleanup, not a gate. The gap is: **nothing blocks the drift at the moment it's introduced**, i.e. at commit time.

## 2. Root cause

There's no single source of truth for "what version of X does this monorepo use," and no enforcement point. This is exactly what Yarn Berry's built-in **constraints engine** exists for — it's a first-class feature of the package manager already running this repo, not a third-party add-on.

## 3. Decision: use Yarn's native constraints engine, not a new dependency

Ladder walk-through:

1. Needs to exist? Yes — real, already-possible bug class across 54 workspaces.
2. Already in this codebase? No existing tool.
3. Stdlib? N/A.
4. **Native platform feature covers it? Yes — `yarn constraints`.** Since Yarn 2, Berry ships a constraints checker (`yarn constraints`, `yarn constraints --fix`) that reads every workspace's manifest and applies rules you define in a `yarn.config.cjs` at the repo root. "Same dependency must resolve to the same version everywhere" is the textbook use case — Yarn's own docs use this exact rule as the canonical example. Nothing to install.
5. Already-installed dependency? `lint-staged` + `husky` are already wired for pre-commit — reuse them to invoke the gate, no new hook infra.

Stop climbing here. No new package.

### 3.1 Tech stack evaluation (so the choice isn't just assumed)

| Option | New dependency? | Fit | Verdict |
|---|---|---|---|
| **Yarn constraints** (`yarn.config.cjs`) | None — built into Yarn 4.15.0, already pinned | Purpose-built for exactly this: cross-workspace version alignment | **Chosen** |
| `syncpack` | Yes, new devDependency + its own config format | Popular, nicer CLI diffing, but re-implements what Yarn already ships | Skip — duplicate capability |
| `@manypkg/cli` | Yes, new devDependency | Similar scope to syncpack, opinionated about workspace structure | Skip — same reason |
| Custom Node script walking `packages/**/package.json` | No new dep, but real code to write and maintain | Reinvents the constraints engine, own bug surface | Skip — rung 4 already won |
| Nx module-boundary rules | N/A | Repo doesn't use Nx | Not applicable |

## 4. Implementation

### 4.1 Define the rule — `yarn.config.cjs` (new file, repo root)

```js
// yarn.config.cjs
// Enforces one version per dependency across every workspace.
// `EXCEPTIONS` lists idents allowed to diverge on purpose (rare — document why inline).
const EXCEPTIONS = new Set([
  // 'some-package', // e.g. intentional major-version split during a migration
]);

module.exports = {
  async constraints({ Yarn }) {
    for (const dep of Yarn.dependencies()) {
      if (dep.type === `peerDependencies`) continue;
      if (EXCEPTIONS.has(dep.ident)) continue;

      for (const otherDep of Yarn.dependencies({ ident: dep.ident })) {
        if (otherDep.type === `peerDependencies`) continue;
        dep.update(otherDep.range);
      }
    }
  },
};
```

`dep.update(range)` is Yarn's way of saying "this range should match that one"; when it can't, `yarn constraints` reports the mismatch and exits non-zero. `--fix` rewrites every offending `package.json` to the majority/first-seen range automatically. No `@yarnpkg/types` package needed — that's optional TS typing sugar only, skipped to avoid an unnecessary devDependency.

### 4.2 Wire it into the existing pre-commit path

`.husky/pre-commit` already runs `yarn lint-staged` — reuse it. Add one key to the existing `lint-staged` block in `package.json` (don't touch the existing Biome line):

```diff
   "lint-staged": {
     "*.{js,jsx,ts,tsx,json}": [
       "biome check --no-errors-on-unmatched --files-ignore-unknown=true"
-    ]
+    ],
+    "**/package.json": () => "yarn constraints"
   }
```

The function form is deliberate: `lint-staged` normally appends the list of staged files as arguments, but `yarn constraints` always scans the whole workspace graph (it has to — a conflict is only visible when comparing across workspaces). The function form ignores the staged-file list and runs one fixed command instead. **This is the "localized" part of the ask**: the check only fires when a commit actually touches a `package.json`; a commit that only changes source files never pays the cost.

Also add two root scripts for manual use (`package.json` → `scripts`):

```json
"dep:check": "yarn constraints",
"dep:fix": "yarn constraints --fix"
```

### 4.3 Bootstrap — do this before enabling the hook, not after

Turning the gate on with existing drift already in the repo would block the next unrelated commit with someone else's conflict. Sequence matters:

1. `yarn constraints` — see what's currently broken across the 54 workspaces.
2. `yarn constraints --fix` — auto-align everything.
3. Review the diff like any dependency bump (this touches many `package.json` files — expected, it's a mechanical version alignment, not a code change).
4. Commit that alignment **by itself**, in its own PR.
5. Only then land the `lint-staged` wiring from 4.2, in a separate commit/PR.

Skipping this order is the one way this plan backfires (a wall of pre-existing violations blocking day-one commits from unrelated engineers).

## 5. Verification — the one runnable check

Config-driven logic still needs a check that fails when the rule breaks. No test framework needed — this is a two-minute manual repro:

```bash
# 1. Induce a conflict on purpose
node -e "
  const fs = require('fs');
  const a = JSON.parse(fs.readFileSync('packages/backend/dcc-api-med-products/package.json'));
  a.dependencies.typescript = '5.0.0';
  fs.writeFileSync('packages/backend/dcc-api-med-products/package.json', JSON.stringify(a, null, 2) + '\n');
"

# 2. Confirm the gate catches it
yarn constraints   # expect non-zero exit, prints the mismatch

# 3. Confirm auto-fix resolves it
yarn constraints --fix
yarn constraints   # expect exit 0 now

# 4. Discard the induced change (or leave it fixed — either is fine)
git checkout -- packages/backend/dcc-api-med-products/package.json
```

If step 2 doesn't fail, the constraint rule isn't wired correctly — fix before rollout.

## 6. Effort estimate

| Step | Time |
|---|---|
| Write `yarn.config.cjs` | 15 min |
| Wire `lint-staged` + root scripts | 5 min |
| Bootstrap fix + review diff across 54 workspaces | 30–60 min (depends how much drift already exists — unknown until step 4.3.1 runs) |
| Verification repro | 10 min |
| **Total** | **~1–1.5 hours**, plus PR review time for the bootstrap diff |

## 7. Explicitly out of scope for v1 (phase 2, only if needed)

- **Transitive dependency dedup** (`yarn dedupe --check`) — catches drift in *resolved* sub-dependencies, not just direct `package.json` entries. Different problem, add later if it actually bites.
- **Banned-package rules** (e.g. blocklist a deprecated internal lib) — same `constraints` file can grow a second loop for this; not requested, skip until asked.
- Renovate config changes — Renovate already handles *updating* versions repo-wide; this plan only stops *new* drift between Renovate runs. No overlap to resolve.
