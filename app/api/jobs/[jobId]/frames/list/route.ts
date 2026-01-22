import { NextResponse } from "next/server";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await ctx.params;

  const API_BASE_URL = mustEnv("API_BASE_URL");
  const targetUrl = `${API_BASE_URL.replace(/\/$/, "")}/jobs/${encodeURIComponent(
    jobId
  )}/frames/list`;

  const upstream = await fetch(targetUrl, { method: "GET" });
  const text = await upstream.text();

  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store"
    }
  });
}
