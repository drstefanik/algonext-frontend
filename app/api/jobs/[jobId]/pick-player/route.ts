import { forward } from "../../../proxy";

export const runtime = "nodejs";

type RouteContext = {
  params: {
    jobId: string;
  };
};

export async function POST(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  const base = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return new Response("API_BASE_URL missing", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  return forward(request, `${base}/jobs/${encodeURIComponent(jobId)}/pick-player`);
}
