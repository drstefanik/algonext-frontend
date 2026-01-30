"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  createJob,
  enqueueJob,
  getJob,
  getJobFrames,
  getJobTrackCandidates,
  normalizeJob,
  pickJobPlayer,
  saveJobPlayerRef,
  saveJobTargetSelection,
  type FrameSelection,
  type JobResponse,
  type PreviewFrame,
  type TrackCandidate,
  type TrackCandidateSampleFrame,
  type TargetSelection
} from "@/lib/api";
import ProgressBar from "@/components/ProgressBar";
import ResultView from "@/components/ResultView";
import { extractWarnings } from "@/lib/warnings";
import OverlayFramesGallery from "@/components/OverlayFramesGallery";
import { normalizeFrameUrl } from "@/lib/frameUrl";
import {
  clampNormalized,
  coerceNumber,
  getSelectionBBox,
  getSelectionFrameKey,
  getSelectionTimeSec
} from "@/lib/selection";

const roles = ["Striker", "Winger", "Midfielder", "Defender", "Goalkeeper"];
const POLLING_TIMEOUT_MS = 12000;
const REQUIRED_FRAME_COUNT = 8;
const MIN_FRAMES = REQUIRED_FRAME_COUNT;

type ImageLoadFailure = {
  url: string;
  status: number | null;
  context: string;
  key?: string | null;
  occurredAt: string;
};

const FrameSelector = ({ children }: { children: ReactNode }) => <>{children}</>;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBboxOutOfBounds = (bbox: { x: number; y: number; w: number; h: number }) =>
  bbox.x < 0 || bbox.y < 0 || bbox.w <= 0 || bbox.h <= 0 || bbox.x + bbox.w > 1 || bbox.y + bbox.h > 1;

const isBboxTooSmallOrLarge = (bbox: { x: number; y: number; w: number; h: number }) => {
  const minSize = 0.02;
  const maxSize = 0.98;
  return bbox.w < minSize || bbox.h < minSize || bbox.w > maxSize || bbox.h > maxSize;
};

const formatFrameTime = (timeSec: number | null) =>
  timeSec === null ? "—" : `${timeSec.toFixed(2)}s`;

const formatFrameAlt = (timeSec: number | null) =>
  timeSec === null ? "Preview frame (time unknown)" : `Preview frame at ${timeSec.toFixed(2)}s`;

const formatMetric = (value: number | null | undefined, suffix = "") =>
  value === null || value === undefined
    ? "—"
    : `${value.toFixed(2)}${suffix}`;

const normalizeCandidateTier = (candidate: TrackCandidate) => {
  if (!candidate.tier) {
    return "PRIMARY";
  }
  const normalized = candidate.tier.trim().toUpperCase();
  if (normalized.includes("PRIMARY")) {
    return "PRIMARY";
  }
  if (normalized.includes("SECONDARY")) {
    return "SECONDARY";
  }
  if (normalized.includes("OTHER")) {
    return "OTHER";
  }
  return "PRIMARY";
};

const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

const formatScore = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : value.toFixed(2);

const getCandidateSelection = (candidate: TrackCandidate) => {
  const frameTimeSec = getSelectionTimeSec(candidate) ?? candidate.t ?? null;
  const bbox = getSelectionBBox(candidate);
  const { x, y, w, h } = bbox ?? {};
  if (
    frameTimeSec === null ||
    frameTimeSec === undefined ||
    x === null ||
    x === undefined ||
    y === null ||
    y === undefined ||
    w === null ||
    w === undefined ||
    h === null ||
    h === undefined
  ) {
    return null;
  }
  return { frameTimeSec, x, y, w, h };
};

const resolveCandidateBox = (
  frame: TrackCandidateSampleFrame | null,
  candidate: TrackCandidate
) => {
  const frameBox = frame ? getSelectionBBox(frame) : null;
  const candidateBox = getSelectionBBox(candidate);
  const x = frameBox?.x ?? candidateBox?.x ?? null;
  const y = frameBox?.y ?? candidateBox?.y ?? null;
  const w = frameBox?.w ?? candidateBox?.w ?? null;
  const h = frameBox?.h ?? candidateBox?.h ?? null;
  if (
    x === null ||
    x === undefined ||
    y === null ||
    y === undefined ||
    w === null ||
    w === undefined ||
    h === null ||
    h === undefined
  ) {
    return null;
  }
  return {
    x: clampNormalized(x),
    y: clampNormalized(y),
    w: clampNormalized(w),
    h: clampNormalized(h)
  };
};

const normalizeTargetSelection = (source: unknown): TargetSelection | null => {
  const timeSec = getSelectionTimeSec(source);
  const frameKey = getSelectionFrameKey(source);
  const bbox = getSelectionBBox(source);
  if (!bbox) {
    return null;
  }
  const record = source as Record<string, unknown>;
  const trackId =
    typeof record.trackId === "string"
      ? record.trackId
      : typeof record.track_id === "string"
      ? record.track_id
      : null;
  return {
    frameTimeSec: timeSec,
    frame_time_sec: timeSec,
    frameKey: frameKey ?? null,
    frame_key: frameKey ?? null,
    trackId,
    track_id: trackId,
    t: timeSec ?? null,
    x: bbox.x,
    y: bbox.y,
    w: bbox.w,
    h: bbox.h
  };
};

const buildHttpErrorMessage = async (response: Response) => {
  let message = "";
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    try {
      const rawBody = await response.clone().text();
      console.error("[jobs] Non-JSON error response", {
        status: response.status,
        body: rawBody
      });
    } catch {
      // ignore logging failures
    }
    if (response.status >= 500) {
      return `Server unavailable (${response.status}). Please retry.`;
    }
    return `Unexpected response (${response.status}).`;
  }

  try {
    const data = (await response.clone().json()) as
      | {
          error?: string | { message?: string };
          detail?: unknown;
          progress?: { message?: string };
          message?: string;
        }
      | undefined;
    if (data) {
      const detail = data.detail;
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail
          .map((item) => {
            if (typeof item === "string") {
              return item;
            }
            if (item && typeof item === "object") {
              if ("msg" in item && typeof item.msg === "string") {
                return item.msg;
              }
              if ("message" in item && typeof item.message === "string") {
                return item.message;
              }
              return JSON.stringify(item);
            }
            return String(item);
          })
          .filter(Boolean)
          .join("; ");
      }

      if (!message) {
        message =
          (typeof data.error === "object" ? data.error?.message : data.error) ??
          data.progress?.message ??
          data.message ??
          "";
      }
    }
  } catch {
    // ignore json parse errors
  }

  if (!message) {
    try {
      message = await response.text();
    } catch {
      // ignore text parse errors
    }
  }

  if (!message) {
    message = response.statusText || "Unexpected error";
  }

  return message;
};

const extractNestedErrorMessage = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }

  if ("error" in error) {
    const nestedError = (error as { error?: unknown }).error;
    if (typeof nestedError === "string") {
      return nestedError;
    }
    if (
      nestedError &&
      typeof nestedError === "object" &&
      "message" in nestedError &&
      typeof nestedError.message === "string"
    ) {
      return nestedError.message;
    }
  }

  if ("detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      const message = detail
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item === "object") {
            if ("msg" in item && typeof item.msg === "string") {
              return item.msg;
            }
            if ("message" in item && typeof item.message === "string") {
              return item.message;
            }
            return JSON.stringify(item);
          }
          return String(item);
        })
        .filter(Boolean)
        .join("; ");
      if (message) {
        return message;
      }
    }
    if (
      detail &&
      typeof detail === "object" &&
      "error" in detail &&
      detail.error &&
      typeof detail.error === "object" &&
      "message" in detail.error &&
      typeof detail.error.message === "string"
    ) {
      return detail.error.message;
    }
  }

  if ("progress" in error) {
    const progress = (error as { progress?: unknown }).progress;
    if (progress && typeof progress === "object" && "message" in progress) {
      const progressMessage = progress.message;
      if (typeof progressMessage === "string") {
        return progressMessage;
      }
    }
  }

  return null;
};

const toErrorMessage = (error: unknown) => {
  const nestedMessage = extractNestedErrorMessage(error);
  if (nestedMessage) {
    return nestedMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized ?? "Unexpected error";
  } catch {
    return "Unexpected error";
  }
};

const fetchJsonWithTimeout = async <T,>(input: RequestInfo | URL) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POLLING_TIMEOUT_MS);

  try {
    const response = await fetch(input, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      const message = await buildHttpErrorMessage(response);
      throw new Error(message);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      try {
        const rawBody = await response.text();
        console.error("[jobs] Non-JSON success response", {
          status: response.status,
          body: rawBody
        });
      } catch {
        // ignore logging failures
      }
      throw new Error("Unexpected response from server.");
    }

    return (await response.json()) as T;
  } catch (fetchError) {
    if (fetchError instanceof Error && fetchError.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw fetchError;
  } finally {
    clearTimeout(timeoutId);
  }
};

const statusStyles: Record<string, string> = {
  QUEUED: "bg-slate-800 text-slate-200",
  WAITING_FOR_SELECTION: "bg-amber-500/20 text-amber-200",
  WAITING_FOR_PLAYER: "bg-amber-500/20 text-amber-200",
  RUNNING: "bg-blue-500/20 text-blue-200",
  COMPLETED: "bg-emerald-500/20 text-emerald-200",
  PARTIAL: "bg-amber-400/20 text-amber-200",
  FAILED: "bg-rose-500/20 text-rose-200"
};

type PreviewDragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type PreviewMode = "player-ref" | "target";

type TargetAdjustMode = "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se";

type TargetAdjustState = {
  mode: TargetAdjustMode;
  startX: number;
  startY: number;
  origin: TargetSelection;
};

