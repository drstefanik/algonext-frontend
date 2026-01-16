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
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    const body = await request.text();
    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: body || undefined
    });

    const responseBody = await upstreamResponse.text();
    const contentType =
      upstreamResponse.headers.get("content-type") ?? "text/plain";

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: { "Content-Type": contentType }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: `Proxy error: ${message}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function POST(request: Request) {
  return proxyRequest(request, {
    targetUrl: `${API_ORIGIN}/jobs`
  });
}
