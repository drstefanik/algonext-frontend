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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
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
    const method = methodOverride ?? request.method;
    const sendBody = includeBody && method !== "GET" && method !== "HEAD";
    const bodyData = sendBody ? await request.clone().arrayBuffer() : undefined;

    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers,
      body: bodyData?.byteLength ? bodyData : undefined,
      cache: "no-store",
      signal: controller.signal
    });

    console.info("[proxy] Upstream response", {
      requestId,
      targetHost,
      status: upstreamResponse.status
    });

    const resHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      // fetch decodes compressed upstream bodies; do not label them as gzip.
      if (!HOP_BY_HOP.has(lowerKey) && lowerKey !== "content-encoding") {
        resHeaders.set(key, value);
      }
    });
    resHeaders.set("x-request-id", upstreamResponse.headers.get("x-request-id") ?? requestId);
    resHeaders.set("cache-control", "no-store");

    const responseBody = method === "HEAD" || [204, 205, 304].includes(upstreamResponse.status)
      ? null
      : await upstreamResponse.arrayBuffer();
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
      status: controller.signal.aborted ? 504 : 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-request-id": requestId
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}
