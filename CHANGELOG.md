# Changelog

## 1.0.0 (2026-10-15)

### ⚠ BREAKING CHANGES

* Package renamed from `monorepo-dep-auditor` to `@amittksharma/monorepo-dep-auditor`. No code changes. The CLI command (`monorepo-dep-auditor`) and config file name are unchanged; only install commands, `npx` calls and imports need the scoped name.

### Features

* Publish with npm provenance (`provenance=true` in `.npmrc`).
* Add `keywords` to `package.json`.
* Add `-h` / `--help`, which prints usage and exits 0 (previously `--help` failed with "Unknown option").
