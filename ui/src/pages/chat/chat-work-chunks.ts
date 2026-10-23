import { asNullableRecord as asRecord } from "@openclaw/normalization-core/record-coerce";
import {
  isToolCallContentType,
  isToolResultContentType,
  resolveToolUseId,
} from "../../../../src/chat/tool-content.js";
import type { MessageGroup } from "../../lib/chat/chat-types.ts";
import { resolveMessageDisplayMarkdown } from "../../lib/chat/message-display.ts";
import { normalizeMessage } from "../../lib/chat/message-normalizer.ts";
import { resolveMessageVisibleContent } from "../../lib/chat/message-visibility.ts";
import { isProviderVoiceTranscript } from "./chat-assistant-reply.ts";
import { assistantGroupIsIndependentBoundary, hasForwardedSource } from "./chat-turn-boundary.ts";
import { copyLiveTerminalIdentity } from "./terminal-message-identity.ts";

export type WorkChunkPart<T> = { id: string; kind: "visible" | "work" | "boundary"; value: T };
export type WorkChunk<T> = { kind: "visible" | "work-chunk"; parts: WorkChunkPart<T>[] };

/** Order-preserving presentation only. Boundaries are emitted, never swallowed by work. */
export function chunkContiguousWork<T>(
  parts: readonly WorkChunkPart<T>[],
  live = false,
): WorkChunk<T>[] {
  const chunks: WorkChunk<T>[] = [];
  for (const part of parts) {
    const kind = !live && part.kind === "work" ? "work-chunk" : "visible";
    const previous = chunks.at(-1);
    if (kind === "work-chunk" && previous?.kind === "work-chunk") {
      previous.parts.push(part);
    } else {
      chunks.push({ kind, parts: [part] });
    }
  }
  return chunks;
}

function isWorkBlock(block: unknown): boolean {
  const type = asRecord(block)?.type;
  return (
    type === "thinking" ||
    type === "redacted_thinking" ||
    isToolCallContentType(type) ||
    isToolResultContentType(type)
  );
}

/**
 * Split mixed provider envelopes without changing history or persisted IDs.
 * Source metadata remains intact for reactions, full-message loading and file attribution.
 */
export function splitMixedWorkGroup(group: MessageGroup): MessageGroup[] {
  if (
    hasForwardedSource(group) ||
    assistantGroupIsIndependentBoundary(group) ||
    group.messages.some(({ message }) => isProviderVoiceTranscript(message))
  ) {
    return [group];
  }
  const pieces = group.messages.flatMap((source) => {
    const record = asRecord(source.message);
    if (record?.role !== "assistant" || !Array.isArray(record.content)) {
      return [
        {
          source,
          role: group.role,
          visibleContent: resolveMessageVisibleContent(
            source.message,
            normalizeMessage(source.message),
          ),
        },
      ];
    }
    const stretches: { work: boolean; blocks: unknown[]; index: number }[] = [];
    for (const [index, block] of record.content.entries()) {
      const work = isWorkBlock(block);
      // Filtered/empty blocks render nothing and cannot separate adjacent work.
      if (!work) {
        const part = { ...record, content: [block] };
        const normalized = normalizeMessage(part);
        const visible = resolveMessageVisibleContent(part, normalized);
        if (
          visible === "none" ||
          (visible === "text" && !resolveMessageDisplayMarkdown(part, normalized).trim())
        ) {
          continue;
        }
      }
      const last = stretches.at(-1);
      if (work && last?.work) {
        last.blocks.push(block);
      } else {
        stretches.push({ work, blocks: [block], index });
      }
    }
    if (stretches.length < 2 || !stretches.some((stretch) => stretch.work)) {
      return [
        {
          source,
          role: group.role,
          visibleContent: resolveMessageVisibleContent(
            source.message,
            normalizeMessage(source.message),
          ),
        },
      ];
    }

    const lastVisible = stretches.findLast((stretch) => !stretch.work)?.index;
    return stretches.map(({ work, blocks, index }) => {
      const blockIdentity = resolveToolUseId(asRecord(blocks[0]) ?? {}) ?? String(index);
      const message = {
        ...record,
        content: blocks,
        // Prepared activity belongs only to its own call stretch. Keep non-call
        // receipts once, rather than duplicating outcomes into visible text.
        activity:
          work && Array.isArray(record.activity)
            ? record.activity.filter((item: unknown) => {
                const activity = asRecord(item);
                const id = activity?.toolCallId ?? activity?.itemId;
                return (
                  blocks.some((block) => resolveToolUseId(asRecord(block) ?? {}) === id) ||
                  (activity?.kind !== "tool" &&
                    index === stretches.find((stretch) => stretch.work)?.index)
                );
              })
            : undefined,
      };
      copyLiveTerminalIdentity(source.message, message);
      const visibleContent = resolveMessageVisibleContent(message, normalizeMessage(message));
      return {
        source: {
          ...source,
          key:
            !work && index === 0
              ? source.key
              : `${source.key}:part:${work ? "work" : "visible"}:${blockIdentity}`,
          actionKey: source.actionKey ?? source.key,
          actionMessage: source.actionMessage ?? source.message,
          presentationOwnsFooter: index === lastVisible,
          presentationOwnsTerminalStatus: index === stretches.at(-1)?.index,
          message,
          hasVisibleContent: visibleContent !== "none",
        },
        role: work
          ? blocks.some(
              (block) =>
                isToolCallContentType(asRecord(block)?.type) ||
                isToolResultContentType(asRecord(block)?.type),
            )
            ? "tool"
            : "assistant"
          : "assistant",
        visibleContent,
      };
    });
  });
  // Ordinary messages and their grouping retain exactly their existing identity.
  if (pieces.every(({ source }, index) => source === group.messages[index])) {
    return [group];
  }
  return pieces.map(({ source, role, visibleContent }) =>
    Object.assign({}, group, {
      key:
        role === group.role && source.key === group.messages[0]?.key
          ? group.key
          : `group:${role}:${source.key}`,
      role,
      messages: [source],
      visibleContent,
    }),
  );
}
