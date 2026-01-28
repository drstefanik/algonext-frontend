type ForwardOptions = {
  methodOverride?: string;
  includeBody?: boolean;
};

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
  try {
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (!HOP_BY_HOP.has(k)) headers.set(key, value);
    });

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

    if (!upstreamResponse.ok) {
      console.error("[proxy] Upstream error", {
        status: upstreamResponse.status,
        body: responseBody
      });
    }

    const resHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!HOP_BY_HOP.has(lowerKey) && PASSTHROUGH_HEADERS.has(lowerKey)) {
        resHeaders.set(key, value);
      }
    });

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: resHeaders
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[proxy] Upstream fetch failed", {
      targetUrl,
      message
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "UPSTREAM_FETCH_FAILED",
          message,
          targetUrl
        }
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }
      }
    );
  }
}
