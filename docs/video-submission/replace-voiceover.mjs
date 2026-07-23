import { access, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "output");
const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(outputDir, "hammadev-build-week-demo-human.mp4");
const sourceVideo = path.join(outputDir, "hammadev-build-week-demo-clean.mp4");
const voiceover = JSON.parse(await readFile(path.join(here, "voiceover.json"), "utf8"));

if (!inputPath) {
  console.error("Usage: node docs/video-submission/replace-voiceover.mjs <voice.wav|m4a|mp3> [output.mp4]");
  process.exit(2);
}

await Promise.all([access(inputPath), access(sourceVideo)]);

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

function srtTime(seconds) {
  const millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function chunks(text, count = 8) {
  const words = text.trim().split(/\s+/);
  const result = [];
  for (let index = 0; index < words.length; index += count) {
    result.push(words.slice(index, index + count).join(" "));
  }
  return result;
}

const videoDuration = await duration(sourceVideo);
const audioDuration = await duration(inputPath);
if (audioDuration > videoDuration + 0.25) {
  throw new Error(
    `Voice recording is ${audioDuration.toFixed(1)} seconds, but the video is ${videoDuration.toFixed(1)} seconds. ` +
    "Shorten the take so no narration is cut off."
  );
}
if (audioDuration < videoDuration - 12) {
  throw new Error(
    `Voice recording is only ${audioDuration.toFixed(1)} seconds. Aim for 145–151 seconds so narration stays aligned with the scenes.`
  );
}

let captionNumber = 1;
const captions = [];
for (const scene of voiceover) {
  const sceneChunks = chunks(scene.narration);
  const durationPerChunk = (scene.end - scene.start) / sceneChunks.length;
  for (const [index, text] of sceneChunks.entries()) {
    const start = scene.start + index * durationPerChunk;
    const end = index === sceneChunks.length - 1
      ? scene.end
      : start + durationPerChunk;
    captions.push(`${captionNumber}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`);
    captionNumber += 1;
  }
}
const captionsPath = path.join(outputDir, "human-captions.srt");
await writeFile(captionsPath, captions.join("\n"), "utf8");

const filter = [
  "[1:a]highpass=f=70",
  "lowpass=f=12000",
  "loudnorm=I=-16:LRA=7:TP=-1.5",
  "afade=t=in:st=0:d=0.15",
  `apad=pad_dur=${Math.max(0, videoDuration - audioDuration).toFixed(3)}[voice]`,
].join(",");

await run("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-i", sourceVideo,
  "-i", inputPath,
  "-filter_complex", filter,
  "-map", "0:v:0",
  "-map", "[voice]",
  "-t", videoDuration.toFixed(3),
  "-vf", `subtitles=${captionsPath}:force_style='FontName=DejaVu Sans,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00121918,BorderStyle=3,BackColour=&HCC121918,Outline=1,Shadow=0,MarginV=28,Alignment=2'`,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-movflags", "+faststart",
  outputPath,
]);

console.log(`Created ${outputPath}`);
console.log(`Video: ${videoDuration.toFixed(1)} seconds · voice: ${audioDuration.toFixed(1)} seconds`);
console.log(`Captions: ${captionsPath}`);
