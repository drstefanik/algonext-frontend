const ALLOWED_FRAME_HOST = "46.224.249.136:9000";

const jsonHeaders = {
  "Content-Type": "application/json",
  "cache-control": "no-store"
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response(JSON.stringify({ ok: false, error: "Missing url" }), {
      status: 400,
      headers: jsonHeaders
    });
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

  if (target.host !== ALLOWED_FRAME_HOST) {
    return new Response(JSON.stringify({ ok: false, error: "Host not allowed" }), {
      status: 403,
      headers: jsonHeaders
    });
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      cache: "no-store"
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

    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") ?? "image/jpeg");
    headers.set("cache-control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 502,
      headers: jsonHeaders
    });
  }
}
