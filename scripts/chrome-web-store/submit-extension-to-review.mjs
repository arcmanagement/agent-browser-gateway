import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

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
const versionPath = process.env.EXTENSION_VERSION_PATH || `${workspace}/extension-version.txt`;
const extensionVersion =
  process.env.EXTENSION_VERSION ||
  (existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : '');
const zipPath =
  process.env.EXTENSION_ZIP_PATH ||
  `${workspace}/dist/agent-browser-gateway-extension-${extensionVersion}.zip`;
const itemName = `publishers/${process.env.CHROME_PUBLISHER_ID}/items/${process.env.CHROME_EXTENSION_ID}`;
const publishType = process.env.CWS_PUBLISH_TYPE || 'STAGED_PUBLISH';
const outputDir = process.env.CWS_OUTPUT_DIR || `${workspace}/.cws`;

if (publishType !== 'STAGED_PUBLISH') {
  throw new Error(
    `Refusing publishType=${publishType}. ABG Chrome Web Store automation must stage reviewed submissions for manual publish.`,
  );
}

if (!extensionVersion) {
  throw new Error(`Extension version is not set. Set EXTENSION_VERSION or create ${versionPath}`);
}

if (!existsSync(zipPath)) {
  throw new Error(`Chrome extension archive does not exist: ${zipPath}`);
}

mkdirSync(outputDir, { recursive: true });

function readZippedManifestVersion() {
  const raw = execFileSync('unzip', ['-p', zipPath, 'manifest.json'], {
    encoding: 'utf8',
  });
  const manifest = JSON.parse(raw);
  return manifest.version || '';
}

const manifestVersion = readZippedManifestVersion();
if (manifestVersion !== extensionVersion) {
  throw new Error(
    `ZIP manifest version mismatch: manifest=${manifestVersion}, expected=${extensionVersion}`,
  );
}

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

function writeJson(name, value) {
  writeFileSync(`${outputDir}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
}

function parseVersion(version) {
  if (!version || !/^[0-9]+(?:\.[0-9]+){1,3}$/.test(version)) {
    return null;
  }

  return version.split('.').map((part) => Number(part));
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    return null;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
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

function singleRevisionVersion(revisionStatus) {
  const versions = revisionVersions(revisionStatus);
  if (versions.length === 0) {
    return null;
  }
  if (versions.length > 1) {
    throw new Error(`Chrome Web Store revision has multiple versions: ${versions.join(', ')}`);
  }

  return versions[0];
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

function assertStoreItemIsHealthy(status) {
  if (status.takenDown) {
    throw new Error('Chrome Web Store item is taken down. Check Developer Dashboard.');
  }
  if (status.warned) {
    throw new Error('Chrome Web Store item has a policy warning. Check Developer Dashboard.');
  }
}

async function prepareForUpload(accessToken) {
  const status = await fetchStatus(accessToken);
  writeJson('cws-fetch-status.json', status);
  assertStoreItemIsHealthy(status);
  console.log(`Chrome Web Store current status: ${JSON.stringify(summarizeStatus(status))}`);

  const submittedState = status.submittedItemRevisionStatus?.state || null;
  const submittedVersion = singleRevisionVersion(status.submittedItemRevisionStatus);

  if (submittedState === 'PENDING_REVIEW') {
    if (!submittedVersion) {
      throw new Error('Chrome Web Store has a pending review with an unknown extension version.');
    }

    const comparison = compareVersions(submittedVersion, extensionVersion);
    if (comparison === 0) {
      const uploadResponse = {
        uploadState: 'SKIPPED',
        reason: 'same_version_already_pending_review',
        extensionVersion,
      };
      const submitResponse = {
        state: 'PENDING_REVIEW',
        publishType,
        skipped: true,
        reason: 'same_version_already_pending_review',
        extensionVersion,
      };
      writeJson('cws-upload-response.json', uploadResponse);
      writeJson('cws-submit-response.json', submitResponse);
      console.log(`Chrome Web Store already has extension ${extensionVersion} pending review.`);
      return { shouldUpload: false };
    }

    throw new Error(
      `Chrome Web Store has pending extension ${submittedVersion}, but this build is ${extensionVersion}. Resolve it in the Developer Dashboard before submitting a new package.`,
    );
  }

  if (submittedState === 'STAGED') {
    throw new Error(
      `Chrome Web Store has staged extension ${submittedVersion || 'unknown'} waiting for manual publish.`,
    );
  }

  return { shouldUpload: true };
}

async function waitForUpload(accessToken, uploadResponse) {
  if (uploadResponse.uploadState === 'SUCCEEDED') {
    return uploadResponse;
  }
  if (uploadResponse.uploadState !== 'IN_PROGRESS') {
    throw new Error(`Chrome Web Store upload did not succeed: ${JSON.stringify(uploadResponse)}`);
  }

  for (let elapsedSeconds = 0; elapsedSeconds < 300; elapsedSeconds += 10) {
    await sleep(10_000);
    const status = await fetchStatus(accessToken);
    writeJson('cws-fetch-status.json', status);
    assertStoreItemIsHealthy(status);

    if (status.lastAsyncUploadState === 'SUCCEEDED') {
      return status;
    }
    if (status.lastAsyncUploadState === 'FAILED') {
      throw new Error(`Chrome Web Store async upload failed: ${JSON.stringify(status)}`);
    }

    console.log(`Chrome Web Store upload still in progress after ${elapsedSeconds + 10}s`);
  }

  throw new Error('Timed out waiting for Chrome Web Store upload to finish');
}

const accessToken = await fetchAccessToken();
const preparation = await prepareForUpload(accessToken);

if (!preparation.shouldUpload) {
  process.exit(0);
}

const uploadResponse = await fetchJson(
  `https://chromewebstore.googleapis.com/upload/v2/${itemName}:upload`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Length': String(statSync(zipPath).size),
      'Content-Type': 'application/zip',
    },
    body: createReadStream(zipPath),
    duplex: 'half',
  },
);

writeJson('cws-upload-response.json', uploadResponse);
const completedUpload = await waitForUpload(accessToken, uploadResponse);
console.log(
  `Chrome Web Store upload completed: ${
    completedUpload.uploadState || completedUpload.lastAsyncUploadState
  }`,
);

const submitResponse = await fetchJson(
  `https://chromewebstore.googleapis.com/v2/${itemName}:publish`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      publishType,
      blockOnWarnings: true,
    }),
  },
);

writeJson('cws-submit-response.json', submitResponse);
console.log(`Chrome Web Store review submission created: ${submitResponse.state}`);
console.log('Publish type is STAGED_PUBLISH; approved submissions require manual Publish.');
