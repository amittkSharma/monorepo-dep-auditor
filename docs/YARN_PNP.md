# Yarn Berry PnP: known limitation

## The problem

`banned-packages` (range-based bans) and `peer-consistency` both determine what's *actually
installed* via `node:module`'s `createRequire(fromPackageJsonPath).resolve(depName)` — see
[ARCHITECTURE.md](ARCHITECTURE.md). That works because npm, pnpm, and Yarn classic (v1) all
install a real `node_modules` tree that Node's built-in module resolution already understands.

Yarn Berry (v2+) in **PnP mode** (its default, unless `nodeLinker: node-modules` is set in
`.yarnrc.yml`) doesn't create `node_modules` at all — it replaces it with a `.pnp.cjs`/`.pnp.mjs`
loader hook. Nothing installs that hook into this package's plain Node process, so every
`createRequire(...).resolve()` call fails, indistinguishable from "genuinely not installed".

## Impact

- **`peer-consistency`**: every declared `peerDependency`, in every workspace, would be reported
  as "not installed" — even when it's perfectly satisfied. A 100% false-positive rate on this
  check's entire output, not an occasional miss.
- **`banned-packages` range-based bans**: silently fall back to the declared-spec-only check
  (the same logic this package used before it could resolve installed versions at all) — not
  wrong, just unable to catch an override that moves a version into/out of the banned range.
- **`banned-packages` outright bans** and **`single-version`**: unaffected. Neither depends on
  resolving anything on disk — they only read declared manifests, which cdvc's own workspace
  discovery already handles for Yarn PnP repos (`pnp-workspace.yaml`/`workspaces` field, no
  `node_modules` needed).

**Who actually hits this:** the intersection of (a) Yarn Berry specifically in PnP mode — not
npm, pnpm, Yarn classic, or Yarn Berry with the `node-modules` linker — and (b)
`checkPeerConsistency: true` set, since that check is opt-in. Likely a small fraction of this
package's users, but for that fraction the check was completely unusable and silently wrong
(no error, just incorrect output) — severity matters as much as headcount for a tool whose whole
job is being trustworthy.

## Current mitigation (implemented)

`isYarnPnp(rootDir)` (`src/resolve-installed-version.ts`) detects a `.pnp.cjs`/`.pnp.mjs` file at
the workspace root. When present:

- `peer-consistency` skips its resolution-based check entirely and returns no violations, instead
  of reporting a false "not installed" for every peer. It prints one `console.warn` explaining why
  it skipped, so the silence is visible rather than mistaken for "everything's fine".
- `banned-packages` still runs its range-based check via the declared-spec fallback (degraded, not
  wrong) and prints one `console.warn` the first time a range-based ban is configured, so users
  know overrides won't be caught in this environment. Outright bans are unaffected and print no
  warning, since they were never at risk.

This is a "detect and don't lie about it" fix, not real PnP support — it costs one `existsSync`
check and a couple of early returns, no new dependency, no change to the `Violation` shape or any
reporter.

## Options for real PnP support (not implemented)

1. **Load `.pnp.cjs`'s own resolution API.** Yarn's PnP runtime exposes a `resolveToUnqualified`/
   `resolveRequest` API on the object returned by `require(path.join(rootDir, ".pnp.cjs"))`.
   Calling that (or simply `require()`-ing the file once, which registers Node module-resolution
   hooks globally as a side effect — this is literally what `yarn node` does) would make
   `resolveInstalledVersion`'s existing `createRequire(...).resolve()` calls start working
   correctly for the rest of the process, with no other code changes needed. Smallest real fix,
   but couples this package to Yarn's undocumented-ish PnP runtime API shape, which has changed
   across major Yarn versions before.
2. **Shell out to `yarn info <pkg> --json`** per dependency to ask Yarn itself what's resolved.
   More robust to internal API changes (it's Yarn's actual public CLI surface), but spawns one
   process per dependency lookup — meaningfully slower on a large monorepo — and requires the
   `yarn` binary to be on `PATH`, which a global install of this package can't assume.
3. **Document a required invocation mode**: tell PnP users to run this tool via `yarn node
   <path-to-this-cli>` (or `yarn dlx monorepo-dep-auditor`) instead of `npx`/global `node`. Since
   `yarn node` pre-loads the PnP hook before running the script, this package's existing
   `createRequire(...).resolve()` calls would then transparently work with zero code changes here.
   Cheapest of the three in code, but pushes the fix onto every user's invocation habits instead
   of fixing it once in the package, and doesn't help anyone who's already invoking this via a
   global install or a CI step that calls `node dist/cli.js` directly.

No decision has been made on which of these (if any) to pursue; this file exists so the tradeoff
is visible rather than rediscovered from scratch next time someone hits it.
