import { NextResponse } from "next/server";

type ForwardOptions = {
  methodOverride?: string;
  includeBody?: boolean;
};

const generateRequestId = () => crypto.randomUUID();

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

const PASSTHROUGH_HEADERS = new Set(["content-type", "cache-control"]);

export async function forward(
  request: Request,
  targetUrl: string,
  { methodOverride, includeBody = true }: ForwardOptions = {}
) {
  const requestId = generateRequestId();
  const targetHost = (() => {
    try {
      return new URL(targetUrl).host;
    } catch {
      return "unknown";
    }
  })();
  try {
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (!HOP_BY_HOP.has(k)) headers.set(key, value);
    });
    headers.set("x-request-id", requestId);

    // IMPORTANT: non usare request.body (stream) su Vercel.
    // Bufferizza il body: stabile per JSON piccoli.
    const bodyText = includeBody ? await request.clone().text() : undefined;

    const upstreamResponse = await fetch(targetUrl, {
      method: methodOverride ?? request.method,
      headers,
      body: bodyText && includeBody ? bodyText : undefined,
      cache: "no-store",
    });

    const responseBody = await upstreamResponse.text();
    const upstreamContentType = (
      upstreamResponse.headers.get("content-type") ?? ""
    ).toLowerCase();
    console.info("[proxy] Upstream response", {
      requestId,
      targetHost,
      status: upstreamResponse.status
    });

    const isJsonResponse = upstreamContentType.includes("application/json");
    if (!isJsonResponse) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UPSTREAM_BAD_GATEWAY",
            message: "Backend API unavailable",
            status: 502
          }
        },
        {
          status: 502,
          headers: {
            "cache-control": "no-store",
            "x-request-id": requestId
          }
        }
      );
    }

    const resHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!HOP_BY_HOP.has(lowerKey) && PASSTHROUGH_HEADERS.has(lowerKey)) {
        resHeaders.set(key, value);
      }
    });
    resHeaders.set("x-request-id", requestId);

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: resHeaders
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[proxy] Upstream fetch failed", {
      requestId,
      targetHost,
      status: "fetch_failed"
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UPSTREAM_UNREACHABLE",
          message,
          targetUrl,
          requestId
        }
      },
      {
        status: 502,
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId
        }
      }
    );
  }
}
