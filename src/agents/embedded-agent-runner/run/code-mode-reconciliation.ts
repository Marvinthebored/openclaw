import { validateToolArguments } from "@openclaw/ai/validation";
import { stableStringify } from "@openclaw/normalization-core";
import { Type } from "typebox";
import { normalizeToolPolicyName } from "../../tool-policy.js";
import type { AnyAgentTool } from "../../tools/common.js";
import { asToolParamsRecord, ToolInputError, textResult } from "../../tools/common.js";
import type {
  CodeModeReconciliationPlan,
  CodeModeReconciliationPlanEntry,
  EmbeddedRunTerminalRetryState,
} from "./terminal-retry-state.js";
import type { EmbeddedRunAttemptResult } from "./types.js";

export type {
  CodeModeReconciliationPlan,
  CodeModeReconciliationPlanEntry,
} from "./terminal-retry-state.js";

const CODE_MODE_RECONCILIATION_PROMPT =
  "OpenClaw activated this recovery attempt because the previous Code Mode mutation may have partially applied. This is the only recovery attempt. First use read by itself to determine the authoritative current state and wait for its result. In a later turn, call recovery_propose exactly once with every remaining tool call in required execution order; it records exact pending work without executing it and ends reconciliation. Include only work that inspection proves did not happen. If no work remains, report the authoritative state without calling recovery_propose.";
export const CODE_MODE_POST_RECONCILIATION_INSTRUCTION =
  "The previous uncertain Code Mode mutation has now been reconciled. Execute only the exact pending calls recorded during reconciliation. OpenClaw rejects unplanned calls and consumes each plan entry before execution, so failed calls cannot be replayed.";

const RECONCILIATION_TOOL_NAMES = new Set(["read"]);
const TURN_ENDING_TOOL_NAMES = new Set([
  "ask_user",
  "message",
  "sessions_yield",
  "structured_output",
]);
export const CODE_MODE_RECONCILIATION_PROPOSAL_TOOL_NAME = "recovery_propose";
const MAX_RECONCILIATION_PLAN_CALLS = 32;
const MAX_RECONCILIATION_PLAN_ARGUMENT_BYTES = 64 * 1024;
const MAX_RECONCILIATION_ATTEMPTS = 2;

export function isCodeModeReconciliationTool(tool: { name?: string }): boolean {
  return RECONCILIATION_TOOL_NAMES.has(normalizeToolPolicyName(tool.name ?? ""));
}

function assertPlanEntryMatches(
  entry: CodeModeReconciliationPlanEntry | undefined,
  params: { toolName: string; args: unknown },
): void {
  if (
    !entry ||
    entry.toolName !== normalizeToolPolicyName(params.toolName) ||
    entry.argumentsKey !== stableStringify(params.args)
  ) {
    throw new ToolInputError(
      "This call is not the next pending operation recorded during Code Mode reconciliation.",
    );
  }
}

