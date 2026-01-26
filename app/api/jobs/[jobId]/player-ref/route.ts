import { forward } from "../../../proxy";

const API_BASE_URL = process.env.API_BASE_URL;

type RouteContext = {
  params: {
    jobId: string;
  };
};

async function proxyRequest(request: Request, targetUrl: string, jobId: string) {
  if (!API_BASE_URL) {
    return new Response(
      JSON.stringify({ error: "Missing API_BASE_URL environment variable." }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "cache-control": "no-store"
        }
      }
    );
  }

  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length");
  console.info("[player-ref] forward:start", {
    jobId,
    targetUrl,
    "content-type": contentType,
    "content-length": contentLength
  });

  try {
    const response = await forward(request, targetUrl, { methodOverride: "POST" });
    const responseText = await response.clone().text();
    console.info("[player-ref] forward:response", {
      status: response.status,
      bodyPreview: responseText.slice(0, 300)
    });
    return response;
  } catch (error) {
    if (error instanceof Error) {
      console.error("[player-ref] forward:error", error.stack ?? error.message);
      return new Response(
        JSON.stringify({ message: error.message, targetUrl }),
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
          }
        }
      );
    }

    console.error("[player-ref] forward:error", error);
    return new Response(JSON.stringify({ message: "Unknown error", targetUrl }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  return proxyRequest(request, `${API_BASE_URL}/jobs/${jobId}/player-ref`, jobId);
}
