import { forward } from "../../proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
        headers: {
          "Content-Type": "application/json",
          "cache-control": "no-store"
        }
      }
    );
  }

  const response = await forward(request, targetUrl, { includeBody: false });
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-cache, no-store, must-revalidate");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  return proxyRequest(request, `${API_ORIGIN}/jobs/${jobId}`);
}
