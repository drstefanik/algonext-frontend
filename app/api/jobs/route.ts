import { forward } from "../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL;

export async function POST(request: Request) {
  if (!API_BASE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing API_BASE_URL environment variable." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8", "cache-control": "no-store" } }
    );
  }

  return forward(request, `${API_BASE_URL}/jobs`);
}
