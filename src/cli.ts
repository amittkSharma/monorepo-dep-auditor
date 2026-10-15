#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { audit } from "./audit.js";
import { toCsv } from "./reporters/csv.js";
import { toHtml } from "./reporters/html.js";
import { toJson } from "./reporters/json.js";
import { toMarkdown } from "./reporters/markdown.js";
import { toTable } from "./reporters/table.js";
import type { CdvcDependencyType, Violation } from "./types.js";

const REPORTERS = {
  table: toTable,
  json: toJson,
  markdown: toMarkdown,
  csv: toCsv,
  html: toHtml,
} as const;

type Format = keyof typeof REPORTERS;

function isOwnRuleViolation(violation: Violation): boolean {
  return (
    violation.rule === "banned-packages" ||
    violation.rule === "peer-consistency"
  );
}

const USAGE = `Usage: monorepo-dep-auditor [options]

Policy checks for JS/TS monorepos: version consistency, banned packages, peer-dependency consistency.
Exits 1 if any violation is found, 0 otherwise.

Options:
  --format <name>               table (default) | json | markdown | csv | html
  --out <path>                  Write the report to a file instead of stdout
  --config <path>               Config file (default: <root-dir>/monorepo-dep-auditor.config.json)
  --root-dir <path>             Monorepo to audit (default: current directory)
  --fix                         Auto-fix single-version mismatches
  --dep-type <type>             Dependency type to check (repeatable)
  --ignore-dep <name>           Ignore a dependency in single-version (repeatable)
  --ignore-dep-pattern <regex>  Same, by regex (repeatable)
  --ignore-package <name>       Ignore a workspace package (repeatable)
  --ignore-package-pattern <regex>
  --ignore-path <path>          Ignore a workspace path (repeatable)
  --ignore-path-pattern <regex>
  -h, --help                    Show this help
`;

function main(): void {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      format: { type: "string", default: "table" },
      out: { type: "string" },
      config: { type: "string" },
      "root-dir": { type: "string" },
      fix: { type: "boolean", default: false },
      "dep-type": { type: "string", multiple: true },
      "ignore-dep": { type: "string", multiple: true },
      "ignore-dep-pattern": { type: "string", multiple: true },
      "ignore-package": { type: "string", multiple: true },
      "ignore-package-pattern": { type: "string", multiple: true },
      "ignore-path": { type: "string", multiple: true },
      "ignore-path-pattern": { type: "string", multiple: true },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const format = values.format as string;
  if (!(format in REPORTERS)) {
    console.error(
      `Unknown --format "${format}". Expected one of: ${Object.keys(REPORTERS).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const { violations, monorepoKind, repoName, packageCount } = audit({
    rootDir: values["root-dir"] ?? process.cwd(),
    configPath: values.config,
    fix: values.fix,
    depType: values["dep-type"] as CdvcDependencyType[] | undefined,
    ignoreDep: values["ignore-dep"],
    ignoreDepPattern: values["ignore-dep-pattern"],
    ignorePackage: values["ignore-package"],
    ignorePackagePattern: values["ignore-package-pattern"],
    ignorePath: values["ignore-path"],
    ignorePathPattern: values["ignore-path-pattern"],
  });

  if (values.fix) {
    const ownRuleViolations = violations.filter(isOwnRuleViolation);
    if (ownRuleViolations.length > 0) {
      console.error(
        `Note: --fix only auto-fixes check-dependency-version-consistency's single-version ` +
          `mismatches. ${ownRuleViolations.length} violation(s) from banned-packages/peer-consistency ` +
          "have no auto-fix and need manual fixing.",
      );
    }
  }

  const render = REPORTERS[format as Format];
  const output = render(violations, {
    monorepoKind,
    repoName,
    packageCount,
    generatedAt: new Date().toISOString(),
  });

  if (values.out) {
    writeFileSync(values.out, output);
  } else {
    console.log(output);
  }

  process.exitCode = violations.length > 0 ? 1 : 0;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
