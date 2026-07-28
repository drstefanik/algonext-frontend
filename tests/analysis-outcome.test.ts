import {
  analysisAttemptHeaders,
  getResponseAnalysisAttemptId,
  getTargetAnalysisAttemptId
} from "../lib/analysis-attempt-client";
import { deriveAnalysisOutcome } from "../lib/analysis-outcome";
import { mayCommitRefresh } from "../lib/refresh-commit-guard";
import { transitionReselectionRecovery } from "../lib/reselection-recovery";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const failed = deriveAnalysisOutcome({
  status: "PARTIAL",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      evaluation_status: "TRACKING_FAILED",
      tracking_quality_index: 11.3,
      tracking_signals: {
        samples_used: 4,
        tracklet_continuity_pct: 33.3
      },
      tracking: {
        tracking_success: false,
        tracking_status: "ANCHOR_NOT_FOUND",
        action_required: "RESELECT_PLAYER",
        metrics_scope: "selected_player",
        bboxes_count: 0,
        windows_processed: 1,
        segments_total: 108,
        segments_with_player: 0,
        anchors_total: 1,
        anchors_matched: 0,
        reid_summary: {
          reason_codes: ["REID_ANCHORS_NOT_FOUND"]
        }
      }
    }
  }
});

assert(failed.pipelineState === "finished", "the pipeline should be technically finished");
assert(failed.trackingState === "failed", "zero-anchor tracking must fail closed");
assert(failed.metricsVisible === false, "legacy 11.3/33.3/4 metrics must stay hidden");
assert(failed.observedSamples === 0, "preview samples must not become player observations");
assert(failed.windowsProcessed === 1, "anchor preflight window count should be retained");
assert(failed.windowsTotal === 108, "full-match window count should be retained");
assert(failed.anchorsMatched === 0, "matched anchor count should be zero");
assert(
  failed.trackingFailureKind === "anchor_missing",
  "an actual anchor miss must retain anchor-missing semantics"
);

const failedWithoutTrackingSamples = deriveAnalysisOutcome({
  status: "PARTIAL",
  progress: {
    stats: { windowsCompleted: null, windowsTotal: 108 }
  },
  result: {
    raw: {
      evaluation_status: "TRACKING_FAILED",
      tracking_signals: {
        samples_used: 4,
        tracklet_continuity_pct: 33.3
      },
      tracking: {
        tracking_success: false,
        tracking_status: "ANCHOR_NOT_FOUND",
        action_required: "RESELECT_PLAYER",
        metrics_scope: "selected_player",
        segments_total: 108,
        segments_with_player: 0,
        anchors_total: 1,
        anchors_matched: 0
      }
    }
  }
});

assert(
  failedWithoutTrackingSamples.observedSamples === 0,
  "preview samples must not leak when tracking omits bboxes_count"
);
assert(
  failedWithoutTrackingSamples.metricsVisible === false,
  "preview-only metrics must remain hidden"
);

const timedOut = deriveAnalysisOutcome({
  status: "PARTIAL",
  progress: {
    stats: { windowsCompleted: 12, windowsTotal: 108 }
  },
  result: {
    raw: {
      evaluation_status: "TRACKING_INCOMPLETE",
      tracking: {
        partial: true,
        partial_reason: "TRACKING_TIMEOUT",
        metrics_scope: "selected_player",
        segments_total: 108,
        segments_with_player: 0,
        reid_summary: {
          status: "PARTIAL_TIMEOUT",
          reason_codes: ["TRACKING_BUDGET_EXHAUSTED"]
        }
      }
    }
  }
});

assert(timedOut.trackingState === "partial", "a budget timeout is not an anchor miss");
assert(timedOut.metricsVisible === false, "incomplete zero-sample tracking has no metrics");

const succeeded = deriveAnalysisOutcome({
  status: "COMPLETED",
  progress: {
    stats: { windowsCompleted: 4, windowsTotal: 4 }
  },
  result: {
    raw: {
      tracking: {
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 183,
        segments_total: 4,
        segments_with_player: 2,
        anchors_total: 4,
        anchors_matched: 4
      }
    }
  }
});

assert(
  succeeded.trackingState === "succeeded",
  "an all-legacy payload without any nonce must remain compatible"
);
assert(succeeded.metricsVisible === true, "selected-player metrics should be visible");
assert(succeeded.observedSamples === 183, "selected observations should be retained");

const newAttemptId = "63d748f7-66a4-485d-adca-d3c7a6067cb0";
const oldAttemptId = "1fdaf4b6-3c5c-4923-b80d-c542df602e96";

