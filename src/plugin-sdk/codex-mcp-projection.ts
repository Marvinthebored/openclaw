// Private thread-configuration projections for the bundled Codex plugin.
// Workspace preparation and MCP metadata remain separate from live run resources.
import { pinExecToolTarget } from "../agents/exec-tool-target-pinning.js";
import type { AgentHarnessHostCapabilities } from "../agents/harness/host-capability-types.js";
import {
  resolveAgentHarnessScheduledToolProjectionCapability,
  resolveAgentHarnessTtsProvenanceTransferCapability,
  type AgentHarnessScheduledToolProjectionFactory,
  type AgentHarnessTtsProvenanceTransfer,
} from "../agents/harness/host-private-capabilities.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type {
  CronCreatorToolAllowlistEntry,
  CronToolsAllowCaptureRef,
} from "../agents/tools/cron-tool.types.js";
import { getPluginToolMeta } from "../plugins/tool-metadata.js";

export { pinExecToolTarget };
export { resolveBootstrapFilesForPreparation } from "../agents/bootstrap-files.js";
export { loadCodexBundleMcpApprovalConfig } from "../agents/codex-mcp-config.js";
export {
  formatMcpCodexApprovalRemedy,
  requiresMcpCodexToolApproval,
  resolveProjectedMcpCodexToolApprovalMode,
} from "../agents/mcp-codex-tool-approval.js";
export type CodexScheduledToolProjectionFactory = AgentHarnessScheduledToolProjectionFactory;
export type CodexTtsProvenanceTransfer = AgentHarnessTtsProvenanceTransfer;

// OpenClaw's native code mode hands file access to Codex (it drops its own
// exec/read/write/edit dynamic tools in that mode, see the Codex plugin's dynamic-tool
// profile), so the projection names the file reads every Codex sandbox mode allows.
// Shell is deliberately not projected: at the pinned Codex the shell registers only with
// an environment, the `shell_tool` feature, and a model whose shell type is not disabled,
// and OpenClaw cannot observe the realized tool plan at capture. A creator keeps `exec`
// only through the bridged `gateway_exec` alias, which records the shell it actually had.
// apply_patch (per model), write_stdin/process (`unified_exec`) and file writes (sandbox
// mode) are likewise never projected; the bridged surface carries them when present.
const CODEX_NATIVE_CRON_CREATOR_AUTHORITY = ["read"] as const;

/** Resolve the private scheduled-tool projection issuer for the Codex harness owner. */
export function resolveCodexScheduledToolProjectionFactory(
  hostCapabilities: AgentHarnessHostCapabilities,
): CodexScheduledToolProjectionFactory | undefined {
  return resolveAgentHarnessScheduledToolProjectionCapability({
    hostCapabilities,
    ownerPluginId: "codex",
  });
}

/** Resolve private TTS delivery transfer for the bundled Codex harness owner. */
export function resolveCodexTtsProvenanceTransfer(
  hostCapabilities: AgentHarnessHostCapabilities,
): CodexTtsProvenanceTransfer | undefined {
  return resolveAgentHarnessTtsProvenanceTransferCapability({
    hostCapabilities,
    ownerPluginId: "codex",
  });
}

export {
  buildCodexUserMcpServersThreadConfigPatch,
  buildCodexUserMcpServersThreadConfigPatchForRuntime,
  buildCodexUserMcpServersThreadConfigPatchForRun,
  resolveCodexMcpToolOverridesForAgent,
} from "../agents/cli-runner/bundle-mcp-codex.js";
export {
  runWithCronCreatorAuthorityCapabilityResolver,
  runWithCronCreatorAuthorityResolver,
} from "../agents/cron-creator-authority-context.js";

/** Materialize static configured MCP under the Codex harness authority envelope. */
export async function materializeStaticMcpToolsForHarnessRun(
  params: Parameters<
    typeof import("../agents/agent-bundle-mcp-harness.js").materializeStaticMcpToolsForHarnessRunCore
  >[0],
) {
  const { materializeStaticMcpToolsForHarnessRunCore: materialize } =
    await import("../agents/agent-bundle-mcp-harness.js");
  return materialize(params);
}

/** Capture the final Codex dynamic-tool surface for cron creator authority. */
export async function captureFinalCodexCronCreatorToolAllowlist(
  target: CronCreatorToolAllowlistEntry[],
  captureRef: CronToolsAllowCaptureRef,
  tools: readonly AnyAgentTool[],
  options: { nativeToolSurfaceEnabled?: boolean } = {},
) {
  const { captureFinalEffectiveCronCreatorToolAllowlist: capture } =
    await import("../agents/tools/cron-tool.js");
  return capture(target, captureRef, tools, (tool) => getPluginToolMeta(tool), {
    canonicalToolNames: options.nativeToolSurfaceEnabled
      ? CODEX_NATIVE_CRON_CREATOR_AUTHORITY
      : undefined,
  });
}
