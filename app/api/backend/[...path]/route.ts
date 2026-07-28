import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UPSTREAM_TIMEOUT_MS = 30_000;
const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "if-none-match",
  "x-analysis-attempt-id",
  "user-agent"
]);
const FORWARDED_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-disposition",
  "etag",
  "last-modified"
]);

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const getApiBaseUrl = () => {
  const raw = process.env.API_BASE_URL?.trim();
  if (!raw) {
    throw new Error("API_BASE_URL is not configured.");
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("API_BASE_URL must use http or https.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
};

const isSingleJobRead = (request: Request, path: string[]) =>
  request.method === "GET" && path.length === 2 && path[0] === "jobs" && Boolean(path[1]);

const buildTargetUrl = (request: Request, path: string[]) => {
  const base = getApiBaseUrl();
  const safePath = path
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
  base.pathname = `${base.pathname}/${safePath}`.replace(/\/{2,}/g, "/");

  const incoming = new URL(request.url);
  base.search = incoming.search;
  if (isSingleJobRead(request, path) && !base.searchParams.has("view")) {
    base.searchParams.set("view", "full");
  }
  return base;
};

const buildRequestHeaders = (request: Request, requestId: string) => {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("x-request-id", requestId);
  return headers;
};

const buildResponseHeaders = (upstream: Response, requestId: string) => {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-request-id": upstream.headers.get("x-request-id") ?? requestId
  });
  upstream.headers.forEach((value, key) => {
    if (FORWARDED_RESPONSE_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
};

const proxy = async (request: Request, context: RouteContext) => {
  const { path } = await context.params;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const target = buildTargetUrl(request, path);
    const includeBody = request.method !== "GET" && request.method !== "HEAD";
    const body = includeBody ? await request.arrayBuffer() : undefined;
    const upstream = await fetch(target, {
      method: request.method,
      headers: buildRequestHeaders(request, requestId),
      body: includeBody && body?.byteLength ? body : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal
    });

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: buildResponseHeaders(upstream, requestId)
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.error("[backend-proxy] upstream request failed", {
      requestId,
      method: request.method,
      path: path.join("/"),
      timedOut
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
          message: timedOut
            ? "The AlgoNext API did not respond in time."
            : "The AlgoNext API is currently unavailable."
        },
        meta: { request_id: requestId }
      },
      {
        status: timedOut ? 504 : 502,
        headers: { "cache-control": "no-store", "x-request-id": requestId }
      }
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
