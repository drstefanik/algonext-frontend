import { forward } from "../../../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: {
    jobId: string;
  };
};

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  const base = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return new Response("API_BASE_URL missing", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  return forward(request, `${base}/jobs/${encodeURIComponent(jobId)}/candidates`, {
    includeBody: false
  });
}
