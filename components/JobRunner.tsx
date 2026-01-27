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
  getJobTrackCandidates,
  listJobFrames,
  normalizeJob,
  selectJobTrack,
  saveJobPlayerRef,
  saveJobTargetSelection,
  type FrameItem,
  type FrameSelection,
  type JobResponse,
  type PreviewFrame,
  type TrackCandidate,
  type TargetSelection
} from "@/lib/api";
import ProgressBar from "@/components/ProgressBar";
import ResultView from "@/components/ResultView";
import { extractWarnings } from "@/lib/warnings";

const roles = ["Striker", "Winger", "Midfielder", "Defender", "Goalkeeper"];
const POLLING_TIMEOUT_MS = 12000;
const REQUIRED_FRAME_COUNT = 8;
const MIN_FRAMES = REQUIRED_FRAME_COUNT;

const FrameSelector = ({ children }: { children: ReactNode }) => <>{children}</>;

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getTimeSec = (x: any): number | null =>
  x?.timeSec ?? x?.time_sec ?? x?.frameTimeSec ?? x?.frame_time_sec ?? null;

const getFrameKey = (x: any): string | null =>
  x?.frameKey ?? x?.frame_key ?? x?.key ?? null;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

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

const mapFrameItemToPreviewFrame = (
  frame: FrameItem,
  index: number
): PreviewFrame => {
  const timeSec = coerceNumber(getTimeSec(frame));
  const key = frame.key ?? `frame-${timeSec}-${index}`;
  return {
    timeSec,
    key,
    url: frame.url,
    signedUrl: frame.url,
    width: frame.width ?? null,
    height: frame.height ?? null
  };
};

