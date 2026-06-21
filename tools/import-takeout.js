import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase, importBackfilledSession } from "../apps/api/db.js";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run import:takeout -- /path/to/takeout-folder-or-json");
  process.exit(1);
}

const db = openDatabase();
const files = collectJsonFiles(resolve(inputPath));
let imported = 0;
let skipped = 0;

for (const file of files) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(data) ? data : data.BrowserHistory || data["Browser History"] || [];

    for (const row of rows) {
      const normalized = normalizeTakeoutRow(row, file);
      if (!normalized) {
        skipped += 1;
        continue;
      }

      importBackfilledSession(db, normalized);
      imported += 1;
    }
  } catch (error) {
    skipped += 1;
    console.warn(`Skipped ${file}: ${error.message}`);
  }
}

console.log(`Backfill complete. Imported ${imported} records, skipped ${skipped}.`);
console.log("Note: backfilled Google/Chrome history usually has timestamps, not reliable active duration.");

function collectJsonFiles(path) {
  const stats = statSync(path);
  if (stats.isFile()) return path.endsWith(".json") ? [path] : [];

  const results = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const entryStats = statSync(fullPath);
    if (entryStats.isDirectory()) {
      results.push(...collectJsonFiles(fullPath));
    } else if (entry.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results;
}

function normalizeTakeoutRow(row, file) {
  const title = cleanTitle(row.title || row.header || row.name || "");
  const url = firstUrl(row);
  const time = row.time || row.time_usec || row.timestamp || row.date;
  const startAt = normalizeTime(time);

  if (!url || !startAt) return null;

  return {
    id: stableId(`${file}:${url}:${startAt}:${title}`),
    source: inferSource(file, row),
    url,
    title,
    start_at: startAt,
    end_at: null,
    duration_seconds: 0,
    backfilled: true,
    metadata: { importedFrom: file }
  };
}

function firstUrl(row) {
  if (row.url) return row.url;
  if (row.titleUrl) return row.titleUrl;
  if (Array.isArray(row.subtitles)) {
    const subtitle = row.subtitles.find((item) => item.url);
    if (subtitle) return subtitle.url;
  }
  if (Array.isArray(row.details)) {
    const detail = row.details.find((item) => item.url);
    if (detail) return detail.url;
  }
  return null;
}

function normalizeTime(value) {
  if (!value) return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const number = Number(value);
    const ms = number > 1e14 ? Math.floor(number / 1000) : number;
    return new Date(ms).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanTitle(title) {
  return String(title).replace(/^Visited\s+/i, "").replace(/^Watched\s+/i, "").trim();
}

function inferSource(file, row) {
  const lower = `${file} ${row.header || ""}`.toLowerCase();
  if (lower.includes("youtube")) return "google_takeout_youtube";
  if (lower.includes("chrome")) return "google_takeout_chrome";
  if (lower.includes("search")) return "google_takeout_search";
  return "google_takeout";
}

function stableId(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `backfill_${(hash >>> 0).toString(16)}`;
}