function proposalTool(
  allowedTools: ReadonlyMap<
    string,
    Pick<AnyAgentTool, "description" | "name" | "parameters" | "prepareArguments"> & {
      terminal: boolean;
    }
  >,
  plan: CodeModeReconciliationPlan,
): AnyAgentTool {
  return {
    name: CODE_MODE_RECONCILIATION_PROPOSAL_TOOL_NAME,
    label: "Recovery proposal",
    description:
      "Record the complete ordered recovery plan without executing it, then end reconciliation.",
    parameters: Type.Object(
      {
        calls: Type.Array(
          Type.Object(
            {
              tool: Type.String(),
              arguments: Type.Record(Type.String(), Type.Unknown()),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: MAX_RECONCILIATION_PLAN_CALLS },
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_toolCallId, input) => {
      if (!plan.readObserved) {
        throw new ToolInputError(
          "Inspect with read and wait for its result before proposing work.",
        );
      }
      const params = asToolParamsRecord(input);
      if (!Array.isArray(params.calls) || params.calls.length === 0) {
        throw new ToolInputError("Recovery proposal requires at least one call.");
      }
      const calls = params.calls;
      if (calls.length > MAX_RECONCILIATION_PLAN_CALLS) {
        throw new ToolInputError("Recovery proposal has too many calls.");
      }
      if (plan.entries.length > 0) {
        throw new ToolInputError("A recovery plan has already been recorded.");
      }
      const entries = calls.map((inputCall, index): CodeModeReconciliationPlanEntry => {
        const call = asToolParamsRecord(inputCall);
        if (typeof call.tool !== "string") {
          throw new ToolInputError("Recovery proposal requires a tool name.");
        }
        const toolName = normalizeToolPolicyName(call.tool);
        const tool = allowedTools.get(toolName);
        if (!tool || isCodeModeReconciliationTool({ name: toolName })) {
          throw new ToolInputError("Recovery proposal names an unavailable tool.");
        }
        const proposedArguments = asToolParamsRecord(call.arguments);
        const preparedArguments = asToolParamsRecord(
          tool.prepareArguments ? tool.prepareArguments(proposedArguments) : proposedArguments,
        );
        const args = validateToolArguments(tool, {
          type: "toolCall",
          id: "recovery-proposal",
          name: tool.name,
          arguments: preparedArguments,
        });
        const argumentsKey = stableStringify(args);
        if (
          new TextEncoder().encode(`${toolName}\n${argumentsKey}`).byteLength >
          MAX_RECONCILIATION_PLAN_ARGUMENT_BYTES
        ) {
          throw new ToolInputError("Recovery proposal arguments are too large.");
        }
        const terminal = tool.terminal;
        if (terminal && index !== calls.length - 1) {
          throw new ToolInputError("A turn-ending recovery call must be the final planned call.");
        }
        const entry: CodeModeReconciliationPlanEntry = {
          toolName,
          argumentsKey,
          consumed: false,
        };
        if (terminal) {
          entry.terminal = true;
        }
        return entry;
      });
      plan.entries.push(...entries);
      return {
        ...textResult("Recovery plan recorded; no action was executed.", {
          recoveryProposal: true,
        }),
        terminate: true,
      };
    },
  };
}

export function validateCodeModeReconciliationCalls(
  plan: CodeModeReconciliationPlan,
  calls: readonly { toolCall: { id: string; name: string }; args: unknown }[],
): Map<string, CodeModeReconciliationPlanEntry> {
  const pending = plan.entries.filter((entry) => !entry.consumed);
  if (calls.length > pending.length) {
    throw new ToolInputError("Recovery attempted more calls than were recorded.");
  }
  const admitted = new Map<string, CodeModeReconciliationPlanEntry>();
  calls.forEach((call, index) => {
    const entry = pending[index];
    assertPlanEntryMatches(entry, { toolName: call.toolCall.name, args: call.args });
    if (entry) {
      admitted.set(call.toolCall.id, entry);
    }
  });
  return admitted;
}

export function commitCodeModeReconciliationCalls(
  plan: CodeModeReconciliationPlan,
  admitted: ReadonlyMap<string, CodeModeReconciliationPlanEntry>,
  calls: readonly { toolCallId: string; args: unknown }[],
): void {
  for (const call of calls) {
    const entry = admitted.get(call.toolCallId);
    const next = plan.entries.find((candidate) => !candidate.consumed);
    if (!entry || entry !== next) {
      throw new ToolInputError("Recovery operation order changed before execution.");
    }
    // The batch gate already matched model-authored arguments. This boundary sees
    // the trusted tool preparer and policy-hook result, which is authoritative.
    entry.argumentsKey = stableStringify(call.args);
    entry.consumed = true;
  }
}

/** Build the bounded capture surface or the exact planned execution surface. */
export function applyCodeModeReconciliationPlan(params: {
  tools: AnyAgentTool[];
  clientTools?: readonly {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }[];
  plan: CodeModeReconciliationPlan;
  capture: boolean;
}): AnyAgentTool[] {
  if (params.capture) {
    const allowedTools = new Map(
      params.tools.map(
        (tool) =>
          [
            normalizeToolPolicyName(tool.name),
            {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              prepareArguments: tool.prepareArguments,
              terminal: TURN_ENDING_TOOL_NAMES.has(normalizeToolPolicyName(tool.name)),
            },
          ] as const,
      ),
    );
    for (const clientTool of params.clientTools ?? []) {
      const normalized = normalizeToolPolicyName(clientTool.name);
      if (!allowedTools.has(normalized)) {
        const clientParameters =
          clientTool.parameters ?? Type.Object({}, { additionalProperties: true });
        // SAFETY: provider client parameters are JSON Schema objects accepted by this boundary.
        const parameters = clientParameters as AnyAgentTool["parameters"];
        allowedTools.set(normalized, {
          name: clientTool.name,
          description: clientTool.description ?? "",
          parameters,
          prepareArguments: undefined,
          terminal: true,
        });
      }
    }
    const read = params.tools.find((tool) => isCodeModeReconciliationTool(tool));
    return [...(read ? [read] : []), proposalTool(allowedTools, params.plan)];
  }
  const plannedNames = new Set(
    params.plan.entries.filter((entry) => !entry.consumed).map((entry) => entry.toolName),
  );
  const plannedTools = params.tools.filter((tool) =>
    plannedNames.has(normalizeToolPolicyName(tool.name)),
  );
  for (const tool of plannedTools) {
    tool.executionMode = "sequential";
  }
  return plannedTools;
}

function isQuiescentCodeModeRecoveryAttempt(params: {
  attempt: EmbeddedRunAttemptResult;
  hostOwnsToolSurface: boolean;
}): boolean {
  const { attempt } = params;
  return (
    attempt.terminal.kind === "ok" &&
    params.hostOwnsToolSurface &&
    attempt.itemLifecycle.activeCount === 0 &&
    attempt.itemLifecycle.startedCount === attempt.itemLifecycle.completedCount &&
    !attempt.clientToolCalls &&
    !attempt.yieldDetected &&
    !attempt.didSendDeterministicApprovalPrompt &&
    !attempt.runtimeContinuationStarted &&
    !attempt.toolMetas.some((entry) => entry.asyncStarted === true) &&
    (attempt.acceptedSessionSpawns?.length ?? 0) === 0 &&
    !attempt.didSendViaMessagingTool &&
    (attempt.successfulCronAdds ?? 0) === 0
  );
}

function shouldRetryCodeModeReconciliation(
  params: Parameters<typeof isQuiescentCodeModeRecoveryAttempt>[0],
): boolean {
  return (
    params.attempt.codeModeReconciliationCandidate === true &&
    isQuiescentCodeModeRecoveryAttempt(params)
  );
}

function hasSuccessfulCodeModeReconciliationRead(attempt: EmbeddedRunAttemptResult): boolean {
  return attempt.toolMetas.some(
    (entry) =>
      normalizeToolPolicyName(entry.toolName) === "read" &&
      entry.isError !== true &&
      entry.terminate !== true &&
      entry.asyncStarted !== true,
  );
}

function hasCompletedCodeModeReconciliationReport(attempt: EmbeddedRunAttemptResult): boolean {
  const assistant = attempt.currentAttemptCompletedAssistant;
  return (
    assistant?.stopReason === "stop" &&
    !assistant.content.some((entry) => entry.type === "toolCall") &&
    assistant.content.some((entry) => entry.type === "text" && entry.text.trim().length > 0)
  );
}

function hasCompletedCodeModeReconciliationProposal(attempt: EmbeddedRunAttemptResult): boolean {
  return attempt.toolMetas.some(
    (entry) =>
      normalizeToolPolicyName(entry.toolName) === CODE_MODE_RECONCILIATION_PROPOSAL_TOOL_NAME &&
      entry.isError !== true &&
      entry.terminate === true,
  );
}

export function activateCodeModeReconciliation(params: {
  attempt: EmbeddedRunAttemptResult;
  hostOwnsToolSurface: boolean;
  retryState: EmbeddedRunTerminalRetryState;
  activateInternalPrompt: (prompt: string) => void;
}): boolean {
  const pendingPlan = params.retryState.codeModeReconciliationPlan?.entries.some(
    (entry) => !entry.consumed,
  );
  if (params.retryState.disableCodeModeForReconciledContinuation && pendingPlan) {
    if (params.attempt.clientToolCalls) {
      return false;
    }
    if (
      !isQuiescentCodeModeRecoveryAttempt({
        attempt: params.attempt,
        hostOwnsToolSurface: params.hostOwnsToolSurface,
      }) ||
      params.attempt.lastToolError !== undefined ||
      params.attempt.toolMetas.some((entry) => entry.isError === true || entry.terminate === true)
    ) {
      return false;
    }
    if (params.retryState.codeModeReconciliationAttempts >= MAX_RECONCILIATION_ATTEMPTS) {
      throw new Error("Code Mode recovery ended with pending planned calls.");
    }
    params.retryState.codeModeReconciliationAttempts += 1;
    params.activateInternalPrompt(
      "Recovery still has recorded calls pending. Execute every available planned call before answering.",
    );
    return true;
  }
  if (params.retryState.forceCodeModeReconciliationTools) {
    const completedProposal = hasCompletedCodeModeReconciliationProposal(params.attempt);
    const isSupersededProposalError = (entry: { toolName: string }) =>
      completedProposal &&
      normalizeToolPolicyName(entry.toolName) === CODE_MODE_RECONCILIATION_PROPOSAL_TOOL_NAME;
    if (
      !isQuiescentCodeModeRecoveryAttempt({
        attempt: params.attempt,
        hostOwnsToolSurface: params.hostOwnsToolSurface,
      }) ||
      (params.attempt.lastToolError !== undefined &&
        !isSupersededProposalError(params.attempt.lastToolError)) ||
      params.attempt.toolMetas.some(
        (entry) =>
          (entry.isError === true && !isSupersededProposalError(entry)) ||
          (entry.terminate === true &&
            normalizeToolPolicyName(entry.toolName) !==
              CODE_MODE_RECONCILIATION_PROPOSAL_TOOL_NAME),
      ) ||
      !hasSuccessfulCodeModeReconciliationRead(params.attempt) ||
      (!completedProposal && !hasCompletedCodeModeReconciliationReport(params.attempt))
    ) {
      return false;
    }
    params.retryState.forceCodeModeReconciliationTools = false;
    params.retryState.disableCodeModeForReconciledContinuation = true;
    params.activateInternalPrompt("Execute the reconciled recovery plan with the available tools.");
    return true;
  }
  if (
    params.retryState.codeModeReconciliationAttempts >= 1 ||
    !shouldRetryCodeModeReconciliation({
      attempt: params.attempt,
      hostOwnsToolSurface: params.hostOwnsToolSurface,
    })
  ) {
    return false;
  }
  params.retryState.codeModeReconciliationAttempts += 1;
  params.retryState.forceCodeModeReconciliationTools = true;
  params.retryState.codeModeReconciliationPlan = { entries: [], readObserved: false };
  params.activateInternalPrompt(CODE_MODE_RECONCILIATION_PROMPT);
  return true;
}
