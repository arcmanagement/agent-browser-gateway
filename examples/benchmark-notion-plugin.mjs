#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(__dirname, "fixtures/notion-page.html"), "utf8");

function loadTransform(pluginDir, transformName) {
  const transforms = {};
  const sandbox = {
    abg: {
      plugin: { name: path.basename(pluginDir) },
      version: "benchmark",
      log() {},
      registerTransform(name, fn) {
        transforms[name] = fn;
      },
    },
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(root, pluginDir, "index.js"), "utf8");
  vm.runInContext(source, sandbox, { filename: path.join(pluginDir, "index.js") });
  const transform = transforms[transformName];
  if (typeof transform !== "function") {
    throw new Error(`${transformName} was not registered by ${pluginDir}`);
  }
  return transform;
}

const genericMarkdown = loadTransform("plugins/markdown-plugin", "html-to-markdown")(html);
const notionMarkdown = loadTransform("plugins/notion-plugin", "notion-to-markdown")(html);

const rows = [
  ["Raw Notion-like page HTML", html],
  ["Generic markdown-plugin", genericMarkdown],
  ["notion-plugin domain transform", notionMarkdown],
];

function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

const rawTokens = approxTokens(html);
console.log("| Method | chars | tokens (approx) | reduction vs raw |");
console.log("|---|---:|---:|---:|");
for (const [name, text] of rows) {
  const tokens = approxTokens(text);
  const reduction = name.startsWith("Raw") ? "-" : pct(1 - tokens / rawTokens);
  console.log(`| ${name} | ${text.length.toLocaleString("en-US")} | ~${tokens.toLocaleString("en-US")} | ${reduction} |`);
}
