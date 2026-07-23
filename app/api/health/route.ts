import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const check = async (path: string, signal: AbortSignal) => {
  const base = process.env.API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("API_BASE_URL is not configured.");
  return fetch(`${base}${path}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal
  });
};

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    let upstream = await check("/ready", controller.signal);
    if (upstream.status === 404) upstream = await check("/health", controller.signal);
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(
      {
        ok: upstream.ok,
        frontend: "ready",
        backend: body
      },
      {
        status: upstream.ok ? 200 : 503,
        headers: { "cache-control": "no-store" }
      }
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        ok: false,
        frontend: "ready",
        backend: {
          status: "unavailable",
          reason: timedOut ? "timeout" : "connection_failed"
        }
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" }
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}
