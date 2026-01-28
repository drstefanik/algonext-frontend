import { forward } from "../../../proxy";

export const runtime = "nodejs";

const API_BASE_URL = process.env.API_BASE_URL;

type RouteContext = {
  params: {
    jobId: string;
  };
};

type SelectionPayload = {
  trackId?: unknown;
  selection?: {
    time_sec?: unknown;
    frame_time_sec?: unknown;
    bbox?: {
      x?: unknown;
      y?: unknown;
      w?: unknown;
      h?: unknown;
    };
  };
};

const isFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);

const validatePayload = (payload: SelectionPayload) => {
  const issues: string[] = [];
  const trackId = typeof payload.trackId === "string" ? payload.trackId.trim() : "";
  if (!trackId) {
    issues.push("trackId is required.");
  }
  const selection = payload.selection ?? null;
  if (!selection || typeof selection !== "object") {
    issues.push("selection is required.");
    return { valid: false, issues };
  }
  const timeSec = selection.time_sec ?? selection.frame_time_sec;
  if (!isFiniteNumber(timeSec)) {
    issues.push("selection.time_sec is required.");
  }
  const bbox = selection.bbox ?? null;
  if (!bbox || typeof bbox !== "object") {
    issues.push("selection.bbox is required.");
    return { valid: false, issues };
  }
  if (!isFiniteNumber(bbox.x)) issues.push("selection.bbox.x is required.");
  if (!isFiniteNumber(bbox.y)) issues.push("selection.bbox.y is required.");
  if (!isFiniteNumber(bbox.w)) issues.push("selection.bbox.w is required.");
  if (!isFiniteNumber(bbox.h)) issues.push("selection.bbox.h is required.");

  return { valid: issues.length === 0, issues };
};

async function proxyRequest(request: Request, targetUrl: string) {
  if (!API_BASE_URL) {
    return new Response(
      JSON.stringify({ error: "Missing API_BASE_URL environment variable." }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "cache-control": "no-store"
        }
      }
    );
  }

  return forward(request, targetUrl, { methodOverride: "POST" });
}

export async function POST(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  const bodyText = await request.clone().text().catch(() => "");
  if (!bodyText) {
    console.warn("[select-track] Empty payload received.");
    return new Response(
      JSON.stringify({ error: "Missing request body.", issues: ["body is required"] }),
      { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } }
    );
  }
  try {
    const parsed = JSON.parse(bodyText) as SelectionPayload;
    const validation = validatePayload(parsed);
    if (!validation.valid) {
      console.warn("[select-track] Invalid payload", {
        issues: validation.issues,
        payload: parsed
      });
      return new Response(
        JSON.stringify({ error: "Invalid select-track payload.", issues: validation.issues }),
        { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn("[select-track] Failed to parse payload", { message });
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload.", issues: [message] }),
      { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } }
    );
  }

  return proxyRequest(request, `${API_BASE_URL}/jobs/${jobId}/select-track`);
}