const getCandidateSelection = (candidate: TrackCandidate) => {
  const frameTimeSec = getTimeSec(candidate) ?? candidate.t ?? null;
  const { x, y, w, h } = candidate;
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

const buildHttpErrorMessage = async (response: Response) => {
  let message = "";

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
  const [selectingTrackId, setSelectingTrackId] = useState<string | null>(null);
  const [previewDragState, setPreviewDragState] =
    useState<PreviewDragState | null>(null);
  const [refreshingFrames, setRefreshingFrames] = useState(false);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [framesFrozen, setFramesFrozen] = useState(false);
  const [previewPollingError, setPreviewPollingError] = useState<string | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewImageErrors, setPreviewImageErrors] = useState<Record<string, string>>(
    {}
  );
  const [previewPollingActive, setPreviewPollingActive] = useState(false);
  const [previewPollingAttempt, setPreviewPollingAttempt] = useState(0);
  const previewListRequestRef = useRef(0);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const previewModalRef = useRef<HTMLDivElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const playerSectionRef = useRef<HTMLElement | null>(null);
  const pollStartRef = useRef<number | null>(null);

  const resolvePreviewFrameUrl = (frame: PreviewFrame) =>
    frame.signedUrl ?? frame.url ?? "";

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

  const resolvedPreviewFrames = previewFrames;
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
  const hasPlayer = Boolean(job?.playerRef || selectedTrackId);
  const hasTarget =
    Array.isArray(job?.target?.selections) && job.target.selections.length > 0;
  const status = job?.status ?? null;
  const normalizedStatus = typeof status === "string" ? status.toUpperCase() : null;
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
    normalizedStep === "WAITING_FOR_TARGET" || hasTarget || playerSaved;
  const effectiveStep: "PLAYER" | "TARGET" | "PROCESSING" | "IDLE" = !jobId
    ? "IDLE"
    : status === "RUNNING" || status === "QUEUED" || status === "PROCESSING"
      ? "PROCESSING"
      : previewsReady && !hasPlayer
        ? "PLAYER"
        : previewsReady && hasPlayer && !hasTarget
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
    !hasPlayer &&
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
  const canEnqueue = hasPlayer;
  const enqueueHint = !hasPlayer ? "Select a player to start analysis" : "Ready";
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

  const showBestMatchMessage =
    totalTracksCount > 0 && trackCandidates.length === 0 && !loadingTrackCandidates;
  const hasCandidateList =
    trackCandidates.length > 0 || fallbackCandidates.length > 0;
  const [previewImageSize, setPreviewImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

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
    const selectionKey = getFrameKey(selection);
    const frameKey = getFrameKey(frame);
    if (selectionKey && frameKey) {
      return selectionKey === frameKey;
    }
    const selectionTime = getTimeSec(selection);
    const frameTime = getTimeSec(frame);
    if (selectionTime == null || frameTime == null) {
      return false;
    }
    return Math.abs(selectionTime - frameTime) < 0.05;
  };

  const resolveTargetPreviewFrame = (selection: TargetSelection | null) => {
    if (!selection) {
      return null;
    }
    const selectionKey = getFrameKey(selection);
    if (selectionKey) {
      return (
        previewFramesWithImages.find(
          (frame) => getFrameKey(frame) === selectionKey
        ) ?? null
      );
    }
    const targetTime = getTimeSec(selection);
    if (targetTime == null) {
      return null;
    }
    return (
      previewFramesWithImages.find((frame) => {
        const frameTime = getTimeSec(frame);
        return frameTime != null && Math.abs(frameTime - targetTime) < 0.05;
      }) ?? null
    );
  };

  const getSelectionDisplayRect = (
    selection: TargetSelection | FrameSelection | null
  ) => {
    if (!selection || !previewImageSize) {
      return null;
    }
    return {
      left: selection.x * previewImageSize.width,
      top: selection.y * previewImageSize.height,
      width: selection.w * previewImageSize.width,
      height: selection.h * previewImageSize.height
    };
  };

  const getPreviewFrameSrc = (frame: PreviewFrame) => {
    const frameUrl = resolvePreviewFrameUrl(frame);
    if (!frameUrl) {
      return "";
    }
    return `/api/frame-proxy?url=${encodeURIComponent(frameUrl)}`;
  };

  const getCandidateThumbnailSrc = (candidate: TrackCandidate) => {
    const thumbnailUrl = candidate.thumbnailUrl ?? "";
    if (!thumbnailUrl) {
      return "";
    }
    return `/api/frame-proxy?url=${encodeURIComponent(thumbnailUrl)}`;
  };

  const handlePreviewImageError = (frame: PreviewFrame, context: string) => {
    console.error("FRAME_IMG_ERROR", {
      context,
      key: frame.key,
      url: resolvePreviewFrameUrl(frame)
    });
    setPreviewImageErrors((prev) => ({
      ...prev,
      [frame.key]: context
    }));
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
    if (jobTargetSelection) {
      setTargetSelection(jobTargetSelection);
      setDraftTargetSelection(jobTargetSelection);
    }
  }, [jobTargetSelection]);

  useEffect(() => {
    setPlayerSaved(Boolean(job?.playerRef || selectedTrackId));
    if (job?.target?.selections?.length) {
      setTargetSaved(true);
    } else if (!draftTargetSelection) {
      setTargetSaved(false);
    }
  }, [
    job?.playerRef,
    job?.target?.selections?.length,
    selectedTrackId,
    draftTargetSelection
  ]);

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
      previewListRequestRef.current = 0;
      pollStartRef.current = null;
      setPollingTimedOut(false);
      return;
    }
  }, [jobId]);

  useEffect(() => {
    if (jobId) {
      setFramesFrozen(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (showTargetSection) {
      setGridMode("target");
    } else if (showManualPlayerFallback) {
      setGridMode("player-ref");
    }
  }, [showTargetSection, showManualPlayerFallback]);

  useEffect(() => {
    if (!jobId || selectedTrackId) {
      return;
    }

    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const pollIntervalMs = 3000;

    const pollCandidates = async () => {
      if (!isMounted) {
        return;
      }

      setCandidatePolling(true);
      try {
        const { candidates, fallbackCandidates: fallbackList } =
          await getJobTrackCandidates(jobId);
        if (!isMounted) {
          return;
        }
        setTrackCandidates(candidates);
        setFallbackCandidates(fallbackList);
        setShowSecondaryCandidates(false);
        setShowAllCandidates(false);
        setPlayerCandidateError(null);

        if (candidates.length > 0 || fallbackList.length > 0) {
          setCandidatePolling(false);
          return;
        }
      } catch (fetchError) {
        if (!isMounted) {
          return;
        }
        setPlayerCandidateError(toErrorMessage(fetchError));
      }

      timeoutId = setTimeout(pollCandidates, pollIntervalMs);
    };

    pollCandidates();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      setCandidatePolling(false);
    };
  }, [jobId, selectedTrackId]);

  useEffect(() => {
    if (!jobId || !shouldPollFrameList) {
      return;
    }

    let isMounted = true;
    const requestId = Date.now();
    previewListRequestRef.current = requestId;
    let attempts = 0;
    const maxAttempts = 30;
    const intervalMs = 1500;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      setPreviewPollingActive(true);
      listJobFrames(jobId)
        .then(({ items }) => {
          if (!isMounted) {
            return;
          }
          if (previewListRequestRef.current !== requestId) {
            return;
          }

          if (!framesFrozen) {
            const mappedFrames = items.map(mapFrameItemToPreviewFrame);
            setPreviewFrames(mappedFrames);
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
      setError("Seleziona un player per avviare l'analisi.");
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
    setPlayerCandidateError(null);
    setSelectingTrackId(candidate.trackId);
    try {
      await selectJobTrack(jobId, candidate);
      setSelectedTrackId(candidate.trackId);
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
    } catch (selectError) {
      setPlayerCandidateError(toErrorMessage(selectError));
    } finally {
      setSelectingTrackId(null);
    }
  };

  const handleSaveSelection = async () => {
    if (!jobId || !draftTargetSelection) {
      return;
    }
    setSelectionError(null);
    setSelectionSuccess(null);
    setSavingSelection(true);
    try {
      await saveJobTargetSelection(jobId, {
        selections: [draftTargetSelection]
      });
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      setTargetSelection(draftTargetSelection);
      setTargetSaved(true);
      setSelectionSuccess("Selection saved");
    } catch (saveError) {
      setSelectionError(toErrorMessage(saveError));
    } finally {
      setSavingSelection(false);
    }
  };

  const handleOpenPreview = (frame: PreviewFrame, mode: PreviewMode) => {
    if (mode === "target" && !hasPlayer) {
      setError("Select player first.");
      return;
    }
    if (!hasFullPreviewSet && !(isCandidatesFailed && hasAnyPreviewFrames)) {
      setError("Wait for 8/8 preview frames.");
      return;
    }
    setPreviewMode(mode);
    setFramesFrozen(true);
    setSelectedPreviewFrame(frame);
    setPlayerRefSelection(null);
    setPreviewDragState(null);
    setPlayerRefError(null);
    if (mode === "target") {
      setSelectionError(null);
      setSelectionSuccess(null);
      const existingSelection = draftTargetSelection ?? targetSelection;
      if (existingSelection && selectionMatchesFrame(existingSelection, frame)) {
        setDraftTargetSelection(existingSelection);
      } else {
        setDraftTargetSelection(null);
      }
    }
  };

  const handleClosePreview = () => {
    setSelectedPreviewFrame(null);
    setPlayerRefSelection(null);
    setPreviewDragState(null);
  };

  const handlePreviewMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const image = previewImageRef.current;
    if (!image) {
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
          frame_key: selectedPreviewFrame.key,
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
    setSelectingTrackId(null);
    setGridMode("player-ref");
    setPreviewDragState(null);
    setPreviewFrames([]);
    setFramesFrozen(false);
    setPreviewPollingError(null);
    setPreviewPollingActive(false);
    setPreviewPollingAttempt(0);
    setPreviewImageErrors({});
    previewListRequestRef.current = 0;
    pollStartRef.current = null;
    setPollingTimedOut(false);
  };

  const handleSelectTargetFromFrames = () => {
    if (previewFramesWithImages.length === 0) {
      const rawPlayerRef =
        (job ? (job as { playerRefRaw?: unknown }).playerRefRaw : null) ??
        (job ? (job as { player_ref?: unknown }).player_ref : null) ??
        (job ? (job as { playerRef?: unknown }).playerRef : null) ??
        null;
      const rawInputVideoUrl =
        job?.result?.assets?.inputVideoUrl ??
        job?.result?.assets?.input_video_url ??
        (job
          ? (job as { assets?: { inputVideoUrl?: string } }).assets?.inputVideoUrl
          : null) ??
        (job ? (job as { video_url?: string }).video_url : null) ??
        null;
      const previewFramesPayload =
        (job ? (job as { preview_frames?: unknown[] }).preview_frames : null) ??
        (job ? (job as { previewFrames?: unknown[] }).previewFrames : null) ??
        job?.previewFrames ??
        [];
      const missingFields: string[] = [];

      if (!rawPlayerRef) {
        missingFields.push("player_ref/playerRef");
      }
      if (!rawInputVideoUrl) {
        missingFields.push("assets.inputVideoUrl/video_url");
      }
      if (!Array.isArray(previewFramesPayload) || previewFramesPayload.length === 0) {
        missingFields.push("preview_frames");
      }
      if (
        Array.isArray(previewFramesPayload) &&
        previewFramesPayload.length > 0 &&
        resolvedPreviewFrames.every((frame) => !frame.signedUrl)
      ) {
        missingFields.push("signed_url nei frame");
      }

      console.warn("TARGET_FRAME_PICKER_EMPTY", {
        missingFields,
        rawPlayerRef,
        rawInputVideoUrl,
        previewFramesCount: Array.isArray(previewFramesPayload)
          ? previewFramesPayload.length
          : 0
      });
    }
    setSelectionError(null);
    const resolvedTargetFrame = resolveTargetPreviewFrame(
      draftTargetSelection ?? targetSelection
    );
    if (draftTargetSelection ?? targetSelection) {
      if (resolvedTargetFrame) {
        handleOpenPreview(resolvedTargetFrame, "target");
      } else {
        setSelectionError("Impossibile risolvere il frame del target.");
      }
    }
    setGridMode("target");
    playerSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const playerRefMissingTime = playerRefSelection?.frameTimeSec == null;
  const targetMissingTime = getTimeSec(draftTargetSelection) == null;
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
                    Candidate selection
                  </p>
                  <p className="mt-2 text-sm text-slate-200">
                    Choose the player track to follow.
                  </p>
                </div>
                {showPlayerSection ? (
                  <button
                    type="button"
                    onClick={handleRefreshTrackCandidates}
                    disabled={loadingTrackCandidates}
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingTrackCandidates ? "Refreshing..." : "Refresh"}
                  </button>
                ) : null}
              </div>

              {showPlayerSection ? (
                <div className="mt-4 space-y-4">
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
                                  onClick={() => setShowSecondaryCandidates((prev) => !prev)}
                                  className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500"
                                >
                                  {showSecondaryCandidates ? "Show less" : "Show more"}
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
                                  const thumbnailSrc = getCandidateThumbnailSrc(candidate);
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
                                      onClick={() => handleSelectTrack(candidate)}
                                      disabled={isSelecting || isSelected || !hasSelectionData}
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
                                                ? "Click to select"
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
                                  const thumbnailSrc = getCandidateThumbnailSrc(candidate);
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
                                      onClick={() => handleSelectTrack(candidate)}
                                      disabled={isSelecting || isSelected || !hasSelectionData}
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
                                                ? "Click to select"
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
                                  const thumbnailSrc = getCandidateThumbnailSrc(candidate);
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
                                      onClick={() => handleSelectTrack(candidate)}
                                      disabled={isSelecting || isSelected || !hasSelectionData}
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
                                                ? "Click to select"
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
                              const thumbnailSrc = getCandidateThumbnailSrc(candidate);
                              const isSelected = selectedTrackId === candidate.trackId;
                              const isSelecting = selectingTrackId === candidate.trackId;
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
                                  onClick={() => handleSelectTrack(candidate)}
                                  disabled={isSelecting || isSelected || !hasSelectionData}
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
                                            ? "Click to select"
                                            : "Missing selection data"}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
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
                      No candidates available yet.
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
              Images blocked or failed to load. Check the frame proxy or mixed
              content settings.
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
                            onError={() => handlePreviewImageError(frame, "player-grid")}
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
                      <span>Waiting for previews / tracking candidates…</span>
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
                    savingSelection || !draftTargetSelection || targetMissingTime
                  }
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSelection ? "Saving..." : "Save selection"}
                </button>
                <span className="text-xs text-slate-500">
                  {targetMissingTime
                    ? "Frame missing time_sec."
                    : draftTargetSelection
                    ? "Ready to save selection."
                    : "Select one box to continue."}
                </span>
              </div>
            </div>

            {selectionError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {selectionError}
              </div>
            ) : null}
            {selectionSuccess ? (
              <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                {selectionSuccess}
              </div>
            ) : null}
          </div>
        ) : null}

        {job && (job.status === "COMPLETED" || job.status === "PARTIAL") ? (
          <ResultView job={job} />
        ) : null}
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
                  {previewMode === "target" ? "Draw target box" : "Draw player box"}
                </h3>
                <p
                  id="preview-modal-description"
                  className="mt-1 text-sm text-slate-400"
                >
                  {previewMode === "target"
                    ? "Drag to mark the target in the selected frame."
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
                    handlePreviewImageError(selectedPreviewFrame, "preview-modal")
                  }
                />
              )}
              <div className="pointer-events-none absolute inset-0">
                {previewMode === "player-ref" && playerRefSelection ? (
                  (() => {
                    const rect = getSelectionDisplayRect(playerRefSelection);
                    if (!rect) {
                      return null;
                    }
                    return (
                      <div
                        className="absolute rounded border border-emerald-400 bg-emerald-400/20"
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
                        className="absolute rounded border border-amber-400 bg-amber-400/20"
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
                {activePreviewRect ? (
                  <div
                    className="absolute rounded border border-blue-400 bg-blue-400/20"
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
                  : previewMode === "player-ref" && playerRefSelection
                  ? "Bounding box ready. Save to continue."
                  : previewMode === "target" && draftTargetSelection
                  ? "Bounding box ready. Save to continue."
                  : previewMode === "target"
                  ? "Drag on the image to draw the target box."
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
                  onClick={handleClosePreview}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
                >
                  Use selection
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
    </div>
  );
}
