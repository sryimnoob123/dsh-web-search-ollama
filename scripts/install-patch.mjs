#!/usr/bin/env node
// dsh-web-search-ollama - one-shot profile patch installer.
//
// Writes (or repairs) the profile cordis.patch.yml rows that make the web
// seam select this plugin's "ollama" provider and disable the built-in
// DeepSeek one. Also sets the DSH_WEB_SEARCH_PROVIDER=ollama user env var
// (Windows) as a belt-and-braces fallback: dsh-web reads it when the patch
// config is absent, so a corrupted patch can never silently fall back to the
// built-in DeepSeek provider. Idempotent, UTF-8 without BOM, backs up before
// touching the patch.
//
// Usage:
//   node scripts/install-patch.mjs                 # default profile dir
//   node scripts/install-patch.mjs <profile-dir>   # explicit profile dir
//   node scripts/install-patch.mjs --check         # dry-run: report only
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

// ---- env var (belt and braces) -------------------------------------------
const ENV_NAME = "DSH_WEB_SEARCH_PROVIDER";
const ENV_VALUE = "ollama";
let envState = "unknown";
if (process.platform === "win32") {
  try {
    const cur = execFileSync("reg", ["query", "HKCU\\Environment", "/v", ENV_NAME], { encoding: "utf8" });
    envState = /ollama/.test(cur) ? "set" : "wrong";
  } catch {
    envState = "unset";
  }
} else {
  envState = process.env[ENV_NAME] === ENV_VALUE ? "set" : "unset";
}
console.log("env " + ENV_NAME + ": " + envState);

// ---- patch rows ----------------------------------------------------------
const text = readFileSync(patchFile, "utf8");
const hasWeb = /^[\t ]*- id: web\b[\s\S]*?searchProvider:\s*ollama\s*$/m.test(text);
const hasDisable = /^[\t ]*- id: web-search-deepseek[\s\S]*?disabled:\s*true\s*$/m.test(text);

console.log("patch file: " + patchFile);
console.log("searchProvider: ollama present: " + hasWeb);
console.log("web-search-deepseek disabled: " + hasDisable);

const patchDone = hasWeb && hasDisable;
const envDone = envState === "set";

if (patchDone && envDone) {
  console.log("Already configured - nothing to do. Restart DSH to apply.");
  process.exit(0);
}

if (checkOnly) {
  console.log("--check: configuration INCOMPLETE (missing: " +
    [patchDone ? "" : "patch rows", envDone ? "" : "env var"].filter(Boolean).join(", ") +
    "); run without --check to apply.");
  process.exit(2);
}

// ---- apply env var -------------------------------------------------------
if (!envDone) {
  if (process.platform === "win32") {
    try {
      execFileSync("setx", [ENV_NAME, ENV_VALUE], { stdio: "ignore" });
      console.log("env " + ENV_NAME + "=" + ENV_VALUE + " set (user scope; new processes inherit it)");
    } catch (err) {
      console.warn("setx failed: " + err.message + " - set " + ENV_NAME + "=" + ENV_VALUE + " manually (user env var)");
    }
  } else {
    console.warn("Set " + ENV_NAME + "=" + ENV_VALUE + " in your shell profile (e.g. ~/.bashrc) manually.");
  }
}

// ---- apply patch rows ----------------------------------------------------
if (!patchDone) {
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
  console.log("Patch updated (UTF-8, no BOM).");
}

console.log("Done. Restart DSH for it to take effect.");
