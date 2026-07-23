import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launchDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(launchDir, '..', '..');
const submission = JSON.parse(
  await readFile(path.join(launchDir, 'submission.json'), 'utf8'),
);

const failures = [];
const warnings = [];
const reports = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function pngDimensions(bytes) {
  check(
    bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    'A required image is not a PNG',
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function checkPng(relativePath, width, height, maxBytes) {
  const filepath = path.join(launchDir, relativePath);
  let bytes;
  let fileStats;
  try {
    bytes = await readFile(filepath);
    fileStats = await stat(filepath);
  } catch {
    failures.push(`${relativePath} is missing`);
    return undefined;
  }
  const dimensions = pngDimensions(bytes);

  check(
    dimensions.width === width && dimensions.height === height,
    `${relativePath} is ${dimensions.width}x${dimensions.height}; expected ${width}x${height}`,
  );
  check(
    fileStats.size <= maxBytes,
    `${relativePath} is ${fileStats.size} bytes; maximum is ${maxBytes}`,
  );
  reports.push(`${relativePath}: ${dimensions.width}x${dimensions.height}`);
  return bytes;
}

check(submission.name === 'HammaDev', 'Product name must be exactly HammaDev');
check(submission.tagline.length <= 60, 'Tagline exceeds 60 characters');
check(submission.description.length <= 500, 'Description exceeds 500 characters');
check(submission.launchTags.length >= 1 && submission.launchTags.length <= 3, 'Use one to three launch tags');
check(submission.shoutouts.length <= 3, 'Use no more than three shoutouts');
check(submission.gallery.length >= 2, 'Product Hunt requires at least two gallery images');
check(!/\bupvotes?\b/i.test(submission.firstComment), 'Maker comment must not ask for votes');
check(
  submission.primaryUrl === 'https://hammadev.nematov.com/',
  'Primary URL must use the deployed canonical URL',
);

reports.push(`tagline: ${submission.tagline.length}/60 characters`);
reports.push(`description: ${submission.description.length}/500 characters`);

await checkPng(submission.thumbnail, 240, 240, 3_000_000);
for (const galleryImage of submission.gallery) {
  await checkPng(galleryImage, 1270, 760, 8_000_000);
}
const socialImage = await checkPng('assets/og-image.png', 1200, 630, 5_000_000);
await checkPng('assets/youtube-thumbnail.png', 1280, 720, 2_000_000);

try {
  const publicSocialImage = await readFile(
    path.join(projectDir, 'website', 'public', 'og-image.png'),
  );
  if (socialImage) {
    check(
      createHash('sha256').update(socialImage).digest('hex')
        === createHash('sha256').update(publicSocialImage).digest('hex'),
      'website/public/og-image.png does not match the launch social image',
    );
  }
} catch {
  failures.push('website/public/og-image.png is missing');
}

const videoPath = path.resolve(launchDir, submission.videoFile);
const captionPath = path.resolve(launchDir, submission.captionFile);
check(
  path.basename(videoPath) !== 'hammadev-build-week-demo.mp4',
  'The synthetic timing preview must not be used as the launch video',
);
try {
  await stat(videoPath);
} catch {
  failures.push(`${submission.videoFile} is missing`);
}
try {
  await stat(captionPath);
  const captions = await readFile(captionPath, 'utf8');
  check(/\bpublic beta\b/i.test(captions), 'Launch captions do not mention the public beta');
  check(!/\bpublic alpha\b/i.test(captions), 'Launch captions still mention the public alpha');
} catch {
  failures.push(`${submission.captionFile} is missing`);
}

const probe = spawnSync(
  'ffprobe',
  ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', videoPath],
  { encoding: 'utf8' },
);
check(probe.status === 0, `ffprobe failed: ${probe.stderr.trim()}`);
if (probe.status === 0) {
  const metadata = JSON.parse(probe.stdout);
  const duration = Number(metadata.format?.duration ?? 0);
  const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = metadata.streams.find((stream) => stream.codec_type === 'audio');
  check(duration >= 30 && duration < 180, `Video duration ${duration} is outside 30–180 seconds`);
  check(Boolean(videoStream), 'Demo has no video stream');
  check(metadata.streams.some((stream) => stream.codec_type === 'audio'), 'Demo has no audio stream');
  check(videoStream?.codec_name === 'h264', 'Demo video stream is not H.264');
  check(videoStream?.width === 1920 && videoStream?.height === 1080, 'Demo is not 1920x1080');
  check(audioStream?.codec_name === 'aac', 'Demo audio stream is not AAC');
  reports.push(`video: ${duration.toFixed(1)} seconds with audio and video`);
}

for (const [field, label] of [
  ['videoUrl', 'YouTube URL'],
  ['makerUsername', 'Product Hunt maker username'],
  ['productHuntUrl', 'final Product Hunt URL'],
]) {
  if (!submission[field]) warnings.push(`${label} is account-bound and still blank`);
}

if (failures.length > 0) {
  console.error(`Product Hunt validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Product Hunt local package: PASS\n${reports.join('\n')}`);
}

if (warnings.length > 0) {
  console.warn(`Pending external actions:\n- ${warnings.join('\n- ')}`);
}
