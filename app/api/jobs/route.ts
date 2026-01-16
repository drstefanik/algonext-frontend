import { forward } from "../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL;

type ProxyContext = {
  targetUrl: string;
};

async function proxyRequest(request: Request, { targetUrl }: ProxyContext) {
  const requestId = crypto.randomUUID();

  if (!API_BASE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing API_BASE_URL environment variable.", requestId }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    );
  }

  try {
    const res = await forward(request, targetUrl);

    // Se il backend manda 500 con text/plain, te lo faccio vedere in frontend
    if (!res.ok) {
      const contentType = res.headers.get("content-type") || "text/plain; charset=utf-8";
      const text = await res.text().catch(() => "");
      return new Response(text || JSON.stringify({ ok: false, error: "Upstream error", requestId }), {
        status: res.status,
        headers: {
          "content-type": contentType.includes("application/json")
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      });
    }

    return res;
  } catch (err: any) {
    console.error("[api/jobs proxy] ERROR", { requestId, message: err?.message, stack: err?.stack });
    return new Response(
      JSON.stringify({ ok: false, error: "Proxy failed", requestId }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    );
  }
}

export async function POST(request: Request) {
  return proxyRequest(request, { targetUrl: `${API_BASE_URL}/jobs` });
}