type AttemptOverrides = {
  omitTargetTracking?: boolean;
  target?: Record<string, unknown>;
  targetTracking?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  tracking?: Record<string, unknown>;
  declared?: Record<string, unknown>;
};

const coherentBoundOutcome = (overrides: AttemptOverrides = {}) =>
  deriveAnalysisOutcome({
    status: "COMPLETED",
    target: {
      analysis_attempt_id: newAttemptId,
      ...overrides.target,
      ...(overrides.omitTargetTracking
        ? {}
        : {
            tracking: {
              analysis_attempt_id: newAttemptId,
              ...overrides.targetTracking
            }
          })
    },
    progress: {
      analysisAttemptId: newAttemptId,
      analysisAttemptIds: [newAttemptId],
      ...overrides.progress,
      stats: { windowsCompleted: 4, windowsTotal: 4 }
    },
    result: {
      raw: {
        analysis_attempt_id: newAttemptId,
        ...overrides.raw,
        analysis_outcome: {
          analysis_attempt_id: newAttemptId,
          pipeline_state: "DONE",
          tracking_state: "SUCCEEDED",
          metrics_scope: "selected_player",
          ...overrides.declared
        },
        tracking: {
          analysis_attempt_id: newAttemptId,
          tracking_success: true,
          tracking_status: "SUCCEEDED",
          metrics_scope: "selected_player",
          bboxes_count: 99,
          segments_total: 4,
          segments_with_player: 2,
          ...overrides.tracking
        }
      }
    }
  });

const conflictingAttemptAliases = [
  coherentBoundOutcome({ target: { analysisAttemptId: oldAttemptId } }),
  coherentBoundOutcome({
    targetTracking: { analysis_attempt_id: oldAttemptId }
  }),
  coherentBoundOutcome({
    progress: { analysisAttemptIds: [newAttemptId, oldAttemptId] }
  }),
  coherentBoundOutcome({ raw: { analysisAttemptId: oldAttemptId } }),
  coherentBoundOutcome({
    tracking: { analysisAttemptId: oldAttemptId }
  }),
  coherentBoundOutcome({
    declared: { analysisAttemptId: oldAttemptId }
  })
];

for (const [index, outcome] of conflictingAttemptAliases.entries()) {
  assert(
    outcome.analysisAttemptMismatch &&
      outcome.trackingState === "failed" &&
      outcome.metricsVisible === false &&
      outcome.observedSamples === 0,
    `attempt alias conflict ${index + 1} must fail closed`
  );
}

const coherentBoundResult = coherentBoundOutcome();
assert(
  coherentBoundResult.analysisAttemptMismatch === false &&
    coherentBoundResult.trackingState === "succeeded" &&
    coherentBoundResult.metricsVisible === true,
  "coherent attempt aliases must remain visible"
);

const missingTargetTrackingAttempt = coherentBoundOutcome({
  omitTargetTracking: true
});
assert(
  missingTargetTrackingAttempt.analysisAttemptMismatch &&
    missingTargetTrackingAttempt.trackingState === "failed" &&
    missingTargetTrackingAttempt.metricsVisible === false &&
    missingTargetTrackingAttempt.observedSamples === 0,
  "modern attempt evidence must require target.tracking.analysis_attempt_id"
);

const staleAttemptResult = deriveAnalysisOutcome({
  status: "READY_TO_ENQUEUE",
  target: {
    analysis_attempt_id: newAttemptId
  },
  progress: {
    analysisAttemptId: newAttemptId,
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      analysis_attempt_id: oldAttemptId,
      analysis_outcome: {
        analysis_attempt_id: oldAttemptId,
        pipeline_state: "DONE",
        tracking_state: "SUCCEEDED",
        metrics_scope: "selected_player"
      },
      tracking: {
        analysis_attempt_id: oldAttemptId,
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 240,
        segments_total: 108,
        segments_with_player: 12,
        windows_processed: 108,
        anchors_total: 2,
        anchors_matched: 2
      }
    }
  }
});

