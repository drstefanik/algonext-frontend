import { forward } from "../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL;

export async function POST(request: Request) {
  try {
    if (!API_BASE_URL) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing API_BASE_URL environment variable." }),
        { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } }
      );
    }

    return forward(request, `${API_BASE_URL}/jobs`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: `Route error: ${msg}` }), {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
