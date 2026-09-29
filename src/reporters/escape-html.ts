const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes every char that could break out of HTML text/attribute context. This tool renders
 * other people's package names and package.json content, which is untrusted input — every
 * interpolated value in the HTML reporter must go through this. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char);
}
