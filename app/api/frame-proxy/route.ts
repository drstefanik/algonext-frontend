export const runtime = "nodejs";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
const ALLOWED_FRAME_URL_PREFIX = "https://s3.nextgroupintl.com/";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response(JSON.stringify({ ok: false, error: "Missing url" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!url.startsWith(ALLOWED_FRAME_URL_PREFIX)) {
    return new Response(
      JSON.stringify({ ok: false, error: "INVALID_FRAME_URL_LEGACY" }),
      {
        status: 400,
        headers: jsonHeaders
      }
    );
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid url" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!target.toString().startsWith(ALLOWED_FRAME_URL_PREFIX)) {
    return new Response(
      JSON.stringify({ ok: false, error: "INVALID_FRAME_URL_LEGACY" }),
      {
        status: 400,
        headers: jsonHeaders
      }
    );
  }

  const passthroughHeaders = new Headers();
  const passthroughHeaderNames = [
    "accept",
    "accept-encoding",
    "accept-language",
    "if-modified-since",
    "if-none-match",
    "range",
    "user-agent"
  ];
  for (const name of passthroughHeaderNames) {
    const value = request.headers.get(name);
    if (value) {
      passthroughHeaders.set(name, value);
    }
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      cache: "no-store",
      headers: passthroughHeaders
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(
        JSON.stringify({ ok: false, error: "Upstream fetch failed" }),
        {
          status: 502,
          headers: jsonHeaders
        }
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 502,
      headers: jsonHeaders
    });
  }
}
