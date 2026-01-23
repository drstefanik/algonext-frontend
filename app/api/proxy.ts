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
      body: bodyText,
      cache: "no-store",
    });

    const upstreamContentType =
      upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8";
    const responseBody = await upstreamResponse.text();

    const resHeaders = new Headers(upstreamResponse.headers);
    resHeaders.set("content-type", upstreamContentType);
    resHeaders.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    resHeaders.set("pragma", "no-cache");
    resHeaders.set("expires", "0");

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: resHeaders
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: `Proxy error: ${message}` }),
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
