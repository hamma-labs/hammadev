import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDir = path.resolve(websiteDir, '..');
const packageJson = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'));
const bundleName = `hammadev-website-${packageJson.version}`;
const outputPath = path.join(projectDir, `${bundleName}.tgz`);
const checksumPath = `${outputPath}.sha256`;
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hammadev-website-bundle-'));
const bundleDir = path.join(temporaryRoot, bundleName);

async function hashFile(filepath) {
  return createHash('sha256').update(await readFile(filepath)).digest('hex');
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filepath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, filepath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, filepath));
    }
  }
  return files;
}

try {
  const distDir = path.join(websiteDir, 'dist');
  const distStats = await stat(distDir);
  if (!distStats.isDirectory()) {
    throw new Error('website/dist is not a directory; run pnpm website:build first');
  }

  await mkdir(bundleDir, { recursive: true });
  await cp(distDir, path.join(bundleDir, 'dist'), { recursive: true });
  await cp(path.join(websiteDir, 'nginx.conf'), path.join(bundleDir, 'nginx.conf'));

  const deployInstructions = `# HammaDev website ${packageJson.version}

This bundle contains the exact static site and nginx virtual-host configuration.

Before replacing the live site:

1. preserve the current document root or container as the rollback target;
2. verify this archive with the adjacent SHA-256 file;
3. extract the archive into a new versioned directory;
4. replace the served document root atomically with \`dist/\`;
5. apply \`nginx.conf\` through the server's existing configuration workflow;
6. run \`pnpm website:check:live\` from the source repository.

Expected canonical URL: https://hammadev.nematov.com/
Expected product version: ${packageJson.version}
`;
  await writeFile(path.join(bundleDir, 'DEPLOY.md'), deployInstructions);

  const bundledFiles = await listFiles(bundleDir);
  const manifestFiles = {};
  for (const relativePath of bundledFiles) {
    manifestFiles[relativePath] = await hashFile(path.join(bundleDir, relativePath));
  }
  const manifest = {
    schemaVersion: 1,
    product: 'HammaDev website',
    version: packageJson.version,
    canonicalUrl: 'https://hammadev.nematov.com/',
    files: manifestFiles,
  };
  await writeFile(
    path.join(bundleDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const archive = spawnSync(
    'tar',
    [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-czf',
      outputPath,
      '-C',
      temporaryRoot,
      bundleName,
    ],
    { encoding: 'utf8' },
  );
  if (archive.status !== 0) {
    throw new Error(`tar failed: ${archive.stderr.trim()}`);
  }

  const checksum = await hashFile(outputPath);
  await writeFile(checksumPath, `${checksum}  ${path.basename(outputPath)}\n`);

  const listing = spawnSync('tar', ['-tzf', outputPath], { encoding: 'utf8' });
  if (listing.status !== 0 || !listing.stdout.includes(`${bundleName}/manifest.json`)) {
    throw new Error('Generated archive failed its content check');
  }

  console.log(`Deployment bundle: ${outputPath}`);
  console.log(`SHA-256: ${checksum}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
