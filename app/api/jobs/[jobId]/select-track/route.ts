import { forward } from "../../../proxy";

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

  return forward(request, targetUrl, { methodOverride: "POST" });
}

export async function POST(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  return proxyRequest(request, `${API_BASE_URL}/jobs/${jobId}/select-track`);
}
