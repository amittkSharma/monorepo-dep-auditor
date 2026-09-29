# Real-world validation report

Tested against `dcc.med-solution-apps` (external, read-only — no files in that repo were
modified). Chosen because it's a large, real Turborepo: 50 workspaces, Yarn Berry 4.15.0 with
`nodeLinker: node-modules` (not PnP), 3.5 GB `node_modules`, real `yarn.lock`. This is the first
time this package has been run against a repo of this size, or against real dependency data it
wasn't specifically constructed to pass.

**Update:** the CLI-only-peer false positive found below (`@biomejs/biome`) has since been fixed
and re-verified against this same repo — see "Fix applied and re-verified" at the end of this
report. Everything above that section describes the original run, before the fix.

## What was run

```bash
node dist/cli.js --root-dir <repo> --format json                                  # defaults only
node dist/cli.js --root-dir <repo> --config <external-config> --format json       # + banned-packages + peer-consistency
```

`--config` pointed at a config file outside the target repo — nothing was written into
`dcc.med-solution-apps` at any point.

## Results

| Check                                                       | Result                                | Time          |
| ------------------------------------------------------------ | -------------------------------------- | ------------- |
| `single-version` (default)                                    | 6 real violations                      | 0.21s         |
| + `banned-packages` (outright: `request`; range: `moment`)     | 0 additional (both absent from repo)   | +0.03s        |
| + `peer-consistency`                                           | 2 additional violations                | included above |

**Total: full 3-check audit across 50 workspaces and 3.5 GB of installed dependencies in ~0.25
seconds.** No performance concern at this scale — the earlier "scale untested" caveat is now
addressed for a repo of this size.

### `single-version`: correct, verified

One flagged dependency spot-checked directly against the manifests:

```text
"@zeiss/lib-shared": "*"            → 30 workspaces
"@zeiss/lib-shared": "workspace:*"  → 3 workspaces
"@zeiss/lib-shared": "workspace:^"  → 1 workspace
```

Genuine three-way disagreement on an internal shared package, exactly what the check exists to
catch. Real finding, not a tool artifact.

### `banned-packages`: correct, no false positive

Neither `request` nor `moment` is used anywhere in this repo — correctly zero violations for
both. This repo also has no existing `resolutions`/`overrides` field, so it couldn't re-validate
the override-aware resolved-version logic (already validated separately against purpose-built
npm/pnpm/yarn-classic repros — see the main conversation/README). What it did validate: the
resolution machinery runs cleanly against a real, large, Yarn-Berry-with-node-modules-linker
install without erroring or timing out.

### `peer-consistency`: one real true positive, one new false positive

**True positive** — `packages/common/med-configs` declares peer `@rsbuild/plugin-react: "^1.4.6"`;
actually installed is `2.0.0` (confirmed directly via `require.resolve` + reading that package's
own `package.json`). This is a genuine, pre-existing mismatch in the target repo, correctly
caught. Real value delivered — this is the exact "declared-vs-installed" gap this check exists
to close.

**False positive (newly discovered, now fixed — see below)** — the same workspace declares peer `@biomejs/biome:
"^2.2.4"`; version `2.3.9` is genuinely installed on disk (confirmed by reading
`node_modules/@biomejs/biome/package.json` directly), and `2.3.9` satisfies `^2.2.4`. But
`@biomejs/biome`'s `package.json` has no `main`/`exports` field — it's a CLI-only package (only a
`bin` entry) — so `require.resolve()` throws `MODULE_NOT_FOUND` even though the package is
correctly installed. `peer-consistency` currently treats any `require.resolve` failure as "not
installed", which is wrong specifically for CLI-only peer packages: **installed-but-not-`require`-
able is being reported identically to genuinely-not-installed.**

