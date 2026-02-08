"use client";

import { useState } from "react";

import { resolveJobId, type JobResponse } from "@/lib/api";
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
  const matchRating10 =
    resolveMetricValue(result as Record<string, unknown> | null, [
      "match_rating_10"
    ]) ?? resolveMetricValue(summaryRecord, ["match_rating_10"]);
  const impact100 =
    resolveMetricValue(result as Record<string, unknown> | null, [
      "impact_100"
    ]) ?? resolveMetricValue(summaryRecord, ["impact_100"]);
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
  const clips = job?.assets?.clips ?? [];
  const resolvedClips =
    clips.length > 0
      ? clips
      : result?.assets?.clips ?? result?.clips ?? [];
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
  const { messages: warningMessages } = extractWarnings(warningPayload);
  const matchRatingUnavailable = matchRating10 == null;
  const matchRatingWarning = matchRatingUnavailable ? warningMessages[0] : null;
  const roleScoreUnavailable = roleScore == null;
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
  const [activeTab, setActiveTab] = useState<"analysis" | "ai-report">(
    "analysis"
  );
  const [aiReport, setAiReport] = useState<Record<string, any> | null>(null);
  const [aiReportStatus, setAiReportStatus] = useState<
    "idle" | "loading" | "not-ready" | "error"
  >("idle");
  const [aiReportError, setAiReportError] = useState<string | null>(null);
  const jobId = resolveJobId(job);

  const handleFetchAiReport = async (force = false) => {
    if (!jobId) {
      setAiReportStatus("error");
      setAiReportError("Job ID missing.");
      return;
    }
    setAiReportStatus("loading");
    setAiReportError(null);
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/ai-report${force ? "?force=1" : ""}`,
        { method: "POST" }
      );
      if (response.status === 409) {
        setAiReportStatus("not-ready");
        return;
      }
      if (!response.ok) {
        const message = await response.text();
        setAiReportStatus("error");
        setAiReportError(message || "Unable to generate report.");
        return;
      }
      const payload = (await response.json()) as Record<string, any>;
      setAiReport(payload);
      setAiReportStatus("idle");
    } catch (error) {
      setAiReportStatus("error");
      setAiReportError(
        error instanceof Error ? error.message : "Unable to generate report."
      );
    }
  };

  const renderBulletList = (items: unknown) => {
    if (Array.isArray(items) && items.length > 0) {
      return (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-200">
          {items.map((item, index) => (
            <li key={`${index}-${String(item).slice(0, 16)}`}>
              {typeof item === "string" ? item : JSON.stringify(item)}
            </li>
          ))}
        </ul>
      );
    }
    if (typeof items === "string" && items.trim().length > 0) {
      return <p className="mt-2 text-sm text-slate-200">{items}</p>;
    }
    return <p className="mt-2 text-sm text-slate-400">Not available.</p>;
  };

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap gap-2">
        {(["analysis", "ai-report"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
              activeTab === tab
                ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
                : "border-slate-800 text-slate-300 hover:border-slate-600"
            }`}
          >
            {tab === "analysis" ? "Analysis" : "AI Scout Report"}
          </button>
        ))}
      </div>

      {activeTab === "analysis" ? (
        <>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="text-lg font-semibold text-white">Valutazione</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  Match rating
                </p>
                {matchRatingUnavailable ? (
                  <>
                    <p className="mt-2 text-lg font-semibold text-slate-200">
                      Rating pending
                    </p>
                    {matchRatingWarning ? (
                      <p className="mt-2 text-xs text-amber-200">
                        {matchRatingWarning}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-3xl font-semibold text-emerald-400">
                      {typeof matchRating10 === "number"
                        ? formatScore(matchRating10)
                        : matchRating10}
                    </p>
                    {impact100 == null ? null : (
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                        Impact 100 ·{" "}
                        {typeof impact100 === "number"
                          ? formatScore(impact100)
                          : impact100}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  Role score (legacy)
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
                    <p className="mt-2 text-xl font-semibold text-white">
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
                  <p className="mt-2 text-slate-400">
                    Tracking JSON available soon.
                  </p>
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
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h4 className="text-lg font-semibold text-white">Key moments</h4>
            {resolvedClips.length === 0 ? (
              <p className="mt-2 text-slate-400">
                No key moments available yet.
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {resolvedClips.map((clip, index) => {
                  const clipLabel = clip?.label ?? `Clip ${index + 1}`;
                  const clipUrl = clip?.url ?? clip?.signedUrl ?? null;
                  const clipType =
                    (clip as { type?: string } | null | undefined)?.type ?? "clip";
                  return (
                    <li
                      key={`${clipUrl ?? clipLabel}-${index}`}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                            {clipLabel}
                          </p>
                          <span className="mt-2 inline-flex rounded-full border border-slate-700 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-200">
                            {String(clipType).replace(/_/g, " ")}
                          </span>
                        </div>
                        {clipUrl ? (
                          <a
                            href={clipUrl}
                            className="rounded-full border border-emerald-400/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 hover:border-emerald-300"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open clip
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">
                            Clip link unavailable.
                          </span>
                        )}
                      </div>
                      {clipUrl ? (
                        <video
                          className="mt-3 w-full rounded-lg border border-slate-800"
                          controls
                          src={clipUrl}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
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
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">AI Scout Report</h3>
            <button
              type="button"
              onClick={() => handleFetchAiReport(Boolean(aiReport))}
              className="rounded-full border border-emerald-400/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 hover:border-emerald-300"
            >
              {aiReport ? "Refresh report" : "Generate report"}
            </button>
          </div>

          {aiReportStatus === "loading" ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
              <span>Generating report...</span>
            </div>
          ) : null}

          {aiReportStatus === "not-ready" ? (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
              <p>Job not ready for report yet.</p>
              <button
                type="button"
                onClick={() => handleFetchAiReport(true)}
                className="mt-3 rounded-full border border-amber-400/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100 hover:border-amber-300"
              >
                Retry
              </button>
            </div>
          ) : null}

          {aiReportStatus === "error" ? (
            <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
              {aiReportError ?? "Unable to generate report."}
            </div>
          ) : null}

          {aiReport ? (
            <div className="mt-5 space-y-5 text-sm text-slate-200">
              {aiReport.headline ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Headline
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {aiReport.headline}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Summary
                </p>
                {renderBulletList(
                  aiReport.summary_bullets ?? aiReport.summary ?? aiReport.summaryBullets
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Strengths
                  </p>
                  {renderBulletList(aiReport.strengths)}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Risks
                  </p>
                  {renderBulletList(aiReport.risks)}
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Key moments
                </p>
                <ul className="mt-3 space-y-2">
                  {(Array.isArray(aiReport.key_moments)
                    ? aiReport.key_moments
                    : Array.isArray(aiReport.keyMoments)
                      ? aiReport.keyMoments
                      : []
                  ).length > 0 ? (
                    (Array.isArray(aiReport.key_moments)
                      ? aiReport.key_moments
                      : Array.isArray(aiReport.keyMoments)
                        ? aiReport.keyMoments
                        : []
                    ).map((moment: any, index: number) => {
                      const label =
                        typeof moment === "string"
                          ? moment
                          : moment?.label ?? moment?.title ?? `Moment ${index + 1}`;
                      const url =
                        typeof moment === "string"
                          ? null
                          : moment?.clip_url ??
                            moment?.clipUrl ??
                            moment?.url ??
                            null;
                      return (
                        <li
                          key={`${label}-${index}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                        >
                          <span className="text-sm text-slate-200">{label}</span>
                          {url ? (
                            <a
                              href={url}
                              className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 hover:text-emerald-100"
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open clip
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">
                              Clip unavailable
                            </span>
                          )}
                        </li>
                      );
                    })
                  ) : (
                    <li className="text-sm text-slate-400">
                      No key moments available yet.
                    </li>
                  )}
                </ul>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Training plan (14 days)
                </p>
                {renderBulletList(
                  aiReport.training_plan_14d ?? aiReport.trainingPlan14d
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Limitations
                  </p>
                  {renderBulletList(aiReport.limitations)}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Confidence
                  </p>
                  {renderBulletList(aiReport.confidence)}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              Generate a report to see the AI scouting insights.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
