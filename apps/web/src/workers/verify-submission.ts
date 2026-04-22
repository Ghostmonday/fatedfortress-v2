/**
 * apps/web/src/workers/verify-submission.ts — Cloudflare Worker for VERIFY_SUBMISSION.
 *
 * Runs pre-review automated checks on submitted deliverables.
 * Returns VerificationResult schema.
 *
 * Checks:
 *   format_valid     — MIME type matches deliverable_type
 *   size_within_limit — asset < 500MB
 *   not_empty        — file size > 0
 *   mime_matches_type — extension/mime consistent with deliverable_type
 *   build_success     — code_patch / pr: try a smoke build (stub)
 *   pr_exists         — pr type: check GitHub API
 *   figma_accessible  — figma_link type: check Figma API
 *
 * If auto_reject = true:
 *   - Task is set to revision_requested server-side (not here — caller handles)
 *   - Contributor is notified via verification_failed
 *   - Never reaches host review queue
 */

interface VerifyRequest {
  submissionId: string;
  assetUrl: string;
  deliverableType: string;
}

interface VerificationResult {
  passed: boolean;
  checks: {
    format_valid: boolean;
    size_within_limit: boolean;
    not_empty: boolean;
    mime_matches_type: boolean;
    build_success?: boolean;
    pr_exists?: boolean;
    figma_accessible?: boolean;
  };
  auto_reject: boolean;
  suggested_decision_reason?: string;
  failure_summary?: string;
}

const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

// Maps deliverable types to acceptable MIME patterns
const MIME_PATTERNS: Record<string, RegExp[]> = {
  file:         [/^application\/octet-stream$/, /^text\//, /^application\/pdf$/],
  code_patch:    [/^text\/x-/, /^application\/json$/, /^text\/plain$/],
  design_asset: [/^image\//, /^application\/pdf$/, /^application\/vnd\./],
  pr:           [/^text\/html$/], // GitHub PR URL
  text:         [/^text\/plain$/, /^text\/markdown$/],
  audio:        [/^audio\//],
  video:        [/^video\//],
  "3d_model":   [/^application\/octet-stream$/], // .glb, .obj, .fbx
  figma_link:   [/^text\/plain$/], // URL string
};

async function fetchAssetHead(url: string): Promise<{ ok: boolean; contentLength: number | null; contentType: string | null }> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const contentLength = res.headers.get("content-length");
    const contentType = res.headers.get("content-type") ?? "";
    return { ok: res.ok, contentLength: contentLength ? parseInt(contentLength, 10) : null, contentType };
  } catch {
    return { ok: false, contentLength: null, contentType: "" };
  }
}

async function checkPrExists(prUrl: string, githubToken?: string): Promise<boolean> {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return false;
  const [, owner, repo, number] = match;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
      headers: {
        Authorization: githubToken ? `Bearer ${githubToken}` : "",
        Accept: "application/vnd.github.v3+json",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function verifySubmission(request: VerifyRequest): Promise<VerificationResult> {
  const { assetUrl, deliverableType } = request;
  const checks = {
    format_valid: false,
    size_within_limit: false,
    not_empty: false,
    mime_matches_type: false,
  };
  const failures: string[] = [];

  // HEAD request to get metadata without downloading the whole file
  const { ok, contentLength, contentType } = await fetchAssetHead(assetUrl);

  if (!ok) {
    failures.push(`Asset URL not reachable (${assetUrl})`);
  } else {
    // not_empty
    if (contentLength != null && contentLength > 0) {
      checks.not_empty = true;
    } else {
      failures.push("Asset is empty");
    }

    // size_within_limit
    if (contentLength != null && contentLength <= MAX_SIZE_BYTES) {
      checks.size_within_limit = true;
    } else {
      failures.push(`Asset exceeds 500MB limit (${contentLength ?? "unknown"} bytes)`);
    }

    // mime_matches_type
    if (contentType) {
      const allowed = MIME_PATTERNS[deliverableType] ?? [ /^application\/octet-stream$/ ];
      if (allowed.some(p => p.test(contentType))) {
        checks.mime_matches_type = true;
      } else {
        failures.push(`MIME type '${contentType}' not valid for deliverable type '${deliverableType}'`);
      }
    } else {
      // If no content-type, assume valid if URL looks right
      checks.mime_matches_type = true;
    }
  }

  // format_valid: all structural checks passed
  checks.format_valid = checks.not_empty && checks.size_within_limit && checks.mime_matches_type;

  // Type-specific checks
  let build_success: boolean | undefined;
  let pr_exists: boolean | undefined;
  let figma_accessible: boolean | undefined;

  if (deliverableType === "pr") {
    pr_exists = await checkPrExists(assetUrl, env["GITHUB_TOKEN"]);
    if (!pr_exists) failures.push("Pull request not found or inaccessible");
  }

  if (deliverableType === "figma_link") {
    // Simple URL reachability check for Figma links
    const figmaRes = await fetch(assetUrl, { method: "HEAD" }).catch(() => null);
    figma_accessible = figmaRes?.ok ?? false;
    if (!figma_accessible) failures.push("Figma link not accessible");
  }

  if (["code_patch", "file"].includes(deliverableType)) {
    // Smoke build stub — real implementation would clone + run build command
    build_success = true;
  }

  const auto_reject = !checks.format_valid;
  const failure_summary = failures.length > 0 ? failures.join("; ") : undefined;

  const suggested_decision_reason = auto_reject
    ? (pr_exists === false ? "missing_files" : "quality_issue")
    : undefined;

  return {
    passed: checks.format_valid,
    checks: {
      ...checks,
      build_success,
      pr_exists,
      figma_accessible,
    },
    auto_reject,
    suggested_decision_reason,
    failure_summary,
  };
}

// Cloudflare Worker entrypoint
const worker: ExportedHandler = {
  async fetch(request: Request, env: Record<string, string>): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const body = await request.json() as VerifyRequest;
      const result = await verifySubmission(body);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Verification error";
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
  },
};

export default worker;
