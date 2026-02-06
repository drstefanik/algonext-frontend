import type { JobResponse } from "@/lib/api";
import { extractWarnings } from "@/lib/warnings";

const formatScore = (value?: number) => {
  if (value === undefined || value === null) {
    return "—";
  }
  return value.toFixed(1);
};

const resolveStringField = (...values: Array<unknown>) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
};

const resolveMetricValue = (source: Record<string, unknown> | null, keys: string[]) => {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
  }
  return null;
};

export default function ResultView({ job }: { job: JobResponse }) {
  const result = job.result ?? null;
  const summary = result?.summary ?? null;
  const summaryRecord = summary as Record<string, unknown> | null;
  const overallScore = result?.overallScore ?? summary?.overallScore ?? null;
  const roleScore =
    result?.roleScore ??
    (summaryRecord?.roleScore as number | null | undefined) ??
    null;
  const playerRole = result?.playerRole ?? summary?.playerRole ?? null;
  const radarEntries = Object.entries(result?.radar ?? {});
  const expectedRadarKeys = Array.isArray(result?.radarExpected)
    ? result?.radarExpected
    : Array.isArray(result?.radar_expected)
      ? result?.radar_expected
      : Array.isArray(result?.radarKeys)
        ? result?.radarKeys
        : Array.isArray(result?.radar_keys)
          ? result?.radar_keys
          : null;
  const isRadarPartial =
    Array.isArray(expectedRadarKeys) &&
    expectedRadarKeys.length > 0 &&
    radarEntries.length > 0 &&
    radarEntries.length < expectedRadarKeys.length;
  const clips = result?.clips ?? result?.assets?.clips ?? [];
  const inputVideoUrl =
    result?.assets?.inputVideoUrl ??
    result?.assets?.input_video_url ??
    result?.assets?.inputVideo?.signedUrl ??
    result?.assets?.input_video?.signedUrl ??
    null;
  const warningPayload =
    result?.warnings ??
    job.warnings ??
    (job as { data?: { warnings?: unknown[] } }).data?.warnings ??
    null;
  const { messages: warningMessages, codes: warningCodes } =
    extractWarnings(warningPayload);
  const overallScoreUnavailable = overallScore == null;
  const overallWarning = overallScoreUnavailable ? warningMessages[0] : null;
  const roleScoreUnavailable = roleScore == null;
  const clipExtractionFailed = warningCodes.includes("CLIP_EXTRACTION_FAILED");
  const scoreExplanation =
    resolveStringField(
      result?.scoreExplanation,
      result?.score_explanation,
      result?.score_detail,
      result?.scoreDetail,
      result?.explanation,
      summaryRecord?.scoreExplanation,
      summaryRecord?.score_explanation
    ) ??
    "Tracking + eventi + normalizzazione per ruolo + pesi.";
  const metricsSource =
    (result?.metrics as Record<string, unknown> | undefined) ??
    (result?.raw_metrics as Record<string, unknown> | undefined) ??
    (result?.rawMetrics as Record<string, unknown> | undefined) ??
    (result?.evidence as Record<string, unknown> | undefined) ??
    null;
  const evidenceMetrics = [
    {
      label: "Distance covered",
      value: resolveMetricValue(metricsSource, [
        "distance_covered",
        "distanceCovered",
        "distance",
        "distance_km",
        "distanceKm"
      ])
    },
    {
      label: "Top speed",
      value: resolveMetricValue(metricsSource, [
        "top_speed",
        "topSpeed",
        "max_speed",
        "maxSpeed"
      ])
    },
    {
      label: "Successful actions",
      value: resolveMetricValue(metricsSource, [
        "successful_actions",
        "successfulActions",
        "success_count",
        "successCount"
      ])
    }
  ].filter((metric) => metric.value !== null);
  const trackingUrl =
    resolveStringField(
      result?.trackingJsonUrl,
      result?.tracking_json_url,
      (result?.assets as { trackingJsonUrl?: string })?.trackingJsonUrl,
      (result?.assets as { tracking_json_url?: string })?.tracking_json_url,
      (result?.assets as { tracking_url?: string })?.tracking_url
    ) ?? null;

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-lg font-semibold text-white">Valutazione</h3>
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
                {formatScore(overallScore)}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              Role score
            </p>
            {roleScoreUnavailable ? (
              <>
                <p className="mt-2 text-sm font-semibold text-slate-200">
                  Role score unavailable
                </p>
                {playerRole ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Role: {playerRole}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {formatScore(roleScore)}
                </p>
                {playerRole ? (
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                    {playerRole}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-lg font-semibold text-white">Radar</h4>
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
        <h4 className="text-lg font-semibold text-white">
          How this score is computed
        </h4>
        <p className="mt-2 text-sm text-slate-300">{scoreExplanation}</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h4 className="text-lg font-semibold text-white">Evidence</h4>
        <div className="mt-3 space-y-4 text-sm text-slate-300">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Tracking data
            </p>
            {trackingUrl ? (
              <a
                href={trackingUrl}
                className="mt-2 inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300"
                target="_blank"
                rel="noreferrer"
              >
                Download tracking.json
              </a>
            ) : (
              <p className="mt-2 text-slate-400">Tracking JSON available soon.</p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Metrics
            </p>
            {evidenceMetrics.length > 0 ? (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {evidenceMetrics.map((metric) => (
                  <li
                    key={metric.label}
                    className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      {metric.label}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-100">
                      {typeof metric.value === "number"
                        ? formatScore(metric.value)
                        : metric.value}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-400">Metrics available soon.</p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Clips & assets
            </p>
            {clips.length === 0 ? (
              <p className="mt-2 text-slate-400">
                {clipExtractionFailed
                  ? "Clip extraction failed."
                  : "Clips unavailable for this analysis."}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {clips.map((clip, index) => (
                  <li key={`${clip.signedUrl ?? "clip"}-${index}`}>
                    {clip.signedUrl ? (
                      <a
                        href={clip.signedUrl}
                        className="text-emerald-400 hover:text-emerald-300"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Clip {index + 1} ({clip.start ?? "?"}s-{clip.end ?? "?"}s)
                      </a>
                    ) : (
                      <span className="text-slate-400">Clip link unavailable.</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
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
