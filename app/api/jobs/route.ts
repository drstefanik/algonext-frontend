import { forward } from "../proxy";

const API_ORIGIN = process.env.API_ORIGIN;

type ProxyContext = {
  targetUrl: string;
};

async function proxyRequest(request: Request, { targetUrl }: ProxyContext) {
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

  return forward(request, targetUrl);
}

export async function POST(request: Request) {
  return proxyRequest(request, {
    targetUrl: `${API_ORIGIN}/jobs`
  });
}