assert(
  staleAttemptResult.trackingState === "failed",
  "a result from an older attempt must fail closed"
);
assert(
  staleAttemptResult.trackingFailureKind === "technical",
  "attempt mismatches require a technical retry"
);
assert(
  staleAttemptResult.actionRequired === "RETRY_ANALYSIS",
  "attempt mismatches must request a fresh analysis"
);
assert(
  staleAttemptResult.reasonCodes.includes("ANALYSIS_ATTEMPT_MISMATCH"),
  "attempt mismatches must expose an explicit reason"
);
assert(
  staleAttemptResult.analysisAttemptId === newAttemptId,
  "a mismatch must retain the authoritative target attempt for conditional retry"
);
assert(
  staleAttemptResult.metricsVisible === false,
  "metrics from an older attempt must stay hidden"
);
assert(
  staleAttemptResult.observedSamples === 0 &&
    staleAttemptResult.windowsTotal === null &&
    staleAttemptResult.anchorsTotal === null,
  "stale attempt counters must not remain visible in the failure panel"
);

const nestedAttemptMismatch = deriveAnalysisOutcome({
  status: "COMPLETED",
  target: {
    analysis_attempt_id: newAttemptId,
    tracking: {
      analysis_attempt_id: newAttemptId
    }
  },
  progress: {
    analysisAttemptId: newAttemptId,
    stats: { windowsCompleted: 4, windowsTotal: 4 }
  },
  result: {
    raw: {
      analysis_attempt_id: newAttemptId,
      analysis_outcome: {
        analysis_attempt_id: newAttemptId,
        pipeline_state: "DONE",
        tracking_state: "SUCCEEDED",
        metrics_scope: "selected_player"
      },
      tracking: {
        analysis_attempt_id: oldAttemptId,
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 183,
        segments_total: 4,
        segments_with_player: 2
      }
    }
  }
});

assert(
  nestedAttemptMismatch.trackingState === "failed" &&
    nestedAttemptMismatch.metricsVisible === false,
  "a nested tracking nonce mismatch must fail closed"
);

const partialAttemptMismatch = deriveAnalysisOutcome({
  status: "PARTIAL",
  target: {
    analysis_attempt_id: newAttemptId
  },
  progress: {
    stats: { windowsCompleted: 4, windowsTotal: 4 }
  },
  result: {
    raw: {
      analysis_outcome: {
        analysis_attempt_id: oldAttemptId,
        tracking_state: "SUCCEEDED",
        metrics_scope: "selected_player"
      },
      tracking: {
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 183
      }
    }
  }
});

assert(
  partialAttemptMismatch.trackingState === "failed" &&
    partialAttemptMismatch.reasonCodes.includes("ANALYSIS_ATTEMPT_MISMATCH"),
  "discordant partial nonce copies must fail closed"
);

const taggedCurrentWithUntaggedEvidence = deriveAnalysisOutcome({
  status: "COMPLETED",
  target: {
    analysis_attempt_id: newAttemptId
  },
  progress: {
    analysisAttemptId: newAttemptId,
    stats: { windowsCompleted: 4, windowsTotal: 4 }
  },
  result: {
    raw: {
      tracking: {
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 183,
        segments_total: 4,
        segments_with_player: 2
      }
    }
  }
});

assert(
  taggedCurrentWithUntaggedEvidence.trackingState === "failed" &&
    taggedCurrentWithUntaggedEvidence.metricsVisible === false &&
    taggedCurrentWithUntaggedEvidence.reasonCodes.includes(
      "ANALYSIS_ATTEMPT_MISMATCH"
    ),
  "tagged current state must reject untagged tracking evidence"
);

const taggedResultWithUntaggedNestedEvidence = deriveAnalysisOutcome({
  status: "COMPLETED",
  target: {
    analysis_attempt_id: newAttemptId
  },
  progress: {
    analysisAttemptId: newAttemptId,
    stats: { windowsCompleted: 4, windowsTotal: 4 }
  },
  result: {
    raw: {
      analysis_attempt_id: newAttemptId,
      tracking: {
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 183,
        segments_total: 4,
        segments_with_player: 2
      }
    }
  }
});

assert(
  taggedResultWithUntaggedNestedEvidence.trackingState === "failed" &&
    taggedResultWithUntaggedNestedEvidence.metricsVisible === false,
  "a tagged result must reject untagged nested tracking/outcome evidence"
);

const coherentPreTrackingAttempt = deriveAnalysisOutcome({
  status: "QUEUED",
  target: {
    analysis_attempt_id: newAttemptId
  },
  progress: {
    analysisAttemptId: newAttemptId,
    stats: { windowsCompleted: null, windowsTotal: null }
  },
  result: {
    raw: {
      analysis_attempt_id: newAttemptId,
      assets: {
        input_video: {
          bucket: "fnh",
          key: "jobs/job-1/input.mp4"
        }
      }
    }
  }
});

