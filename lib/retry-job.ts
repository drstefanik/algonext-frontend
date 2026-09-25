import { request } from "./workflow-api";

export async function retryJob(
  jobId: string,
  { force = false, expectedAnalysisAttemptId = null }: {
    force?: boolean;
    expectedAnalysisAttemptId?: string | null;
  } = {}
): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    headers: expectedAnalysisAttemptId
      ? { "X-Analysis-Attempt-Id": expectedAnalysisAttemptId }
      : {},
    body: JSON.stringify({
      force,
      ...(expectedAnalysisAttemptId
        ? { expected_analysis_attempt_id: expectedAnalysisAttemptId }
        : {})
    })
  });
}
