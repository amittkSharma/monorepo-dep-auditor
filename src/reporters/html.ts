import type { ReportMeta, Violation } from "../types.js";
import { escapeHtml } from "./escape-html.js";

// Matches a version/range value — quoted ("^1.2.3", "4.2.0", ">=4.0.0") or bare (as in
// single-version's "Found 2 different versions: 1.2.3 (...); ^1.2.3 (...)") — so it can be
// highlighted separately from the surrounding prose. Deliberately doesn't match quoted package
// names or paths (e.g. "@rsbuild/plugin-react", "packages/foo"): those don't start with a digit,
// `^`, `~`, `<`, or `>`.
const VALUE_RE =
  /"(?:[\^~]|>=|<=|[<>])?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?"|"\*"|(?:[\^~]|>=|<=|[<>])?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|\*(?=\s*\()/g;

/** Renders one fragment of prose, wrapping version/range-shaped values in a highlighted span.
 * Every leaf of text (matched or not) is escaped individually before it's placed in the output,
 * so this is exactly as safe against untrusted input as escaping the whole string upfront. */
function highlightValues(text: string): string {
  let html = "";
  let lastIndex = 0;
  for (const match of text.matchAll(VALUE_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(lastIndex, index));
    const inner = raw.startsWith('"') ? raw.slice(1, -1) : raw;
    html += `<span class="hl-value">${escapeHtml(inner)}</span>`;
    lastIndex = index + raw.length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function renderWorkspaceList(workspaces: readonly string[]): string {
  return `<ul class="hl-paths">${workspaces
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("")}</ul>`;
}

// A "version (path, path, ...)" group, as produced by single-version's multi-version listing
// and banned-packages' range-based "Installed version banned by range" listing.
const VERSION_GROUP_RE = /^(.*?)\s*\(([^)]*)\)$/;

function renderDetailSegment(segment: string): string {
  const match = VERSION_GROUP_RE.exec(segment);
  if (!match) {
    return highlightValues(segment);
  }
  const [, value, pathsRaw] = match;
  const paths = pathsRaw
    .split(", ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    return highlightValues(segment);
  }
  return `${highlightValues(value)}${renderWorkspaceList(paths)}`;
}

/** Rule modules join multiple version/violation entries with "; " (see cdvc-adapter.ts and
 * banned-packages.ts) — that's the "comma/semicolon-separated sentence" this splits into bullet
 * points instead. A detail with no such list (peer-consistency, outright bans) has nothing to
 * split and renders as a single highlighted line, unchanged in structure. */
function renderDetail(detail: string): string {
  const segments = detail.split("; ");
  if (segments.length === 1) {
    return highlightValues(segments[0]);
  }
  return `<ul>${segments.map((s) => `<li>${renderDetailSegment(s)}</li>`).join("")}</ul>`;
}

export function toHtml(
  violations: readonly Violation[],
  meta: ReportMeta,
): string {
  const rows = violations
    .map(
      (violation) => `      <tr>
        <td>${escapeHtml(violation.rule)}</td>
        <td>${escapeHtml(violation.dependency)}</td>
        <td>${renderDetail(violation.detail)}</td>
        <td>${renderWorkspaceList(violation.workspaces)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Monorepo Dependency Audit Report</title>
  <style>
    body { font-family: system-ui, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; }
    td ul { margin: 0.2em 0; padding-left: 1.2em; }
    td > ul { margin-top: 0; }
    ul.hl-paths { font-size: 0.9em; opacity: 0.85; }
    .hl-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-weight: 600;
      background: #fff3cd;
      padding: 0 4px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <h1>Monorepo Dependency Audit Report</h1>
  <p>Repository: ${escapeHtml(meta.repoName)}</p>
  <p>Generated: ${escapeHtml(meta.generatedAt)}</p>
  <p>Packages audited: ${meta.packageCount}</p>
  <p>Detected: ${escapeHtml(meta.monorepoKind)}</p>
  <p>${violations.length} violation(s) found.</p>
  <table>
    <thead>
      <tr><th>Rule</th><th>Dependency</th><th>Detail</th><th>Workspaces</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}
