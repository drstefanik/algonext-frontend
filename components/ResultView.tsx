import type { JobResponse } from "@/lib/api";
import { extractWarnings } from "@/lib/warnings";

const formatScore = (value?: number) => {
  if (value === undefined || value === null) {
    return "—";
  }
  return value.toFixed(1);
};

export default function ResultView({ job }: { job: JobResponse }) {
  const summary = job.result?.summary;
  const radarEntries = Object.entries(job.result?.radar ?? {});
  const expectedRadarKeys = Array.isArray(job.result?.radarExpected)
    ? job.result?.radarExpected
    : Array.isArray(job.result?.radar_expected)
      ? job.result?.radar_expected
      : Array.isArray(job.result?.radarKeys)
        ? job.result?.radarKeys
        : Array.isArray(job.result?.radar_keys)
          ? job.result?.radar_keys
          : null;
  const isRadarPartial =
    Array.isArray(expectedRadarKeys) &&
    expectedRadarKeys.length > 0 &&
    radarEntries.length > 0 &&
    radarEntries.length < expectedRadarKeys.length;
  const clips = job.result?.clips ?? job.result?.assets?.clips ?? [];
  const inputVideoUrl =
    job.result?.assets?.inputVideoUrl ??
    job.result?.assets?.input_video_url ??
    job.result?.assets?.inputVideo?.signedUrl ??
    job.result?.assets?.input_video?.signedUrl ??
    null;
  const warningPayload =
    job.result?.warnings ??
    job.warnings ??
    (job as { data?: { warnings?: unknown[] } }).data?.warnings ??
    null;
  const { messages: warningMessages, codes: warningCodes } =
    extractWarnings(warningPayload);
  const overallScoreUnavailable = summary?.overallScore == null;
  const overallWarning = overallScoreUnavailable ? warningMessages[0] : null;
  const roleUnavailable = !summary?.playerRole;
  const clipExtractionFailed = warningCodes.includes("CLIP_EXTRACTION_FAILED");

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-lg font-semibold text-white">Result Summary</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              Overall Score
            </p>
            {overallScoreUnavailable ? (
              <>
                <p className="mt-2 text-lg font-semibold text-slate-200">
                  Overall score unavailable
                </p>
                {overallWarning ? (
                  <p className="mt-2 text-xs text-amber-200">{overallWarning}</p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-3xl font-semibold text-emerald-400">
                {formatScore(summary?.overallScore)}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              Role
            </p>
            {roleUnavailable ? (
              <>
                <p className="mt-2 text-sm font-semibold text-slate-200">
                  Unavailable
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Role information not provided.
                </p>
              </>
            ) : (
              <p className="mt-2 text-xl font-semibold text-white">
                {summary?.playerRole}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-lg font-semibold text-white">Radar Breakdown</h4>
          {isRadarPartial ? (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-amber-200">
              partial radar
            </span>
          ) : null}
        </div>
        {radarEntries.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            Radar data not available.
          </p>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {radarEntries.map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-slate-800 bg-slate-950 p-3"
              >
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {label}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-slate-100">
                  {value == null ? "Unavailable" : formatScore(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h4 className="text-lg font-semibold text-white">Assets</h4>
        <div className="mt-3 space-y-4 text-sm text-slate-300">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Input Video
            </p>
            {inputVideoUrl ? (
              <a
                href={inputVideoUrl}
                className="mt-2 inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300"
                target="_blank"
                rel="noreferrer"
              >
                Open input video
              </a>
            ) : (
              <p className="mt-2 text-slate-400">
                Input video not available for this job.
              </p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Clips
            </p>
            {clips.length === 0 ? (
              <p className="mt-2 text-slate-400">
                {clipExtractionFailed
                  ? "Clip extraction failed."
                  : "Clips unavailable for this analysis."}
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {clips.map((clip, index) => (
                  <li
                    key={`${clip.signedUrl ?? "clip"}-${index}`}
                    className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950 p-3"
                  >
                    <span className="text-xs text-slate-500">
                      {clip.start ?? "?"}s - {clip.end ?? "?"}s
                    </span>
                    {clip.signedUrl ? (
                      <a
                        href={clip.signedUrl}
                        className="text-emerald-400 hover:text-emerald-300"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open clip
                      </a>
                    ) : (
                      <span className="text-slate-400">
                        Clip link unavailable.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
