import { WorkflowApiError } from "@/lib/workflow-api";

export type PlayerProfileInput = {
  playerName?: string;
  teamName?: string;
  shirtNumber?: number;
};

const API_PREFIX = "/api/backend";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const savePlayerProfile = async (
  jobId: string,
  profile: PlayerProfileInput,
  expectedAnalysisAttemptId?: string | null
): Promise<void> => {
  const payload = {
    player_name: profile.playerName?.trim() || null,
    team_name: profile.teamName?.trim() || null,
    shirt_number: profile.shirtNumber ?? null
  };

  const response = await fetch(
    `${API_PREFIX}/jobs/${encodeURIComponent(jobId)}/player-profile`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(expectedAnalysisAttemptId
          ? { "X-Analysis-Attempt-Id": expectedAnalysisAttemptId }
          : {})
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const payload = asRecord(await response.json().catch(() => ({})));
    const detail = asRecord(payload.detail);
    const error = asRecord(payload.error ?? detail.error ?? detail);
    throw new WorkflowApiError({
      status: response.status,
      code: asString(error.code) ?? "PLAYER_PROFILE_SAVE_FAILED",
      message:
        asString(error.message) ?? `Request failed (${response.status})`,
      requestId:
        asString(asRecord(payload.meta).request_id) ??
        asString(payload.request_id) ??
        response.headers.get("x-request-id"),
      details: error.details ?? null
    });
  }
};
