# monorepo-dep-auditor

Policy checks for JS/TS monorepos: one command, one optional config file, three checks, five
report formats. Catches dependency versions that disagree across workspace packages, blocks
packages you've decided the repo shouldn't use, and verifies peer dependencies against what's
*actually installed*, not just what another manifest declares.

The version-consistency check is built on top of the
[`check-dependency-version-consistency`](https://www.npmjs.com/package/check-dependency-version-consistency)
engine; the banned-packages and peer-consistency checks are original to this package.

**[Try the options playground](docs/playground.html)** — an interactive, dependency-free HTML
page that simulates every option below against a small fixed workspace, so you can see the
resulting CLI command, config file, and violations update live, without installing anything.

## What it checks

- **`single-version`** — every workspace package that depends on the same package must declare
  the same version range. Flags it if two packages disagree (e.g. one wants `left-pad@^1.0.0`,
  another wants `left-pad@^2.0.0`).
- **`banned-packages`** — bans a package outright, or bans only versions inside a semver range,
  repo-wide. A range-based ban checks the *actually installed* version per workspace (same
  resolution `peer-consistency` uses) whenever one is resolvable, so a version pulled in by npm
  `overrides`/Yarn `resolutions`/pnpm's own overrides gets caught even if the declared range looks
  safe — and, the other direction, a declared range that overlaps the ban doesn't get flagged if
  an override already moved the real installed version out of it. Falls back to the declared
  range only when nothing is installed to resolve yet (e.g. before `npm install`).
- **`peer-consistency`** — checks that each workspace's declared `peerDependencies` range is
  satisfied by what's *actually resolvable* on disk (via `require.resolve`), not just what's
  written in another manifest. Reports "not installed anywhere" and "installed but wrong version"
  as two distinct problems, since they need different fixes.

## Install

```bash
npm install --save-dev monorepo-dep-auditor
```

```bash
yarn add --dev monorepo-dep-auditor
```

A global install works too — `npm install -g monorepo-dep-auditor`, then run it against any
repo with `--root-dir /path/to/that/repo` (see [CLI usage](#cli-usage)). Nothing in this
package's resolution logic depends on where it's installed; only the CLI's default target
(`process.cwd()`) does.

## Config

Optional. Create `monorepo-dep-auditor.config.json` at your workspace root:

```json
{
  "bannedPackages": [
    "request",
    { "name": "lodash", "range": "<4.0.0", "reason": "EOL, use lodash-es" }
  ],
  "checkPeerConsistency": true,
  "depType": ["dependencies", "devDependencies"],
  "ignoreDep": ["left-pad"],
  "ignoreDepPattern": ["^@internal/"],
  "ignorePackage": ["some-legacy-package"],
  "ignorePackagePattern": ["^scratch-"],
  "ignorePath": ["packages/some-legacy-package"],
  "ignorePathPattern": ["^packages/scratch-"]
}
```

If this file doesn't exist, `banned-packages` and `peer-consistency` are both skipped — the
`single-version` check still runs with its defaults.

- **`bannedPackages`** — turns on the `banned-packages` check. A plain string bans that package
  outright; an object bans only versions matching `range` and can attach a human-readable
  `reason` shown in violation output.
- **`checkPeerConsistency`** — turns on the `peer-consistency` check.
- **`depType`** — which manifest fields (`dependencies`, `devDependencies`,
  `optionalDependencies`, `peerDependencies`, `resolutions`) the `single-version` check compares
  across workspaces. Defaults to everything except `peerDependencies` (peer ranges are handled by
  the dedicated `peer-consistency` check instead). Only affects `single-version` —
  `banned-packages` and `peer-consistency` each look at their own relevant fields regardless of
  this setting.
- **`ignorePackage`/`ignorePackagePattern`/`ignorePath`/`ignorePathPattern`** — exclude a
  workspace package (by name, workspace-relative path, or a regex of either) from *every* check.
  These four apply uniformly across all three checks.
- **`ignoreDep`/`ignoreDepPattern`** — exclude a dependency name (or regex) from the
  `single-version` check only. This doesn't extend to `banned-packages` (a banned package is
  usually declared at one consistent version, so "ignore a mismatch" doesn't apply) or
  `peer-consistency` (that check compares declared-vs-*installed*, an unrelated question to
  cross-manifest agreement) — use `ignorePackage`/`ignorePath` instead if you need to exclude a
  workspace from those two. An entry that no longer matches a real mismatch (the disagreement it
  was written for has since been fixed) is silently dropped rather than raising an error, so a
  config file doesn't need constant pruning as the repo changes.

**Note:** `ignorePackage`/`ignorePackagePattern`/`ignorePath`/`ignorePathPattern` must match an
actual workspace package for the run to proceed — an unmatched entry raises an error naming the
bad value. That validation (and the exact wording of that one error message) comes from the
`check-dependency-version-consistency` engine used internally for `single-version`.

## CLI usage

```bash
npx monorepo-dep-auditor                         # table format, stdout
npx monorepo-dep-auditor --format json
npx monorepo-dep-auditor --format markdown --out report.md
npx monorepo-dep-auditor --format csv --out report.csv
npx monorepo-dep-auditor --format html --out report.html
npx monorepo-dep-auditor --fix
npx monorepo-dep-auditor --config ./custom.config.json
npx monorepo-dep-auditor --root-dir ../some-other-monorepo
npx monorepo-dep-auditor --dep-type dependencies --dep-type devDependencies
npx monorepo-dep-auditor --ignore-dep left-pad --ignore-dep-pattern '^@internal/'
npx monorepo-dep-auditor --ignore-package some-legacy-package --ignore-path packages/scratch
```

The `--dep-type`/`--ignore-*` flags are repeatable (pass the flag multiple times for multiple
values) and override the same-named config file field when both are set. See
[Config](#config) above for what each one does and does not affect.

`--root-dir` points the audit at a workspace root other than the current directory (resolved
relative to it if not absolute) — `monorepo-dep-auditor.config.json` is then looked up under
*that* directory by default, not the CLI's cwd. A relative `--config` follows the same rule: it
resolves against `--root-dir`, not the CLI's cwd, so both flags stay consistent with each other.
This is what makes a single global install (`npm install -g monorepo-dep-auditor`) usable against
any repo without `cd`-ing into it first; without it, the CLI only ever audits `process.cwd()`.

Exit code is `1` if any violation exists (from any check), `0` otherwise — wire this straight
into a pre-commit hook or CI step.

`--fix` automatically fixes `single-version` mismatches, rewriting each `package.json` to the
newest version already used somewhere in the repo. `banned-packages` and `peer-consistency`
violations have no auto-fix (there's no single "correct" version to fall back to); if any exist
alongside `--fix`, the CLI prints a note telling you they need manual fixing.

### Example output (not a real screenshot) — `table` format

```
Monorepo Dependency Audit Report
Repository: my-monorepo
Generated: 2026-01-01T00:00:00.000Z
Packages audited: 12
Detected: Turborepo

Rule            | Dependency | Detail                                              | Workspaces
----------------+------------+------------------------------------------------------+----------------------------------
single-version  | left-pad   | Found 2 different versions: ^1.0.0 (packages/pkg-a);  | packages/pkg-a, packages/pkg-b
                |            | ^2.0.0 (packages/pkg-b)                               |
banned-packages | request    | Package is banned outright (declared as "^2.88.0")    | packages/uses-banned
peer-consistency| react      | Peer dependency version mismatch: "react" declared    | packages/some-plugin
                |            | range "^18.0.0" is not satisfied by installed version |
                |            | "17.0.2" at "packages/some-plugin"                    |

3 violation(s) found.
```

### Example output (not a real screenshot) — `html` format (rendered as text)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Monorepo Dependency Audit Report</title>
</head>
<body>
  <h1>Monorepo Dependency Audit Report</h1>
  <p>Repository: my-monorepo</p>
  <p>Generated: 2026-01-01T00:00:00.000Z</p>
  <p>Packages audited: 12</p>
  <p>Detected: Turborepo</p>
  <p>1 violation(s) found.</p>
  <table border="1" cellpadding="4" cellspacing="0">
    <thead>
      <tr><th>Rule</th><th>Dependency</th><th>Detail</th><th>Workspaces</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>banned-packages</td>
        <td>request</td>
        <td>Package is banned outright (declared as &quot;^2.88.0&quot;)</td>
        <td>packages/uses-banned</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
```

Every interpolated value in the HTML reporter is passed through an `escapeHtml()` helper —
including dependency names — since this tool renders other people's package names, which are
untrusted input.

## Node API usage

```ts
import { audit, toJson, toHtml } from 'monorepo-dep-auditor';

const { violations, monorepoKind, repoName, packageCount } = audit({
  rootDir: '/path/to/workspace/root',
  // configPath: './custom.config.json', // defaults to <rootDir>/monorepo-dep-auditor.config.json
  // fix: true,                          // auto-fixes single-version mismatches
  // depType: ['dependencies', 'devDependencies'], // single-version check only
  // ignoreDep: ['left-pad'],                       // single-version check only
  // ignorePackage: ['some-legacy-package'],        // every check
});

console.log(`Detected: ${monorepoKind}, ${packageCount} package(s) in ${repoName}`);
console.log(
  toJson(violations, {
    monorepoKind,
    repoName,
    packageCount,
    generatedAt: new Date().toISOString(),
  }),
);

if (violations.length > 0) {
  process.exitCode = 1;
}
```

Each check is also exported individually if you only want one:

```ts
import { checkBannedPackages, checkPeerConsistency } from 'monorepo-dep-auditor';

const banned = checkBannedPackages(rootDir, [{ name: 'request', reason: 'deprecated' }]);
const peers = checkPeerConsistency(rootDir);

// Both take an optional third argument to exclude a package/path (not a dep name — see Config above):
const bannedIgnoringLegacy = checkBannedPackages(rootDir, [{ name: 'request' }], {
  ignorePackage: ['some-legacy-package'],
});
```

## Monorepo tool detection

`monorepoKind` is a friendly label ("Turborepo" / "Nx" / "Lerna" / "Unknown") detected from the
presence of `turbo.json` / `nx.json` / `lerna.json`. It's cosmetic only, shown in report output —
workspace discovery itself relies on the root `package.json`'s `workspaces` field, which Turbo,
modern Nx, and modern Lerna all already require.

## Known limitations (by design)

- **Legacy Lerna repos aren't supported.** If a repo has a `lerna.json` `packages` array but *no*
  `workspaces` field in the root `package.json` (pre-workspaces-era Lerna setups that were never
  migrated), this package throws an actionable error rather than silently doing nothing. We
  deliberately don't maintain a second, Lerna-specific glob-resolution engine alongside
  `workspaces`-field discovery for this one case — Lerna itself supports running alongside
  npm/Yarn workspaces, so the fix is to add a `workspaces` field to root `package.json` mirroring
  `lerna.json`'s `packages` array.
- **`overrides`/`resolutions`/pnpm-overrides are never parsed as manifest fields, by any check —
  and don't need to be.** We chose not to add a parallel reader for any of these three
  differently-shaped fields. `banned-packages`'s range-based bans sidestep the problem entirely by
  checking what's actually resolvable on disk instead (see above) — that's affected by all three
  automatically, with no format-specific parsing. `single-version` is the one check this doesn't
  extend to: it's a manifest-hygiene check (do workspaces *declare* the same range), a
  deliberately different question from what's actually installed, so an override papering over a
  real declared-range disagreement is still correctly flagged there — if the override is ever
  removed, the underlying disagreement it was hiding resurfaces. Also: `banned-packages`'s
  installed-version check only ever looks at workspaces that *directly* declare the banned
  dependency, same scope `peer-consistency` already has — a banned package pulled in only
  transitively, with no direct declaration anywhere, isn't detected.
- **Yarn Berry in PnP mode isn't fully supported.** `peer-consistency` and `banned-packages`'s
  range-based checks both rely on resolving what's actually installed on disk (see above), which
  doesn't work under Yarn's PnP linker (no `node_modules`). This package detects PnP and degrades
  gracefully — `peer-consistency` skips its check (with a warning) instead of false-flagging every
  peer as "not installed", and range-based bans fall back to the declared-spec check (with a
  warning) instead of missing overrides silently.
