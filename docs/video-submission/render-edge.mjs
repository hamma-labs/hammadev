import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "output");
const framesDir = path.join(outputDir, "frames");
const edgeDir = path.join(outputDir, "edge");
const segmentDir = path.join(edgeDir, "segments");
const voice = "en-US-AndrewMultilingualNeural";
const rate = "+0%";
const scenes = JSON.parse(await readFile(path.join(here, "voiceover.json"), "utf8"));
const sceneFlagIndex = process.argv.indexOf("--scene");
const requestedScene = sceneFlagIndex >= 0 ? process.argv[sceneFlagIndex + 1] : undefined;

if (sceneFlagIndex >= 0 && (!requestedScene || !scenes.some((scene) => scene.id === requestedScene))) {
  throw new Error(`Unknown or missing --scene value: ${requestedScene ?? ""}`);
}

await Promise.all([
  mkdir(edgeDir, { recursive: true }),
  mkdir(segmentDir, { recursive: true }),
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

async function duration(filePath) {
  return Number(await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]));
}

function parseSrtTime(value) {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) throw new Error(`Invalid SRT time: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function srtTime(seconds) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function offsetSrt(source, offset, firstNumber) {
  const blocks = source.trim().split(/\r?\n\r?\n/).filter(Boolean);
  return blocks.map((block, blockIndex) => {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes(" --> "));
    if (timingIndex < 0) throw new Error(`Missing SRT timing in block: ${block}`);
    const [start, end] = lines[timingIndex].split(" --> ");
    lines[0] = String(firstNumber + blockIndex);
    lines[timingIndex] = `${srtTime(parseSrtTime(start) + offset)} --> ${srtTime(parseSrtTime(end) + offset)}`;
    return lines.join("\n");
  });
}

for (const scene of scenes) {
  await access(path.join(framesDir, `${scene.id}.png`));
}

const measured = [];
for (const [index, scene] of scenes.entries()) {
  const textPath = path.join(edgeDir, `${scene.id}.txt`);
  const audioPath = path.join(edgeDir, `${scene.id}.mp3`);
  const subtitlesPath = path.join(edgeDir, `${scene.id}.srt`);
  const segmentPath = path.join(segmentDir, `${String(index + 1).padStart(2, "0")}-${scene.id}.mp4`);
  const shouldRender = !requestedScene || requestedScene === scene.id;
  let audioDuration;
  let segmentDuration;

  if (shouldRender) {
    await writeFile(textPath, scene.narration, "utf8");
    await run("edge-tts", [
      "--file", textPath,
      "--voice", voice,
      "--rate", rate,
      "--write-media", audioPath,
      "--write-subtitles", subtitlesPath,
    ]);
    audioDuration = await duration(audioPath);
    segmentDuration = audioDuration + 0.65;
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-loop", "1", "-i", path.join(framesDir, `${scene.id}.png`),
      "-i", audioPath,
      "-filter_complex", "[1:a]loudnorm=I=-16:LRA=7:TP=-1.5,apad=pad_dur=0.65[a]",
      "-map", "0:v:0", "-map", "[a]",
      "-t", segmentDuration.toFixed(3), "-r", "30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart",
      segmentPath,
    ]);
  } else {
    const existingNarration = await readFile(textPath, "utf8");
    if (existingNarration !== scene.narration) {
      throw new Error(
        `${scene.id} narration changed; render the full video or run --scene ${scene.id}`,
      );
    }
    await Promise.all([
      access(audioPath),
      access(subtitlesPath),
      access(segmentPath),
    ]);
    audioDuration = await duration(audioPath);
    segmentDuration = await duration(segmentPath);
  }
  measured.push({ ...scene, audioDuration, segmentDuration, segmentPath, subtitlesPath });
}

const totalDuration = measured.reduce((sum, scene) => sum + scene.segmentDuration, 0);
if (totalDuration >= 180) {
  throw new Error(`Rendered narration is ${totalDuration.toFixed(1)} seconds; it must remain below 180 seconds.`);
}

const concatPath = path.join(edgeDir, "concat.txt");
await writeFile(
  concatPath,
  measured.map((scene) => `file '${scene.segmentPath.replaceAll("'", "'\\''")}'`).join("\n") + "\n",
  "utf8"
);
const cleanVideo = path.join(outputDir, "hammadev-build-week-demo-edge-clean.mp4");
await run("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", concatPath,
  "-c", "copy", "-movflags", "+faststart", cleanVideo,
]);

let captionNumber = 1;
let cursor = 0;
const captionBlocks = [];
for (const scene of measured) {
  const source = await readFile(scene.subtitlesPath, "utf8");
  const blocks = offsetSrt(source, cursor, captionNumber);
  captionBlocks.push(...blocks);
  captionNumber += blocks.length;
  cursor += scene.segmentDuration;
}
const subtitlesPath = path.join(outputDir, "edge-captions.srt");
await writeFile(subtitlesPath, captionBlocks.join("\n\n") + "\n", "utf8");

const finalVideo = path.join(outputDir, "hammadev-build-week-demo-edge.mp4");
const pendingVideo = path.join(outputDir, "hammadev-build-week-demo-edge.rendering.mp4");
await run("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-i", cleanVideo,
  "-vf", `subtitles=${subtitlesPath}:force_style='FontName=DejaVu Sans,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00121918,BorderStyle=3,BackColour=&HCC121918,Outline=1,Shadow=0,MarginV=28,Alignment=2'`,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
  "-c:a", "copy", "-movflags", "+faststart",
  pendingVideo,
]);
await rename(pendingVideo, finalVideo);

await writeFile(
  path.join(outputDir, "edge-render.txt"),
  `voice=${voice}\nrate=${rate}\nduration=${totalDuration.toFixed(3)}\n`,
  "utf8"
);
console.log(`${finalVideo}\n${totalDuration.toFixed(1)} seconds\n${voice}`);
