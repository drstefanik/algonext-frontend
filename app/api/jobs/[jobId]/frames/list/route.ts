import { forward } from "@/app/api/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: {
    jobId: string;
  };
};

export async function GET(request: Request, { params }: RouteContext) {
  const base = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return Response.json(
      { ok: false, error: "API_BASE_URL missing" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const count = searchParams.get("count") ?? "8";
  const url = `${base}/jobs/${encodeURIComponent(params.jobId)}/frames?count=${encodeURIComponent(
    count
  )}`;

  return forward(request, url, { methodOverride: "GET", includeBody: false });
}
