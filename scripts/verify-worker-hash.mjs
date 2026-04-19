#!/usr/bin/env node
/**
 * verify-worker-hash.mjs
 *
 * CI + browser-side verifiability script.
 *
 * PURPOSE:
 *   The "provably BYOK" guarantee lives here. This script:
 *   1. Builds a canonical SHA-256 hash of the compiled Fortress Worker bundle.
 *   2. Writes the hash into a publicly visible manifest (published to here.now).
 *   3. Verifies the hash in CI by comparing the live bundle to the recorded hash.
 *   4. Generates the SRI (Subresource Integrity) attribute for /connect display.
 *
 * SECURITY NOTES:
 *   - Hash is over the MINIFIED, PRODUCTION bundle, NOT source files.
 *     Source maps are excluded from the canonical hash.
 *   - The build MUST be reproducible — vite.config.ts pins all transform options.
 *   - This script is itself verified in CI via its own hash in scripts/hashes.json.
 *
 * USAGE:
 *   node scripts/verify-worker-hash.mjs --build    # Build + record hash
 *   node scripts/verify-worker-hash.mjs --verify   # Verify bundle vs recorded hash
 *   node scripts/verify-worker-hash.mjs --sri       # Print SRI attribute for /connect
 */

import { createHash }          from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { parseArgs }              from "node:util";

const HASH_MANIFEST_PATH = resolve("scripts/worker-hash-manifest.json");
const WORKER_BUNDLE_GLOB = resolve("apps/worker/dist");

// ---------------------------------------------------------------------------
// Canonical bundle content assembly
// ---------------------------------------------------------------------------

/**
 * Returns all files that are part of the canonical worker bundle.
 * Excludes: source maps (.map), README, license files.
 *
 * Files are sorted deterministically so hash is path-order independent.
 * This is critical for reproducibility across different OS file systems.
 */
function getCanonicalBundleFiles(distDir) {
  // Uses top-level readdirSync import — no dynamic import needed in ESM.
  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walk(fullPath));
      } else if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (
          !name.endsWith(".map") &&
          !name.endsWith(".license") &&
          name !== "readme.md" &&
          name !== ".nojekyll"
        ) {
          files.push(fullPath);
        }
      }
    }
    return files;
  }
  return walk(distDir);
}

/**
 * Computes the canonical SHA-256 hash over all bundle files.
 *
 * Hash input is: for each file in sorted order,
 *   "<relative-path>:<hex-content-hash>\n"
 * This makes the hash sensitive to both file names and file contents,
 * so renaming a file or changing content both invalidate the hash.
 */
async function computeBundleHash(distDir) {
  const files = getCanonicalBundleFiles(distDir);

  if (files.length === 0) {
    throw new Error(`No bundle files found in ${distDir}. Did you run the build?`);
  }

  const outer = createHash("sha256");

  for (const filePath of files) {
    const relativePath = relative(distDir, filePath);
    const content = readFileSync(filePath);
    const fileHash = createHash("sha256").update(content).digest("hex");
    outer.update(`${relativePath}:${fileHash}\n`);
  }

  return outer.digest("hex");
}

// ---------------------------------------------------------------------------
// SRI hash for <script> tag — sha256- prefix, base64 encoded
// ---------------------------------------------------------------------------

