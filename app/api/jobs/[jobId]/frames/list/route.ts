import { forward } from "@/app/api/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = process.env.API_BASE_URL;

type RouteContext = {
  params: {
    jobId: string;
  };
};

export async function GET(request: Request, { params }: RouteContext) {
  if (!API_BASE_URL) {
    return new Response("Missing API_BASE_URL environment variable.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const { search } = new URL(request.url);
  const url = `${API_BASE_URL}/jobs/${encodeURIComponent(params.jobId)}/frames/list${search}`;

  return forward(request, url);
}
