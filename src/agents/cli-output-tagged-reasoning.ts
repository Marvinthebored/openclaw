import {
  createReasoningTagTextPartitioner,
  scanReasoningTags,
} from "../../packages/markdown-core/src/reasoning-tags.js";
export function partitionLeadingTaggedReasoning(
  text: string,
  final: boolean,
):
  | { pending: true; openWithoutPendingTag: boolean }
  | { pending: false; reasoningText: string; visibleText: string } {
  const first = text.search(/\S/u);
  if (first === -1) {
    return final
      ? { pending: false, reasoningText: "", visibleText: text }
      : { pending: true, openWithoutPendingTag: false };
  }
  if (text.charAt(first) !== "<") {
    return { pending: false, reasoningText: "", visibleText: text };
  }

  const scan = scanReasoningTags(text, final);
  let depth = 0;
  let end = -1;
  for (const tag of scan.tags) {
    if (depth === 0) {
      const expectedStart = end === -1 ? first : end;
      if (text.slice(expectedStart, tag.index).trim() || tag.isClose || tag.isSelfClosing) {
        break;
      }
    }
    depth += tag.isClose ? -1 : tag.isSelfClosing ? 0 : 1;
    if (depth === 0 && tag.isClose) {
      end = tag.index + tag.text.length;
    }
  }

  const pendingTagAfterBlock =
    end !== -1 && scan.pendingStart !== undefined && !text.slice(end, scan.pendingStart).trim();
  if (end === -1) {
    const pendingLeadingTag =
      scan.pendingStart !== undefined && !text.slice(first, scan.pendingStart).trim();
    return !final && (depth > 0 || pendingLeadingTag)
      ? { pending: true, openWithoutPendingTag: depth > 0 && scan.pendingStart === undefined }
      : { pending: false, reasoningText: "", visibleText: text };
  }
  if (!final && (depth > 0 || pendingTagAfterBlock || !text.slice(end).trim())) {
    return { pending: true, openWithoutPendingTag: depth > 0 && scan.pendingStart === undefined };
  }

  const partitioner = createReasoningTagTextPartitioner();
  const deltas = [...partitioner.pushVisible(text.slice(0, end)), ...partitioner.flush()];
  const reasoningText = deltas
    .filter((delta) => delta.kind === "thinking")
    .map((delta) => delta.text)
    .join("");
  return reasoningText
    ? { pending: false, reasoningText, visibleText: text.slice(end) }
    : { pending: false, reasoningText: "", visibleText: text };
}
