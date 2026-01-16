type ForwardOptions = {
  methodOverride?: string;
  includeBody?: boolean;
};

export async function forward(
  request: Request,
  targetUrl: string,
  { methodOverride, includeBody = true }: ForwardOptions = {}
) {
  try {
    const headers = new Headers();
    const reqContentType = request.headers.get("content-type");
    if (reqContentType) {
      headers.set("content-type", reqContentType);
    }

    const body = includeBody ? await request.text() : undefined;
    const upstreamResponse = await fetch(targetUrl, {
      method: methodOverride ?? request.method,
      headers,
      body: body && includeBody ? body : undefined
    });

    const responseBody = await upstreamResponse.text();
    const upstreamContentType =
      upstreamResponse.headers.get("content-type") ?? "text/plain";

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "content-type": upstreamContentType,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: `Proxy error: ${message}` }), {
      status: 502,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      }
    });
  }
}
