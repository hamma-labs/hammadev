import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDir = path.resolve(websiteDir, '..');
const packageJson = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'));
const productContract = JSON.parse(
  await readFile(path.join(projectDir, 'product-contract.json'), 'utf8'),
);

const requestedUrl = process.argv.slice(2).find((argument) => argument !== '--');
const baseUrl = new URL(requestedUrl ?? 'https://hammadev.nematov.com/');
const expectedCanonical = 'https://hammadev.nematov.com/';
const failures = [];
const reports = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function attribute(html, selector, name) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = html.match(new RegExp(`<[^>]+${escapedSelector}[^>]*>`, 'i'))?.[0];
  return tag?.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))?.[1];
}

function pngDimensions(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    failures.push('Social card is not a PNG');
    return undefined;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function fetchRequired(relativeUrl) {
  const url = new URL(relativeUrl, baseUrl);
  const response = await fetch(url, { redirect: 'follow' });
  check(response.ok, `${url} returned HTTP ${response.status}`);
  return response;
}

const rootResponse = await fetchRequired('/');
const html = await rootResponse.text();
reports.push(`root: HTTP ${rootResponse.status} at ${rootResponse.url}`);

check(
  rootResponse.headers.get('content-type')?.startsWith('text/html'),
  'Root response is not HTML',
);
check(html.includes('<title>HammaDev — Project Memory for AI Coding Agents</title>'), 'Search title is stale');
check(
  attribute(html, 'rel="canonical"', 'href') === expectedCanonical,
  'Canonical URL is missing or incorrect',
);
check(
  attribute(html, 'property="og:image"', 'content') === `${expectedCanonical}og-image.png`,
  'Open Graph image is missing or incorrect',
);

for (const header of [
  'content-security-policy',
  'cross-origin-opener-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
]) {
  check(rootResponse.headers.has(header), `Root response is missing ${header}`);
}
check(
  rootResponse.headers.get('cache-control')?.includes('no-cache'),
  'HTML response is not explicitly non-cacheable',
);

const scriptPath = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
const stylesheetPath = html.match(/href="(\/assets\/index-[^"]+\.css)"/)?.[1];
check(Boolean(scriptPath), 'Fingerprint JavaScript asset is missing');
check(Boolean(stylesheetPath), 'Fingerprint stylesheet asset is missing');

if (scriptPath) {
  const scriptResponse = await fetchRequired(scriptPath);
  const script = await scriptResponse.text();
  check(script.includes(packageJson.version), `Deployed JavaScript is not version ${packageJson.version}`);
  check(
    script.includes(productContract.installCommand),
    `Deployed JavaScript does not contain ${productContract.installCommand}`,
  );
  check(script.includes('Hardened with GPT-5.6'), 'OpenAI Day positioning is missing');
  check(
    scriptResponse.headers.get('cache-control')?.includes('immutable'),
    'Fingerprint JavaScript is not immutable',
  );
  reports.push(`script: ${scriptPath}`);
}

if (stylesheetPath) {
  const stylesheetResponse = await fetchRequired(stylesheetPath);
  check(
    stylesheetResponse.headers.get('cache-control')?.includes('immutable'),
    'Fingerprint stylesheet is not immutable',
  );
  reports.push(`stylesheet: ${stylesheetPath}`);
}

const socialResponse = await fetchRequired('/og-image.png');
check(
  socialResponse.headers.get('content-type') === 'image/png',
  'Social card response does not use image/png',
);
const socialDimensions = pngDimensions(await socialResponse.arrayBuffer());
if (socialDimensions) {
  check(
    socialDimensions.width === 1200 && socialDimensions.height === 630,
    `Social card is ${socialDimensions.width}x${socialDimensions.height}; expected 1200x630`,
  );
  reports.push(`social card: ${socialDimensions.width}x${socialDimensions.height}`);
}

const robotsResponse = await fetchRequired('/robots.txt');
const robots = await robotsResponse.text();
check(
  robots.includes(`Sitemap: ${expectedCanonical}sitemap.xml`),
  'robots.txt does not advertise the canonical sitemap',
);

const sitemapResponse = await fetchRequired('/sitemap.xml');
const sitemap = await sitemapResponse.text();
check(sitemap.includes(`<loc>${expectedCanonical}</loc>`), 'Sitemap canonical URL is incorrect');

await fetchRequired('/favicon.svg');

if (failures.length > 0) {
  console.error(`Live website verification failed for ${baseUrl}:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Live website verification: PASS\n${reports.join('\n')}`);
}
