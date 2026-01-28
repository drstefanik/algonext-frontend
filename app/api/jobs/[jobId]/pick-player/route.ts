import { forward } from "../../../proxy";

export const runtime = "nodejs";

const API_BASE_URL = process.env.API_BASE_URL;

type RouteContext = {
  params: {
    jobId: string;
  };
};

type PickPlayerPayload = {
  frame_key?: unknown;
  track_id?: unknown;
};

const validatePayload = (payload: PickPlayerPayload) => {
  const issues: string[] = [];
  const frameKey =
    typeof payload.frame_key === "string" ? payload.frame_key.trim() : "";
  const trackId =
    typeof payload.track_id === "string" ? payload.track_id.trim() : "";

  if (!frameKey) {
    issues.push("frame_key is required.");
  }
  if (!trackId) {
    issues.push("track_id is required.");
  }

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
    return new Response(
      JSON.stringify({ error: "Missing request body.", issues: ["body is required"] }),
      { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } }
    );
  }
  try {
    const parsed = JSON.parse(bodyText) as PickPlayerPayload;
    const validation = validatePayload(parsed);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: "Invalid pick-player payload.", issues: validation.issues }),
        { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload.", issues: [message] }),
      { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } }
    );
  }

  return proxyRequest(request, `${API_BASE_URL}/jobs/${jobId}/pick-player`);
}
