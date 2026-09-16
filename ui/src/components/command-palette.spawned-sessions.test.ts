/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDialogPolyfill } from "../test-helpers/modal-dialog.ts";
import {
  createContext,
  createGateway,
  createSessionResult,
  enterQuery,
  findPaletteOption,
  mountPalette,
} from "./command-palette.test-support.ts";
import "./command-palette.ts";

describe("CommandPalette categorized spawned sessions", () => {
  let restoreDialog: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    restoreDialog = installDialogPolyfill();
  });
  afterEach(() => {
    document.body.replaceChildren();
    restoreDialog();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "finds a categorized spawned dashboard conversation (transcript search: %s)",
    async (transcripts) => {
      const parentKey = "agent:main:discord:channel:parent";
      const office = createSessionResult("agent:main:dashboard:office-ha", "OFFICE HA");
      Object.assign(office.sessions[0]!, {
        category: "HOME ASSISTANT",
        archived: false,
        spawnedBy: parentKey,
        parentSessionKey: parentKey,
        createdVia: "spawn",
        createdActor: { type: "agent" },
      });
      const request = vi.fn(async (method: string) =>
        method === "sessions.search" ? { results: [] } : { models: [] },
      );
      const { gateway } = createGateway(true, {
        methods: transcripts ? ["sessions.search"] : [],
        request,
      });
      const list = vi.fn(async () => office);
      const { palette } = await mountPalette(createContext(gateway, list));
      await enterQuery(palette, "OFFICE HA");
      await vi.advanceTimersByTimeAsync(50);
      await palette.updateComplete;
      const option = findPaletteOption(palette, "OFFICE HA");
      expect(option).toBeDefined();
      option!.click();
      expect(palette.onSelectSession).toHaveBeenCalledWith(office.sessions[0]!.key);
      if (transcripts) {
        expect(request).toHaveBeenCalledWith(
          "sessions.search",
          expect.objectContaining({ sessionKeys: [office.sessions[0]!.key] }),
        );
      }
    },
  );
});