assert(
  coherentPreTrackingAttempt.trackingState === "unverified" &&
    !coherentPreTrackingAttempt.reasonCodes.includes(
      "ANALYSIS_ATTEMPT_MISMATCH"
    ),
  "a coherent pre-tracking reset must not require evidence that does not exist yet"
);

const coherentAttemptResult = deriveAnalysisOutcome({
  status: "COMPLETED",
  target: {
    analysis_attempt_id: newAttemptId,
    tracking: {
      analysis_attempt_id: newAttemptId
    }
  },
  progress: {
    analysisAttemptId: newAttemptId,
    stats: { windowsCompleted: 4, windowsTotal: 4 }
  },
  result: {
    raw: {
      analysis_attempt_id: newAttemptId,
      analysis_outcome: {
        analysis_attempt_id: newAttemptId,
        pipeline_state: "DONE",
        tracking_state: "SUCCEEDED",
        metrics_scope: "selected_player"
      },
      tracking: {
        analysis_attempt_id: newAttemptId,
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 183,
        segments_total: 4,
        segments_with_player: 2,
        anchors_total: 4,
        anchors_matched: 4
      }
    }
  }
});

assert(
  coherentAttemptResult.trackingState === "succeeded" &&
    coherentAttemptResult.metricsVisible === true &&
    coherentAttemptResult.observedSamples === 183,
  "coherent attempt copies must preserve the successful result"
);

const anchorOnly = deriveAnalysisOutcome({
  status: "WAITING_FOR_PLAYER",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      analysis_outcome: {
        pipeline_state: "DONE",
        tracking_state: "FAILED"
      },
      tracking: {
        tracking_success: false,
        tracking_status: "ANCHOR_ONLY",
        action_required: "RESELECT_PLAYER",
        metrics_scope: "selected_player",
        bboxes_count: 18,
        segments_total: 108,
        segments_with_player: 2,
        autonomous_segments_with_player: 0,
        anchors_total: 2,
        anchors_matched: 2,
        reid_summary: {
          reason_codes: ["AUTONOMOUS_REID_NOT_PROVEN"]
        }
      }
    }
  }
});

assert(anchorOnly.trackingState === "failed", "anchor-only tracking must fail closed");
assert(
  anchorOnly.pipelineState === "finished",
  "a completed 108/108 attempt must remain technically finished"
);
assert(anchorOnly.anchorsMatched === 2, "matched anchors must remain visible");
assert(anchorOnly.metricsVisible === false, "anchor-only metrics must stay hidden");
assert(
  anchorOnly.trackingFailureKind === "autonomous_unproven",
  "anchor-only tracking must explain that autonomous ReID was not proven"
);

const sparseCrossWindow = deriveAnalysisOutcome({
  status: "PARTIAL",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      tracking: {
        tracking_success: true,
        tracking_status: "SPARSE_CROSS_WINDOW_EVIDENCE",
        metrics_scope: "selected_player",
        bboxes_count: 24,
        segments_total: 108,
        segments_with_player: 3,
        autonomous_segments_with_player: 1,
        anchors_total: 2,
        anchors_matched: 2
      }
    }
  }
});

assert(
  sparseCrossWindow.trackingState === "partial",
  "sparse cross-window evidence must not look fully successful"
);
assert(
  sparseCrossWindow.metricsVisible === true,
  "truthful selected-player diagnostics may remain visible"
);
assert(
  sparseCrossWindow.reasonCodes.includes("SPARSE_CROSS_WINDOW_EVIDENCE"),
  "the sparse status must be exposed as a user-visible reason"
);

const succeededWithoutValidatedScore = deriveAnalysisOutcome({
  status: "PARTIAL",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      evaluation_status: "TRACKING_ONLY",
      tracking: {
        tracking_success: true,
        tracking_status: "SUCCEEDED",
        metrics_scope: "selected_player",
        bboxes_count: 240,
        segments_total: 108,
        segments_with_player: 12,
        anchors_total: 2,
        anchors_matched: 2
      }
    }
  }
});

assert(
  succeededWithoutValidatedScore.trackingState === "succeeded",
  "a withheld score must not downgrade successful tracking"
);

