import { deriveAnalysisOutcome } from "../lib/analysis-outcome";
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

assert(succeeded.trackingState === "succeeded", "positive selected tracking should succeed");
assert(succeeded.metricsVisible === true, "selected-player metrics should be visible");
assert(succeeded.observedSamples === 183, "selected observations should be retained");

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

console.log("analysis-outcome tests passed");
