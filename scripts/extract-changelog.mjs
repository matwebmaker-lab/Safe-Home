#!/usr/bin/env bun
/**
 * Henter release-notater for en versjon fra CHANGELOG.md.
 * Bruk: bun scripts/extract-changelog.mjs [version]
 * Uten version: leser versjon fra package.json.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = (process.argv[2] || pkg.version).replace(/^v/, "");

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const heading = new RegExp(
  `^## \\[${version.replace(/\./g, "\\.")}\\](?:\\s*-\\s*[^\\n]*)?\\s*$`,
  "m"
);
const match = heading.exec(changelog);
if (!match) {
  console.error(`Fant ingen CHANGELOG-seksjon for versjon ${version}.`);
  console.error("Legg til ## [" + version + "] i CHANGELOG.md (eller fyll ## [Unreleased] før bump).");
  process.exit(1);
}

const start = match.index + match[0].length;
const rest = changelog.slice(start);
const next = rest.search(/^## \[/m);
const body = (next === -1 ? rest : rest.slice(0, next)).trim();

if (!body) {
  console.error(`CHANGELOG-seksjonen for ${version} er tom.`);
  process.exit(1);
}

const header = `Safe Home v${version}\n\n`;
const footer =
  "\n\nInstalled users: Safe Home will offer this update in the app (with what’s new). You can also open Settings → App version.";
process.stdout.write(header + body + footer + "\n");
