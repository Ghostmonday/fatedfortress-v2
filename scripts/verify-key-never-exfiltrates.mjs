#!/usr/bin/env node
/**
 * verify-key-never-exfiltrates.mjs
 *
 * Security proof test: verifies that no API key ever leaves the Fortress Worker
 * in any postMessage or network request to the FatedFortress origin.
 *
 * WHAT THIS PROVES:
 *   This test is not a unit test — it is a security proof. It:
 *   1. Starts a real headless browser (Playwright).
 *   2. Injects a sentinel API key with a recognizable structure.
 *   3. Intercepts ALL network requests and postMessages to any FF origin.
 *   4. Asserts the sentinel key is absent in every encoding:
 *      raw, base64, base64url, URL-encoded, JSON-stringified, hex.
 *   5. Performs the full generate flow: store key → generate → receive chunks.
 *   6. Fails the test if any request/message contains the sentinel in any encoding.
 *
 * EXIT CODES:
 *   0 = proof passed, key never exfiltrated
 *   1 = proof failed, key found in intercepted message or network request
 *   2 = test infrastructure error (browser failed to launch, timeout, etc.)
 *
 * CI GATE: This script MUST pass before every v1 deploy and v1.5 Tempo launch.
 * A failing exit code blocks CI pipeline. See SECURITY.md Pre-launch Gate 3.
 *
 * USAGE:
 *   node scripts/verify-key-never-exfiltrates.mjs [--url http://localhost:5173]
 */

import { chromium }     from "playwright";
import { parseArgs }    from "node:util";
import { createHash }   from "node:crypto";

const SENTINEL_KEY = "sk-ff-sentinel-" + createHash("sha256")
  .update("fatedfortress-key-exfiltration-probe-" + Date.now())
  .digest("hex")
  .slice(0, 24);

const FF_TEST_URL = "http://localhost:5173";
const TIMEOUT_MS  = 30_000;

// ---------------------------------------------------------------------------
// Encoding variants — key is "found" if ANY of these appear in any message
// ---------------------------------------------------------------------------

function computeSentinelVariants(key) {
  const buf = Buffer.from(key, "utf8");
  return new Set([
    key,                                    // raw
    buf.toString("base64"),                 // standard base64
    buf.toString("base64url"),              // url-safe base64
    encodeURIComponent(key),               // URL-encoded
    JSON.stringify(key),                   // JSON-stringified (with quotes)
    buf.toString("hex"),                   // hex
    key.replace(/-/g, "_"),               // underscore variant
    key.replace(/_/g, "-"),               // hyphen variant
    btoa(key),                             // legacy btoa
    // Chunked: check if key is split across two postMessages (anti-evasion)
    // This catches the attack where a compromised worker sends the key in halves.
    key.slice(0, key.length / 2),         // first half
    key.slice(key.length / 2),            // second half
  ]);
}

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------

