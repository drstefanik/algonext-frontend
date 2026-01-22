import { forward } from "../../../proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = process.env.API_BASE_URL;

type RouteContext = {
  params: {
    jobId: string;
  };
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

  return forward(request, targetUrl, { includeBody: false });
}

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  const { search } = new URL(request.url);
  const targetUrl = `${API_BASE_URL}/jobs/${encodeURIComponent(
    jobId
  )}/frames/list${search}`;
  return proxyRequest(request, targetUrl);
}
