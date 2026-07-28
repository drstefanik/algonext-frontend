export const PLAYER_RESELECTION_WARNINGS = new Set([
  "PLAYER_ANCHOR_NOT_FOUND",
  "PLAYER_RESELECTION_REQUIRED"
]);

export type ReselectionRecoveryTransition = {
  clearSelections: boolean;
  clearedJobId: string | null;
};

export const transitionReselectionRecovery = (
  clearedJobId: string | null,
  job: { id: string; warnings: string[] }
): ReselectionRecoveryTransition => {
  const requiresReselection = job.warnings.some((warning) =>
    PLAYER_RESELECTION_WARNINGS.has(warning)
  );
  if (!requiresReselection) {
    return { clearSelections: false, clearedJobId: null };
  }
  return {
    clearSelections: clearedJobId !== job.id,
    clearedJobId: job.id
  };
};
