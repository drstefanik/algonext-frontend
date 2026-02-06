import { forward } from "../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL;
let loggedBaseUrl = false;

const logApiBaseUrlHost = (value: string) => {
  if (loggedBaseUrl) {
    return;
  }
  loggedBaseUrl = true;
  try {
    const url = new URL(value);
    console.info("[jobs] API_BASE_URL host", { host: url.host });
  } catch {
    console.info("[jobs] API_BASE_URL host", { host: "invalid" });
  }
};

export async function POST(request: Request) {
  try {
    if (!API_BASE_URL) {
      return new Response("Missing API_BASE_URL environment variable.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      });
    }

    if (!API_BASE_URL.startsWith("http://") && !API_BASE_URL.startsWith("https://")) {
      return new Response("Invalid API_BASE_URL. It must start with http:// or https://.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      });
    }

    logApiBaseUrlHost(API_BASE_URL);

    return forward(request, `${API_BASE_URL}/jobs`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(`Route error: ${msg}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }
}
