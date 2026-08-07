const fs = require("fs/promises");

const SOURCE_FILE = "lukudiplomi/mantsala/source/2026.json";
const OUTPUT_FILE = "lukudiplomi/mantsala/2026.json";

const API_BASE_URL = "https://api.finna.fi/v1/search";
const LIMIT = 100;
const DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeFinnaPrefix(id) {
  if (!id || typeof id !== "string") return "";

  return id
    .replace("kirkes.", "")
    .trim();
}

function buildApiUrl(openUrl, page) {
  const originalUrl = new URL(openUrl);
  const apiUrl = new URL(API_BASE_URL);

  originalUrl.searchParams.forEach((value, key) => {
    apiUrl.searchParams.append(key, value);
  });

  apiUrl.searchParams.append(
    "filter[]",
    'building:"0/Kirkes/"'
  );

  apiUrl.searchParams.set("limit", String(LIMIT));
  apiUrl.searchParams.set("page", String(page));

  apiUrl.searchParams.delete("field");
  apiUrl.searchParams.delete("field[]");
  apiUrl.searchParams.append("field[]", "id");

  return apiUrl.toString();
}

async function fetchBookSeriesIds(openUrl) {
  const ids = new Set();
  let page = 1;
  let resultCount = null;

  while (true) {
    const apiUrl = buildApiUrl(openUrl, page);

    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "lukudiplomi-series-id-updater"
      }
    });

    if (!response.ok) {
      throw new Error(`Finna API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (typeof data.resultCount === "number") {
      resultCount = data.resultCount;
    }

    const records = Array.isArray(data.records) ? data.records : [];

    for (const record of records) {
      const id = removeFinnaPrefix(record?.id);

      if (id.length > 0) {
        ids.add(id);
      }
    }

    if (records.length === 0) break;
    if (records.length < LIMIT) break;
    if (resultCount !== null && page * LIMIT >= resultCount) break;

    page++;

    await sleep(DELAY_MS);
  }

  return Array.from(ids);
}

function normalizeIds(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((id) => id.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  return [];
}

function sameIds(a, b) {
  const first = [...a].sort();
  const second = [...b].sort();

  if (first.length !== second.length) return false;

  return first.every((value, index) => value === second[index]);
}

async function main() {
  const raw = await fs.readFile(SOURCE_FILE, "utf8");
  const items = JSON.parse(raw);

  if (!Array.isArray(items)) {
    throw new Error("JSON root must be an array");
  }

  let changed = false;
  let checked = 0;
  let updated = 0;
  let failed = 0;

  for (const item of items) {
    const isSeries = item.itemType === "series";
    const hasOpenUrl =
      typeof item.openUrl === "string" && item.openUrl.trim().length > 0;

    if (!isSeries || !hasOpenUrl) {
      continue;
    }

    checked++;

    try {
      console.log(`Checking: ${item.itemName || item.bookId || "unnamed series"}`);

      const newIds = await fetchBookSeriesIds(item.openUrl);
      const oldIds = normalizeIds(item.bookSeriesIds);

      if (!sameIds(oldIds, newIds)) {
        item.bookSeriesIds = newIds;
        changed = true;
        updated++;
      }

      console.log(`Found ${newIds.length} ids`);
    } catch (error) {
      failed++;
      console.error(`Failed: ${item.itemName || item.bookId || "unnamed series"}`);
      console.error(error.message);
    }

    await sleep(DELAY_MS);
  }

  if (changed) {
    await fs.writeFile(
      OUTPUT_FILE,
      `${JSON.stringify(items, null, 2)}\n`,
      "utf8"
    );
  }

  console.log("");
  console.log("Done");
  console.log(`Series checked: ${checked}`);
  console.log(`Series updated: ${updated}`);
  console.log(`Series failed: ${failed}`);
  console.log(`Changed: ${changed ? "yes" : "no"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
