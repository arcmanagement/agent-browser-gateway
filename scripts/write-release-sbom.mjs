#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.argv[2];
const outDir = process.argv[3];
const outputPath = process.argv[4];
const version = process.argv[5] || "0.0.0";

if (!repoRoot || !outDir || !outputPath) {
  console.error("usage: write-release-sbom.mjs <repo-root> <out-dir> <output-path> [version]");
  process.exit(2);
}

const now = new Date(0).toISOString();
const artifacts = await listFiles(outDir);
const checksums = await Promise.all(
  artifacts
    .filter((file) => !file.endsWith(".spdx.json") && !file.endsWith("SHA256SUMS.txt"))
    .map(async (file) => {
      const bytes = await readFile(path.join(outDir, file));
      return {
        file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
);

const swiftPins = await readSwiftPins(path.join(repoRoot, "Package.resolved"));
const nodePins = await readPnpmPins(path.join(repoRoot, "extension", "pnpm-lock.yaml"));
const toolPins = await readTextIfExists(path.join(repoRoot, "mise.toml"));
const dotnetPin = await readTextIfExists(path.join(repoRoot, "global.json"));

const packages = [
  {
    SPDXID: "SPDXRef-Package-AgentBrowserGateway",
    name: "AgentBrowserGateway",
    downloadLocation: "https://github.com/arcmanagement/agent-browser-gateway",
    filesAnalyzed: false,
    versionInfo: version,
    supplier: "Organization: ArcManagement",
    checksums: [],
  },
  ...swiftPins.map((pin) => ({
    SPDXID: spdxId(`Swift-${pin.identity}`),
    name: pin.identity,
    downloadLocation: pin.location,
    filesAnalyzed: false,
    versionInfo: pin.version || pin.revision,
    supplier: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:swift/${pin.identity}@${pin.version || pin.revision}`,
      },
    ],
  })),
  ...nodePins.map((pin) => ({
    SPDXID: spdxId(`Npm-${pin.name}`),
    name: pin.name,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    versionInfo: pin.version,
    supplier: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/${pin.name}@${pin.version}`,
      },
    ],
  })),
];

const files = checksums.map((item, index) => ({
  SPDXID: `SPDXRef-File-${index + 1}`,
  fileName: item.file,
  checksums: [{ algorithm: "SHA256", checksumValue: item.sha256 }],
}));

const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `agent-browser-gateway-${version}-release-artifacts`,
  documentNamespace: `https://github.com/arcmanagement/agent-browser-gateway/spdx/agent-browser-gateway-${version}-${process.env.SOURCE_DATE_EPOCH || "0"}`,
  creationInfo: {
    created: now,
    creators: ["Tool: scripts/write-release-sbom.mjs"],
    comment:
      "Release artifact SBOM seed generated from repository lockfiles, pinned tool declarations, and local reproducible-build outputs.",
  },
  packages,
  files,
  relationships: [
    ...files.map((file) => ({
      spdxElementId: "SPDXRef-Package-AgentBrowserGateway",
      relationshipType: "CONTAINS",
      relatedSpdxElement: file.SPDXID,
    })),
    ...packages.slice(1).map((pkg) => ({
      spdxElementId: "SPDXRef-Package-AgentBrowserGateway",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: pkg.SPDXID,
    })),
  ],
  annotations: [
    {
      annotationDate: now,
      annotationType: "OTHER",
      annotator: "Tool: scripts/write-release-sbom.mjs",
      comment: [
        "Pinned tools from mise.toml:",
        toolPins.trim() || "none",
        "",
        "Pinned .NET SDK from global.json:",
        dotnetPin.trim() || "none",
      ].join("\n"),
    },
  ],
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);

async function listFiles(root) {
  const entries = await readdir(root);
  const files = [];
  for (const entry of entries.sort()) {
    const fullPath = path.join(root, entry);
    const info = await stat(fullPath);
    if (info.isFile()) files.push(entry);
  }
  return files;
}

async function readSwiftPins(filePath) {
  const text = await readTextIfExists(filePath);
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (parsed.pins || []).map((pin) => ({
    identity: pin.identity,
    location: pin.location,
    revision: pin.state?.revision,
    version: pin.state?.version,
  }));
}

async function readPnpmPins(filePath) {
  const text = await readTextIfExists(filePath);
  if (!text) return [];
  const pins = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^  '?(?<name>[^':]+(?:\/[^':]+)?)@(?<version>[^':]+)'?:$/);
    if (!match?.groups) continue;
    const { name, version } = match.groups;
    if (!name.startsWith("/") && version) pins.push({ name, version });
  }
  return pins;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function spdxId(value) {
  return `SPDXRef-${value.replace(/[^A-Za-z0-9.-]/g, "-")}`;
}
