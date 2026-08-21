#!/usr/bin/env node
// dsh-web-search-ollama - one-shot profile patch installer.
//
// Writes (or repairs) the profile cordis.patch.yml rows that make the web
// seam select this plugin's "ollama" provider and disable the built-in
// DeepSeek one. Idempotent, UTF-8 without BOM, backs up before touching.
//
// Usage:
//   node scripts/install-patch.mjs                 # default profile dir
//   node scripts/install-patch.mjs <profile-dir>  # explicit profile dir
//   node scripts/install-patch.mjs --check       # dry-run: report only
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const profileArg = args.find((a) => !a.startsWith("--"));

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh-v4lite");
const profileDir = profileArg ?? join(DSH_HOME, "profiles", "web-desktop");
const patchFile = join(profileDir, "cordis.patch.yml");

if (!existsSync(patchFile)) {
  console.error("cordis.patch.yml not found: " + patchFile);
  console.error("Expected DSH profile at: " + profileDir);
  console.error("Pass the profile dir explicitly, e.g. node scripts/install-patch.mjs C:/Users/you/.dsh-v4lite/profiles/web-desktop");
  process.exit(1);
}

const text = readFileSync(patchFile, "utf8");
const hasWeb = /^[\t ]*- id: web\b[\s\S]*?searchProvider:\s*ollama\s*$/m.test(text);
const hasDisable = /^[\t ]*- id: web-search-deepseek[\s\S]*?disabled:\s*true\s*$/m.test(text);

console.log("patch file: " + patchFile);
console.log("searchProvider: ollama present: " + hasWeb);
console.log("web-search-deepseek disabled: " + hasDisable);

if (hasWeb && hasDisable) {
  console.log("Already configured - nothing to do. Restart DSH to apply.");
  process.exit(0);
}

if (checkOnly) {
  console.log("--check: configuration INCOMPLETE (rows missing); run without --check to append.");
  process.exit(2);
}

const WEB_BLOCK = [
  "",
  "# dsh-web-search-ollama: web seam selects the ollama provider for web_search.",
  "- id: web",
  "  config:",
  "    searchProvider: ollama",
  "",
  "# dsh-web-search-ollama: disable the built-in DeepSeek search provider so the",
  "# seam does not see two usable providers (WEB_PROVIDER_AMBIGUOUS).",
  "- id: web-search-deepseek",
  "  disabled: true",
  "",
].join("\n");

const backup = patchFile + ".bak-" + Date.now();
copyFileSync(patchFile, backup);
console.log("backup: " + backup);

const out = (text.endsWith("\n") ? text : text + "\n") + "\n" + WEB_BLOCK;
writeFileSync(patchFile, out, "utf8");
console.log("Patch updated (UTF-8, no BOM). Restart DSH for it to take effect.");