async function computeSRIHash(distDir) {
  // SRI is over the entry-point JS only (index.*.js in dist root or assets/).
  // Uses top-level readdirSync — no dynamic import needed in ESM.
  let entryFile = null;

  // Check dist root first (flat Vite output)
  const rootFiles = readdirSync(distDir).filter(
    (f) => f.endsWith(".js") && !f.endsWith(".map") && f.startsWith("index")
  );
  if (rootFiles.length > 0) {
    entryFile = join(distDir, rootFiles[0]);
  }

  // Fall back to assets/ subdirectory (Vite default hashed output)
  if (!entryFile) {
    const assetsDir = join(distDir, "assets");
    if (existsSync(assetsDir)) {
      // Filter for entry-point only — Vite names it "index-[hash].js".
      // Chunk files are named after their module (e.g., "vendor-abc123.js").
      // Using any .js file risks SRI over a non-entry chunk, which browsers reject.
      const assetFiles = readdirSync(assetsDir).filter(
        (f) => f.endsWith(".js") && !f.endsWith(".map") && f.startsWith("index")
      );
      if (assetFiles.length > 0) {
        // join directly with assetsDir — assetFiles are bare filenames, no prefix.
        entryFile = join(assetsDir, assetFiles[0]);
      }
    }
  }

  if (!entryFile) {
    throw new Error("No entry JS found for SRI. Build the worker first.");
  }

  const content = readFileSync(entryFile);
  const hash = createHash("sha256").update(content).digest("base64");
  return `sha256-${hash}`;
}

// ---------------------------------------------------------------------------
// Manifest read/write
// ---------------------------------------------------------------------------

function readManifest() {
  if (!existsSync(HASH_MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(HASH_MANIFEST_PATH, "utf8"));
}

function writeManifest(manifest) {
  writeFileSync(HASH_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdBuild() {
  console.log("⚙  Computing canonical bundle hash...");
  const hash = await computeBundleHash(WORKER_BUNDLE_GLOB);
  const sri  = await computeSRIHash(WORKER_BUNDLE_GLOB);
  const ts   = new Date().toISOString();

  const manifest = {
    canonical: hash,
    sri,
    bundleDir: "apps/worker/dist",
    algorithm: "sha256-canonical-v1",
    generatedAt: ts,
    schemaVersion: 1,
  };

  writeManifest(manifest);
  console.log(`✅ Hash recorded:`);
  console.log(`   canonical: ${hash}`);
  console.log(`   sri:       ${sri}`);
  console.log(`   manifest:  ${HASH_MANIFEST_PATH}`);
  console.log(`\n   Commit scripts/worker-hash-manifest.json — this is the published trust anchor.`);
}

async function cmdVerify() {
  const manifest = readManifest();
  if (!manifest) {
    console.error("❌ No manifest found. Run: node scripts/verify-worker-hash.mjs --build");
    process.exit(1);
  }

  console.log("🔍 Verifying worker bundle against recorded hash...");
  const live = await computeBundleHash(WORKER_BUNDLE_GLOB);

  if (live !== manifest.canonical) {
    console.error("❌ HASH MISMATCH — Worker bundle has changed since last trusted build.");
    console.error(`   Expected: ${manifest.canonical}`);
    console.error(`   Actual:   ${live}`);
    console.error(`\n   If this was intentional, run --build to update the manifest and commit it.`);
    console.error(`   CI blocks merge until the manifest is updated AND reviewed.`);
    process.exit(2); // Exit code 2 = hash mismatch (distinct from general error)
  }

  console.log(`✅ Hash verified — bundle matches recorded manifest.`);
  console.log(`   ${manifest.canonical}`);
  console.log(`   Recorded: ${manifest.generatedAt}`);
}

async function cmdSRI() {
  const manifest = readManifest();
  if (!manifest) {
    console.error("❌ No manifest. Run --build first.");
    process.exit(1);
  }
  console.log(`\nSRI attribute for /connect display:`);
  console.log(`integrity="${manifest.sri}" crossorigin="anonymous"`);
  console.log(`\nFull <script> tag:`);
  console.log(`<script src="/worker/assets/index.js" integrity="${manifest.sri}" crossorigin="anonymous"></script>`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    build:  { type: "boolean", default: false },
    verify: { type: "boolean", default: false },
    sri:    { type: "boolean", default: false },
  },
  strict: false,
});

if (values.build) {
  await cmdBuild();
} else if (values.verify) {
  await cmdVerify();
} else if (values.sri) {
  await cmdSRI();
} else {
  console.log("Usage:");
  console.log("  --build   Compute hash of built worker bundle and write manifest");
  console.log("  --verify  Verify live bundle against manifest (CI gate)");
  console.log("  --sri     Print SRI attribute for /connect display");
  process.exit(1);
}
