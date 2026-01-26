export type JobWarning = {
  code?: string;
  message?: string;
  reason?: string;
  detail?: string;
};

type WarningInput = string | JobWarning;

const normalizeMessage = (warning: WarningInput): string => {
  if (typeof warning === "string") {
    return warning;
  }
  return (
    warning.message ??
    warning.reason ??
    warning.detail ??
    warning.code ??
    "Warning reported by backend."
  );
};

const normalizeCode = (warning: WarningInput): string | null => {
  if (typeof warning === "string") {
    return null;
  }
  return typeof warning.code === "string" ? warning.code : null;
};

export const extractWarnings = (warnings: unknown) => {
  if (!Array.isArray(warnings)) {
    return { messages: [], codes: [] };
  }

  const messages: string[] = [];
  const codes: string[] = [];

  warnings.forEach((warning) => {
    if (typeof warning === "string") {
      messages.push(normalizeMessage(warning));
      return;
    }
    if (warning && typeof warning === "object") {
      const message = normalizeMessage(warning as JobWarning);
      if (message) {
        messages.push(message);
      }
      const code = normalizeCode(warning as JobWarning);
      if (code) {
        codes.push(code);
      }
    }
  });

  return {
    messages: Array.from(new Set(messages)),
    codes: Array.from(new Set(codes))
  };
};
