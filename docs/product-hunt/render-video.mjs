import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "output");
const framesDir = path.join(outputDir, "frames");
const audioDir = path.join(outputDir, "audio");
const segmentsDir = path.join(outputDir, "segments");
const voice = "en-US-AndrewMultilingualNeural";
const scenes = JSON.parse(await readFile(path.join(here, "video-scenes.json"), "utf8"));
const requireFromWebsite = createRequire(path.join(here, "../../website/package.json"));
const { chromium } = requireFromWebsite("@playwright/test");

await Promise.all([mkdir(framesDir, { recursive: true }), mkdir(audioDir, { recursive: true }), mkdir(segmentsDir, { recursive: true })]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} exited ${code}\n${stderr}`)));
  });
}

async function duration(file) {
  return Number(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]));
}

function parseTime(value) {
  const [clock, millis] = value.split(",");
  const [hours, minutes, seconds] = clock.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds + Number(millis) / 1000;
}

function srtTime(seconds) {
  const value = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  const secs = Math.floor((value % 60000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function offsetCaptions(source, offset, firstNumber) {
  return source.trim().split(/\r?\n\r?\n/).filter(Boolean).map((block, index) => {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes(" --> "));
    const [start, end] = lines[timingIndex].split(" --> ");
    lines[0] = String(firstNumber + index);
    lines[timingIndex] = `${srtTime(parseTime(start) + offset)} --> ${srtTime(parseTime(end) + offset)}`;
    return lines.join("\n");
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const scene of scenes) {
  await page.goto(`${pathToFileURL(path.join(here, "video-deck.html")).href}?scene=${scene.id}`, { waitUntil: "load" });
  await page.screenshot({ path: path.join(framesDir, `${scene.id}.png`) });
}
await browser.close();

const rendered = [];
for (const [index, scene] of scenes.entries()) {
  const textPath = path.join(audioDir, `${scene.id}.txt`);
  const audioPath = path.join(audioDir, `${scene.id}.mp3`);
  const subtitlesPath = path.join(audioDir, `${scene.id}.srt`);
  const segmentPath = path.join(segmentsDir, `${String(index + 1).padStart(2, "0")}-${scene.id}.mp4`);
  await writeFile(textPath, scene.narration, "utf8");
  await run("edge-tts", ["--file", textPath, "--voice", voice, "--write-media", audioPath, "--write-subtitles", subtitlesPath]);
  const audioDuration = await duration(audioPath);
  const segmentDuration = audioDuration + 0.7;
  const fadeOut = Math.max(0, segmentDuration - 0.35).toFixed(3);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", path.join(framesDir, `${scene.id}.png`), "-i", audioPath, "-filter_complex", `[0:v]fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.35[v];[1:a]loudnorm=I=-16:LRA=7:TP=-1.5,apad=pad_dur=0.7[a]`, "-map", "[v]", "-map", "[a]", "-t", segmentDuration.toFixed(3), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", segmentPath]);
  rendered.push({ segmentPath, subtitlesPath, duration: segmentDuration });
}

const totalDuration = rendered.reduce((sum, scene) => sum + scene.duration, 0);
if (totalDuration >= 180) throw new Error(`Product Hunt video is ${totalDuration.toFixed(1)} seconds; expected under 180 seconds.`);
const concatPath = path.join(outputDir, "concat.txt");
await writeFile(concatPath, rendered.map(({ segmentPath }) => `file '${segmentPath.replaceAll("'", "'\\''")}'`).join("\n") + "\n", "utf8");
const cleanVideo = path.join(outputDir, "hammadev-product-hunt-launch-clean.mp4");
await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-movflags", "+faststart", cleanVideo]);

let cursor = 0;
let captionNumber = 1;
const captionBlocks = [];
for (const scene of rendered) {
  const blocks = offsetCaptions(await readFile(scene.subtitlesPath, "utf8"), cursor, captionNumber);
  captionBlocks.push(...blocks);
  captionNumber += blocks.length;
  cursor += scene.duration;
}
const captionsPath = path.join(outputDir, "hammadev-product-hunt-launch.srt");
await writeFile(captionsPath, captionBlocks.join("\n\n") + "\n", "utf8");
const finalVideo = path.join(outputDir, "hammadev-product-hunt-launch.mp4");
const pendingVideo = path.join(outputDir, "hammadev-product-hunt-launch.rendering.mp4");
await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", cleanVideo, "-vf", `subtitles=${captionsPath}:force_style='FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H00121918,BorderStyle=3,BackColour=&HCC121918,Outline=1,Shadow=0,MarginV=28,Alignment=2'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", pendingVideo]);
await rename(pendingVideo, finalVideo);
await access(finalVideo);
await writeFile(path.join(outputDir, "render.txt"), `voice=${voice}\nduration=${totalDuration.toFixed(3)}\n`, "utf8");
console.log(`${finalVideo}\n${totalDuration.toFixed(1)} seconds\n${voice}`);
