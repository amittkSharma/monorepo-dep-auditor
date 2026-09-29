# Problem 5: Runtime Env Validation — Breakdown & Feasibility Check

## Verdict up front

**Worth solving as a problem class, not worth solving from scratch.** Env
validation at boot is a real pain point, but the exact tool described here
(Zod/TypeBox + "zero-dependency") already exists in three mature forms.
Building a new one duplicates `@t3-oss/env-core`, `envalid`, and `znv` almost
line for line. The differentiator worth actually building is the **enterprise
monitoring integration** — that part is genuinely under-served.

---

## 1. The problem statement, split into chunks

The original ask bundles five separate problems into one sentence. Treat
them as five:

1. **Schema definition** — describe what env vars should exist, their types
   (string/number/bool/url/enum), and whether they're required or optional.
2. **Parsing & coercion** — `process.env` is `Record<string, string | undefined>`.
   Turn `"true"` into `true`, `"5432"` into `5432`, etc.
3. **Fail-fast assertion at boot** — if validation fails, crash immediately
   with a readable error, before any request handler or DB pool spins up.
4. **Readable failure output** — list *every* missing/invalid var in one
   error, not just the first one (so a dev doesn't fix-run-fix-run five times).
5. **Monitoring/observability integration** — when it crashes in a real
   deployment (not a dev laptop), someone needs to see *why* without SSH-ing
   into a container that's already dead.

Chunk 5 is the part almost nobody builds well. Chunks 1–4 are commodity.

---

## 2. Is this already solved?

Yes, several times over, at production quality:

| Tool | Approach | Notes |
|---|---|---|
| [`@t3-oss/env-core`](https://www.npmjs.com/package/@t3-oss/env-core) | Zod-based | The de facto standard in the T3/Next.js ecosystem. Splits server/client vars, works with any Standard Schema validator (Zod, Valibot, ArkType). |
| [`envalid`](https://www.npmjs.com/package/envalid) | Own mini-schema (not Zod) | Older, widely adopted, built-in cleaners for common types, fails fast with a formatted report. |
| [`znv`](https://www.npmjs.com/package/znv) | Zod-based | Thin wrapper, does exactly the coercion + fail-fast job, nothing else. |
| [`arktype`](https://arktype.io/) + custom boot check | Type-level validator | Faster than Zod at runtime, same idea. |
| Plain `zod.parse(process.env)` + a 10-line wrapper | DIY | What most teams actually ship — and it's fine. |

**Implication:** the "build a validation utility" part of the ticket is
low-value work. It re-solves a solved problem and adds another
dependency-shaped thing to maintain. The "zero-dependency" requirement in the
original ask is also self-contradictory if Zod is a hard requirement — Zod
*is* the dependency. Worth flagging back to whoever wrote the ticket.

---

## 3. Where the real, unsolved value is

None of the tools above ship monitoring integration out of the box. That's
the actual gap:

- **Structured startup-failure events**, not just a thrown error and a `1`
  exit code — something a monitoring backend can parse (Sentry event, Datadog
  log with tags, OpenTelemetry span with `error=true`).
- **Distinguish "which var, which service, which environment"** in the
  alert, so on-call doesn't have to read a stack trace to know it's
  `STRIPE_SECRET_KEY` missing in `staging` vs `prod`.
- **Redaction** — validation errors must never echo the *value* of a secret
  back into logs or an error-tracking dashboard, only the key name and the
  reason it failed (wrong type, empty, etc.).
- **Partial-crash telemetry** — in a monorepo/multi-service setup, know
  *which service* failed to boot and *which deploy* triggered it, so a bad
  config rollout is traceable to a commit, not just "prod is down."
- **Pre-deploy check, not just boot check** — validate the env file (`.env`,
  secrets manager export) in CI *before* it ships, so the crash never
  reaches production at all. This is the highest-leverage improvement:
  shifting the failure from "3am page" to "failed CI job."

---

## 4. What would actually make this valuable for a team

Ranked by effort-to-payoff, highest payoff first:

1. **CI-time validation** — run the exact same schema against a `.env.example`
   / secrets-manager dry-run in the pipeline. Never let a bad config reach a
   real environment. (Small effort, biggest risk reduction.)
2. **One shared schema file per service, versioned in the repo** — so adding
   a new required var is a code-reviewed diff, not tribal knowledge.
3. **Structured error → monitoring adapter** — a small adapter layer that
   takes the validation result and emits one structured event per
   integration (Sentry breadcrumb, Datadog log, plain JSON to stdout for
   log-shippers). This is the part worth actually writing; everything else
   is `@t3-oss/env-core` or `envalid`.
4. **`.env.example` drift check** — lint rule/CI step that fails if
   `schema.keys() !== .env.example keys()`, so the example file never goes
   stale.
5. **Redacted diagnostics** — on failure, print key name + failure reason
   only, never the attempted value.

---

## 5. Recommendation

- Don't build a new Zod-wrapper validator. Adopt `@t3-oss/env-core` or
  `envalid` (5 minutes, zero new problems).
- Do build the thin monitoring-adapter layer (item 3 above) — that's the
  actual unsolved 20% of this ticket, and it's a half-day of work, not a
  library.
- Do add the CI dry-run check (item 1) — this is the change that actually
  stops the "3am page" scenario the ticket is worried about, since a broken
  config never reaches boot in the first place.

**Next:** confirm which monitoring backend (Sentry, Datadog, OTel, or plain
structured stdout logs) this needs to integrate with — that decides the
shape of the adapter in item 3.
