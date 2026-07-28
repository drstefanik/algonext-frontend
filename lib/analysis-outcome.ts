type JsonRecord = Record<string, unknown>;

type OutcomeJob = {
  status: string;
  target?: JsonRecord | null;
  progress: {
    analysisAttemptId?: unknown;
    analysis_attempt_id?: unknown;
    analysisAttemptIds?: unknown;
    stats: {
      windowsCompleted: number | null;
      windowsTotal: number | null;
    };
  };
  result: { raw: JsonRecord } | null;
};

export type PipelineState = "active" | "finished" | "failed" | "waiting";
export type TrackingState = "failed" | "partial" | "succeeded" | "unverified";
export type TrackingFailureKind =
  | "technical"
  | "anchor_missing"
  | "anchor_rejected"
  | "autonomous_unproven"
  | "unknown";

export type AnalysisOutcome = {
  analysisAttemptId: string | null;
  analysisAttemptMismatch: boolean;
  pipelineState: PipelineState;
  trackingState: TrackingState;
  trackingStatus: string | null;
  trackingFailureKind: TrackingFailureKind | null;
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

const attemptCopy = (...values: unknown[]) => {
  const ids = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => text(value)?.toLowerCase() ?? null)
    .filter((value): value is string => value !== null)
    .filter((value, index, all) => all.indexOf(value) === index);
  return {
    id: ids[0] ?? null,
    conflict: ids.length > 1
  };
};

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
const partialTrackingStatuses = new Set([
  "PARTIAL_TIMEOUT",
  "TRACKING_TIMEOUT",
  "SPARSE_CROSS_WINDOW_EVIDENCE"
]);
const technicalTrackingStatuses = new Set([
  "ANCHOR_ACQUISITION_ERROR",
  "TEAM_COLOR_GUARD_ERROR",
  "WINDOW_PROCESSING_ERROR"
]);
const failureStatuses = new Set([
  "ANCHOR_ONLY",
  "ANCHOR_NOT_FOUND",
  "ANCHOR_REJECTED",
  "ANCHOR_TRACK_EMPTY",
  "NO_PLAYER_TRACK",
  ...technicalTrackingStatuses
]);

const declaredPipelineState = (value: unknown): PipelineState | null => {
  const state = text(value)?.toUpperCase();
  if (state === "DONE" || state === "COMPLETED" || state === "FINISHED") {
    return "finished";
  }
  if (state === "FAILED" || state === "STOPPED") return "failed";
  if (state === "RUNNING" || state === "ACTIVE" || state === "INCOMPLETE") {
    return "active";
  }
  if (state === "WAITING") return "waiting";
  return null;
};

const includesReason = (reasonCodes: string[], ...codes: string[]) => {
  const expected = new Set(codes);
  return reasonCodes.some((code) => expected.has(code.toUpperCase()));
};

