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
  const { searchParams } = new URL(request.url);
  const count = searchParams.get("count") ?? "8";
  return proxyRequest(
    request,
    `${API_BASE_URL}/jobs/${jobId}/frames?count=${count}`
  );
}
