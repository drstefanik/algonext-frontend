type JsonRecord = Record<string, unknown>;

type OutcomeJob = {
  status: string;
  progress: {
    stats: {
      windowsCompleted: number | null;
      windowsTotal: number | null;
    };
  };
  result: { raw: JsonRecord } | null;
};

export type PipelineState = "active" | "finished" | "failed" | "waiting";
export type TrackingState = "failed" | "partial" | "succeeded" | "unverified";

export type AnalysisOutcome = {
  pipelineState: PipelineState;
  trackingState: TrackingState;
  metricsScope: string | null;
  metricsVisible: boolean;
  observedSamples: number;
  segmentsTotal: number | null;
  segmentsWithPlayer: number | null;
  windowsProcessed: number | null;
  windowsTotal: number | null;
  anchorsTotal: number | null;
  anchorsMatched: number | null;
  actionRequired: string | null;
  reasonCodes: string[];
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const record = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const number = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const strings = (...values: unknown[]): string[] => {
  const collected = values.flatMap((value) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
  );
  return collected
    .map((value) => value.trim())
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
};

const terminalStatuses = new Set(["COMPLETED", "PARTIAL", "DONE"]);
const activeStatuses = new Set(["QUEUED", "RUNNING", "PROCESSING"]);
const failureStatuses = new Set([
  "ANCHOR_ACQUISITION_ERROR",
  "ANCHOR_NOT_FOUND",
  "ANCHOR_REJECTED",
  "ANCHOR_TRACK_EMPTY",
  "NO_PLAYER_TRACK",
  "TEAM_COLOR_GUARD_ERROR"
]);

export const deriveAnalysisOutcome = (
  job: OutcomeJob
): AnalysisOutcome => {
  const raw = job.result?.raw ?? {};
  const tracking = record(raw.tracking);
  const declared = record(raw.analysis_outcome);
  const summary = record(tracking.reid_summary);
  const trackingQuality = record(raw.tracking_quality);
  const signals = record(raw.tracking_signals ?? trackingQuality.signals);
  const hasTrackingContract = Object.keys(tracking).length > 0;

  const observedSamples = Math.max(
    0,
    number(
      hasTrackingContract
        ? tracking.bboxes_count ?? declared.observed_samples
        : declared.observed_samples ?? signals.samples_used
    ) ?? 0
  );
  const segmentsTotal = number(
    tracking.segments_total ?? declared.segments_total
  );
  const segmentsWithPlayer = number(
    tracking.segments_with_player ?? declared.segments_with_player
  );
  const anchorsTotal = number(tracking.anchors_total ?? declared.anchors_total);
  const anchorsMatched = number(
    tracking.anchors_matched ?? declared.anchors_matched
  );
  const windowsProcessed = number(
    tracking.windows_processed ??
      declared.windows_processed ??
      job.progress.stats.windowsCompleted
  );
  const windowsTotal = number(
    declared.windows_total ??
      tracking.segments_total ??
      job.progress.stats.windowsTotal
  );
  const actionRequired = text(
    tracking.action_required ?? declared.action_required
  )?.toUpperCase() ?? null;
  const status = text(
    tracking.tracking_status ?? declared.tracking_state ?? summary.status
  )?.toUpperCase() ?? null;
  const partialReason = text(tracking.partial_reason)?.toUpperCase() ?? null;
  const trackingIncomplete =
    tracking.partial === true ||
    status === "PARTIAL_TIMEOUT" ||
    status === "TRACKING_TIMEOUT" ||
    partialReason === "PARTIAL_TIMEOUT" ||
    partialReason === "TRACKING_TIMEOUT";
  const reasonCodes = strings(
    declared.reason_codes,
    summary.reason_codes,
    raw.reason_codes,
    trackingQuality.reason_codes
  );
  const explicitlyFailed =
    tracking.tracking_success === false ||
    raw.evaluation_status === "TRACKING_FAILED" ||
    actionRequired === "RESELECT_PLAYER" ||
    (status !== null && failureStatuses.has(status));
  const completedWithoutPlayer =
    !activeStatuses.has(job.status) &&
    hasTrackingContract &&
    !trackingIncomplete &&
    observedSamples === 0 &&
    ((segmentsTotal !== null && segmentsTotal > 0 && segmentsWithPlayer === 0) ||
      (anchorsTotal !== null && anchorsTotal > 0 && anchorsMatched === 0));

  let trackingState: TrackingState = "unverified";
  if (explicitlyFailed || completedWithoutPlayer) {
    trackingState = "failed";
  } else if (trackingIncomplete) {
    trackingState = "partial";
  } else if (
    tracking.tracking_success === true ||
    observedSamples > 0 ||
    (segmentsWithPlayer !== null && segmentsWithPlayer > 0)
  ) {
    trackingState = job.status === "PARTIAL" ? "partial" : "succeeded";
  }

  const pipelineState: PipelineState =
    job.status === "FAILED"
      ? "failed"
      : terminalStatuses.has(job.status)
        ? "finished"
        : activeStatuses.has(job.status)
          ? "active"
          : "waiting";
  const metricsScope =
    text(tracking.metrics_scope ?? declared.metrics_scope) ?? null;

  return {
    pipelineState,
    trackingState,
    metricsScope,
    metricsVisible:
      trackingState !== "failed" &&
      observedSamples > 0 &&
      metricsScope === "selected_player",
    observedSamples,
    segmentsTotal,
    segmentsWithPlayer,
    windowsProcessed,
    windowsTotal,
    anchorsTotal,
    anchorsMatched,
    actionRequired,
    reasonCodes
  };
};