const trackingFailureKind = ({
  actionRequired,
  anchorsMatched,
  reasonCodes,
  status
}: {
  actionRequired: string | null;
  anchorsMatched: number | null;
  reasonCodes: string[];
  status: string | null;
}): TrackingFailureKind => {
  if (
    actionRequired === "RETRY_ANALYSIS" ||
    (status !== null && technicalTrackingStatuses.has(status)) ||
    reasonCodes.some((code) => {
      const normalized = code.toUpperCase();
      return (
        normalized.includes("ACQUISITION_ERROR") ||
        normalized.includes("PROCESSING_ERROR") ||
        normalized.includes("PROCESSING_FAILED") ||
        normalized === "TEAM_COLOR_GUARD_ERROR"
      );
    })
  ) {
    return "technical";
  }
  if (
    status === "ANCHOR_REJECTED" ||
    includesReason(
      reasonCodes,
      "ANCHOR_REJECTED",
      "ANCHOR_TRACK_COLOR_UNVERIFIED",
      "REID_ANCHOR_REJECTED"
    )
  ) {
    return "anchor_rejected";
  }
  if (
    status === "ANCHOR_ONLY" ||
    includesReason(reasonCodes, "AUTONOMOUS_REID_NOT_PROVEN")
  ) {
    return "autonomous_unproven";
  }
  if (
    status === "ANCHOR_NOT_FOUND" ||
    status === "ANCHOR_TRACK_EMPTY" ||
    status === "NO_PLAYER_TRACK" ||
    ((anchorsMatched ?? 0) === 0 &&
      includesReason(
        reasonCodes,
        "REID_ANCHORS_NOT_FOUND",
        "REID_ALL_ANCHORS_NOT_FOUND",
        "REID_ANCHOR_TRACK_NOT_FOUND",
        "REID_ANCHOR_TRACK_EMPTY"
      ))
  ) {
    return "anchor_missing";
  }
  return "unknown";
};

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
  const target = record(job.target);
  const targetTracking = record(target.tracking);
  const progress = record(job.progress);
  const analysisAttemptSources = [
    attemptCopy(target.analysis_attempt_id, target.analysisAttemptId),
    attemptCopy(
      targetTracking.analysis_attempt_id,
      targetTracking.analysisAttemptId
    ),
    attemptCopy(
      progress.analysisAttemptIds,
      progress.analysis_attempt_id,
      progress.analysisAttemptId
    ),
    attemptCopy(raw.analysis_attempt_id, raw.analysisAttemptId),
    attemptCopy(tracking.analysis_attempt_id, tracking.analysisAttemptId),
    attemptCopy(declared.analysis_attempt_id, declared.analysisAttemptId)
  ];
  const analysisAttemptCopies = analysisAttemptSources.map(
    (source) => source.id
  );
  const analysisAttemptIds = analysisAttemptCopies.filter(
    (value): value is string => value !== null
  );
  const hasAttemptBoundEvidence =
    hasTrackingContract || Object.keys(declared).length > 0;
  const analysisAttemptMismatch =
    analysisAttemptSources.some((source) => source.conflict) ||
    (analysisAttemptIds.length > 1 &&
      new Set(analysisAttemptIds).size > 1) ||
    (analysisAttemptIds.length > 0 &&
      hasAttemptBoundEvidence &&
      analysisAttemptCopies.some((value) => value === null));

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
  const declaredActionRequired = text(
    tracking.action_required ?? declared.action_required
  )?.toUpperCase() ?? null;
  const declaredStatus = text(
    tracking.tracking_status ?? declared.tracking_state ?? summary.status
  )?.toUpperCase() ?? null;
  const actionRequired = analysisAttemptMismatch
    ? "RETRY_ANALYSIS"
    : declaredActionRequired;
  const status = analysisAttemptMismatch
    ? "ANALYSIS_ATTEMPT_MISMATCH"
    : declaredStatus;
  const declaredTrackingState =
    text(declared.tracking_state)?.toUpperCase() ?? null;
  const partialReason = text(tracking.partial_reason)?.toUpperCase() ?? null;
  const trackingIncomplete =
    tracking.partial === true ||
    (status !== null && partialTrackingStatuses.has(status)) ||
    declaredTrackingState === "INCOMPLETE" ||
    partialReason === "PARTIAL_TIMEOUT" ||
    partialReason === "TRACKING_TIMEOUT";
  const reasonCodes = strings(
    declared.reason_codes,
    summary.reason_codes,
    raw.reason_codes,
    trackingQuality.reason_codes,
    status === "SPARSE_CROSS_WINDOW_EVIDENCE" ? [status] : [],
    analysisAttemptMismatch ? ["ANALYSIS_ATTEMPT_MISMATCH"] : []
  );
  const explicitlyFailed =
    analysisAttemptMismatch ||
    tracking.tracking_success === false ||
    declaredTrackingState === "FAILED" ||
    raw.evaluation_status === "TRACKING_FAILED" ||
    actionRequired === "RESELECT_PLAYER" ||
    (status !== null && failureStatuses.has(status));
  const trackingAttested =
    !analysisAttemptMismatch &&
    (tracking.tracking_success === true ||
      declaredTrackingState === "SUCCEEDED");
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
  } else if (trackingAttested) {
    trackingState = "succeeded";
  }

  const pipelineState: PipelineState = analysisAttemptMismatch
    ? "failed"
    : job.status === "FAILED"
    ? "failed"
    : declaredPipelineState(declared.pipeline_state) ??
      (terminalStatuses.has(job.status)
        ? "finished"
        : activeStatuses.has(job.status)
          ? "active"
          : "waiting");
  const metricsScope =
    text(tracking.metrics_scope ?? declared.metrics_scope) ?? null;
  const failureKind =
    trackingState === "failed"
      ? trackingFailureKind({
          actionRequired,
          anchorsMatched,
          reasonCodes,
          status
        })
      : null;

  return {
    analysisAttemptId: analysisAttemptSources[0].conflict
      ? null
      : analysisAttemptSources[0].id,
    analysisAttemptMismatch,
    pipelineState,
    trackingState,
    trackingStatus: status,
    trackingFailureKind: failureKind,
    metricsScope: analysisAttemptMismatch ? null : metricsScope,
    metricsVisible:
      !analysisAttemptMismatch &&
      trackingState !== "failed" &&
      trackingAttested &&
      observedSamples > 0 &&
      metricsScope === "selected_player",
    observedSamples: analysisAttemptMismatch ? 0 : observedSamples,
    segmentsTotal: analysisAttemptMismatch ? null : segmentsTotal,
    segmentsWithPlayer: analysisAttemptMismatch ? null : segmentsWithPlayer,
    windowsProcessed: analysisAttemptMismatch ? null : windowsProcessed,
    windowsTotal: analysisAttemptMismatch ? null : windowsTotal,
    anchorsTotal: analysisAttemptMismatch ? null : anchorsTotal,
    anchorsMatched: analysisAttemptMismatch ? null : anchorsMatched,
    actionRequired,
    reasonCodes
  };
};
