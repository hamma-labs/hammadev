import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDir = path.resolve(websiteDir, '..');
const distDir = path.join(websiteDir, 'dist');
const deckPath = path.join(projectDir, 'docs', 'product-hunt', 'deck.html');
const outputDir = path.join(projectDir, 'docs', 'product-hunt', 'assets');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function pngDimensions(bytes) {
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error('Rendered asset is not a PNG');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function validateAsset(filename, width, height, maxBytes) {
  const filepath = path.join(outputDir, filename);
  const bytes = await readFile(filepath);
  const dimensions = pngDimensions(bytes);
  const fileStats = await stat(filepath);

  if (dimensions.width !== width || dimensions.height !== height) {
    throw new Error(
      `${filename} is ${dimensions.width}x${dimensions.height}; expected ${width}x${height}`,
    );
  }
  if (fileStats.size > maxBytes) {
    throw new Error(`${filename} is ${fileStats.size} bytes; limit is ${maxBytes}`);
  }
  return `${filename}: ${dimensions.width}x${dimensions.height}, ${fileStats.size} bytes`;
}

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filepath = path.resolve(distDir, relativePath);

    if (!filepath.startsWith(`${distDir}${path.sep}`) && filepath !== path.join(distDir, 'index.html')) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const body = await readFile(filepath);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(filepath)) ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await mkdir(outputDir, { recursive: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Could not start the local product site');
}

const browser = await chromium.launch();
try {
  const sitePage = await browser.newPage({
    viewport: { width: 1270, height: 760 },
    deviceScaleFactor: 1,
  });
  await sitePage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' });
  await sitePage.screenshot({
    path: path.join(outputDir, 'gallery-01-product.png'),
    fullPage: false,
  });

  const deckPage = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });
  await deckPage.goto(pathToFileURL(deckPath).href, { waitUntil: 'load' });

  for (const [id, filename] of [
    ['thumbnail', 'thumbnail.png'],
    ['gallery-02-continuity', 'gallery-02-continuity.png'],
    ['gallery-03-openai-day', 'gallery-03-openai-day.png'],
    ['gallery-04-proof', 'gallery-04-proof.png'],
    ['og-image', 'og-image.png'],
    ['youtube-thumbnail', 'youtube-thumbnail.png'],
  ]) {
    await deckPage.locator(`#${id}`).screenshot({ path: path.join(outputDir, filename) });
  }
} finally {
  await browser.close();
  server.close();
}

const reports = await Promise.all([
  validateAsset('thumbnail.png', 240, 240, 3_000_000),
  validateAsset('gallery-01-product.png', 1270, 760, 8_000_000),
  validateAsset('gallery-02-continuity.png', 1270, 760, 8_000_000),
  validateAsset('gallery-03-openai-day.png', 1270, 760, 8_000_000),
  validateAsset('gallery-04-proof.png', 1270, 760, 8_000_000),
  validateAsset('og-image.png', 1200, 630, 5_000_000),
  validateAsset('youtube-thumbnail.png', 1280, 720, 2_000_000),
]);

console.log(`Product Hunt assets rendered:\n${reports.join('\n')}`);
