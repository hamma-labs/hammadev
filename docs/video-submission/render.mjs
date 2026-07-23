import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "output");
const framesDir = path.join(outputDir, "frames");
const audioDir = path.join(outputDir, "audio");
const segmentsDir = path.join(outputDir, "segments");
const scenes = JSON.parse(await readFile(path.join(here, "scenes.json"), "utf8"));
const captionsOnly = process.argv.includes("--captions-only");
const requireFromWebsite = createRequire(path.join(here, "../../website/package.json"));
const { chromium } = requireFromWebsite("@playwright/test");

await Promise.all([
  mkdir(framesDir, { recursive: true }),
  mkdir(audioDir, { recursive: true }),
  mkdir(segmentsDir, { recursive: true }),
]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exited ${code}\n${stderr}`));
    });
  });
}

function srtTime(seconds) {
  const millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function wrapCaption(text, width = 74) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

function captionChunks(text, wordsPerChunk = 9) {
  const words = text.trim().split(/\s+/);
  const chunks = [];
  for (let index = 0; index < words.length; index += wordsPerChunk) {
    chunks.push(words.slice(index, index + wordsPerChunk).join(" "));
  }
  return chunks;
}

const measured = [];
if (captionsOnly) {
  for (const [index, scene] of scenes.entries()) {
    const segmentPath = path.join(segmentsDir, `${String(index + 1).padStart(2, "0")}-${scene.id}.mp4`);
    const duration = Number(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", segmentPath]));
    measured.push({ ...scene, duration, segmentPath });
  }
} else {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const scene of scenes) {
    const deckUrl = `${pathToFileURL(path.join(here, "deck.html")).href}?scene=${scene.id}`;
    await page.goto(deckUrl, { waitUntil: "load" });
    await page.screenshot({ path: path.join(framesDir, `${scene.id}.png`) });
  }
  await browser.close();

  for (const [index, scene] of scenes.entries()) {
    const narrationPath = path.join(audioDir, `${scene.id}.txt`);
    const audioPath = path.join(audioDir, `${scene.id}.wav`);
    const segmentPath = path.join(segmentsDir, `${String(index + 1).padStart(2, "0")}-${scene.id}.mp4`);
    await writeFile(narrationPath, scene.narration, "utf8");
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `flite=textfile=${narrationPath}:voice=slt`, "-ar", "48000", "-ac", "1", audioPath]);
    const duration = Number(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath])) + 0.8;
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", path.join(framesDir, `${scene.id}.png`), "-i", audioPath, "-filter_complex", "[1:a]apad=pad_dur=0.8[a]", "-map", "0:v", "-map", "[a]", "-t", duration.toFixed(3), "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", segmentPath]);
    measured.push({ ...scene, duration, segmentPath });
  }
}

const concatPath = path.join(outputDir, "concat.txt");
await writeFile(concatPath, measured.map((scene) => `file '${scene.segmentPath.replaceAll("'", "'\\''")}'`).join("\n") + "\n", "utf8");
const cleanVideo = path.join(outputDir, "hammadev-build-week-demo-clean.mp4");
if (!captionsOnly) {
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", cleanVideo]);
}

let cursor = 0;
const captions = [];
let captionNumber = 1;
for (const scene of measured) {
  const chunks = captionChunks(scene.narration);
  const wordTotal = chunks.reduce((total, chunk) => total + chunk.split(/\s+/).length, 0);
  const spokenDuration = Math.max(0, scene.duration - 0.8);
  for (const chunk of chunks) {
    const wordCount = chunk.split(/\s+/).length;
    const chunkDuration = spokenDuration * (wordCount / wordTotal);
    const end = cursor + chunkDuration;
    captions.push(`${captionNumber}\n${srtTime(cursor)} --> ${srtTime(end)}\n${wrapCaption(chunk, 54)}\n`);
    captionNumber += 1;
    cursor = end;
  }
  cursor += 0.8;
}
const subtitlesPath = path.join(outputDir, "captions.srt");
await writeFile(subtitlesPath, captions.join("\n"), "utf8");

const finalVideo = path.join(outputDir, "hammadev-build-week-demo.mp4");
await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", cleanVideo, "-vf", `subtitles=${subtitlesPath}:force_style='FontName=DejaVu Sans,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00121918,BorderStyle=3,BackColour=&HCC121918,Outline=1,Shadow=0,MarginV=28,Alignment=2'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", finalVideo]);

const durationReport = `${cursor.toFixed(1)} seconds`;
await writeFile(path.join(outputDir, "duration.txt"), `${durationReport}\n`, "utf8");
console.log(`${finalVideo}\n${durationReport}`);
