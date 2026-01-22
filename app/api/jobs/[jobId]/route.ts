import { forward } from "../../proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE_URL = process.env.API_BASE_URL;

type RouteContext = {
  params: {
    jobId: string;
  };
};

async function proxyRequest(request: Request, targetUrl: string) {
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

  const response = await forward(request, targetUrl, { includeBody: false });
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-cache, no-store, must-revalidate");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");

  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  const data = (await response.json()) as Record<string, unknown>;
  const mapped = mapJobResponse(data);
  headers.set("content-type", "application/json");

  return new Response(JSON.stringify(mapped), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

type UnknownRecord = Record<string, any>;

const mapPreviewFrame = (frame: UnknownRecord) => ({
  ...frame,
  key: frame.key ?? frame.s3_key ?? frame.s3Key ?? frame.frame_key ?? frame.frameKey,
  width: frame.width ?? frame.w ?? frame.frame_width ?? frame.frameWidth,
  height: frame.height ?? frame.h ?? frame.frame_height ?? frame.frameHeight,
  timeSec: frame.time_sec ?? frame.timeSec ?? frame.t ?? frame.frame_time_sec,
  signedUrl: frame.signed_url ?? frame.signedUrl ?? frame.url
});

const mapProgress = (progress?: UnknownRecord) =>
  progress
    ? {
        ...progress,
        updatedAt: progress.updated_at ?? progress.updatedAt
      }
    : progress;

const mapSummary = (summary?: UnknownRecord) =>
  summary
    ? {
        ...summary,
        playerRole: summary.player_role ?? summary.playerRole,
        overallScore: summary.overall_score ?? summary.overallScore
      }
    : summary;

const mapAssets = (assets?: UnknownRecord) =>
  assets
    ? {
        ...assets,
        inputVideo: assets.input_video
          ? {
              ...assets.input_video,
              s3Key: assets.input_video.s3_key ?? assets.input_video.s3Key,
              signedUrl:
                assets.input_video.signed_url ?? assets.input_video.signedUrl,
              expiresIn:
                assets.input_video.expires_in ?? assets.input_video.expiresIn
            }
          : assets.inputVideo
      }
    : assets;

const mapClip = (clip: UnknownRecord) => ({
  ...clip,
  s3Key: clip.s3_key ?? clip.s3Key,
  signedUrl: clip.signed_url ?? clip.signedUrl,
  expiresIn: clip.expires_in ?? clip.expiresIn
});

const mapTargetSelection = (selection: UnknownRecord) => ({
  ...selection,
  frameTimeSec: selection.frame_time_sec ?? selection.frameTimeSec
});

const mapJobResponse = (job: UnknownRecord) => {
  const result = job.result as UnknownRecord | undefined;
  const target = job.target as UnknownRecord | undefined;
  const previewFramesSource =
    job.preview_frames ?? job.previewFrames ?? result?.preview_frames ?? result?.previewFrames;

  return {
    ok: true,
    data: {
      ...job,
      jobId: job.job_id ?? job.jobId,
      playerRef: job.player_ref ?? job.playerRef,
      createdAt: job.created_at ?? job.createdAt,
      updatedAt: job.updated_at ?? job.updatedAt,
      videoUrl: job.video_url ?? job.videoUrl,
      teamName: job.team_name ?? job.teamName,
      status: job.status ?? job.state,
      progress: mapProgress(job.progress),
      previewFrames: Array.isArray(previewFramesSource)
        ? previewFramesSource.map(mapPreviewFrame)
        : [],
      result: result
        ? {
            ...result,
            previewFrames: (result.preview_frames ?? result.previewFrames ?? []).map(
              mapPreviewFrame
            ),
            playerRef: result.player_ref ?? result.playerRef,
            summary: mapSummary(result.summary),
            assets: mapAssets(result.assets),
            clips: (result.clips ?? []).map(mapClip)
          }
        : result,
      target: target
        ? {
            ...target,
            selections: (target.selections ?? []).map(mapTargetSelection)
          }
        : target
    }
  };
};

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = context.params;
  return proxyRequest(request, `${API_BASE_URL}/jobs/${jobId}`);
}
