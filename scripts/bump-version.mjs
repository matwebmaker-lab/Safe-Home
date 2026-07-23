#!/usr/bin/env node
/**
 * Bump Safe Home-versjon i package.json, Cargo.toml og tauri.conf.json.
 * Bruk: node scripts/bump-version.mjs [patch|minor|major]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bump = (process.argv[2] || "patch").toLowerCase();

if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`Ugyldig bump-type: ${bump}. Bruk patch, minor eller major.`);
  process.exit(1);
}

function parseSemver(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Ugyldig semver: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function bumpVersion(v, kind) {
  const s = parseSemver(v);
  if (kind === "major") {
    s.major += 1;
    s.minor = 0;
    s.patch = 0;
  } else if (kind === "minor") {
    s.minor += 1;
    s.patch = 0;
  } else {
    s.patch += 1;
  }
  return `${s.major}.${s.minor}.${s.patch}`;
}

const pkgPath = resolve(root, "package.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const lockPath = resolve(root, "src-tauri/Cargo.lock");
const confPath = resolve(root, "src-tauri/tauri.conf.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const next = bumpVersion(pkg.version, bump);

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

let cargo = readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`);
writeFileSync(cargoPath, cargo);

let lock = readFileSync(lockPath, "utf8");
lock = lock.replace(
  /(\[\[package\]\]\r?\nname = "safe-home"\r?\nversion = ")[^"]+(")/,
  `$1${next}$2`
);
writeFileSync(lockPath, lock);

const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = next;
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

console.log(next);
