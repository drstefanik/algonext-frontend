type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;

const normalizedAttemptIds = (...values: unknown[]): string[] =>
  values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(asString)
    .filter((value): value is string => value !== null)
    .filter((value, index, all) => all.indexOf(value) === index);

export const getTargetAnalysisAttemptId = (value: unknown): string | null => {
  const source = asRecord(value);
  const ids = normalizedAttemptIds(
    source.analysis_attempt_id,
    source.analysisAttemptId
  );
  return ids.length === 1 ? ids[0] : null;
};

export const analysisAttemptHeaders = (
  expectedAnalysisAttemptId: string | null | undefined
): HeadersInit =>
  expectedAnalysisAttemptId
    ? { "X-Analysis-Attempt-Id": expectedAnalysisAttemptId }
    : {};

export const getResponseAnalysisAttemptId = (
  value: unknown
): string | null => {
  const source = asRecord(value);
  const ids = normalizedAttemptIds(
    source.analysis_attempt_id,
    source.analysisAttemptId,
    getTargetAnalysisAttemptId(source.target)
  );
  return ids.length === 1 ? ids[0] : null;
};