const rejectedAnchor = deriveAnalysisOutcome({
  status: "WAITING_FOR_PLAYER",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      analysis_outcome: {
        pipeline_state: "DONE",
        tracking_state: "FAILED"
      },
      tracking: {
        tracking_success: false,
        tracking_status: "ANCHOR_REJECTED",
        action_required: "RESELECT_PLAYER",
        metrics_scope: "selected_player",
        bboxes_count: 0,
        segments_total: 108,
        segments_with_player: 0,
        anchors_total: 2,
        anchors_matched: 2,
        reid_summary: {
          reason_codes: ["ANCHOR_TRACK_COLOR_UNVERIFIED"]
        }
      }
    }
  }
});

assert(
  rejectedAnchor.trackingFailureKind === "anchor_rejected",
  "a color-guard rejection must not be reported as an anchor miss"
);

const technicalRetry = deriveAnalysisOutcome({
  status: "FAILED",
  progress: {
    stats: { windowsCompleted: 1, windowsTotal: 108 }
  },
  result: {
    raw: {
      tracking: {
        tracking_success: false,
        tracking_status: "ANCHOR_ACQUISITION_ERROR",
        action_required: "RETRY_ANALYSIS",
        metrics_scope: "selected_player",
        bboxes_count: 0,
        anchors_total: 2,
        anchors_matched: 0,
        reid_summary: {
          reason_codes: ["REID_ANCHOR_ACQUISITION_ERROR"]
        }
      }
    }
  }
});

assert(
  technicalRetry.trackingFailureKind === "technical",
  "a retryable acquisition error must not blame the player selection"
);

const technicalGuardRetry = deriveAnalysisOutcome({
  status: "FAILED",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      tracking: {
        tracking_success: false,
        tracking_status: "TEAM_COLOR_GUARD_ERROR",
        action_required: "RETRY_ANALYSIS",
        metrics_scope: "selected_player",
        bboxes_count: 0,
        anchors_total: 2,
        anchors_matched: 2
      }
    }
  }
});

assert(
  technicalGuardRetry.trackingFailureKind === "technical",
  "a guard implementation error must keep technical-retry semantics"
);

const unverifiedLegacyFallback = deriveAnalysisOutcome({
  status: "FAILED",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      tracking: {
        tracking_success: false,
        tracking_status: "REID_FALLBACK_LEGACY_UNVERIFIED",
        action_required: "RETRY_ANALYSIS",
        metrics_scope: "selected_player",
        bboxes_count: 12,
        segments_total: 108,
        segments_with_player: 2,
        reid_summary: {
          status: "FALLBACK_LEGACY",
          reason_codes: ["IDENTITY_UNVERIFIED_LEGACY_FALLBACK"]
        }
      }
    }
  }
});

assert(
  unverifiedLegacyFallback.trackingState === "failed",
  "legacy fallback must never count as selected-player success"
);
assert(
  unverifiedLegacyFallback.metricsVisible === false,
  "unverified legacy fallback observations must remain hidden"
);
assert(
  unverifiedLegacyFallback.trackingFailureKind === "technical",
  "legacy fallback requires a technical retry"
);

const disabledLegacyPayload = deriveAnalysisOutcome({
  status: "COMPLETED",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      analysis_outcome: {
        tracking_state: "UNVERIFIED"
      },
      tracking: {
        metrics_scope: "selected_player",
        bboxes_count: 12,
        segments_total: 108,
        segments_with_player: 2,
        reid_summary: {
          status: "DISABLED",
          validated: false,
          reason_codes: ["PLAYER_REID_DISABLED"]
        }
      }
    }
  }
});

assert(
  disabledLegacyPayload.trackingState === "unverified",
  "disabled ReID cannot inherit success from legacy bounding boxes"
);
assert(
  disabledLegacyPayload.metricsVisible === false,
  "disabled ReID cannot expose legacy selected-player metrics"
);

const unattestedLegacyPayload = deriveAnalysisOutcome({
  status: "COMPLETED",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      tracking: {
        metrics_scope: "selected_player",
        bboxes_count: 20,
        segments_total: 108,
        segments_with_player: 3
      }
    }
  }
});

assert(
  unattestedLegacyPayload.trackingState === "unverified",
  "quantitative legacy evidence is not an identity attestation"
);
assert(
  unattestedLegacyPayload.metricsVisible === false,
  "unattested legacy metrics must stay hidden"
);

const declaredHistoricalSuccess = deriveAnalysisOutcome({
  status: "COMPLETED",
  progress: {
    stats: { windowsCompleted: 108, windowsTotal: 108 }
  },
  result: {
    raw: {
      analysis_outcome: {
        tracking_state: "SUCCEEDED"
      },
      tracking: {
        metrics_scope: "selected_player",
        bboxes_count: 20,
        segments_total: 108,
        segments_with_player: 3
      }
    }
  }
});

