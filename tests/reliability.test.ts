import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { canRetryPreparation, mergeJobFrames, readStoredJobId, storeJobId } from "../lib/workflow-session";
import { createJob, normalizeJob, request, WorkflowApiError, type PreviewFrame } from "../lib/workflow-api";
import { retryJob } from "../lib/retry-job";
import { savePlayerProfile } from "../lib/player-profile-api";
import { GET, HEAD } from "../app/api/backend/[...path]/route";
import { forward } from "../app/api/proxy";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalBase = process.env.API_BASE_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalBase === undefined) delete process.env.API_BASE_URL;
  else process.env.API_BASE_URL = originalBase;
});
const frame = (job: string, tracks: PreviewFrame["tracks"] = []): PreviewFrame => ({
  key: `jobs/${job}/frames/frame_0001.jpg`, timeSec: 0, url: "https://example.test/frame.jpg",
  width: 100, height: 100, tracks
});

test("changing jobs cannot carry previous frames into the new job", () => {
  assert.deepEqual(mergeJobFrames("new", [frame("new")], [frame("old")]), [frame("new")]);
});
test("authoritative empty detections clear older detected boxes", () => {
  const old = frame("one", [{ trackId: "7", tier: null, score: .9, bbox: { x: .1, y: .1, w: .1, h: .2 } }]);
  assert.deepEqual(mergeJobFrames("one", [frame("one")], [old])[0].tracks, []);
});
test("blocked browser storage does not block bootstrap or saving a created job", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    get localStorage() { throw new DOMException("Disabled", "SecurityError"); }
  } });
  assert.equal(readStoredJobId(), null);
  assert.doesNotThrow(() => storeJobId("job-1"));
  assert.doesNotThrow(() => storeJobId(null));
});
test("preparation retry requires an explicit preparation failure", () => {
  const job = normalizeJob({ id: "one", status: "FAILED", failure_reason: "preview_generation_failed" });
  assert.equal(canRetryPreparation(job), true);
  assert.equal(canRetryPreparation({ ...job, playerSaved: true }), false);
  assert.equal(canRetryPreparation({ ...job, failureReason: "TRACKING_TIMEOUT" }), false);
});
test("only a preparation still unstarted after ten minutes exposes recovery", () => {
  const now = Date.parse("2026-09-25T16:30:00Z");
  const job = normalizeJob({ id: "one", status: "CREATED", created_at: "2026-09-25T16:19:00Z", progress: { step: "CREATED", pct: 0 } });
  assert.equal(canRetryPreparation(job, now), true);
  assert.equal(canRetryPreparation({ ...job, createdAt: "2026-09-25T16:25:00Z" }, now), false);
  assert.equal(canRetryPreparation({ ...job, createdAt: null }, now), false);
  assert.equal(canRetryPreparation({ ...job, progress: { ...job.progress, step: "EXTRACTING_PREVIEWS" } }, now), false);
  assert.equal(canRetryPreparation({ ...job, progress: { ...job.progress, updatedAt: "2026-09-25T16:29:00Z" } }, now), false);
  assert.equal(canRetryPreparation({ ...job, playerSaved: true }, now), false);
});
test("a created job ID survives a lost follow-up GET and remains pollable", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ ok: true, data: { id: "saved-job", status: "CREATED" } });
    throw new TypeError("network down");
  };
  const job = await createJob({ sourceMode: "url", source: "https://example.test/video.mp4", role: "MF", category: "U18", teamName: "" });
  assert.equal(job.id, "saved-job");
  assert.equal(job.status, "CREATED");
  assert.equal(calls, 2);
});
test("plain FastAPI detail retains the actionable error code and request ID", async () => {
  globalThis.fetch = async () => Response.json({ detail: { code: "ANALYSIS_ATTEMPT_MISMATCH", message: "Reload", details: { current: "next" } } }, { status: 409, headers: { "x-request-id": "req" } });
  await assert.rejects(request("/jobs/one"), (error: unknown) => error instanceof WorkflowApiError && error.code === "ANALYSIS_ATTEMPT_MISMATCH" && error.requestId === "req");
});
test("the request deadline aborts a stalled response body as well as headers", async () => {
  for (const contentType of ["text/plain", "application/json"]) {
    globalThis.fetch = async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Timeout", "AbortError")));
      }
    }), { headers: { "content-type": contentType } });
    await assert.rejects(request("/jobs/one", {}, 5), (error: unknown) => error instanceof WorkflowApiError && error.code === "REQUEST_TIMEOUT");
  }
});
test("truncated JSON is never reported as a successful mutation", async () => {
  globalThis.fetch = async () => new Response('{"ok":', { headers: { "content-type": "application/json" } });
  await assert.rejects(request("/jobs/one/retry", { method: "POST" }), (error: unknown) => error instanceof WorkflowApiError && error.code === "INVALID_RESPONSE");
});
test("retry and profile mutations both carry a deadline and attempt precondition", async () => {
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => { requests.push(init!); return Response.json({ ok: true, data: {} }); };
  await retryJob("one", { expectedAnalysisAttemptId: "attempt-2" });
  await savePlayerProfile("one", { shirtNumber: 3 }, "attempt-2");
  for (const init of requests) {
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(new Headers(init.headers).get("x-analysis-attempt-id"), "attempt-2");
  }
});
test("active proxy preserves bodyless 204/304 and backend revision", async () => {
  process.env.API_BASE_URL = "https://backend.test";
  for (const status of [204, 205, 304]) {
    globalThis.fetch = async () => new Response(null, { status, headers: { "x-algonext-revision": "sha", "retry-after": "5" } });
    const response = await GET(new Request("https://frontend.test/api/backend/jobs/one"), { params: Promise.resolve({ path: ["jobs", "one"] }) });
    assert.equal(response.status, status);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("x-algonext-revision"), "sha");
    assert.equal(response.headers.get("retry-after"), "5");
  }
});
test("proxy HEAD succeeds without fabricating a body", async () => {
  process.env.API_BASE_URL = "https://backend.test";
  globalThis.fetch = async () => new Response(null, { status: 200 });
  const response = await HEAD(new Request("https://frontend.test/api/backend/health", { method: "HEAD" }), { params: Promise.resolve({ path: ["health"] }) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});
test("legacy proxy forwards decoded bodies without stale gzip metadata", async () => {
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.signal);
    assert.equal(init?.body, undefined);
    return new Response('{"ok":true}', { headers: { "content-type": "application/json", "content-encoding": "gzip", "x-request-id": "upstream-id" } });
  };
  const response = await forward(new Request("https://frontend.test/api/jobs/one"), "https://backend.test/jobs/one");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("x-request-id"), "upstream-id");
  assert.deepEqual(await response.json(), { ok: true });
});