export default function JobRunner() {
  const [videoUrl, setVideoUrl] = useState("");
  const [role, setRole] = useState("Striker");
  const [category, setCategory] = useState("U17");
  const [shirtNumber, setShirtNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [targetSelection, setTargetSelection] = useState<TargetSelection | null>(
    null
  );
  const [draftTargetSelection, setDraftTargetSelection] =
    useState<TargetSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectionSuccess, setSelectionSuccess] = useState<string | null>(null);
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null);
  const [selectionRequestId, setSelectionRequestId] = useState<string | null>(null);
  const [targetMismatchOpen, setTargetMismatchOpen] = useState(false);
  const [targetMismatchAllowForce, setTargetMismatchAllowForce] = useState(false);
  const [playerRefError, setPlayerRefError] = useState<string | null>(null);
  const [playerCandidateError, setPlayerCandidateError] = useState<string | null>(
    null
  );
  const [polling, setPolling] = useState(false);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [savingPlayerRef, setSavingPlayerRef] = useState(false);
  const [gridMode, setGridMode] = useState<PreviewMode>("player-ref");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("player-ref");
  const [selectedPreviewFrame, setSelectedPreviewFrame] = useState<PreviewFrame | null>(
    null
  );
  const [playerRefSelection, setPlayerRefSelection] = useState<FrameSelection | null>(
    null
  );
  const [playerSaved, setPlayerSaved] = useState(false);
  const [targetSaved, setTargetSaved] = useState(false);
  const [trackCandidates, setTrackCandidates] = useState<TrackCandidate[]>([]);
  const [fallbackCandidates, setFallbackCandidates] = useState<TrackCandidate[]>(
    []
  );
  const [loadingTrackCandidates, setLoadingTrackCandidates] = useState(false);
  const [candidatePolling, setCandidatePolling] = useState(false);
  const [showSecondaryCandidates, setShowSecondaryCandidates] = useState(false);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [candidateReview, setCandidateReview] = useState<TrackCandidate | null>(
    null
  );
  const [selectingTrackId, setSelectingTrackId] = useState<string | null>(null);
  const [previewDragState, setPreviewDragState] =
    useState<PreviewDragState | null>(null);
  const [targetAdjustState, setTargetAdjustState] =
    useState<TargetAdjustState | null>(null);
  const [refreshingFrames, setRefreshingFrames] = useState(false);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [showLegacyFlow] = useState(false);
  const [overlayToast, setOverlayToast] = useState<string | null>(null);
  const [framesFrozen, setFramesFrozen] = useState(false);
  const [previewPollingError, setPreviewPollingError] = useState<string | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewImageErrors, setPreviewImageErrors] = useState<Record<string, string>>(
    {}
  );
  const [imageLoadFailures, setImageLoadFailures] = useState<ImageLoadFailure[]>(
    []
  );
  const [previewPollingActive, setPreviewPollingActive] = useState(false);
  const [previewPollingAttempt, setPreviewPollingAttempt] = useState(0);
  const frameSrcCacheRef = useRef<Map<string, string>>(new Map());
  const [, setFrameSrcCacheVersion] = useState(0);
  const previewListRequestRef = useRef(0);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const previewModalRef = useRef<HTMLDivElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const playerSectionRef = useRef<HTMLElement | null>(null);
  const analysisSectionRef = useRef<HTMLElement | null>(null);
  const pollStartRef = useRef<number | null>(null);

  const [analysisTrackId, setAnalysisTrackId] = useState<string | null>(null);
  const [analysisFrameKey, setAnalysisFrameKey] = useState<string | null>(null);
  const [analysisJob, setAnalysisJob] = useState<JobResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisPolling, setAnalysisPolling] = useState(false);
  const [analysisRequesting, setAnalysisRequesting] = useState(false);

  const resolvePreviewFrameUrl = (frame: PreviewFrame) =>
    frame.signedUrl ?? "";

  const pct = job?.progress?.pct ?? 0;
  const step = job?.progress?.step ?? "—";
  const normalizedStep =
    typeof step === "string" ? step.trim().toUpperCase() : null;
  const displayStatus = job?.status ?? "WAITING";
  const displayStatusLabelMap: Record<string, string> = {
    WAITING_FOR_PLAYER: "Select player",
    WAITING_FOR_SELECTION: "Select target",
    RUNNING: "Running",
    COMPLETED: "Completed",
    PARTIAL: "Completed (partial)",
    FAILED: "Failed"
  };
  const displayStatusLabel =
    displayStatusLabelMap[displayStatus] ?? displayStatus.toLowerCase();

  const statusClass = useMemo(() => {
    if (!displayStatus) {
      return "bg-slate-800 text-slate-200";
    }
    return statusStyles[displayStatus] ?? "bg-slate-800 text-slate-200";
  }, [displayStatus]);

  const analysisStatus = analysisJob?.status ?? null;
  const analysisProgressPct = analysisJob?.progress?.pct ?? 0;
  const analysisStep = analysisJob?.progress?.step ?? "—";
  const analysisMessage = analysisJob?.progress?.message ?? null;
  const analysisNormalizedStatus =
    typeof analysisStatus === "string" ? analysisStatus.toUpperCase() : null;
  const analysisIsFinal =
    analysisNormalizedStatus === "COMPLETED" ||
    analysisNormalizedStatus === "PARTIAL" ||
    analysisNormalizedStatus === "FAILED";
  const analysisIsRunning =
    analysisRequesting ||
    analysisPolling ||
    analysisNormalizedStatus === "RUNNING" ||
    analysisNormalizedStatus === "PROCESSING";

  const jobPreviewFrames = job?.previewFrames ?? [];
  const resolvedPreviewFrames =
    previewFrames.length > 0
      ? previewFrames.map((frame) => {
          const match = jobPreviewFrames.find(
            (jobFrame) =>
              getSelectionFrameKey(jobFrame) === getSelectionFrameKey(frame)
          );
          return match?.tracks ? { ...frame, tracks: match.tracks } : frame;
        })
      : jobPreviewFrames;
  const overlayGalleryFrames = previewFrames;
  const previewFramesWithImages = resolvedPreviewFrames.filter((frame) =>
    Boolean(resolvePreviewFrameUrl(frame))
  );
  const hasAnyPreviewFrames = resolvedPreviewFrames.length > 0;
  const hasPreviewImages = previewFramesWithImages.length > 0;
  const previewFramesMissingUrls = hasAnyPreviewFrames && !hasPreviewImages;
  const hasFullPreviewSet = resolvedPreviewFrames.length >= REQUIRED_FRAME_COUNT;
  const previewImageErrorCount = Object.keys(previewImageErrors).length;
  const hasPreviewFrameErrors =
    hasAnyPreviewFrames && previewImageErrorCount > 0;
  const playerRef = job?.playerRef ?? null;
  const jobTargetSelection = job?.target?.selections?.[0] ?? null;
  const jobTargetDraftSource =
    job?.target &&
    typeof job.target === "object" &&
    "selection" in (job.target as Record<string, unknown>)
      ? (job.target as { selection?: unknown }).selection ?? null
      : null;
  const jobTargetDraft = normalizeTargetSelection(jobTargetDraftSource);
  const hasPlayerRef = Boolean(job?.playerRef);
  const hasTarget =
    Array.isArray(job?.target?.selections) && job.target.selections.length > 0;
  const targetConfirmed = Boolean(
    job?.target &&
      typeof job.target === "object" &&
      "confirmed" in job.target &&
      (job.target as { confirmed?: boolean }).confirmed === true
  );
  const status = job?.status ?? null;
  const normalizedStatus = typeof status === "string" ? status.toUpperCase() : null;
  const isFinalStatus =
    normalizedStatus === "COMPLETED" ||
    normalizedStatus === "PARTIAL" ||
    normalizedStatus === "FAILED";
  const isFinalStep =
    normalizedStep === "COMPLETE" ||
    normalizedStep === "COMPLETED" ||
    normalizedStep === "FINISHED";
  const shouldShowResult = Boolean(job) && (isFinalStatus || isFinalStep);
  const resultMissing = shouldShowResult && !job?.result;
  const isProcessingStatus = normalizedStatus === "PROCESSING";
  const isLowCoverageStatus = normalizedStatus === "LOW_COVERAGE";
  const isCandidatesFailed = normalizedStep === "CANDIDATES_FAILED";
  const warningsPayload =
    job?.result?.warnings ??
    job?.warnings ??
    (job && typeof job === "object"
      ? (job as { data?: { warnings?: unknown[] } }).data?.warnings
      : null) ??
    null;
  const { messages: warningMessages } = extractWarnings(warningsPayload);
  const hasWarnings = warningMessages.length > 0;
  const inputVideoUrl =
    job?.result?.assets?.inputVideoUrl ??
    job?.result?.assets?.input_video_url ??
    job?.result?.assets?.inputVideo?.signedUrl ??
    job?.result?.assets?.input_video?.signedUrl ??
    (job ? (job as { inputVideoUrl?: string }).inputVideoUrl : null) ??
    (job ? (job as { video_url?: string }).video_url : null) ??
    null;
  const clipsCount =
    job?.result?.clips?.length ??
    job?.result?.assets?.clips?.length ??
    0;
  const radarKeysCount = Object.keys(job?.result?.radar ?? {}).length;
  const previewsReady = hasFullPreviewSet;
  const isTargetStepReady =
    normalizedStep === "WAITING_FOR_TARGET" || hasTarget || targetConfirmed;
  const effectiveStep: "PLAYER" | "TARGET" | "PROCESSING" | "IDLE" = !jobId
    ? "IDLE"
    : status === "RUNNING" || status === "QUEUED" || status === "PROCESSING"
      ? "PROCESSING"
      : previewsReady && !hasPlayerRef
        ? "PLAYER"
        : previewsReady && hasPlayerRef && !hasTarget
          ? "TARGET"
          : "PROCESSING";
  const rawAutodetectionStatus =
    typeof job?.autodetection_status === "string"
      ? job.autodetection_status
      : typeof job?.autodetectionStatus === "string"
        ? job.autodetectionStatus
        : typeof job?.progress?.autodetection_status === "string"
          ? job.progress.autodetection_status
          : typeof job?.progress?.autodetectionStatus === "string"
            ? job.progress.autodetectionStatus
            : null;
  const autodetectionStatus = rawAutodetectionStatus?.trim().toUpperCase() ?? null;
  const autodetectEnabled =
    autodetectionStatus !== null &&
    autodetectionStatus !== "OFF" &&
    autodetectionStatus !== "DISABLED" &&
    autodetectionStatus !== "NONE";
  const autodetectLowCoverage = autodetectionStatus === "LOW_COVERAGE";
  const rawErrorDetail =
    typeof job?.error_detail === "string"
      ? job.error_detail
      : typeof job?.errorDetail === "string"
        ? job.errorDetail
        : typeof job?.progress?.error_detail === "string"
          ? job.progress.error_detail
          : typeof job?.progress?.errorDetail === "string"
            ? job.progress.errorDetail
            : null;
  const errorDetail = rawErrorDetail?.trim() ?? null;
  const hasAutodetectErrorDetail = Boolean(errorDetail);
  const framesProcessed = coerceNumber(
    job?.progress && typeof job.progress === "object"
      ? (job.progress as Record<string, unknown>).framesProcessed ??
          (job.progress as Record<string, unknown>).frames_processed ??
          (job.progress as Record<string, unknown>).processedFrames ??
          (job.progress as Record<string, unknown>).processed_frames
      : null
  );
  const framesProcessedCount = Math.max(framesProcessed ?? 0, 0);
  const totalTracks = coerceNumber(
    job?.progress && typeof job.progress === "object"
      ? (job.progress as Record<string, unknown>).totalTracks ??
          (job.progress as Record<string, unknown>).total_tracks ??
          (job.progress as Record<string, unknown>).tracksTotal ??
          (job.progress as Record<string, unknown>).tracks_total
      : null
  );
  const totalTracksCount = Math.max(totalTracks ?? 0, 0);
  const isProcessingWithoutCandidates =
    isProcessingStatus && trackCandidates.length === 0;
  const isPreviewReadyTracking =
    isProcessingStatus && framesProcessedCount > 0 && totalTracksCount === 0;
  const playerCtaLabel = isPreviewReadyTracking
    ? "Detecting players… (preview ready, tracking running)"
    : isProcessingWithoutCandidates
      ? `Detecting players… (${framesProcessedCount} frames processed)`
      : "Select player now";
  const canShowPlayerCandidates =
    Boolean(jobId) &&
    !hasPlayerRef &&
    (previewsReady ||
      (isCandidatesFailed && hasAnyPreviewFrames) ||
      trackCandidates.length > 0 ||
      fallbackCandidates.length > 0 ||
      loadingTrackCandidates ||
      candidatePolling ||
      autodetectEnabled);
  const showPlayerSection = effectiveStep === "PLAYER" || canShowPlayerCandidates;
  const showTargetSection = effectiveStep === "TARGET" || isTargetStepReady;
  const selectionReady = previewsReady && (showPlayerSection || showTargetSection);
  const isExtractingPreviews = job?.progress?.step === "EXTRACTING_PREVIEWS";
  const isPreviewsReady = job?.progress?.step === "PREVIEWS_READY";
  const canEnqueue = hasPlayerRef && targetConfirmed;
  const enqueueHint = !canEnqueue
    ? "Seleziona player e target prima di avviare"
    : "Ready";
  const shouldPollFrames =
    Boolean(jobId) &&
    (isExtractingPreviews || isPreviewsReady || selectionReady);
  const shouldPollFrameList = shouldPollFrames && !framesFrozen;
  const frameSelectorKey = jobId ?? "frame-selector";
  const showManualPlayerFallback =
    showPlayerSection &&
    (previewsReady || isCandidatesFailed) &&
    !selectedTrackId &&
    ((isLowCoverageStatus && framesProcessedCount >= MIN_FRAMES) ||
      (autodetectLowCoverage && hasAutodetectErrorDetail) ||
      isCandidatesFailed);
  const manualFallbackMessage =
    autodetectLowCoverage && hasAutodetectErrorDetail
      ? errorDetail
      : "Autodetection coverage is low. Use the manual fallback below.";
  const canShowFrameSelector =
    (showTargetSection && previewsReady && (hasPreviewImages || previewFramesMissingUrls)) ||
    (showManualPlayerFallback &&
      ((previewsReady && (hasPreviewImages || previewFramesMissingUrls)) ||
        (isCandidatesFailed && (hasPreviewImages || previewFramesMissingUrls))));
  const isDetectingPlayers =
    (autodetectEnabled || candidatePolling) &&
    !autodetectLowCoverage &&
    !selectedTrackId &&
    trackCandidates.length === 0 &&
    !playerCandidateError;
  const { primaryCandidates, secondaryCandidates, otherCandidates } = useMemo(() => {
    return trackCandidates.reduce(
      (acc, candidate) => {
        const tier = normalizeCandidateTier(candidate);
        if (tier === "SECONDARY") {
          acc.secondaryCandidates.push(candidate);
        } else if (tier === "OTHER") {
          acc.otherCandidates.push(candidate);
        } else {
          acc.primaryCandidates.push(candidate);
        }
        return acc;
      },
      {
        primaryCandidates: [] as TrackCandidate[],
        secondaryCandidates: [] as TrackCandidate[],
        otherCandidates: [] as TrackCandidate[]
      }
    );
  }, [trackCandidates]);

  const reviewFrames =
    candidateReview?.sampleFrames?.filter((frame) => frame.imageUrl) ?? [];
  const reviewPreviewFrames: TrackCandidateSampleFrame[] =
    reviewFrames.length > 0
      ? reviewFrames.slice(0, 3)
      : candidateReview?.thumbnailUrl
        ? [
            {
              imageUrl: candidateReview.thumbnailUrl,
              x: candidateReview.x ?? null,
              y: candidateReview.y ?? null,
              w: candidateReview.w ?? null,
              h: candidateReview.h ?? null
            }
          ]
        : [];

  const showBestMatchMessage =
    totalTracksCount > 0 && trackCandidates.length === 0 && !loadingTrackCandidates;
  const hasCandidateList =
    trackCandidates.length > 0 || fallbackCandidates.length > 0;
  const [previewImageSize, setPreviewImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const selectedCandidate =
    trackCandidates.find((candidate) => candidate.trackId === selectedTrackId) ??
    fallbackCandidates.find((candidate) => candidate.trackId === selectedTrackId) ??
    null;
  const selectedSampleFrames =
    selectedCandidate?.sampleFrames?.filter((frame) => frame.imageUrl) ?? [];
  const selectedSamplePreviewFrames =
    selectedSampleFrames.length > 0
      ? selectedSampleFrames.slice(0, 3)
      : selectedCandidate?.thumbnailUrl
        ? [
            {
              imageUrl: selectedCandidate.thumbnailUrl,
              x: selectedCandidate.x ?? null,
              y: selectedCandidate.y ?? null,
              w: selectedCandidate.w ?? null,
              h: selectedCandidate.h ?? null
            }
          ]
        : [];
  const playerRefRaw =
    job?.playerRefRaw ??
    (job ? (job as { player_ref?: unknown }).player_ref : null) ??
    (job ? (job as { playerRef?: unknown }).playerRef : null) ??
    null;
  const bestPreviewFrameKey =
    (playerRefRaw &&
    typeof playerRefRaw === "object" &&
    "best_preview_frame_key" in (playerRefRaw as Record<string, unknown>)
      ? (playerRefRaw as { best_preview_frame_key?: string | null })
          .best_preview_frame_key ?? null
      : null) ??
    (playerRefRaw &&
    typeof playerRefRaw === "object" &&
    "bestPreviewFrameKey" in (playerRefRaw as Record<string, unknown>)
      ? (playerRefRaw as { bestPreviewFrameKey?: string | null })
          .bestPreviewFrameKey ?? null
      : null) ??
    getSelectionFrameKey(playerRefRaw) ??
    null;
  const selectedPlayerPreviewFrame =
    (bestPreviewFrameKey
      ? previewFramesWithImages.find(
          (frame) => getSelectionFrameKey(frame) === bestPreviewFrameKey
        )
      : null) ?? null;
  const activePreviewRect = previewDragState
    ? {
        left: Math.min(previewDragState.startX, previewDragState.currentX),
        top: Math.min(previewDragState.startY, previewDragState.currentY),
        width: Math.abs(previewDragState.currentX - previewDragState.startX),
        height: Math.abs(previewDragState.currentY - previewDragState.startY)
      }
    : null;

  const selectionMatchesFrame = (
    selection: TargetSelection | FrameSelection | null,
    frame: PreviewFrame | null
  ) => {
    if (!selection || !frame) {
      return false;
    }
    const selectionKey = getSelectionFrameKey(selection);
    const frameKey = getSelectionFrameKey(frame);
    if (selectionKey && frameKey) {
      return selectionKey === frameKey;
    }
    const selectionTime = getSelectionTimeSec(selection);
    const frameTime = getSelectionTimeSec(frame);
    if (selectionTime == null || frameTime == null) {
      return false;
    }
    return Math.abs(selectionTime - frameTime) < 0.05;
  };

  const resolveTargetPreviewFrame = (
    selection: TargetSelection | null
  ): { frame: PreviewFrame | null; warning?: string } => {
    if (!selection) {
      return { frame: null };
    }
    const selectionKey = getSelectionFrameKey(selection);
    if (!selectionKey) {
      return {
        frame: null,
        warning: "Seleziona un frame dove il giocatore è visibile."
      };
    }
    const frame =
      previewFramesWithImages.find(
        (candidate) => getSelectionFrameKey(candidate) === selectionKey
      ) ?? null;
    return {
      frame,
      warning: frame
        ? undefined
        : `Frame_key ${selectionKey} non trovato nei preview.`
    };
  };

  const getSelectionDisplayRect = (
    selection: TargetSelection | FrameSelection | null
  ) => {
    if (!selection || !previewImageSize) {
      return null;
    }
    if (
      selection.x < 0 ||
      selection.y < 0 ||
      selection.w < 0 ||
      selection.h < 0 ||
      selection.x + selection.w > 1 ||
      selection.y + selection.h > 1
    ) {
      console.warn("SELECTION_OUT_OF_BOUNDS", selection);
    }
    return {
      left: selection.x * previewImageSize.width,
      top: selection.y * previewImageSize.height,
      width: selection.w * previewImageSize.width,
      height: selection.h * previewImageSize.height
    };
  };

  const resolveFrameUrl = (url: string | null | undefined) => {
    const normalized = normalizeFrameUrl(url ?? "");
    if (!normalized) {
      return "";
    }
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return normalized;
      }
    } catch {
      return "";
    }
    return "";
  };

  const fetchImageStatus = async (url: string) => {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        cache: "no-store"
      });
      return response.status;
    } catch (error) {
      console.warn("IMG_STATUS_HEAD_FAILED", { url, error });
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store"
      });
      return response.status;
    } catch (error) {
      console.warn("IMG_STATUS_GET_FAILED", { url, error });
    }

    return null;
  };

  const getCachedFrameSrc = (
    cacheKey: string,
    rawUrl: string | null | undefined
  ) => {
    const frameUrl = resolveFrameUrl(rawUrl);
    if (!frameUrl) {
      return "";
    }
    const key = `${cacheKey}:${frameUrl}`;
    const cached = frameSrcCacheRef.current.get(key);
    if (cached) {
      return cached;
    }
    frameSrcCacheRef.current.set(key, frameUrl);
    return frameUrl;
  };


  const getPreviewFrameSrc = (frame: PreviewFrame) =>
    getCachedFrameSrc(`preview-${frame.key}`, resolvePreviewFrameUrl(frame));

  const selectedPreviewThumbnail = selectedPlayerPreviewFrame
    ? getPreviewFrameSrc(selectedPlayerPreviewFrame)
    : "";

  const getCandidateThumbnailSrc = (candidate: TrackCandidate) =>
    getCachedFrameSrc(`candidate-${candidate.trackId}`, candidate.thumbnailUrl);

  const getCandidateSampleFrameSrc = (frameUrl: string | null | undefined) =>
    getCachedFrameSrc("candidate-sample", frameUrl);

  const logImageFailure = async (
    context: string,
    url: string | null | undefined,
    key?: string | null
  ) => {
    const resolvedUrl = resolveFrameUrl(url);
    if (!resolvedUrl) {
      return;
    }
    const status = await fetchImageStatus(resolvedUrl);
    console.error("IMG_ONERROR", {
      context,
      key: key ?? null,
      url: resolvedUrl,
      status
    });
    setImageLoadFailures((prev) => {
      const failureKey = `${context}:${resolvedUrl}`;
      const next = [
        {
          url: resolvedUrl,
          status,
          context,
          key: key ?? null,
          occurredAt: new Date().toISOString()
        },
        ...prev.filter(
          (item) => `${item.context}:${item.url}` !== failureKey
        )
      ];
      return next.slice(0, 6);
    });
  };

  const handlePreviewImageError = (frame: PreviewFrame, context: string) => {
    console.error("FRAME_IMG_ERROR", {
      context,
      key: frame.key,
      url: resolvePreviewFrameUrl(frame)
    });
    void logImageFailure(context, resolvePreviewFrameUrl(frame), frame.key);
    setPreviewImageErrors((prev) => ({
      ...prev,
      [frame.key]: context
    }));
  };

  const handlePreviewFrameFallback = (frame: PreviewFrame, context: string) => {
    handlePreviewImageError(frame, context);
  };

  const handleCandidateFrameFallback = (
    context: string,
    frameUrl?: string | null
  ) => {
    void logImageFailure(context, frameUrl ?? null, null);
  };

  const handlePreviewImageLoad = (frame: PreviewFrame) => {
    setPreviewImageErrors((prev) => {
      if (!prev[frame.key]) {
        return prev;
      }
      const next = { ...prev };
      delete next[frame.key];
      return next;
    });
    if (selectedPreviewFrame && frame.key === selectedPreviewFrame.key) {
      const image = previewImageRef.current;
      if (image) {
        setPreviewImageSize({
          width: image.clientWidth,
          height: image.clientHeight
        });
      }
    }
  };

  useEffect(() => {
    if (!jobId || !polling) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const getPollInterval = (step?: string | null) => {
      if (!step) {
        return 3000;
      }
      if (step.toUpperCase().includes("TRACKING")) {
        return 4000;
      }
      if (step.toUpperCase().includes("SCORING")) {
        return 2000;
      }
      return 3000;
    };

    const poll = async () => {
      if (!isMounted) {
        return;
      }

      if (!pollStartRef.current) {
        pollStartRef.current = Date.now();
      }

      const elapsedMs = Date.now() - pollStartRef.current;
      if (elapsedMs > 60 * 60 * 1000) {
        setPolling(false);
        setPollingTimedOut(true);
        return;
      }

      try {
        const data = await fetchJsonWithTimeout<JobResponse>(`/api/jobs/${jobId}`);
        const normalizedJob = normalizeJob(data);
        setJob(normalizedJob);

        if (
          normalizedJob.status === "COMPLETED" ||
          normalizedJob.status === "PARTIAL" ||
          normalizedJob.status === "FAILED"
        ) {
          setPolling(false);
          return;
        }

        const nextInterval = getPollInterval(normalizedJob.progress?.step ?? null);
        timeoutId = setTimeout(poll, nextInterval);
      } catch (pollError) {
        setError(toErrorMessage(pollError));
        setPolling(false);
      }
    };

    poll();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [jobId, polling]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let isMounted = true;
    const fetchJob = async () => {
      try {
        const data = await getJob(jobId);
        if (isMounted) {
          setJob(normalizeJob(data));
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(toErrorMessage(fetchError));
        }
      }
    };

    fetchJob();

    return () => {
      isMounted = false;
    };
  }, [jobId]);

  useEffect(() => {
    if (!overlayToast) {
      return;
    }
    const timeoutId = setTimeout(() => setOverlayToast(null), 5000);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [overlayToast]);

  useEffect(() => {
    const draftSelection = jobTargetDraft ?? jobTargetSelection ?? null;
    if (draftSelection) {
      setTargetSelection(draftSelection);
      setDraftTargetSelection(draftSelection);
    }
  }, [jobTargetDraft, jobTargetSelection]);

  useEffect(() => {
    if (selectedTrackId) {
      setCandidateReview(null);
    }
  }, [selectedTrackId]);

  useEffect(() => {
    setPlayerSaved(hasPlayerRef);
    if (targetConfirmed) {
      setTargetSaved(true);
    } else if (!draftTargetSelection) {
      setTargetSaved(false);
    }
  }, [hasPlayerRef, targetConfirmed, draftTargetSelection]);

  useEffect(() => {
    if (!selectedPreviewFrame) {
      setPreviewImageSize(null);
      return;
    }
    const updateSize = () => {
      const image = previewImageRef.current;
      if (image) {
        setPreviewImageSize({
          width: image.clientWidth,
          height: image.clientHeight
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => {
      window.removeEventListener("resize", updateSize);
    };
  }, [selectedPreviewFrame]);

  useEffect(() => {
    if (!shouldPollFrameList) {
      setPreviewPollingActive(false);
    }
  }, [shouldPollFrameList]);

  useEffect(() => {
    if (
      previewFrames.length > 0 &&
      previewFramesWithImages.length === previewFrames.length
    ) {
      setPreviewPollingActive(false);
    }
  }, [previewFrames.length, previewFramesWithImages.length]);

  useEffect(() => {
    if (!jobId) {
      setPreviewFrames([]);
      setFramesFrozen(false);
      setPreviewPollingError(null);
      setPreviewPollingActive(false);
      setPreviewPollingAttempt(0);
      setPreviewImageErrors({});
      setPreviewError(null);
      setTrackCandidates([]);
      setFallbackCandidates([]);
      setLoadingTrackCandidates(false);
      setCandidatePolling(false);
      setPlayerCandidateError(null);
      setSelectedTrackId(null);
      setSelectingTrackId(null);
      setShowSecondaryCandidates(false);
      setShowAllCandidates(false);
      setAnalysisTrackId(null);
      setAnalysisFrameKey(null);
      setAnalysisJob(null);
      setAnalysisError(null);
      setAnalysisPolling(false);
      setAnalysisRequesting(false);
      previewListRequestRef.current = 0;
      pollStartRef.current = null;
      setPollingTimedOut(false);
      frameSrcCacheRef.current.clear();
      setFrameSrcCacheVersion((prev) => prev + 1);
      return;
    }
  }, [jobId]);

  useEffect(() => {
    if (jobId) {
      setFramesFrozen(false);
      frameSrcCacheRef.current.clear();
      setFrameSrcCacheVersion((prev) => prev + 1);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !analysisTrackId || analysisRequesting || analysisError) {
      return;
    }

    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const pollAnalysis = async () => {
      try {
        const updated = await getJob(jobId, analysisTrackId);
        if (!isMounted) {
          return;
        }
        setAnalysisJob(updated);
        const status = (updated.status ?? "").toString().toUpperCase();
        if (["COMPLETED", "PARTIAL", "FAILED"].includes(status)) {
          setAnalysisPolling(false);
          return;
        }
        timeoutId = setTimeout(pollAnalysis, 3000);
      } catch (pollError) {
        if (!isMounted) {
          return;
        }
        setAnalysisError(toErrorMessage(pollError));
        setAnalysisPolling(false);
      }
    };

    setAnalysisPolling(true);
    pollAnalysis();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [jobId, analysisTrackId, analysisError, analysisRequesting]);

  useEffect(() => {
    if (showTargetSection) {
      setGridMode("target");
    } else if (showManualPlayerFallback) {
      setGridMode("player-ref");
    }
  }, [showTargetSection, showManualPlayerFallback]);

  useEffect(() => {
    if (!jobId || !shouldPollFrameList) {
      return;
    }

    let isMounted = true;
    const requestId = Date.now();
    previewListRequestRef.current = requestId;
    let attempts = 0;
    const maxAttempts = 24;
    const intervalMs = 2500;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      setPreviewPollingActive(true);
      getJobFrames(jobId, REQUIRED_FRAME_COUNT)
        .then(({ items }) => {
          if (!isMounted) {
            return;
          }
          if (previewListRequestRef.current !== requestId) {
            return;
          }

          if (!framesFrozen) {
            setPreviewFrames(items);
          }
          setPreviewError(null);
          setPreviewPollingError(null);

          if (items.length >= REQUIRED_FRAME_COUNT) {
            setPreviewPollingActive(false);
            return;
          }

          attempts += 1;
          if (
            shouldPollFrameList &&
            items.length < REQUIRED_FRAME_COUNT &&
            attempts < maxAttempts
          ) {
            timeoutId = setTimeout(poll, intervalMs);
            return;
          }

          if (
            shouldPollFrameList &&
            items.length < REQUIRED_FRAME_COUNT &&
            attempts >= maxAttempts
          ) {
            setPreviewPollingError("Preview polling timed out. Please retry.");
          }
          setPreviewPollingActive(false);
        })
        .catch((fetchError) => {
          if (!isMounted) {
            return;
          }
          if (previewListRequestRef.current !== requestId) {
            return;
          }

          const message = String(fetchError?.message || fetchError);
          setPreviewError(message);
          setPreviewPollingError(message);
          attempts += 1;
          if (shouldPollFrameList && attempts < maxAttempts) {
            timeoutId = setTimeout(poll, intervalMs);
            return;
          }
          setPreviewPollingActive(false);
        });
    };

    poll();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    jobId,
    shouldPollFrameList,
    previewPollingAttempt,
    framesFrozen
  ]);

  useEffect(() => {
    console.log("PREVIEW_DEBUG", {
      status: job?.status ?? null,
      step: job?.progress?.step ?? null,
      previewFramesState: previewFrames.length,
      previewFramesResolved: resolvedPreviewFrames.length,
      previewImageErrorCount
    });
  }, [
    job?.status,
    job?.progress?.step,
    previewFrames.length,
    resolvedPreviewFrames.length,
    previewImageErrorCount
  ]);

  useEffect(() => {
    if (selectedPreviewFrame) {
      lastFocusedElementRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        previewCloseButtonRef.current?.focus();
      });
    } else {
      lastFocusedElementRef.current?.focus();
    }
  }, [selectedPreviewFrame]);

  const handleCreateJob = async () => {
    setError(null);
    const trimmedVideo = videoUrl.trim();
    if (!trimmedVideo) {
      setError("Video URL or key is required.");
      return;
    }
    const trimmedTeamName = teamName.trim();
    const normalizedShirtNumber = shirtNumber !== "" ? Number(shirtNumber) : null;

    setSubmitting(true);
    try {
      const isHttpUrl = /^https?:\/\//i.test(trimmedVideo);
      const response = await createJob({
        ...(isHttpUrl
          ? { video_url: trimmedVideo }
          : { video_key: trimmedVideo, video_bucket: "fnh" }),
        role,
        category,
        ...(trimmedTeamName ? { team_name: trimmedTeamName } : {}),
        ...(normalizedShirtNumber !== null && !Number.isNaN(normalizedShirtNumber)
          ? { shirt_number: normalizedShirtNumber }
          : {})
      });
      const nextJobId = response.jobId ?? null;
      setJobId(nextJobId);
      setJob({ jobId: response.jobId, status: response.status });
      setTargetSelection(null);
      setSelectionSuccess(null);
      setSelectionWarning(null);
      setSelectedPreviewFrame(null);
      setPlayerRefSelection(null);
      setPlayerRefError(null);
      setPlayerCandidateError(null);
      setPlayerSaved(false);
      setTargetSaved(false);
      setTrackCandidates([]);
      setFallbackCandidates([]);
      setShowSecondaryCandidates(false);
      setShowAllCandidates(false);
      setSelectedTrackId(null);
      setCandidateReview(null);
      setSelectingTrackId(null);
      setGridMode("player-ref");
    } catch (createError) {
      setError(toErrorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnqueue = async () => {
    if (!jobId) {
      return;
    }
    if (!canEnqueue) {
      setError("Seleziona player e target prima di avviare");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await enqueueJob(jobId);
      setJob(normalizeJob(response));
      setPolling(true);
      setPollingTimedOut(false);
      pollStartRef.current = Date.now();
      setFramesFrozen(true);
      setSelectedPreviewFrame(null);
    } catch (enqueueError) {
      setError(toErrorMessage(enqueueError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshTrackCandidates = async () => {
    if (!jobId) {
      return;
    }
    setLoadingTrackCandidates(true);
    setPlayerCandidateError(null);
    try {
      const { candidates, fallbackCandidates: fallbackList } =
        await getJobTrackCandidates(jobId);
      setTrackCandidates(candidates);
      setFallbackCandidates(fallbackList);
      setShowSecondaryCandidates(false);
      setShowAllCandidates(false);
    } catch (fetchError) {
      setTrackCandidates([]);
      setFallbackCandidates([]);
      setPlayerCandidateError(toErrorMessage(fetchError));
    } finally {
      setLoadingTrackCandidates(false);
    }
  };

  const resolveTrackFrameKey = (trackId: string) => {
    if (!trackId) {
      return null;
    }
    const frameMatch = previewFramesWithImages.find((frame) =>
      (frame.tracks ?? []).some((track) => track.trackId === trackId)
    );
    if (frameMatch) {
      return frameMatch.key;
    }
    return null;
  };

  const openTargetModalFromJob = (updatedJob: JobResponse) => {
    const selection =
      normalizeTargetSelection(
        updatedJob.target &&
          typeof updatedJob.target === "object" &&
          "selection" in (updatedJob.target as Record<string, unknown>)
          ? (updatedJob.target as { selection?: unknown }).selection ?? null
          : null
      ) ??
      updatedJob.target?.selections?.[0] ??
      null;
    if (!selection) {
      setSelectionError("Draft target non presente nel job. Verifica backend.");
      return;
    }
    setDraftTargetSelection(selection);
    const { frame: resolvedTargetFrame, warning } =
      resolveTargetPreviewFrame(selection);
    if (!resolvedTargetFrame) {
      setSelectionError(warning ?? "Impossibile aprire il frame target.");
      return;
    }
    setSelectionWarning(warning ?? null);
    handleOpenPreview(resolvedTargetFrame, "target");
  };

  const handlePickPlayer = async (trackId: string, frameKey: string | null) => {
    if (!jobId || !frameKey) {
      return;
    }
    setPlayerCandidateError(null);
    setSelectingTrackId(trackId);
    try {
      await pickJobPlayer(jobId, { frameKey, trackId });
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      if (!updatedJob.playerRef) {
        setPlayerCandidateError(
          "Backend did not persist player_ref yet. Please retry or refresh."
        );
        return;
      }
      setSelectedTrackId(trackId);
      setCandidateReview(null);
      openTargetModalFromJob(updatedJob);
    } catch (selectError) {
      const errorCode =
        selectError && typeof selectError === "object"
          ? (selectError as { code?: string }).code
          : null;
      if (errorCode === "INVALID_SELECTION") {
        setOverlayToast(
          "Selezione non valida (track non presente nel frame). Prova un altro frame."
        );
      } else {
        setPlayerCandidateError(toErrorMessage(selectError));
      }
    } finally {
      setSelectingTrackId(null);
    }
  };

  const handleSelectTrack = async (candidate: TrackCandidate) => {
    if (!jobId) {
      return;
    }
    const selection = getCandidateSelection(candidate);
    if (!selection) {
      setPlayerCandidateError(
        "Missing selection data for this candidate. Check sample frames mapping."
      );
      return;
    }
    const frameKey =
      resolveTrackFrameKey(candidate.trackId) ??
      getSelectionFrameKey(candidate.sampleFrames?.[0]) ??
      null;
    if (!frameKey) {
      setPlayerCandidateError(
        "Frame_key mancante per questa traccia. Usa il picker overlay."
      );
      return;
    }
    await handlePickPlayer(candidate.trackId, frameKey);
  };

  const handleReviewCandidate = (candidate: TrackCandidate) => {
    const selection = getCandidateSelection(candidate);
    if (!selection) {
      setPlayerCandidateError(
        "Missing selection data for this candidate. Check sample frames mapping."
      );
      return;
    }
    setPlayerCandidateError(null);
    setCandidateReview(candidate);
  };

  const submitTargetSelection = async (force?: boolean, closeOnSuccess?: boolean) => {
    if (!jobId || !draftTargetSelection) {
      return;
    }
    setSelectionError(null);
    setSelectionSuccess(null);
    setSelectionWarning(null);
    setSelectionRequestId(null);
    setSavingSelection(true);
    try {
      await saveJobTargetSelection(jobId, {
        selections: [draftTargetSelection],
        ...(force ? { force: true } : {})
      });
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      const updatedSelection = updatedJob.target?.selections?.[0] ?? null;
      const updatedTargetConfirmed = Boolean(updatedJob.target?.confirmed);
      setTargetSelection(updatedSelection);
      setDraftTargetSelection(updatedSelection);
      setTargetSaved(updatedTargetConfirmed);
      if (updatedTargetConfirmed) {
        setSelectionSuccess("Selection confirmed");
        if (closeOnSuccess) {
          handleClosePreview();
        }
      } else {
        setSelectionError(
          "Selection not confirmed in backend. Please retry or check API logs."
        );
      }
    } catch (saveError) {
      const error = saveError as Error & {
        status?: number;
        code?: string;
        allowForce?: boolean;
        requestId?: string;
      };
      const errorCode = error?.code ?? null;
      if (errorCode === "INVALID_PAYLOAD") {
        console.error("TARGET_SELECTION_PAYLOAD_INVALID", saveError);
        setSelectionError("Errore interno UI: payload incompleto");
        return;
      }
      if (errorCode === "INVALID_FRAME_KEY") {
        setSelectionError("Frame non valido, ricarica overlay");
        setDraftTargetSelection(null);
        return;
      }
      if (errorCode === "TRACK_NOT_IN_FRAME") {
        setSelectionError(
          "Selected player not visible in this frame. Choose another frame."
        );
        setDraftTargetSelection(null);
        return;
      }
      if (
        error?.status === 409 &&
        (errorCode === "TARGET_MISMATCH" ||
          error.message.toUpperCase().includes("TARGET_MISMATCH"))
      ) {
        setTargetMismatchAllowForce(Boolean(error.allowForce));
        setTargetMismatchOpen(true);
        return;
      }
      if (errorCode === "TARGET_MISMATCH") {
        setTargetMismatchAllowForce(Boolean(error.allowForce));
        setTargetMismatchOpen(true);
        return;
      }
      if (errorCode === "INTERNAL_ERROR") {
        setSelectionError("Errore interno del server");
        setSelectionRequestId(error.requestId ?? null);
        return;
      }
      setSelectionError(toErrorMessage(saveError));
    } finally {
      setSavingSelection(false);
    }
  };

  const handleSaveSelection = async () => {
    await submitTargetSelection(false);
  };

  const handleOpenPreview = (frame: PreviewFrame, mode: PreviewMode) => {
    if (mode === "target" && !hasPlayerRef) {
      setError("Select player first.");
      return;
    }
    if (!hasFullPreviewSet && !(isCandidatesFailed && hasAnyPreviewFrames)) {
      setError("Wait for 8/8 preview frames.");
      return;
    }
    if (mode === "target") {
      setSelectionError(null);
    }
    setPreviewMode(mode);
    setFramesFrozen(true);
    setSelectedPreviewFrame(frame);
    setPlayerRefSelection(null);
    setPreviewDragState(null);
    setTargetAdjustState(null);
    setPlayerRefError(null);
    if (mode === "target") {
      setSelectionError(null);
      setSelectionSuccess(null);
      setSelectionWarning(null);
    }
  };

  const handleClosePreview = () => {
    setSelectedPreviewFrame(null);
    setPlayerRefSelection(null);
    setPreviewDragState(null);
    setTargetAdjustState(null);
  };

  const handlePreviewMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const image = previewImageRef.current;
    if (!image) {
      return;
    }
    if (previewMode === "target" && targetAdjustState) {
      return;
    }
    const rect = image.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;

    setPreviewDragState({
      startX,
      startY,
      currentX: startX,
      currentY: startY
    });
  };

  const handlePreviewMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (targetAdjustState) {
      const image = previewImageRef.current;
      if (!image) {
        return;
      }
      const rect = image.getBoundingClientRect();
      const currentX = event.clientX - rect.left;
      const currentY = event.clientY - rect.top;
      const dx = currentX - targetAdjustState.startX;
      const dy = currentY - targetAdjustState.startY;
      const width = image.clientWidth || rect.width;
      const height = image.clientHeight || rect.height;
      if (!width || !height) {
        return;
      }
      const dxNorm = dx / width;
      const dyNorm = dy / height;
      const minSize = 0.02;
      const origin = targetAdjustState.origin;
      let next = { ...origin };

      if (targetAdjustState.mode === "move") {
        const maxX = 1 - origin.w;
        const maxY = 1 - origin.h;
        next.x = Math.min(Math.max(origin.x + dxNorm, 0), maxX);
        next.y = Math.min(Math.max(origin.y + dyNorm, 0), maxY);
      }

      if (targetAdjustState.mode === "resize-se") {
        next.w = Math.min(Math.max(origin.w + dxNorm, minSize), 1 - origin.x);
        next.h = Math.min(Math.max(origin.h + dyNorm, minSize), 1 - origin.y);
      }
      if (targetAdjustState.mode === "resize-nw") {
        const newX = Math.min(Math.max(origin.x + dxNorm, 0), origin.x + origin.w - minSize);
        const newY = Math.min(Math.max(origin.y + dyNorm, 0), origin.y + origin.h - minSize);
        next.w = Math.min(Math.max(origin.w - dxNorm, minSize), 1 - newX);
        next.h = Math.min(Math.max(origin.h - dyNorm, minSize), 1 - newY);
        next.x = newX;
        next.y = newY;
      }
      if (targetAdjustState.mode === "resize-ne") {
        const newY = Math.min(Math.max(origin.y + dyNorm, 0), origin.y + origin.h - minSize);
        next.w = Math.min(Math.max(origin.w + dxNorm, minSize), 1 - origin.x);
        next.h = Math.min(Math.max(origin.h - dyNorm, minSize), 1 - newY);
        next.y = newY;
      }
      if (targetAdjustState.mode === "resize-sw") {
        const newX = Math.min(Math.max(origin.x + dxNorm, 0), origin.x + origin.w - minSize);
        next.w = Math.min(Math.max(origin.w - dxNorm, minSize), 1 - newX);
        next.h = Math.min(Math.max(origin.h + dyNorm, minSize), 1 - origin.y);
        next.x = newX;
      }

      setDraftTargetSelection({
        ...origin,
        x: clampNormalized(next.x),
        y: clampNormalized(next.y),
        w: clampNormalized(next.w),
        h: clampNormalized(next.h)
      });
      return;
    }
    if (!previewDragState) {
      return;
    }
    const image = previewImageRef.current;
    if (!image) {
      return;
    }
    const rect = image.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    setPreviewDragState((prev) =>
      prev
        ? {
            ...prev,
            currentX,
            currentY
          }
        : prev
    );
  };

  const handlePreviewMouseUp = () => {
    if (targetAdjustState) {
      setTargetAdjustState(null);
      return;
    }
    if (!previewDragState || !selectedPreviewFrame) {
      return;
    }
    const image = previewImageRef.current;
    if (!image) {
      setPreviewDragState(null);
      return;
    }
    const displayWidth = image.clientWidth;
    const displayHeight = image.clientHeight;
    if (!displayWidth || !displayHeight) {
      setPreviewDragState(null);
      return;
    }
    const { startX, startY, currentX, currentY } = previewDragState;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width > 1 && height > 1) {
      const x1 = clamp(left / displayWidth);
      const y1 = clamp(top / displayHeight);
      const x2 = clamp((left + width) / displayWidth);
      const y2 = clamp((top + height) / displayHeight);
      const normalized = {
        x: x1,
        y: y1,
        w: clamp(x2 - x1),
        h: clamp(y2 - y1)
      };
      const outOfBounds =
        left < 0 ||
        top < 0 ||
        left + width > displayWidth ||
        top + height > displayHeight;
      if (outOfBounds) {
        console.warn("DRAW_BOX_OUT_OF_BOUNDS", {
          left,
          top,
          width,
          height,
          displayWidth,
          displayHeight
        });
      }
      console.assert(
        normalized.x >= 0 &&
          normalized.y >= 0 &&
          normalized.w >= 0 &&
          normalized.h >= 0 &&
          normalized.x + normalized.w <= 1 &&
          normalized.y + normalized.h <= 1,
        "Normalized bbox outside frame",
        normalized
      );
      if (previewMode === "player-ref") {
        setPlayerRefSelection({
          frameTimeSec: selectedPreviewFrame.timeSec,
          x: normalized.x,
          y: normalized.y,
          w: normalized.w,
          h: normalized.h
        });
      } else {
        setSelectionSuccess(null);
        setSelectionError(null);
        setDraftTargetSelection({
          frameTimeSec: selectedPreviewFrame.timeSec,
          frameKey: selectedPreviewFrame.key,
          frame_key: selectedPreviewFrame.key,
          trackId: selectedTrackId ?? null,
          track_id: selectedTrackId ?? null,
          x: normalized.x,
          y: normalized.y,
          w: normalized.w,
          h: normalized.h
        });
      }
    }
    setPreviewDragState(null);
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClosePreview();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const modal = previewModalRef.current;
    if (!modal) {
      return;
    }
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute("disabled"));
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const isShift = event.shiftKey;
    const activeElement = document.activeElement as HTMLElement | null;

    if (isShift && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!isShift && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSavePlayerRef = async () => {
    if (!jobId || !playerRefSelection) {
      return;
    }
    setPlayerRefError(null);
    setSavingPlayerRef(true);
    try {
      const response = await saveJobPlayerRef(jobId, playerRefSelection);
      const responseSource =
        response && typeof response === "object" && "data" in response
          ? (response as { data?: unknown }).data
          : response;
      if (
        responseSource &&
        typeof responseSource === "object" &&
        ("player_ref" in responseSource || "playerRef" in responseSource)
      ) {
        const playerRefValue =
          (responseSource as { player_ref?: unknown }).player_ref ??
          (responseSource as { playerRef?: unknown }).playerRef ??
          null;
        if (playerRefValue === null) {
          setPlayerRefError(
            "Backend did not persist player_ref (null). Check payload keys."
          );
          return;
        }
      }
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      handleClosePreview();
    } catch (saveError) {
      setPlayerRefError(toErrorMessage(saveError));
    } finally {
      setSavingPlayerRef(false);
    }
  };

  const handleStopPolling = () => {
    setPolling(false);
  };

  const handleRestartJob = async () => {
    if (!jobId) {
      return;
    }
    if (!canEnqueue) {
      setError("Seleziona player e target prima di avviare");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await enqueueJob(jobId);
      setJob(normalizeJob(response));
      setPolling(true);
      setPollingTimedOut(false);
      pollStartRef.current = Date.now();
    } catch (restartError) {
      setError(toErrorMessage(restartError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshJob = async () => {
    if (!jobId) {
      return;
    }
    setRefreshingFrames(true);
    setError(null);
    try {
      const updatedJob = await getJob(jobId);
      setJob(normalizeJob(updatedJob));
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setRefreshingFrames(false);
    }
  };

  const handleRetryPreviewPolling = () => {
    setPreviewPollingError(null);
    setPreviewPollingAttempt((prev) => prev + 1);
  };

  const handleRetryPreviewExtraction = () => {
    handleRetryPreviewPolling();
    handleRefreshJob();
  };

  const handleFocusStep = () => {
    if (effectiveStep === "TARGET") {
      setGridMode("target");
      playerSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      return;
    }

    if (effectiveStep === "PLAYER") {
      playerSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  };

  const handleReset = () => {
    setVideoUrl("");
    setRole("Striker");
    setCategory("U17");
    setShirtNumber("");
    setTeamName("");
    setJobId(null);
    setJob(null);
    setTargetSelection(null);
    setDraftTargetSelection(null);
    setError(null);
    setSelectionError(null);
    setSelectionSuccess(null);
    setSelectionWarning(null);
    setPlayerRefError(null);
    setPlayerCandidateError(null);
    setPolling(false);
    setSavingSelection(false);
    setSavingPlayerRef(false);
    setSelectedPreviewFrame(null);
    setPlayerRefSelection(null);
    setPlayerSaved(false);
    setTargetSaved(false);
    setTrackCandidates([]);
    setFallbackCandidates([]);
    setLoadingTrackCandidates(false);
    setCandidatePolling(false);
    setShowSecondaryCandidates(false);
    setShowAllCandidates(false);
    setSelectedTrackId(null);
    setCandidateReview(null);
    setSelectingTrackId(null);
    setGridMode("player-ref");
    setPreviewDragState(null);
    setTargetAdjustState(null);
    setPreviewFrames([]);
    setFramesFrozen(false);
    setPreviewPollingError(null);
    setPreviewPollingActive(false);
    setPreviewPollingAttempt(0);
    setPreviewImageErrors({});
    previewListRequestRef.current = 0;
    pollStartRef.current = null;
    setPollingTimedOut(false);
    setTargetMismatchOpen(false);
    setTargetMismatchAllowForce(false);
  };

  const handleSelectTargetFromFrames = () => {
    setSelectionError(null);
    setSelectionWarning(null);
    const selectionSource =
      draftTargetSelection ?? jobTargetDraft ?? targetSelection ?? null;
    if (!selectionSource) {
      setSelectionError(
        "Target draft mancante. Seleziona un player per generare il box."
      );
      return;
    }
    const { frame: resolvedTargetFrame, warning } =
      resolveTargetPreviewFrame(selectionSource);
    if (warning && resolvedTargetFrame) {
      setSelectionWarning(warning);
    }
    if (resolvedTargetFrame) {
      handleOpenPreview(resolvedTargetFrame, "target");
    } else {
      setSelectionError(warning ?? "Impossibile risolvere il frame del target.");
    }
    setGridMode("target");
    playerSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const playerRefMissingTime = playerRefSelection?.frameTimeSec == null;
  const targetMissingTime = getSelectionTimeSec(draftTargetSelection) == null;
  const targetMissingFrameKey = Boolean(
    draftTargetSelection && !getSelectionFrameKey(draftTargetSelection)
  );
  const targetSelectionFrameKey =
    getSelectionFrameKey(draftTargetSelection) ?? selectedPreviewFrame?.key ?? null;
  const targetInvalidReason = useMemo(() => {
    if (!draftTargetSelection) {
      return null;
    }
    const bbox = {
      x: draftTargetSelection.x,
      y: draftTargetSelection.y,
      w: draftTargetSelection.w,
      h: draftTargetSelection.h
    };
    if (isBboxOutOfBounds(bbox) || isBboxTooSmallOrLarge(bbox)) {
      return "Select a player box.";
    }
    return null;
  }, [draftTargetSelection]);
  const selectedFrameMissingTime = selectedPreviewFrame?.timeSec == null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Create Job</h2>
            <p className="mt-1 text-sm text-slate-400">
              Provide the details for a new analysis request.
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
            Form
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block text-sm text-slate-300">
            Video URL (http/https) or MinIO Object Key
            <textarea
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              className="mt-2 h-24 w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              placeholder="https://..."
            />
          </label>

          <label className="block text-sm text-slate-300">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {roles.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            Category
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Team name <span className="text-xs text-slate-500">(optional)</span>
            <input
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              placeholder="e.g. Home team"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Shirt number <span className="text-xs text-slate-500">(optional)</span>
            <input
              type="number"
              value={shirtNumber}
              onChange={(event) => setShirtNumber(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              placeholder="e.g. 9"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCreateJob}
            disabled={submitting}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Job"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
          >
            Reset
          </button>
        </div>

        {jobId ? (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Job Created
            </p>
            <p className="mt-2 text-sm text-slate-200">ID: {jobId}</p>
            <button
              type="button"
              onClick={handleEnqueue}
              disabled={!canEnqueue || submitting}
              aria-disabled={!canEnqueue || submitting}
              className={`mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 ${
                !canEnqueue || submitting ? "cursor-not-allowed opacity-50" : ""
              }`}
            >
              {submitting ? "Starting..." : "Start analysis"}
            </button>
            <p className="mt-2 text-xs text-slate-500">{enqueueHint}</p>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
      </section>

      <section
        ref={playerSectionRef}
        className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Select Player</h2>
            <p className="mt-1 text-sm text-slate-400">
              Choose the player to track before processing continues.
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
            Step
          </span>
        </div>

        <div className="mt-6 space-y-6">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-500">
              Preview debug
            </p>
            <div className="mt-2 grid gap-1">
              <span>Status: {job?.status ?? "—"}</span>
              <span>Step: {job?.progress?.step ?? "—"}</span>
              <span>Frames (payload): {job?.previewFrames?.length ?? 0}</span>
              <span>Frames (list): {previewFrames.length}</span>
              <span>Frames (resolved): {resolvedPreviewFrames.length}</span>
              <span>Frames error: {previewError || "—"}</span>
              <span>Image errors: {previewImageErrorCount}</span>
              <span>Warnings: {warningMessages.length}</span>
              <span>Warnings(raw): {JSON.stringify(warningMessages)}</span>
              <span>Clips: {clipsCount}</span>
              <span>hasInputVideoUrl: {String(Boolean(inputVideoUrl))}</span>
              <span>Radar keys: {radarKeysCount}</span>
              <span>playerSaved: {String(playerSaved)}</span>
              <span>targetSaved: {String(targetSaved)}</span>
              <span>
                playerRef(raw):{" "}
                {JSON.stringify(
                  (job as any)?.playerRefRaw ??
                    (job as any)?.player_ref ??
                    (job as any)?.playerRef ??
                    job?.result?.player_ref ??
                    job?.result?.playerRef ??
                    null
                )}
              </span>
              <span>
                target(raw):{" "}
                {JSON.stringify(job?.target ?? (job as any)?.data?.target ?? null)}
              </span>
            </div>
          </div>
          {jobId ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Player selection
                  </p>
                  <p className="mt-2 text-sm text-slate-200">
                    Use the frames below to draw a bounding box for the player.
                  </p>
                </div>
              </div>

              {showPlayerSection ? (
                <div className="mt-4 space-y-4">
                  <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Overlay frames gallery
                        </p>
                        <p className="mt-1 text-sm text-slate-200">
                          Click a frame to draw a bounding box around the player.
                        </p>
                      </div>
                    </div>

                    {previewError ? (
                      <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                        {previewError}
                      </div>
                    ) : null}
                    {previewPollingActive && overlayGalleryFrames.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
                        <span>Loading preview frames...</span>
                      </div>
                    ) : previewError ? null : (
                      <OverlayFramesGallery
                        frames={overlayGalleryFrames}
                        getFrameSrc={getPreviewFrameSrc}
                        disabled={analysisRequesting}
                        onFrameError={(frame) =>
                          handlePreviewFrameFallback(frame, "overlay-gallery")
                        }
                        onSelectFrame={(frame) => handleOpenPreview(frame, "player-ref")}
                      />
                    )}
                  </div>

                  {showLegacyFlow && selectedTrackId ? (
                    <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">
                            Selected player
                          </p>
                          <p className="mt-1 text-sm text-slate-200">
                            Track {selectedTrackId}
                            {selectedCandidate?.tier
                              ? ` · ${selectedCandidate.tier}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                          {selectedPreviewThumbnail ? (
                            <img
                              src={selectedPreviewThumbnail}
                              alt="Selected player frame"
                              className="h-24 w-full object-cover"
                              onError={() => {
                                if (selectedPlayerPreviewFrame) {
                                  handlePreviewFrameFallback(
                                    selectedPlayerPreviewFrame,
                                    "selected-preview"
                                  );
                                }
                              }}
                            />
                          ) : (
                            <div className="flex h-24 w-full items-center justify-center text-xs text-slate-500">
                              Best preview not available
                            </div>
                          )}
                        </div>
                        {selectedSamplePreviewFrames.map((frame, index) => {
                          const frameSrc = getCandidateSampleFrameSrc(
                            frame.imageUrl ?? null
                          );
                          const bbox = selectedCandidate
                            ? resolveCandidateBox(frame ?? null, selectedCandidate)
                            : null;
                          return (
                            <div
                              key={`${selectedTrackId}-sample-${index}`}
                              className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
                            >
                              {frameSrc ? (
                                <img
                                  src={frameSrc}
                                  alt={`Selected sample ${index + 1}`}
                                  className="h-24 w-full object-cover"
                                  onError={() =>
                                    handleCandidateFrameFallback(
                                      "candidate-sample",
                                      frame.imageUrl
                                    )
                                  }
                                />
                              ) : (
                                <div className="flex h-24 w-full items-center justify-center text-xs text-slate-500">
                                  No sample
                                </div>
                              )}
                              {bbox ? (
                                <div
                                  className="absolute rounded border border-emerald-300 bg-emerald-400/20"
                                  style={{
                                    left: `${bbox.x * 100}%`,
                                    top: `${bbox.y * 100}%`,
                                    width: `${bbox.w * 100}%`,
                                    height: `${bbox.h * 100}%`
                                  }}
                                />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {showLegacyFlow ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Legacy candidates
                        </p>
                        <button
                          type="button"
                          onClick={handleRefreshTrackCandidates}
                          disabled={loadingTrackCandidates}
                          className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loadingTrackCandidates ? "Refreshing..." : "Refresh"}
                        </button>
                      </div>
                      {autodetectLowCoverage ? (
                        <div className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                          Low coverage – pick the best match
                        </div>
                      ) : null}
                      {showBestMatchMessage ? (
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-xs text-slate-200">
                          Auto-detection found tracks but none met the coverage rule.
                          Showing best matches anyway.
                        </div>
                      ) : null}
                      {isDetectingPlayers ? (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
                          <span>
                            {isProcessingStatus
                              ? `Detecting players… (${framesProcessedCount} frames processed)`
                              : "Detecting players..."}
                          </span>
                        </div>
                      ) : null}
                      {!isDetectingPlayers && loadingTrackCandidates ? (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
                          <span>Fetching candidates...</span>
                        </div>
                      ) : null}
                      {playerCandidateError ? (
                        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                          {playerCandidateError}
                        </div>
                      ) : null}
                      {hasCandidateList ? (
                        <div className="space-y-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                            All tracks
                          </p>
                          {trackCandidates.length > 0 ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                  Tabs
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {secondaryCandidates.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setShowSecondaryCandidates((prev) => !prev)
                                      }
                                      className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500"
                                    >
                                      {showSecondaryCandidates
                                        ? "Show less"
                                        : "Show more"}
                                    </button>
                                  ) : null}
                                  {otherCandidates.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowAllCandidates((prev) => {
                                          const next = !prev;
                                          if (next) {
                                            setShowSecondaryCandidates(true);
                                          }
                                          return next;
                                        });
                                      }}
                                      className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500"
                                    >
                                      {showAllCandidates ? "Show less" : "Show all"}
                                    </button>
                                  ) : null}
                                </div>
                              </div>

                              {primaryCandidates.length > 0 ? (
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                                    Primary
                                  </p>
                                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {primaryCandidates.map((candidate) => {
                                      const thumbnailSrc =
                                        getCandidateThumbnailSrc(candidate);
                                      const isSelected =
                                        selectedTrackId === candidate.trackId;
                                      const isSelecting =
                                        selectingTrackId === candidate.trackId;
                                      const hasSelectionData = Boolean(
                                        getCandidateSelection(candidate)
                                      );
                                      const highStability =
                                        candidate.stability !== null &&
                                        candidate.stability !== undefined &&
                                        candidate.stability > 0.85;
                                      const lowCoverage =
                                        candidate.coverage !== null &&
                                        candidate.coverage !== undefined &&
                                        candidate.coverage < 0.07;
                                      return (
                                        <button
                                          key={candidate.trackId}
                                          type="button"
                                          onClick={() => handleReviewCandidate(candidate)}
                                          disabled={
                                            isSelecting || isSelected || !hasSelectionData
                                          }
                                          aria-pressed={isSelected}
                                          className={`overflow-hidden rounded-xl border text-left transition ${
                                            isSelected
                                              ? "border-emerald-400/60 bg-emerald-500/10"
                                              : "border-slate-800 bg-slate-950 hover:border-emerald-400/60"
                                          } ${
                                            isSelecting || isSelected || !hasSelectionData
                                              ? "cursor-not-allowed"
                                              : ""
                                          }`}
                                        >
                                          <div className="h-32 w-full overflow-hidden bg-slate-900">
                                            {thumbnailSrc ? (
                                              <img
                                                src={thumbnailSrc}
                                                alt={`Candidate ${candidate.trackId}`}
                                                className="h-full w-full object-cover"
                                                onError={() =>
                                                  handleCandidateFrameFallback(
                                                    `candidate-${candidate.trackId}`,
                                                    candidate.thumbnailUrl
                                                  )
                                                }
                                              />
                                            ) : (
                                              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                                                No thumbnail
                                              </div>
                                            )}
                                          </div>
                                          <div className="space-y-3 p-3 text-sm text-slate-200">
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                                Track {candidate.trackId}
                                              </span>
                                              {isSelected ? (
                                                <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                                  Selected
                                                </span>
                                              ) : null}
                                            </div>
                                            {(highStability || lowCoverage) && (
                                              <div className="flex flex-wrap gap-2">
                                                {highStability ? (
                                                  <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                                    High stability
                                                  </span>
                                                ) : null}
                                                {lowCoverage ? (
                                                  <span className="rounded-full bg-amber-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-amber-200">
                                                    Low coverage
                                                  </span>
                                                ) : null}
                                              </div>
                                            )}
                                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Coverage pct
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatPercent(candidate.coverage)}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Stability score
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatScore(candidate.stability)}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Avg area
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatMetric(candidate.avgBoxArea)}
                                                </p>
                                              </div>
                                            </div>
                                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                              {isSelecting
                                                ? "Selecting..."
                                                : isSelected
                                                  ? "Selected"
                                                  : hasSelectionData
                                                    ? "Review selection"
                                                    : "Missing selection data"}
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}

                              {showSecondaryCandidates && secondaryCandidates.length > 0 ? (
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                                    Secondary
                                  </p>
                                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {secondaryCandidates.map((candidate) => {
                                      const thumbnailSrc =
                                        getCandidateThumbnailSrc(candidate);
                                      const isSelected =
                                        selectedTrackId === candidate.trackId;
                                      const isSelecting =
                                        selectingTrackId === candidate.trackId;
                                      const hasSelectionData = Boolean(
                                        getCandidateSelection(candidate)
                                      );
                                      const highStability =
                                        candidate.stability !== null &&
                                        candidate.stability !== undefined &&
                                        candidate.stability > 0.85;
                                      const lowCoverage =
                                        candidate.coverage !== null &&
                                        candidate.coverage !== undefined &&
                                        candidate.coverage < 0.07;
                                      return (
                                        <button
                                          key={candidate.trackId}
                                          type="button"
                                          onClick={() => handleReviewCandidate(candidate)}
                                          disabled={
                                            isSelecting || isSelected || !hasSelectionData
                                          }
                                          aria-pressed={isSelected}
                                          className={`overflow-hidden rounded-xl border text-left transition ${
                                            isSelected
                                              ? "border-emerald-400/60 bg-emerald-500/10"
                                              : "border-slate-800 bg-slate-950 hover:border-emerald-400/60"
                                          } ${
                                            isSelecting || isSelected || !hasSelectionData
                                              ? "cursor-not-allowed"
                                              : ""
                                          }`}
                                        >
                                          <div className="h-32 w-full overflow-hidden bg-slate-900">
                                            {thumbnailSrc ? (
                                              <img
                                                src={thumbnailSrc}
                                                alt={`Candidate ${candidate.trackId}`}
                                                className="h-full w-full object-cover"
                                                onError={() =>
                                                  handleCandidateFrameFallback(
                                                    `candidate-${candidate.trackId}`,
                                                    candidate.thumbnailUrl
                                                  )
                                                }
                                              />
                                            ) : (
                                              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                                                No thumbnail
                                              </div>
                                            )}
                                          </div>
                                          <div className="space-y-3 p-3 text-sm text-slate-200">
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                                Track {candidate.trackId}
                                              </span>
                                              {isSelected ? (
                                                <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                                  Selected
                                                </span>
                                              ) : null}
                                            </div>
                                            {(highStability || lowCoverage) && (
                                              <div className="flex flex-wrap gap-2">
                                                {highStability ? (
                                                  <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                                    High stability
                                                  </span>
                                                ) : null}
                                                {lowCoverage ? (
                                                  <span className="rounded-full bg-amber-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-amber-200">
                                                    Low coverage
                                                  </span>
                                                ) : null}
                                              </div>
                                            )}
                                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Coverage pct
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatPercent(candidate.coverage)}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Stability score
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatScore(candidate.stability)}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Avg area
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatMetric(candidate.avgBoxArea)}
                                                </p>
                                              </div>
                                            </div>
                                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                              {isSelecting
                                                ? "Selecting..."
                                                : isSelected
                                                  ? "Selected"
                                                  : hasSelectionData
                                                    ? "Review selection"
                                                    : "Missing selection data"}
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}

                              {showAllCandidates && otherCandidates.length > 0 ? (
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                                    Others
                                  </p>
                                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {otherCandidates.map((candidate) => {
                                      const thumbnailSrc =
                                        getCandidateThumbnailSrc(candidate);
                                      const isSelected =
                                        selectedTrackId === candidate.trackId;
                                      const isSelecting =
                                        selectingTrackId === candidate.trackId;
                                      const hasSelectionData = Boolean(
                                        getCandidateSelection(candidate)
                                      );
                                      const highStability =
                                        candidate.stability !== null &&
                                        candidate.stability !== undefined &&
                                        candidate.stability > 0.85;
                                      const lowCoverage =
                                        candidate.coverage !== null &&
                                        candidate.coverage !== undefined &&
                                        candidate.coverage < 0.07;
                                      return (
                                        <button
                                          key={candidate.trackId}
                                          type="button"
                                          onClick={() => handleReviewCandidate(candidate)}
                                          disabled={
                                            isSelecting || isSelected || !hasSelectionData
                                          }
                                          aria-pressed={isSelected}
                                          className={`overflow-hidden rounded-xl border text-left transition ${
                                            isSelected
                                              ? "border-emerald-400/60 bg-emerald-500/10"
                                              : "border-slate-800 bg-slate-950 hover:border-emerald-400/60"
                                          } ${
                                            isSelecting || isSelected || !hasSelectionData
                                              ? "cursor-not-allowed"
                                              : ""
                                          }`}
                                        >
                                          <div className="h-32 w-full overflow-hidden bg-slate-900">
                                            {thumbnailSrc ? (
                                              <img
                                                src={thumbnailSrc}
                                                alt={`Candidate ${candidate.trackId}`}
                                                className="h-full w-full object-cover"
                                                onError={() =>
                                                  handleCandidateFrameFallback(
                                                    `candidate-${candidate.trackId}`,
                                                    candidate.thumbnailUrl
                                                  )
                                                }
                                              />
                                            ) : (
                                              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                                                No thumbnail
                                              </div>
                                            )}
                                          </div>
                                          <div className="space-y-3 p-3 text-sm text-slate-200">
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                                Track {candidate.trackId}
                                              </span>
                                              {isSelected ? (
                                                <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                                  Selected
                                                </span>
                                              ) : null}
                                            </div>
                                            {(highStability || lowCoverage) && (
                                              <div className="flex flex-wrap gap-2">
                                                {highStability ? (
                                                  <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                                    High stability
                                                  </span>
                                                ) : null}
                                                {lowCoverage ? (
                                                  <span className="rounded-full bg-amber-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-amber-200">
                                                    Low coverage
                                                  </span>
                                                ) : null}
                                              </div>
                                            )}
                                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Coverage pct
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatPercent(candidate.coverage)}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Stability score
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatScore(candidate.stability)}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="uppercase tracking-[0.2em] text-slate-500">
                                                  Avg area
                                                </p>
                                                <p className="mt-1 text-sm text-slate-200">
                                                  {formatMetric(candidate.avgBoxArea)}
                                                </p>
                                              </div>
                                            </div>
                                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                              {isSelecting
                                                ? "Selecting..."
                                                : isSelected
                                                  ? "Selected"
                                                  : hasSelectionData
                                                    ? "Review selection"
                                                    : "Missing selection data"}
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : null}

                          {fallbackCandidates.length > 0 ? (
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                                Best matches (top)
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {fallbackCandidates.map((candidate) => {
                                  const thumbnailSrc =
                                    getCandidateThumbnailSrc(candidate);
                                  const isSelected =
                                    selectedTrackId === candidate.trackId;
                                  const isSelecting =
                                    selectingTrackId === candidate.trackId;
                                  const hasSelectionData = Boolean(
                                    getCandidateSelection(candidate)
                                  );
                                  const highStability =
                                    candidate.stability !== null &&
                                    candidate.stability !== undefined &&
                                    candidate.stability > 0.85;
                                  const lowCoverage =
                                    candidate.coverage !== null &&
                                    candidate.coverage !== undefined &&
                                    candidate.coverage < 0.07;
                                  return (
                                    <button
                                      key={candidate.trackId}
                                      type="button"
                                      onClick={() => handleReviewCandidate(candidate)}
                                      disabled={
                                        isSelecting || isSelected || !hasSelectionData
                                      }
                                      aria-pressed={isSelected}
                                      className={`overflow-hidden rounded-xl border text-left transition ${
                                        isSelected
                                          ? "border-emerald-400/60 bg-emerald-500/10"
                                          : "border-slate-800 bg-slate-950 hover:border-emerald-400/60"
                                      } ${
                                        isSelecting || isSelected || !hasSelectionData
                                          ? "cursor-not-allowed"
                                          : ""
                                      }`}
                                    >
                                      <div className="h-32 w-full overflow-hidden bg-slate-900">
                                        {thumbnailSrc ? (
                                          <img
                                            src={thumbnailSrc}
                                            alt={`Candidate ${candidate.trackId}`}
                                            className="h-full w-full object-cover"
                                            onError={() =>
                                              handleCandidateFrameFallback(
                                                `candidate-${candidate.trackId}`,
                                                candidate.thumbnailUrl
                                              )
                                            }
                                          />
                                        ) : (
                                          <div className="flex h-full items-center justify-center text-xs text-slate-500">
                                            No thumbnail
                                          </div>
                                        )}
                                      </div>
                                      <div className="space-y-3 p-3 text-sm text-slate-200">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                            Track {candidate.trackId}
                                          </span>
                                          {isSelected ? (
                                            <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                              Selected
                                            </span>
                                          ) : null}
                                        </div>
                                        {(highStability || lowCoverage) && (
                                          <div className="flex flex-wrap gap-2">
                                            {highStability ? (
                                              <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                                                High stability
                                              </span>
                                            ) : null}
                                            {lowCoverage ? (
                                              <span className="rounded-full bg-amber-400/20 px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-amber-200">
                                                Low coverage
                                              </span>
                                            ) : null}
                                          </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                                          <div>
                                            <p className="uppercase tracking-[0.2em] text-slate-500">
                                              Coverage pct
                                            </p>
                                            <p className="mt-1 text-sm text-slate-200">
                                              {formatPercent(candidate.coverage)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="uppercase tracking-[0.2em] text-slate-500">
                                              Stability score
                                            </p>
                                            <p className="mt-1 text-sm text-slate-200">
                                              {formatScore(candidate.stability)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="uppercase tracking-[0.2em] text-slate-500">
                                              Avg area
                                            </p>
                                            <p className="mt-1 text-sm text-slate-200">
                                              {formatMetric(candidate.avgBoxArea)}
                                            </p>
                                          </div>
                                        </div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                          {isSelecting
                                            ? "Selecting..."
                                            : isSelected
                                              ? "Selected"
                                              : hasSelectionData
                                                ? "Review selection"
                                                : "Missing selection data"}
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                          {candidateReview ? (
                            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                    Review selection
                                  </p>
                                  <p className="mt-1 text-sm text-slate-200">
                                    Track {candidateReview.trackId}: verifica i
                                    sample frame prima di confermare.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setCandidateReview(null)}
                                  className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500"
                                >
                                  Close
                                </button>
                              </div>
                              {reviewPreviewFrames.length > 0 ? (
                                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                                  {reviewPreviewFrames.map((frame, index) => {
                                    const frameSrc = getCandidateSampleFrameSrc(
                                      frame.imageUrl ?? null
                                    );
                                    const bbox = resolveCandidateBox(
                                      frame ?? null,
                                      candidateReview
                                    );
                                    return (
                                      <div
                                        key={`${candidateReview.trackId}-${index}`}
                                        className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
                                      >
                                        {frameSrc ? (
                                          <img
                                            src={frameSrc}
                                            alt={`Sample frame ${index + 1}`}
                                            className="h-28 w-full object-cover"
                                            onError={() =>
                                              handleCandidateFrameFallback(
                                                "candidate-sample",
                                                frame.imageUrl
                                              )
                                            }
                                          />
                                        ) : (
                                          <div className="flex h-28 items-center justify-center text-xs text-slate-500">
                                            No frame
                                          </div>
                                        )}
                                        {bbox ? (
                                          <div
                                            className="absolute rounded border border-emerald-400 bg-emerald-400/20"
                                            style={{
                                              left: `${bbox.x * 100}%`,
                                              top: `${bbox.y * 100}%`,
                                              width: `${bbox.w * 100}%`,
                                              height: `${bbox.h * 100}%`
                                            }}
                                          />
                                        ) : null}
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent px-2 py-1">
                                          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-slate-200">
                                            t={formatFrameTime(
                                              frame.frameTimeSec ?? null
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="mt-3 text-xs text-slate-500">
                                  Sample frames non disponibili per questa traccia.
                                </p>
                              )}
                              <div className="mt-4 flex flex-wrap items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleSelectTrack(candidateReview)}
                                  disabled={selectingTrackId === candidateReview.trackId}
                                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {selectingTrackId === candidateReview.trackId
                                    ? "Selecting..."
                                    : "Track this player"}
                                </button>
                                <span className="text-xs text-slate-500">
                                  Conferma dopo aver controllato i bounding box.
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : isDetectingPlayers ? null : showManualPlayerFallback ? (
                        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                          {manualFallbackMessage}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                          Manual selection available. Pick a frame above to draw a box.
                        </div>
                      )}
                    </>
                  ) : null}
                  {showLegacyFlow ? null : isDetectingPlayers ? null : showManualPlayerFallback ? (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                      {manualFallbackMessage}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                      Manual selection available. Pick a frame above to draw a box.
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  Player selected. Continue with target selection.
                </p>
              )}
            </div>
          ) : null}
          {hasPreviewFrameErrors ? (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
              <p>
                Images blocked or failed to load. Check the frame proxy or mixed
                content settings.
              </p>
              {imageLoadFailures.length > 0 ? (
                <div className="mt-2 space-y-1 text-[11px] text-amber-100">
                  {imageLoadFailures.map((failure, index) => (
                    <div key={`${failure.context}-${failure.url}-${index}`}>
                      <span className="font-semibold">
                        {failure.status !== null ? `HTTP ${failure.status}` : "HTTP ?"}
                      </span>
                      {` · ${failure.context}`}
                      <div className="break-all text-amber-200/90">
                        {failure.url}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {jobId ? (
            canShowFrameSelector ? (
              <FrameSelector key={frameSelectorKey}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-400">
                    {gridMode === "player-ref"
                      ? "Manual fallback: click a frame to draw a bounding box around the player."
                      : "Click a preview frame to draw a bounding box around the target."}
                  </p>
                </div>
                {previewFramesMissingUrls ? (
                  <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                    Preview frames ricevuti ma senza URL immagine. Verifica backend:
                    aggiungere signed_url/image_url.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {previewFramesWithImages.map((frame, index) => (
                      <button
                        key={`${frame.key}-${index}`}
                        type="button"
                        onClick={() => handleOpenPreview(frame, gridMode)}
                        className={`group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-left transition ${
                          gridMode === "target"
                            ? "hover:border-amber-300/70"
                            : "hover:border-emerald-400/60"
                        }`}
                      >
                        {previewImageErrors[frame.key] ? (
                          <div className="flex h-32 w-full items-center justify-center bg-slate-900 text-xs text-slate-400">
                            Image blocked
                          </div>
                        ) : (
                          <img
                            src={getPreviewFrameSrc(frame)}
                            alt={formatFrameAlt(frame.timeSec)}
                            className="h-32 w-full object-cover"
                            onLoad={() => handlePreviewImageLoad(frame)}
                            onError={() => handlePreviewFrameFallback(frame, "player-grid")}
                          />
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent px-3 py-2">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-200">
                            t={formatFrameTime(frame.timeSec)}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  You will be asked to draw one bounding box in the full-size view.
                </p>
              </FrameSelector>
            ) : (
              <div className="space-y-3 text-sm text-slate-400">
                {playerRef ? (
                  <p>Player reference already saved.</p>
                ) : isCandidatesFailed && !hasAnyPreviewFrames ? (
                  <>
                    <p className="text-sm text-rose-200">
                      Preview frames not available.
                    </p>
                    <button
                      type="button"
                      onClick={handleRetryPreviewExtraction}
                      className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 transition hover:text-emerald-200"
                    >
                      Retry preview extraction
                    </button>
                  </>
                ) : previewFramesMissingUrls ? (
                  <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                    Preview frames ricevuti ma senza URL immagine. Verifica backend:
                    aggiungere signed_url/image_url.
                  </div>
                ) : hasAnyPreviewFrames ? (
                  <p className="text-sm text-slate-400">
                    Preview frames ready. Select target to continue.
                  </p>
                ) : isProcessingStatus ? (
                  <div className="space-y-2 text-sm text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
                      <span>Waiting for previews…</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {`${framesProcessedCount} frames processed`}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
                      <span>
                        {previewPollingActive
                          ? "Preview frames are loading."
                          : "Waiting for previews."}
                      </span>
                    </div>
                    {previewPollingError ? (
                      <p className="text-xs text-rose-200">{previewPollingError}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={
                        previewPollingError
                          ? handleRetryPreviewPolling
                          : handleRefreshJob
                      }
                      disabled={previewPollingError ? false : refreshingFrames}
                      className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 transition hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {previewPollingError
                        ? "Retry polling"
                        : refreshingFrames
                        ? "Refreshing..."
                        : "Retry"}
                    </button>
                  </>
                )}
              </div>
            )
          ) : (
            <div className="space-y-3 text-sm text-slate-400">
              <p>Create a job to load preview frames.</p>
            </div>
          )}
        </div>
      </section>

      <section
        ref={analysisSectionRef}
        className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Analysis</h2>
            <p className="mt-1 text-sm text-slate-400">
              Monitor the selected player analysis and results.
            </p>
          </div>
          {analysisTrackId ? (
            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300">
              Track #{analysisTrackId}
            </span>
          ) : null}
        </div>

        <div className="mt-6 space-y-4">
          {!analysisTrackId ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
              Click a bounding box in the overlay frames to start analyzing a
              player.
            </div>
          ) : null}

          {analysisTrackId ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Status
                  </p>
                  <p className="mt-1 text-sm text-slate-200">
                    {analysisRequesting
                      ? "Starting analysis..."
                      : analysisStatus ?? "Waiting"}
                  </p>
                </div>
                {analysisFrameKey ? (
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                    Frame {analysisFrameKey}
                  </span>
                ) : null}
              </div>

              {analysisIsRunning ? (
                <div className="mt-4 space-y-3">
                  <ProgressBar pct={analysisProgressPct} />
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-200">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Step
                    </p>
                    <p className="mt-2">{analysisStep}</p>
                    {analysisMessage ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {analysisMessage}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {analysisError ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              {analysisError}
            </div>
          ) : null}

          {analysisIsFinal && analysisJob?.result ? (
            <ResultView job={analysisJob} />
          ) : null}
          {analysisIsFinal && analysisJob && !analysisJob.result ? (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">
              Analysis completed but no result payload was returned.
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Job Progress</h2>
            <p className="mt-1 text-sm text-slate-400">
              Monitor processing status and output.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusClass}`}
          >
            {displayStatusLabel}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <ProgressBar pct={pct} />
          {effectiveStep === "TARGET" || effectiveStep === "PLAYER" ? (
            <button
              type="button"
              onClick={handleFocusStep}
              disabled={effectiveStep === "PLAYER" && isProcessingWithoutCandidates}
              className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm font-semibold text-amber-200 transition hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {effectiveStep === "TARGET"
                ? "Select target now"
                : playerCtaLabel}
            </button>
          ) : null}

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Step
            </p>
            <p className="mt-2 text-sm text-slate-200">
              {step}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {job?.progress?.message ?? "No message"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Frames processed
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {framesProcessedCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Created
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {job?.createdAt ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Updated
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {job?.updatedAt ?? "—"}
              </p>
            </div>
          </div>

          {job?.error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              {job.error}
            </div>
          ) : null}

          {hasWarnings ? (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                Warnings
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-100">
                {warningMessages.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {pollingTimedOut ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              <p className="font-semibold text-amber-100">
                This is taking longer than expected.
              </p>
              <button
                type="button"
                onClick={handleRestartJob}
                className="mt-3 inline-flex items-center rounded-lg border border-amber-300/40 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200 transition hover:border-amber-200"
              >
                Restart job
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStopPolling}
              disabled={!polling}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stop polling
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
            >
              Reset
            </button>
          </div>
        </div>

        {jobId ? (
          <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-white">Target</h3>
                <p className="text-sm text-slate-400">
                  {targetSaved ? "Target saved" : "Missing target"}
                </p>
              </div>
              {gridMode === "target" ? (
                <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                  Target mode on
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={handleSelectTargetFromFrames}
                disabled={!hasAnyPreviewFrames}
                className="rounded-lg border border-amber-300/40 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select target from frames
              </button>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveSelection}
                  disabled={
                    savingSelection ||
                    !draftTargetSelection ||
                    targetMissingTime ||
                    targetMissingFrameKey ||
                    Boolean(targetInvalidReason)
                  }
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSelection ? "Confirming..." : "Confirm target"}
                </button>
                <span className="text-xs text-slate-500">
                  {targetMissingFrameKey
                    ? "Seleziona un frame dove il giocatore è visibile."
                    : targetMissingTime
                    ? "Frame missing time_sec."
                    : targetInvalidReason
                    ? targetInvalidReason
                    : draftTargetSelection
                    ? "Ready to confirm selection."
                    : "Select one box to continue."}
                </span>
              </div>
            </div>

            {selectionError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {selectionError}
                {selectionRequestId ? (
                  <div className="mt-2 text-[11px] text-rose-100/80">
                    request_id: {selectionRequestId}
                  </div>
                ) : null}
              </div>
            ) : null}
            {selectionWarning ? (
              <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">
                {selectionWarning}
              </div>
            ) : null}
            {selectionSuccess ? (
              <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                {selectionSuccess}
              </div>
            ) : null}
          </div>
        ) : null}

        {resultMissing ? (
          <div className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            Processing completato ma result mancante (backend).
          </div>
        ) : null}
        {shouldShowResult && job?.result ? <ResultView job={job} /> : null}
      </section>

      {selectedPreviewFrame ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div
            ref={previewModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-modal-title"
            aria-describedby="preview-modal-description"
            className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
            onKeyDown={handlePreviewKeyDown}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3
                  id="preview-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  {previewMode === "target" ? "Confirm target box" : "Draw player box"}
                </h3>
                <p
                  id="preview-modal-description"
                  className="mt-1 text-sm text-slate-400"
                >
                  {previewMode === "target"
                    ? "Drag to refine the target, or resize using the handles."
                    : "Drag to mark the player in the selected frame."}
                </p>
              </div>
              <button
                ref={previewCloseButtonRef}
                type="button"
                onClick={handleClosePreview}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500"
              >
                Close
              </button>
            </div>

            <div
              className="relative mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              onMouseLeave={handlePreviewMouseUp}
            >
              {previewImageErrors[selectedPreviewFrame.key] ? (
                <div className="flex h-72 w-full items-center justify-center text-xs text-slate-400">
                  Image blocked. Check the frame proxy or mixed content settings.
                </div>
              ) : (
                <img
                  ref={previewImageRef}
                  src={getPreviewFrameSrc(selectedPreviewFrame)}
                  alt={formatFrameAlt(selectedPreviewFrame.timeSec)}
                  className="h-auto w-full select-none"
                  draggable={false}
                  onLoad={() => handlePreviewImageLoad(selectedPreviewFrame)}
                  onError={() =>
                    handlePreviewFrameFallback(selectedPreviewFrame, "preview-modal")
                  }
                />
              )}
              <div className="absolute inset-0">
                {previewMode === "player-ref" && playerRefSelection ? (
                  (() => {
                    const rect = getSelectionDisplayRect(playerRefSelection);
                    if (!rect) {
                      return null;
                    }
                    return (
                      <div
                        className="pointer-events-none absolute rounded border border-emerald-400 bg-emerald-400/20"
                        style={{
                          left: `${rect.left}px`,
                          top: `${rect.top}px`,
                          width: `${rect.width}px`,
                          height: `${rect.height}px`
                        }}
                      />
                    );
                  })()
                ) : null}
                {previewMode === "target" &&
                draftTargetSelection &&
                selectionMatchesFrame(draftTargetSelection, selectedPreviewFrame) ? (
                  (() => {
                    const rect = getSelectionDisplayRect(draftTargetSelection);
                    if (!rect) {
                      return null;
                    }
                    return (
                      <div
                        className="absolute cursor-move rounded border border-amber-400 bg-amber-400/20 pointer-events-auto"
                        style={{
                          left: `${rect.left}px`,
                          top: `${rect.top}px`,
                          width: `${rect.width}px`,
                          height: `${rect.height}px`
                        }}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          const image = previewImageRef.current;
                          if (!image || !draftTargetSelection) {
                            return;
                          }
                          const bounds = image.getBoundingClientRect();
                          setTargetAdjustState({
                            mode: "move",
                            startX: event.clientX - bounds.left,
                            startY: event.clientY - bounds.top,
                            origin: draftTargetSelection
                          });
                        }}
                      >
                        {(["resize-nw", "resize-ne", "resize-sw", "resize-se"] as const).map(
                          (handle) => (
                            <span
                              key={handle}
                              onMouseDown={(event) => {
                                event.stopPropagation();
                                const image = previewImageRef.current;
                                if (!image || !draftTargetSelection) {
                                  return;
                                }
                                const bounds = image.getBoundingClientRect();
                                setTargetAdjustState({
                                  mode: handle,
                                  startX: event.clientX - bounds.left,
                                  startY: event.clientY - bounds.top,
                                  origin: draftTargetSelection
                                });
                              }}
                              className={`absolute h-3 w-3 rounded-sm border border-amber-200 bg-amber-300 pointer-events-auto ${
                                handle === "resize-nw"
                                  ? "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"
                                  : handle === "resize-ne"
                                  ? "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"
                                  : handle === "resize-sw"
                                  ? "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"
                                  : "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"
                              }`}
                            />
                          )
                        )}
                      </div>
                    );
                  })()
                ) : null}
                {activePreviewRect ? (
                  <div
                    className="pointer-events-none absolute rounded border border-blue-400 bg-blue-400/20"
                    style={{
                      left: activePreviewRect.left,
                      top: activePreviewRect.top,
                      width: activePreviewRect.width,
                      height: activePreviewRect.height
                    }}
                  />
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                {selectedFrameMissingTime
                  ? "Frame missing time_sec."
                  : previewMode === "target" && targetMissingFrameKey
                  ? "Seleziona un frame dove il giocatore è visibile."
                  : previewMode === "target" && targetInvalidReason
                  ? targetInvalidReason
                  : previewMode === "player-ref" && playerRefSelection
                  ? "Bounding box ready. Save to continue."
                  : previewMode === "target" && draftTargetSelection
                  ? "Bounding box ready. Confirm to continue."
                  : previewMode === "target"
                  ? "Drag on the image to adjust the target box."
                  : "Drag on the image to draw the player box."}
              </span>
              {previewMode === "player-ref" ? (
                <button
                  type="button"
                  onClick={handleSavePlayerRef}
                  disabled={!playerRefSelection || savingPlayerRef || playerRefMissingTime}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingPlayerRef ? "Saving..." : "Save selection"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => submitTargetSelection(false, true)}
                  disabled={
                    savingSelection ||
                    !draftTargetSelection ||
                    targetMissingTime ||
                    targetMissingFrameKey ||
                    Boolean(targetInvalidReason)
                  }
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSelection ? "Confirming..." : "Confirm target"}
                </button>
              )}
            </div>

            {playerRefError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {playerRefError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {targetMismatchOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-rose-400/40 bg-slate-900 p-6 shadow-xl"
          >
            <h4 className="text-lg font-semibold text-white">
              Target mismatch
            </h4>
            <p className="mt-2 text-sm text-slate-200">
              Il box non coincide con il giocatore selezionato.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setTargetMismatchOpen(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
              >
                Riprova
              </button>
              {targetMismatchAllowForce ? (
                <button
                  type="button"
                  onClick={async () => {
                    setTargetMismatchOpen(false);
                    await submitTargetSelection(true, true);
                  }}
                  className="rounded-lg bg-rose-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-rose-300"
                >
                  Forza
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {overlayToast ? (
        <div className="fixed bottom-6 right-6 z-[70] max-w-sm rounded-xl border border-amber-400/40 bg-slate-950/95 p-4 text-sm text-amber-100 shadow-xl">
          {overlayToast}
        </div>
      ) : null}
    </div>
  );
}
