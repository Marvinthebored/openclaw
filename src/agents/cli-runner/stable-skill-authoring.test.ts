import { afterEach, describe, expect, it } from "vitest";
import type { SkillLibraryAuthoringCapability } from "../../skills/library/authoring.js";
import { createConfiguredSkillWorkshopTool } from "../tools/skill-workshop-tool-factory.js";
import {
  resetStableCliSkillAuthoringForTest,
  resolveStableCliSkillAuthoring,
} from "./stable-skill-authoring.js";

const human = (
  defaultTarget: "workspace" | "personal",
  multipleProfiles = true,
): SkillLibraryAuthoringCapability => ({
  target: "personal",
  defaultTarget,
  multipleProfiles,
  bind: () => {},
  invoke: async () => {
    throw new Error("live grant must not be reached from an internal turn");
  },
});

function workshopDefinition(authoring?: SkillLibraryAuthoringCapability) {
  const tool = createConfiguredSkillWorkshopTool({
    config: {},
    agentId: "main",
    sessionKey: "agent:main:main",
    run: authoring ? { libraryAuthoring: authoring } : undefined,
  });
  return { tool, definition: JSON.stringify([tool.description, tool.parameters]) };
}

afterEach(() => resetStableCliSkillAuthoringForTest());

describe("resolveStableCliSkillAuthoring", () => {
  it("passes through sessions that never had a human authoring grant", () => {
    expect(resolveStableCliSkillAuthoring("agent:main:main", undefined)).toBeUndefined();
    expect(resolveStableCliSkillAuthoring(undefined, undefined)).toBeUndefined();
  });

  it.each(["personal", "workspace"] as const)(
    "keeps the %s-default skill_workshop definition on later internal turns and refuses calls",
    async (defaultTarget) => {
      const grant = human(defaultTarget);
      expect(resolveStableCliSkillAuthoring("agent:main:main", grant)).toBe(grant);
      const expired = resolveStableCliSkillAuthoring("agent:main:main", undefined);
      expect(expired).toBeDefined();
      expect(expired).not.toBe(grant);

      const humanTool = workshopDefinition(grant);
      const internalTool = workshopDefinition(expired);
      expect(internalTool.definition).toBe(humanTool.definition);
      expect(internalTool.definition).not.toBe(workshopDefinition().definition);

      await expect(
        internalTool.tool.execute("personal", { action: "list", target: "personal" }),
      ).rejects.toMatchObject({ code: "AUTHORITY_EXPIRED" });
      if (defaultTarget === "workspace") {
        await expect(
          internalTool.tool.execute("workshop", { action: "list" }),
        ).rejects.toMatchObject({ code: "AUTHORITY_EXPIRED" });
      }
    },
  );

  it("follows the latest human shape and keeps sessions separate", () => {
    resolveStableCliSkillAuthoring("agent:main:a", human("workspace", false));
    resolveStableCliSkillAuthoring("agent:main:a", human("personal", true));
    expect(resolveStableCliSkillAuthoring("agent:main:a", undefined)).toMatchObject({
      defaultTarget: "personal",
      multipleProfiles: true,
    });
    expect(resolveStableCliSkillAuthoring("agent:main:b", undefined)).toBeUndefined();
  });
});
