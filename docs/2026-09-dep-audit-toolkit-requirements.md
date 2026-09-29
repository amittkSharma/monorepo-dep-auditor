# Dependency Supply-Chain Audit Toolkit — Two Requirements, One Doc

Two related but distinct requirements, kept separate on purpose: one is a
narrow check, the other is the product that contains it. Conflating them
leads to over-building the narrow one and under-scoping the real one.

---

## Requirement 1 — Known-Malicious-Package Detection Rule

### Problem statement

A dependency tree contains hundreds to thousands of transitive packages.
Any one of them can turn malicious *after* a team already depends on it
(account takeover, malicious maintainer handoff, compromised publish
pipeline, typosquat). No version-consistency, license, or CVE check
answers "is this exact package I already have installed on a list of
things now known to be malicious" — that requires checking against a feed
that only exists *after* public disclosure, which by definition can't be
hand-typed into a config ahead of time.

### Rationale

- Mechanical, cheap, high-signal: exact name+version string match, no code
  execution, no behavioral heuristics.
- Distinct severity class from CVEs (known bugs) or license violations
  (policy) — this is "known-bad," which should hard-fail CI, not warn.
- The hard part (identifying malicious packages) is already done full-time
  by security researchers (OSV.dev / OpenSSF `malicious-packages`, GitHub
  Advisory Database malware advisories) — the rule only needs to consume
  that feed, not build one.

### Architecture

```
resolved dependency tree (lockfile-derived, direct + transitive)
        │
        ▼
  match against known-malicious feed (name + version)
        │
        ▼
   Violation[] (name, version, path in tree, advisory link)
        │
        ▼
  existing reporter output (JSON/CSV/HTML/MD/table)
```

No new infrastructure — this is a data source, not a new check type.

### Technical stack

- **Detection engine:** none written — shell out to
  [`osv-scanner`](https://github.com/google/osv-scanner) (Go binary,
  OSS, OpenSSF-backed) against the lockfile, or query
  [OSV.dev](https://osv.dev/) API/DB export directly.
- **Feed source:** OSV.dev malicious-packages ecosystem
  (`ossf/malicious-packages`), refreshed on a schedule.
- **Output:** reuse whatever violation/report format the host tool already
  has.

### Target audience

Any team already running a dependency-audit CI gate for other reasons
(version consistency, license policy) who wants this risk class covered
in the same run, with no separate tool to adopt.

### Use cases

- CI fails a PR that pins a package now on the known-malicious list.
- Scheduled (nightly) re-audit catches a dependency that *became*
  malicious after it was already merged — the important case, since this
  is a retroactive risk, not a merge-time one.

### Effort

Small — a few days. Almost all of it is "call `osv-scanner`, parse JSON,
map to existing report format." No original detection logic to design,
tune, or maintain false-positive rates on.

---

## Requirement 2 — Orchestration Layer (the actual product)

### Problem statement

Small teams can't afford BlackDuck / enterprise SCA suites, but the
individual free tools that cover ~70-80% of that value already exist:
`osv-scanner` (vulns + known-malicious), a license checker, a
monorepo-policy checker. What's missing isn't detection capability — it's
that assembling 3-4 separate CLIs, each with its own config format and
output shape, into one CI gate with one merged report is enough friction
that small teams without a dedicated security engineer just don't do it.
The product is the integration, not a new scanner.

### Rationale

- Every underlying check is already best-in-class and free; re-detecting
  any of them from scratch is wasted effort and worse than the original.
- The actual unmet need is operational: one command, one config, one
  report, one CI exit code — so a five-person team can turn this on in an
  afternoon instead of evaluating and wiring four tools separately.
- This is where nearly 100% of the genuine engineering effort belongs.

### Architecture

```
                     ┌─────────────────────┐
                     │   single config      │
                     │   single CLI entry   │
                     └──────────┬──────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   osv-scanner subprocess  license-checker      monorepo-policy rules
   (vulns + known-bad)     subprocess           (existing: version
          │                     │               consistency, peer
          ▼                     ▼               consistency, banned pkgs)
          └─────────────────────┼─────────────────────┘
                                ▼
                    normalize → merged Violation[] schema
                                │
                                ▼
                 unified report (JSON/HTML/MD/table) + CI exit code
```

### Technical stack

- **Runtime:** Node.js/TypeScript (matches the existing monorepo-policy
  codebase this would extend, keeps one language for contributors).
- **External scanners invoked as subprocesses:** `osv-scanner` (Go binary,
  vulns + malware), a license checker (`license-checker` or `licensee`).
- **Own code:** config loader, subprocess orchestration, output
  normalization into one schema, unified reporters, CI exit-code
  convention.
- **No new detection logic anywhere in this layer** — it is glue, by
  design.

### Target audience

Small-to-mid engineering teams (roughly 5-50 engineers) without a
dedicated AppSec/security engineer, who currently either run nothing, or
run one tool in isolation (e.g., just Dependabot) and have no unified
gate combining vuln + malware + license + internal policy.

### Use cases

- Single CI step blocks a PR that introduces a known-vulnerable package,
  a known-malicious package, a disallowed license, or a version-policy
  violation — one failure message, not four separate tool outputs to
  cross-reference.
- Scheduled full-repo audit (not just PR-diff-triggered) catches
  retroactive risk — a dependency already merged that became
  vulnerable/malicious/relicensed after the fact.
- Compliance-lite reporting: a single exportable report to hand a
  customer or auditor asking "what's your dependency risk posture,"
  without a BlackDuck contract.

### Effort

Moderate — the bulk of the work is: subprocess orchestration and error
handling across three different external tools with three different
output formats, designing one merged violation schema that doesn't lose
information any individual tool provides, and reporter work across
whatever output formats are supported. Realistically a multi-week effort
for a solid v1 (config format + three integrations + unified reporters +
CI conventions + docs), not a few days — this is the real product, and
should be estimated and staffed as one.

---

## What This Split Suggests About the Engineer Behind It

Proposing Requirement 1 in isolation, and mistaking it for equivalent to
Requirement 2, is a common and understandable early-stage mistake: it
mistakes "the interesting technical detail" (matching against a
malicious-packages feed) for "the valuable thing to build" (removing
integration friction for teams that can't afford BlackDuck). The instinct
to build detection logic is the more *technically* satisfying problem —
it looks like "real" security engineering — while the orchestration layer
looks like "just" glue code. In practice the reverse is true: the glue is
where 90%+ of the engineering effort and nearly all of the differentiated
value lives, precisely because the detection primitives are already
solved, free, and better-maintained than anything built from scratch here
could be in year one.

The correction — recognizing that shelling out to `osv-scanner` replaces
a whole detection engine, and that the real product is the aggregation
layer — is the more valuable engineering instinct: knowing when *not* to
build, and where the actual scarce value lies (unification, not
detection). That's a build-vs-buy judgment call more than a coding skill,
and it's the difference between a tool that duplicates existing free
software and one that fills a real, currently-unfilled gap for
under-resourced teams.
