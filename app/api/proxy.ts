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
    const bodyData = includeBody ? await request.clone().arrayBuffer() : undefined;

    const upstreamResponse = await fetch(targetUrl, {
      method: methodOverride ?? request.method,
      headers,
      body: bodyData && includeBody ? bodyData : undefined,
      cache: "no-store"
    });

    console.info("[proxy] Upstream response", {
      requestId,
      targetHost,
      status: upstreamResponse.status
    });

    const resHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!HOP_BY_HOP.has(lowerKey)) {
        resHeaders.set(key, value);
      }
    });
    resHeaders.set("x-request-id", requestId);

    const responseBody = await upstreamResponse.arrayBuffer();
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
    return new Response(message, {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-request-id": requestId
      }
    });
  }
}
