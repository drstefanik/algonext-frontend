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
  "content-length",
]);

type UpstreamErrorResponse = {
  error?: { code?: string; message?: string } | string;
  detail?: { error?: { code?: string; message?: string } } | string;
  message?: string;
  code?: string;
  meta?: { request_id?: string };
  request_id?: string;
};

const extractUpstreamMessage = (data: UpstreamErrorResponse | undefined, fallback: string) => {
  if (!data) {
    return fallback;
  }

  if (typeof data.error === "string") {
    return data.error;
  }

  if (typeof data.error?.message === "string") {
    return data.error.message;
  }

  if (typeof data.detail === "string") {
    return data.detail;
  }

  if (typeof data.detail?.error?.message === "string") {
    return data.detail.error.message;
  }

  if (typeof data.message === "string") {
    return data.message;
  }

  return fallback;
};

const extractUpstreamCode = (data: UpstreamErrorResponse | undefined) => {
  if (!data) {
    return undefined;
  }

  if (typeof data.error !== "string" && typeof data.error?.code === "string") {
    return data.error.code;
  }

  if (typeof data.detail !== "string" && typeof data.detail?.error?.code === "string") {
    return data.detail.error.code;
  }

  if (typeof data.code === "string") {
    return data.code;
  }

  return undefined;
};

const extractRequestId = (
  data: UpstreamErrorResponse | undefined,
  upstreamResponse: Response
) =>
  data?.meta?.request_id ??
  data?.request_id ??
  upstreamResponse.headers.get("x-request-id") ??
  undefined;

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
      // @ts-expect-error Next.js extended fetch options
      next: { revalidate: 0 },
    });

    const upstreamContentType =
      upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8";
    const responseBody = await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      let parsedData: UpstreamErrorResponse | undefined;

      try {
        parsedData = JSON.parse(responseBody) as UpstreamErrorResponse;
      } catch {
        parsedData = undefined;
      }

      const message =
        extractUpstreamMessage(parsedData, responseBody?.trim() || "Request failed");
      const code = extractUpstreamCode(parsedData) ?? "HTTP_ERROR";
      const requestId = extractRequestId(parsedData, upstreamResponse);

      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code,
            message,
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
          },
        }),
        {
          status: upstreamResponse.status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        }
      );
    }

    const resHeaders = new Headers(upstreamResponse.headers);
    resHeaders.set("content-type", upstreamContentType);
    resHeaders.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    resHeaders.set("pragma", "no-cache");
    resHeaders.set("expires", "0");

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: resHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "PROXY_ERROR", message: `Proxy error: ${message}` },
        meta: { request_id: undefined, timestamp: new Date().toISOString() },
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    );
  }
}
