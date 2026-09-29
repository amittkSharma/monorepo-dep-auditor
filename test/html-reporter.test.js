import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeHtml, toHtml } from "../dist/index.js";

test("escapeHtml neutralizes every HTML-special character", () => {
  assert.equal(
    escapeHtml("<img src=x onerror=alert(1)>"),
    "&lt;img src=x onerror=alert(1)&gt;",
  );
  assert.equal(
    escapeHtml(`"quoted" & 'single'`),
    "&quot;quoted&quot; &amp; &#39;single&#39;",
  );
});

test("toHtml renders an XSS-shaped dependency name as inert escaped text, not live markup", () => {
  const violations = [
    {
      rule: "banned-packages",
      dependency: "<img src=x onerror=alert(1)>",
      detail: "<script>alert(1)</script>",
      workspaces: ['packages/evil"><script>alert(2)</script>'],
    },
  ];

  const html = toHtml(violations, {
    monorepoKind: "Unknown",
    repoName: "test-repo",
    packageCount: 2,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.ok(
    !html.includes("<img src=x onerror=alert(1)>"),
    "raw <img> tag must not appear unescaped",
  );
  assert.ok(
    !html.includes("<script>alert(1)</script>"),
    "raw <script> tag must not appear unescaped",
  );
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});
