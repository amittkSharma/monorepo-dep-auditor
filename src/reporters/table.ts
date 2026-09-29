import type { ReportMeta, Violation } from "../types.js";

const COLUMNS = ["Rule", "Dependency", "Detail", "Workspaces"] as const;

export function toTable(
  violations: readonly Violation[],
  meta: ReportMeta,
): string {
  const header = [
    "Monorepo Dependency Audit Report",
    `Repository: ${meta.repoName}`,
    `Generated: ${meta.generatedAt}`,
    `Packages audited: ${meta.packageCount}`,
    `Detected: ${meta.monorepoKind}`,
  ].join("\n");

  if (violations.length === 0) {
    return `${header}\nNo violations found.\n`;
  }

  const rows = violations.map((violation) => [
    violation.rule,
    violation.dependency,
    violation.detail,
    violation.workspaces.join(", "),
  ]);
  const widths = COLUMNS.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index].length)),
  );

  const formatRow = (cells: readonly string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ");
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");

  return [
    header,
    "",
    formatRow(COLUMNS),
    separator,
    ...rows.map((row) => formatRow(row)),
    "",
    `${violations.length} violation(s) found.`,
  ].join("\n");
}
