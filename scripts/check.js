"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const appDir = path.join(__dirname, "../app");
const fail = (message) => {
  console.error(`check: ${message}`);
  process.exitCode = 1;
};

const appFiles = fs.readdirSync(appDir).filter((name) => /\.(?:html|css|js)$/.test(name));
for (const name of appFiles.filter((file) => file.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", path.join(appDir, name)], { encoding: "utf8" });
  if (result.status !== 0) fail(`JavaScript syntax error in app/${name}: ${result.stderr.trim()}`);
}

try {
  JSON.parse(fs.readFileSync(path.join(appDir, "data/diary.json"), "utf8"));
} catch (error) {
  fail(`Invalid JSON in app/data/diary.json: ${error.message}`);
}

const index = fs.readFileSync(path.join(appDir, "index.html"), "utf8");
const references = [...index.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
for (const reference of references) {
  if (/^(?:https?:)?\/\//i.test(reference)) {
    fail(`External runtime reference found: ${reference}`);
    continue;
  }
  if (!reference || reference.includes("?") || reference.includes("#") || path.isAbsolute(reference) || reference.split("/").includes("..")) {
    fail(`Unsafe runtime reference found: ${reference}`);
    continue;
  }
  if (!fs.existsSync(path.join(appDir, reference))) fail(`Missing referenced file: app/${reference}`);
}

for (const name of appFiles) {
  const source = fs.readFileSync(path.join(appDir, name), "utf8");
  if (/https?:\/\//i.test(source)) fail(`External runtime URL found in app/${name}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log("check: syntax, JSON, local paths, and runtime URLs passed");
