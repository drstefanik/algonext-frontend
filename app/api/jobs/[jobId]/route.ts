const API_ORIGIN = process.env.API_ORIGIN;

type RouteContext = {
  params: {
    jobId: string;
  };
};

async function proxyRequest(request: Request, targetUrl: string) {
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
    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers
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

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  return proxyRequest(request, `${API_ORIGIN}/jobs/${jobId}`);
}
