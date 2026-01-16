import { forward } from "../proxy";

const API_BASE_URL = process.env.API_BASE_URL;

type ProxyContext = {
  targetUrl: string;
};

async function proxyRequest(request: Request, { targetUrl }: ProxyContext) {
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

  return forward(request, targetUrl);
}

export async function POST(request: Request) {
  return proxyRequest(request, {
    targetUrl: `${API_BASE_URL}/jobs`
  });
}
