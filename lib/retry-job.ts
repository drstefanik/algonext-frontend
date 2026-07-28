import { WorkflowApiError } from "@/lib/workflow-api";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export async function retryJob(
  jobId: string,
  {
    force = false,
    expectedAnalysisAttemptId = null
  }: {
    force?: boolean;
    expectedAnalysisAttemptId?: string | null;
  } = {}
): Promise<void> {
  const response = await fetch(
    `/api/backend/jobs/${encodeURIComponent(jobId)}/retry`,
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
      body: JSON.stringify({
        force,
        ...(expectedAnalysisAttemptId
          ? { expected_analysis_attempt_id: expectedAnalysisAttemptId }
          : {})
      })
    }
  );
  const payload = await response.json().catch(() => ({}));
  const envelope = asRecord(payload);
  if (response.ok && envelope.ok !== false) return;

  const detail = asRecord(envelope.detail);
  const error = asRecord(envelope.error ?? detail.error ?? detail);
  const meta = asRecord(envelope.meta);
  throw new WorkflowApiError({
    status: response.status,
    code: asString(error.code) ?? "RETRY_FAILED",
    message:
      asString(error.message) ??
      "Non è stato possibile riavviare l’analisi.",
    requestId:
      asString(meta.request_id) ??
      asString(envelope.request_id) ??
      response.headers.get("x-request-id"),
    details: error.details ?? null
  });
}
