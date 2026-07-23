import { forward } from "@/app/api/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{
    jobId: string;
    filename: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const resolvedParams = await params;
  const base = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return new Response("API_BASE_URL missing", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  const jobId = encodeURIComponent(resolvedParams.jobId);
  const filename = encodeURIComponent(resolvedParams.filename);
  const url = `${base}/jobs/${jobId}/candidates/${filename}`;

  return forward(request, url, {
    methodOverride: "GET",
    includeBody: false
  });
}
