export const MAX_BEFORE_AGENT_FINALIZE_REVISIONS = 3;

export type CodeModeReconciliationPlanEntry = {
  toolName: string;
  argumentsKey: string;
  consumed: boolean;
  terminal?: boolean;
};

export type CodeModeReconciliationPlan = {
  entries: CodeModeReconciliationPlanEntry[];
  readObserved: boolean;
};

export type EmbeddedRunTerminalRetryState = {
  reasoningOnlyAttempts: number;
  emptyResponseAttempts: number;
  missingAssistantAttempts: number;
  compactionContinuationAttempts: number;
  compactionContinuationInstruction: string | null;
  beforeFinalizeRevisionAttempts: number;
  codeModeReconciliationAttempts: number;
  forceCodeModeReconciliationTools: boolean;
  disableCodeModeForReconciledContinuation: boolean;
  codeModeReconciliationPlan?: CodeModeReconciliationPlan;
};

export function createEmbeddedRunTerminalRetryState(): EmbeddedRunTerminalRetryState {
  return {
    reasoningOnlyAttempts: 0,
    emptyResponseAttempts: 0,
    missingAssistantAttempts: 0,
    compactionContinuationAttempts: 0,
    compactionContinuationInstruction: null,
    beforeFinalizeRevisionAttempts: 0,
    codeModeReconciliationAttempts: 0,
    forceCodeModeReconciliationTools: false,
    disableCodeModeForReconciledContinuation: false,
  };
}