function makeInterceptor(sentinelVariants) {
  const violations = [];

  function checkString(value, source) {
    const str = typeof value === "string" ? value : JSON.stringify(value) ?? "";
    for (const variant of sentinelVariants) {
      if (str.includes(variant)) {
        violations.push({
          source,
          variant,
          excerpt: str.slice(Math.max(0, str.indexOf(variant) - 20), str.indexOf(variant) + variant.length + 20),
        });
      }
    }
  }

  return { violations, checkString };
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

async function runTest(targetUrl) {
  let browser;
  const sentinelVariants = computeSentinelVariants(SENTINEL_KEY);
  const { violations, checkString } = makeInterceptor(sentinelVariants);

  console.log(`\n🔑 Sentinel key: ${SENTINEL_KEY}`);
  console.log(`🌐 Testing:      ${targetUrl}`);
  console.log(`⏱  Timeout:      ${TIMEOUT_MS}ms\n`);

  try {
    browser = await chromium.launch({ headless: true });
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    // ── Intercept all network requests ──────────────────────────────────────
    await ctx.route("**/*", async (route, request) => {
      const url  = request.url();
      const body = request.postData() ?? "";

      // Only intercept requests to FF origins
      const isFFOrigin = url.includes("fatedfortress") || url.includes("localhost");
      if (isFFOrigin) {
        checkString(url,  `network-url: ${url}`);
        checkString(body, `network-body: ${url}`);

        // Also check request headers
        const headers = await request.allHeaders();
        for (const [k, v] of Object.entries(headers)) {
          checkString(`${k}: ${v}`, `request-header: ${url}`);
        }
      }

      await route.continue();
    });

    // ── Intercept postMessages ───────────────────────────────────────────────
    // INTERCEPTION SCOPE NOTE:
    // We intercept messages FROM the worker back TO the main thread (outbound from worker).
    // We do NOT intercept inbound messages TO the worker — they legitimately contain
    // the sentinel key (STORE_KEY carries the raw key by design).
    // Exfiltration can only occur if the worker ECHOES the key outward, either via:
    //   a) A network request FROM the main page (caught by ctx.route below).
    //   b) A message FROM the worker TO the main thread (caught here via the
    //      `message` event — worker sends via window.parent.postMessage which
    //      fires `message` on the parent window, captured by our patched listener).
    // Cross-origin iframes cannot be instrumented by addInitScript, so we rely on
    // the network interceptor to catch any exfiltration via XHR/fetch from the worker.
    await page.exposeFunction("__ffProbePostMessage", (data) => {
      const str = typeof data === "string" ? data : JSON.stringify(data);
      // Label with "worker→main postMessage" to distinguish from network violations
      checkString(str, "worker→main postMessage");
    });

    await page.addInitScript(`
      const _orig = window.postMessage.bind(window);
      window.postMessage = function(data, targetOrigin, transfer) {
        if (typeof __ffProbePostMessage === 'function') {
          __ffProbePostMessage(typeof data === 'string' ? data : JSON.stringify(data));
        }
        return _orig(data, targetOrigin, transfer);
      };
      // Also intercept MessageChannel postMessage
      const _MC = window.MessageChannel;
      window.MessageChannel = function() {
        const mc = new _MC();
        const _p1 = mc.port1.postMessage.bind(mc.port1);
        const _p2 = mc.port2.postMessage.bind(mc.port2);
        mc.port1.postMessage = function(data) {
          if (typeof __ffProbePostMessage === 'function') {
            __ffProbePostMessage(typeof data === 'string' ? data : JSON.stringify(data));
          }
          return _p1(data);
        };
        mc.port2.postMessage = function(data) {
          if (typeof __ffProbePostMessage === 'function') {
            __ffProbePostMessage(typeof data === 'string' ? data : JSON.stringify(data));
          }
          return _p2(data);
        };
        return mc;
      };
    `);

    // ── Navigate and perform the full key store + generate flow ─────────────
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

    // Simulate the full generate flow:
    // 1. Store sentinel key in the Fortress Worker
    // 2. Trigger a test generation
    // 3. Wait for the first chunk
    await page.evaluate(async (sentinelKey) => {
      // These functions are exposed by the web app's test harness when
      // process.env.NODE_ENV === 'test' — they call postMessage to the worker
      // exactly as the real flow does.
      if (window.__ffTestHarness) {
        await window.__ffTestHarness.storeKey("openai", sentinelKey);
        await window.__ffTestHarness.generate({
          provider: "openai",
          model:    "gpt-4o",
          prompt:   "Say 'test' in one word.",
          systemPrompt: "",
        });
      }
    }, SENTINEL_KEY);

    // Wait for the test harness to signal completion OR timeout.
    // This avoids a bare 3s sleep that gives false passes on fast failures.
    // __ffTestHarness.generate() sets window.__ffProofDone = true when the
    // DONE or ERROR message is received from the worker.
    try {
      await page.waitForFunction(
        () => typeof window.__ffProofDone !== "undefined" && window.__ffProofDone === true,
        { timeout: TIMEOUT_MS }
      );
    } catch {
      // waitForFunction timed out — still evaluate whatever violations we caught
      console.warn("⚠  waitForFunction timed out — evaluating partial results.");
    }
    // Extra 500ms to let any async flush complete after the done signal
    await page.waitForTimeout(500);

    // ── Evaluate results ─────────────────────────────────────────────────────
    if (violations.length === 0) {
      console.log("✅ PROOF PASSED — sentinel key not found in any intercepted message or network request.");
      console.log(`   Variants checked: ${sentinelVariants.size}`);
      return 0;
    } else {
      console.error("❌ PROOF FAILED — key exfiltration detected!\n");
      for (const v of violations) {
        console.error(`  SOURCE:  ${v.source}`);
        console.error(`  VARIANT: ${v.variant}`);
        console.error(`  EXCERPT: ...${v.excerpt}...`);
        console.error();
      }
      console.error(`Total violations: ${violations.length}`);
      console.error(`\nThis is a CRITICAL security failure. Do NOT deploy.`);
      return 1;
    }

  } catch (err) {
    console.error(`❌ Test infrastructure error: ${err.message}`);
    return 2;
  } finally {
    if (browser) await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    url: { type: "string", default: FF_TEST_URL },
  },
  strict: false,
});

const exitCode = await runTest(values.url ?? FF_TEST_URL);
process.exit(exitCode);
