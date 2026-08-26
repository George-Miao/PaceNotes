import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const assetDirectory = new URL("../.output/public/assets/", import.meta.url);
const assets = readdirSync(assetDirectory);

function largestGzipSize(pattern) {
  const matches = assets.filter((file) => pattern.test(file));
  if (matches.length === 0) throw new Error(`No built asset matches ${pattern}`);
  return Math.max(
    ...matches.map((file) => gzipSync(readFileSync(new URL(file, assetDirectory))).byteLength),
  );
}

function check(label, pattern, maximumKiB) {
  const bytes = largestGzipSize(pattern);
  const kibibytes = bytes / 1024;
  if (kibibytes > maximumKiB) {
    throw new Error(
      `${label} is ${kibibytes.toFixed(1)} KiB compressed; limit is ${maximumKiB} KiB`,
    );
  }
  console.log(`${label}: ${kibibytes.toFixed(1)} KiB compressed (limit ${maximumKiB} KiB)`);
}

check("Application shell", /^index-[^.]+\.js$/, 150);
check("Planner route", /^trips\._tripId-[^.]+\.js$/, 250);
check("Lazy map", /^TripMap-[^.]+\.js$/, 50);
