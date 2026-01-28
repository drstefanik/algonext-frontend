import { forward } from "@/app/api/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: {
    jobId: string;
  };
};

export async function POST(request: Request, { params }: RouteContext) {
  const base = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return Response.json(
      { ok: false, error: "API_BASE_URL missing" },
      { status: 500 }
    );
  }

  const url = `${base}/jobs/${encodeURIComponent(params.jobId)}/analyze-player`;
  return forward(request, url);
}
