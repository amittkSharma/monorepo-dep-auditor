import type { ReportMeta, Violation } from "../types.js";

export function toMarkdown(
  violations: readonly Violation[],
  meta: ReportMeta,
): string {
  const lines = [
    "# Monorepo Dependency Audit Report",
    "",
    `**Repository:** ${meta.repoName}`,
    "",
    `**Generated:** ${meta.generatedAt}`,
    "",
    `**Packages audited:** ${meta.packageCount}`,
    "",
    `Detected: ${meta.monorepoKind}`,
    "",
  ];

  if (violations.length === 0) {
    lines.push("No violations found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "| Rule | Dependency | Detail | Workspaces |",
    "| --- | --- | --- | --- |",
  );
  for (const violation of violations) {
    const detail = violation.detail.replace(/\|/g, "\\|");
    lines.push(
      `| ${violation.rule} | ${violation.dependency} | ${detail} | ${violation.workspaces.join(", ")} |`,
    );
  }
  lines.push("", `${violations.length} violation(s) found.`);

  return `${lines.join("\n")}\n`;
}
