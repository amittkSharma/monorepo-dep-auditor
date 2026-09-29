import type { ReportMeta, Violation } from "../types.js";

const HEADER = ["rule", "dependency", "detail", "workspaces"];

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(
  violations: readonly Violation[],
  meta: ReportMeta,
): string {
  const rows = [
    "Monorepo Dependency Audit Report",
    ["Repository", meta.repoName].map(csvField).join(","),
    ["Generated", meta.generatedAt].map(csvField).join(","),
    ["Packages audited", String(meta.packageCount)].map(csvField).join(","),
    ["Detected", meta.monorepoKind].map(csvField).join(","),
    "",
    HEADER.map(csvField).join(","),
    ...violations.map((violation) =>
      [
        violation.rule,
        violation.dependency,
        violation.detail,
        violation.workspaces.join("; "),
      ]
        .map(csvField)
        .join(","),
    ),
  ];
  return `${rows.join("\n")}\n`;
}
