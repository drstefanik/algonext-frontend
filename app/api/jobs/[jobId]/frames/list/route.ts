export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: {
    jobId: string;
  };
};

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  const base = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return Response.json(
      { ok: false, error: "API_BASE_URL missing" },
      { status: 500 }
    );
  }

  const { search } = new URL(request.url);
  const url = `${base}/jobs/${encodeURIComponent(params.jobId)}/frames/list${search}`;

  const upstream = await fetch(url, { cache: "no-store" });
  const text = await upstream.text();

  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" }
  });
}