assert(
  declaredHistoricalSuccess.trackingState === "succeeded",
  "an explicit historical success attestation remains compatible"
);
assert(
  declaredHistoricalSuccess.metricsVisible === true,
  "explicitly attested historical metrics remain visible"
);

const unattestedPartial = deriveAnalysisOutcome({
  status: "PARTIAL",
  progress: {
    stats: { windowsCompleted: 12, windowsTotal: 108 }
  },
  result: {
    raw: {
      tracking: {
        partial: true,
        partial_reason: "TRACKING_TIMEOUT",
        metrics_scope: "selected_player",
        bboxes_count: 8,
        segments_total: 108,
        segments_with_player: 2
      }
    }
  }
});

assert(
  unattestedPartial.trackingState === "partial",
  "an incomplete payload remains partial without identity attestation"
);
assert(
  unattestedPartial.metricsVisible === false,
  "partial unattested observations cannot expose selected-player metrics"
);

const unscoped = deriveAnalysisOutcome({
  status: "COMPLETED",
  progress: {
    stats: { windowsCompleted: null, windowsTotal: null }
  },
  result: {
    raw: {
      tracking: {
        tracking_success: true,
        bboxes_count: 20
      }
    }
  }
});

assert(
  unscoped.metricsVisible === false,
  "metrics without selected-player provenance must stay hidden"
);

const firstRecovery = transitionReselectionRecovery(null, {
  id: "job-1",
  warnings: ["PLAYER_RESELECTION_REQUIRED"]
});
assert(firstRecovery.clearSelections, "the first recovery poll clears stale selections");

const repeatedRecovery = transitionReselectionRecovery(firstRecovery.clearedJobId, {
  id: "job-1",
  warnings: ["PLAYER_ANCHOR_NOT_FOUND", "PLAYER_RESELECTION_REQUIRED"]
});
assert(
  repeatedRecovery.clearSelections === false,
  "later polls must preserve the user's in-progress replacement anchors"
);

const recoveryCleared = transitionReselectionRecovery(repeatedRecovery.clearedJobId, {
  id: "job-1",
  warnings: []
});
assert(recoveryCleared.clearedJobId === null, "a successful reset closes the recovery epoch");

const nextRecovery = transitionReselectionRecovery(recoveryCleared.clearedJobId, {
  id: "job-1",
  warnings: ["PLAYER_RESELECTION_REQUIRED"]
});
assert(nextRecovery.clearSelections, "a later failed attempt starts a new recovery epoch");

let refreshEpoch = 1;
let refreshSequence = 0;
const committedRefreshes: string[] = [];
const delayedAttemptA = {
  epoch: refreshEpoch,
  sequence: ++refreshSequence
};
refreshEpoch += 1;
refreshSequence += 1;
const currentAttemptB = {
  epoch: refreshEpoch,
  sequence: ++refreshSequence
};
if (mayCommitRefresh(currentAttemptB, refreshEpoch, refreshSequence)) {
  committedRefreshes.push("attempt-b");
}
if (mayCommitRefresh(delayedAttemptA, refreshEpoch, refreshSequence)) {
  committedRefreshes.push("attempt-a");
}
assert(
  committedRefreshes.join(",") === "attempt-b",
  "a delayed refresh from attempt A must not overwrite attempt B"
);

const legacyPickResponse = {
  target: {
    confirmed: false,
    tracking: { status: "PENDING" }
  }
};
const legacyPickAttempt = getResponseAnalysisAttemptId(legacyPickResponse);
assert(
  legacyPickAttempt === null &&
    Object.keys(analysisAttemptHeaders(legacyPickAttempt)).length === 0,
  "frontend-first rollout must keep old-backend mutation requests body-compatible"
);

const fencedPickAttempt = getResponseAnalysisAttemptId({
  analysis_attempt_id: newAttemptId,
  target: { analysis_attempt_id: newAttemptId }
});
assert(
  fencedPickAttempt === newAttemptId &&
    (analysisAttemptHeaders(fencedPickAttempt) as Record<string, string>)[
      "X-Analysis-Attempt-Id"
    ] === newAttemptId,
  "new-backend mutations must echo the rotated attempt in the precondition header"
);
assert(
  getTargetAnalysisAttemptId({
    analysis_attempt_id: newAttemptId,
    analysisAttemptId: oldAttemptId
  }) === null,
  "conflicting target aliases must never produce a mutation precondition"
);

console.log("analysis-outcome tests passed");
