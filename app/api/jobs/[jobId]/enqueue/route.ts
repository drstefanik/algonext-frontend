import { forward } from "../../../proxy";

const API_ORIGIN = process.env.API_ORIGIN;

type RouteContext = {
  params: {
    jobId: string;
  };
};

async function proxyRequest(request: Request, targetUrl: string) {
  if (!API_ORIGIN) {
    return new Response(
      JSON.stringify({ error: "Missing API_ORIGIN environment variable." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  return forward(request, targetUrl, { methodOverride: "POST", includeBody: false });
}

export async function POST(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  return proxyRequest(request, `${API_ORIGIN}/jobs/${jobId}/enqueue`);
}
