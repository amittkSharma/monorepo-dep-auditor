import { existsSync, readFileSync } from "node:fs";
import type { AuditorConfig } from "./types.js";

/** Opt-in config. No plugin system, no schema validation library, no cosmiconfig — if the
 * file doesn't exist, both custom rules are simply skipped and only cdvc's checks run. */
export function loadConfig(configPath: string): AuditorConfig {
  if (!existsSync(configPath)) {
    return {};
  }
  const raw = readFileSync(configPath, "utf8");
  return JSON.parse(raw) as AuditorConfig;
}
