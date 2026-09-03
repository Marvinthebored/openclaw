import { describe, expect, it } from "vitest";
import { buildAnthropicCliBackend } from "./cli-backend.js";

describe("Claude CLI cron creator authority", () => {
  it("projects native tools into canonical OpenClaw capabilities", () => {
    const project = buildAnthropicCliBackend().projectNativeToolAuthority;

    expect(project?.(undefined)).toEqual([
      "read",
      "write",
      "edit",
      "apply_patch",
      "exec",
      "process",
    ]);
    expect(project?.(["Read", "Grep", "Glob"])).toEqual(["read"]);
    expect(project?.(["Write"])).toEqual(["write"]);
    expect(project?.(["Edit", "NotebookEdit"])).toEqual(["edit", "apply_patch"]);
    expect(project?.(["Bash"])).toEqual([
      "read",
      "write",
      "edit",
      "apply_patch",
      "exec",
      "process",
    ]);
    expect(project?.([])).toEqual([]);
  });
});
