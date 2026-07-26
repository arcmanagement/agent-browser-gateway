import { mkdirSync, writeFileSync } from 'node:fs';

const requiredEnv = [
  'CHROME_EXTENSION_ID',
  'CHROME_PUBLISHER_ID',
  'CHROME_CLIENT_ID',
  'CHROME_CLIENT_SECRET',
  'CHROME_REFRESH_TOKEN',
];

for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const workspace = process.env.WORKSPACE_DIR || process.cwd();
const outputDir = process.env.CWS_OUTPUT_DIR || `${workspace}/.cws`;
const itemName = `publishers/${process.env.CHROME_PUBLISHER_ID}/items/${process.env.CHROME_EXTENSION_ID}`;

mkdirSync(outputDir, { recursive: true });

async function parseJson(response) {
  const body = await response.text();
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${body.slice(0, 500)}`, { cause: error });
  }
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const json = await parseJson(response);
  if (!response.ok) {
    throw new Error(
      `Request failed: ${response.status} ${response.statusText} ${JSON.stringify(json)}`,
    );
  }

  return json;
}

async function fetchAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.CHROME_CLIENT_ID,
    client_secret: process.env.CHROME_CLIENT_SECRET,
    refresh_token: process.env.CHROME_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const json = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!json.access_token) {
    throw new Error('OAuth token response did not include access_token');
  }

  return json.access_token;
}

async function fetchStatus(accessToken) {
  return fetchJson(`https://chromewebstore.googleapis.com/v2/${itemName}:fetchStatus`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function revisionVersions(revisionStatus) {
  return [
    ...new Set(
      (revisionStatus?.distributionChannels || [])
        .map((channel) => channel.crxVersion)
        .filter(Boolean),
    ),
  ];
}

function summarizeStatus(status) {
  return {
    publishedState: status.publishedItemRevisionStatus?.state || null,
    publishedVersions: revisionVersions(status.publishedItemRevisionStatus),
    submittedState: status.submittedItemRevisionStatus?.state || null,
    submittedVersions: revisionVersions(status.submittedItemRevisionStatus),
    lastAsyncUploadState: status.lastAsyncUploadState || null,
    warned: Boolean(status.warned),
    takenDown: Boolean(status.takenDown),
  };
}

function writeJson(name, value) {
  writeFileSync(`${outputDir}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
}

const accessToken = await fetchAccessToken();
const status = await fetchStatus(accessToken);
const summary = summarizeStatus(status);

writeJson('cws-oauth-health.json', {
  checkedAt: new Date().toISOString(),
  itemName,
  summary,
});

if (summary.takenDown) {
  throw new Error('Chrome Web Store item is taken down. Check Developer Dashboard.');
}
if (summary.warned) {
  throw new Error('Chrome Web Store item has a policy warning. Check Developer Dashboard.');
}

console.log(`Chrome Web Store OAuth health check passed: ${JSON.stringify(summary)}`);
