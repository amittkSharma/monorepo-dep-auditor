import fs from "node:fs";
import path from "node:path";

/** Counts workspace packages the same way npm/Yarn/pnpm workspaces resolve the root
 * package.json's `workspaces` field: each entry is either a literal directory or a glob with a
 * single wildcard directory segment (e.g. `"packages/*"`).
 * ponytail: single-level globs only, no nested/recursive workspace discovery (cdvc's own
 * `workspace.js` supports that; reimplementing it here for a display-only count isn't worth a
 * second discovery engine) — covers the `"dir/*"` shape every fixture and every repo tested
 * against this session uses. Extend if a real repo needs deeper nesting. */
export function countWorkspacePackages(rootDir: string): number {
  const rootPkgPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(rootPkgPath)) {
    return 0;
  }

  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  const workspacesField = rootPkg.workspaces;
  const patterns: string[] = Array.isArray(workspacesField)
    ? workspacesField
    : Array.isArray(workspacesField?.packages)
      ? workspacesField.packages
      : [];

  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const pattern of patterns) {
    const isNegated = pattern.startsWith("!");
    const cleanPattern = isNegated ? pattern.slice(1) : pattern;
    const target = isNegated ? excluded : included;

    if (!cleanPattern.includes("*")) {
      if (fs.existsSync(path.join(rootDir, cleanPattern, "package.json"))) {
        target.add(cleanPattern);
      }
      continue;
    }

    const parentDir = path.dirname(cleanPattern);
    const parentAbs = path.join(rootDir, parentDir);
    if (!fs.existsSync(parentAbs)) {
      continue;
    }
    for (const entry of fs.readdirSync(parentAbs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") {
        continue;
      }
      const relative = path.join(parentDir, entry.name);
      if (fs.existsSync(path.join(rootDir, relative, "package.json"))) {
        target.add(relative);
      }
    }
  }

  for (const excludedPath of excluded) {
    included.delete(excludedPath);
  }

  return included.size;
}