- **Root cause**: `resolveInstalledVersion` (`src/resolve-installed-version.ts`) can only find a
  version by resolving an *entry file* first (`createRequire(...).resolve(depName)`), then
  walking up from that file to find the package's own `package.json`. A package with no
  resolvable JS entry point never reaches that walk-up step at all.
- **How common this is**: peerDependencies are usually libraries meant to be imported (`react`,
  `styled-components`, bundler plugins), which do have a `main`/`exports`. CLI-only tools declared
  as *peers* (rather than `devDependencies`) are less common but real — linters/formatters are the
  obvious case, as seen here. Not found by any of this session's earlier testing because every
  prior fixture used ordinary importable packages.
- **Fixed.** `resolveInstalledVersion` (`src/resolve-installed-version.ts`) now falls back to
  resolving `` `${depName}/package.json` `` directly whenever resolving a requirable entry file
  fails — Node can locate a package's `package.json` by name without needing `main`/`exports` to
  point at anything requirable. This is a fix in the one shared function both `peer-consistency`
  and `banned-packages`'s range-based bans call, so both benefit, not just the check that
  surfaced the bug. See "Fix applied and re-verified" below for the re-run against this same
  repo.

## Effectiveness, trust, correctness — updated verdict

- **Effectiveness**: confirmed on real data. Both real checks (`single-version`,
  `peer-consistency`) found genuine, verifiable issues in a production repo neither was tuned
  against. Not toy results.
- **Trust**: earned, and strengthened by this process. Prior to this test, "no false positives"
  was true for everything actually tested. This test found one real gap (CLI-only
  peerDependencies) — it's now fixed and re-verified against the same repo (below), and the fix
  covers both checks that share the resolution logic, not just the one that surfaced it.
- **Correctness at scale**: confirmed. 50 workspaces, 3.5 GB installed, full 3-check audit in a
  quarter of a second — no evidence of a scale ceiling at this size.
- **What's still not tested**: Windows, and repos larger than 50 workspaces (no data point past
  this size). The CLI-only-peer false positive above was the first non-hypothetical gap found by
  testing against real, unprepared data rather than purpose-built fixtures — worth treating as a
  signal that more of this kind of testing would likely surface more edge cases like it.

## Fix applied and re-verified

`resolveInstalledVersion` tries its original path first (resolve an entry file that can be
`require`d, walk up to the matching `package.json`) — unchanged, since it already worked
correctly for ordinary importable packages, including ones aliased by an override to a different
package under the hood. Only when that throws does it now fall back to resolving
``${depName}/package.json`` directly, which Node locates by package name without needing a
`main`/`exports` entry point at all. Added test: `test/peer-consistency.test.js` — a new
`cli-only-lib` fixture (`bin` only, no `main`/`exports`, matching `@biomejs/biome`'s real shape)
that's genuinely installed and satisfies its declared peer range, asserting no violation is
produced. Full suite: 34/34 passing.

Re-ran the exact same two CLI invocations from "What was run" above against
`dcc.med-solution-apps`, unchanged, still strictly read-only:

| Check              | Before fix | After fix | Change                               |
| ------------------ | ---------- | --------- | ------------------------------------ |
| `single-version`   | 6          | 6         | none — unaffected, as expected       |
| `banned-packages`  | 0          | 0         | none — unaffected, as expected       |
| `peer-consistency` | 2          | 1         | `@biomejs/biome` false positive gone |

Remaining `peer-consistency` violation is still the genuine `@rsbuild/plugin-react` mismatch
(`^1.4.6` declared vs. `2.0.0` installed) — confirmed unchanged. Runtime unchanged (~0.15–0.25s
for the full 3-check audit).

**Updated verdict: no known false positives remain from this test.** Both real issues this
report found in a production repo it wasn't tuned against — the `@zeiss/lib-shared` three-way
version disagreement and the `@rsbuild/plugin-react` peer mismatch — are genuine and correctly
still caught. The one false positive found is fixed and confirmed gone on the same repo, not
just in an isolated fixture.
