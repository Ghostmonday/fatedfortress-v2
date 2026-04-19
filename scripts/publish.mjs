#!/usr/bin/env node
/**
 * scripts/publish.mjs — here.now deployment script.
 *
 * Usage:
 *   node scripts/publish.mjs [--env production|staging]
 *
 * Steps:
 *   1. Build web app: vite build (apps/web)
 *   2. Zip dist/ contents (stored, no compression — works in any Node.js)
 *   3. POST to here.now publish API
 *   4. Log the permanent URL
 *
 * Environment:
 *   HERENOW_TOKEN  — here.now API token
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const HERE_NOW_API = "https://api.here.now/v1";
const HERE_NOW_TOKEN = process.env.HERENOW_TOKEN ?? "";

async function build() {
  console.log("[publish] Building web app...");
  const { execSync } = await import("child_process");
  try {
    execSync("npx vite build", {
      cwd: join(ROOT, "apps/web"),
      stdio: "inherit",
    });
    console.log("[publish] Build complete");
  } catch {
    console.error("[publish] Build failed");
    process.exit(1);
  }
}

function collectFiles(dir, prefix = "") {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath, relPath));
    } else {
      files.push({ path: relPath, fullPath });
    }
  }
  return files;
}

/** CRC-32 using the standard IEEE polynomial */
function crc32(data) {
  let crc = 0xffffffff;
  const table = makeCrc32Table();
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

/** Creates a valid ZIP file (stored, no compression) as a Buffer */
function createZip(distPath) {
  console.log("[publish] Creating ZIP archive...");
  const files = collectFiles(distPath);
  console.log(`[publish] Found ${files.length} files`);

  const parts = [];
  let cdOffset = 0;

  // Local file headers + data
  for (const file of files) {
    const data = readFileSync(file.fullPath);
    const nameBytes = Buffer.from(file.path, "utf8");
    const nameLen = nameBytes.length;

    const header = Buffer.alloc(30 + nameLen);
    header.writeUInt32LE(0x04034b50, 0);     // signature
    header.writeUInt16LE(20, 4);              // version needed (2.0)
    header.writeUInt16LE(0, 6);               // general flag
    header.writeUInt16LE(0, 8);               // compression (stored)
    header.writeUInt16LE(0, 10);              // mod time
    header.writeUInt16LE(0, 12);              // mod date
    header.writeUInt32LE(crc32(data), 14);   // CRC-32
    header.writeUInt32LE(data.length, 18);   // compressed size
    header.writeUInt32LE(data.length, 22);   // uncompressed size
    header.writeUInt16LE(nameLen, 26);       // name length
    header.writeUInt16LE(0, 28);              // extra field length
    nameBytes.copy(header, 30);             // file name

    parts.push(header, data);
    cdOffset += header.length + data.length;
  }

  // Central directory
  const cdEntries = [];
  for (const file of files) {
    const data = readFileSync(file.fullPath);
    const nameBytes = Buffer.from(file.path, "utf8");
    const nameLen = nameBytes.length;

    const entry = Buffer.alloc(46 + nameLen);
    entry.writeUInt32LE(0x02014b50, 0);     // signature
    entry.writeUInt16LE(20, 4);              // version made by
    entry.writeUInt16LE(20, 6);              // version needed
    entry.writeUInt16LE(0, 8);               // general flag
    entry.writeUInt16LE(0, 10);              // compression
    entry.writeUInt16LE(0, 12);             // mod time
    entry.writeUInt16LE(0, 14);             // mod date
    entry.writeUInt32LE(crc32(data), 16);  // CRC-32
    entry.writeUInt32LE(data.length, 20);  // compressed size
    entry.writeUInt32LE(data.length, 24);  // uncompressed size
    entry.writeUInt16LE(nameLen, 28);      // name length
    entry.writeUInt16LE(0, 30);            // extra field length
    entry.writeUInt16LE(0, 32);            // comment length
    entry.writeUInt16LE(0, 34);            // disk number start
    entry.writeUInt16LE(0, 36);            // internal attrs
    entry.writeUInt32LE(0, 38);            // external attrs
    entry.writeUInt32LE(cdOffset, 42);    // relative offset
    nameBytes.copy(entry, 46);             // file name

    cdEntries.push(entry);
    cdOffset += header.length + data.length;
  }

  const cdData = Buffer.concat(cdEntries);
  const cdSize = cdData.length;
  const cdStart = parts.reduce((sum, p) => sum + p.length, 0);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);     // signature
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // CD disk
  eocd.writeUInt16LE(files.length, 8);     // CD entries on disk
  eocd.writeUInt16LE(files.length, 10);    // CD entries total
  eocd.writeUInt32LE(cdSize, 12);        // CD size
  eocd.writeUInt32LE(cdStart, 16);       // CD offset
  eocd.writeUInt16LE(0, 20);              // comment length

  const zip = Buffer.concat([...parts, cdData, eocd]);
  console.log(`[publish] ZIP: ${files.length} files, ${(zip.length / 1024).toFixed(1)} KB`);
  return zip;
}

async function publishToHereNow(zipBuffer) {
  if (!HERE_NOW_TOKEN) {
    console.warn("[publish] HERENOW_TOKEN not set — skipping upload");
    return null;
  }

  console.log("[publish] Uploading to here.now...");
  const response = await fetch(`${HERE_NOW_API}/publish`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HERE_NOW_TOKEN}`,
      "Content-Type": "application/zip",
      "X-Client": "fatedfortress",
      "X-App-Name": "fatedfortress",
    },
    body: zipBuffer,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`here.now upload failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.url ?? data.publishUrl ?? null;
}

async function main() {
  const env = process.argv.includes("--staging") ? "staging" : "production";
  console.log(`[publish] Starting publish (${env})...`);

  await build();

  const distPath = join(ROOT, "apps/web/dist");
  if (!existsSync(distPath)) {
    console.error(`[publish] dist/ not found at ${distPath}`);
    process.exit(1);
  }

  const zipBuffer = createZip(distPath);
  const url = await publishToHereNow(zipBuffer);

  if (url) {
    console.log(`\n✅ Published! URL: ${url}`);
  } else {
    console.log("\n⚠️  Skipped upload (no HERENOW_TOKEN).");
    console.log("   To deploy: set HERENOW_TOKEN and run again.");
  }
}

main().catch(console.error);
