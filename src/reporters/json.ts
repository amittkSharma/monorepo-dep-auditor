import type { ReportMeta, Violation } from "../types.js";

export function toJson(
  violations: readonly Violation[],
  meta: ReportMeta,
): string {
  return JSON.stringify(
    {
      title: "Monorepo Dependency Audit Report",
      repoName: meta.repoName,
      generatedAt: meta.generatedAt,
      packageCount: meta.packageCount,
      monorepoKind: meta.monorepoKind,
      violations,
    },
    null,
    2,
  );
}
