import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { takeControlUiElementScreenshot } from "../test-helpers/control-ui-e2e-screenshot.ts";
import { startControlUiE2eServer } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
import {
  controlUiSessionUrl,
  installMockGateway,
  sessionsListResponse,
} from "./session-management.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI mobile categorized spawned session",
  startServer: () => startControlUiE2eServer(undefined, { source: true }),
});

const officeKey = "agent:main:dashboard:office-ha";
const wakeKey = "agent:main:dashboard:wake-word";
const archivedKey = "agent:main:dashboard:archived";
const parentKey = "agent:main:discord:channel:parent";
const captureProof = process.env.OPENCLAW_CAPTURE_UI_PROOF === "1";

suite.define(() => {
  it("shows a categorized spawned conversation in the mobile sidebar drawer", async () => {
    const rows = [
      {
        key: officeKey,
        sessionId: "office-ha",
        kind: "direct",
        label: "OFFICE HA",
        category: "HOME ASSISTANT",
        archived: false,
        spawnedBy: parentKey,
        parentSessionKey: parentKey,
        createdVia: "spawn",
        createdActor: { type: "agent" },
        updatedAt: 30,
      },
      {
        key: wakeKey,
        sessionId: "wake-word",
        kind: "direct",
        label: "Wake-word training",
        category: "HOME ASSISTANT",
        archived: false,
        updatedAt: 20,
      },
      {
        key: archivedKey,
        sessionId: "archived",
        kind: "direct",
        label: "Archived conversation",
        category: "HOME ASSISTANT",
        archived: true,
        updatedAt: 10,
      },
    ];
    const context = await suite.newBrowserContext({
      hasTouch: true,
      isMobile: true,
      locale: "en-US",
      serviceWorkers: "block",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await installMockGateway(page, {
      methodResponses: { "sessions.list": sessionsListResponse(rows) },
      sessionKey: wakeKey,
    });

    try {
      await page.goto(controlUiSessionUrl(suite.server.baseUrl, wakeKey));
      const toggle = page
        .locator(".topbar-nav-toggle:visible, .chat-pane__nav-toggle:visible")
        .first();
      await toggle.tap();
      await expect
        .poll(() => page.locator(".shell").getAttribute("class"))
        .toContain("shell--nav-drawer-open");

      const office = page.locator(`[data-session-key="${officeKey}"]`);
      const group = page.locator('[data-session-section="category:HOME ASSISTANT"]');
      await office.waitFor({ state: "visible" });
      await expect.poll(() => group.locator(`[data-session-key="${wakeKey}"]`).count()).toBe(1);
      await expect.poll(() => page.locator(`[data-session-key="${archivedKey}"]`).count()).toBe(0);
      await expect.poll(() => page.locator(`[data-session-key="${parentKey}"]`).count()).toBe(0);

      if (captureProof) {
        const evidenceDir = path.resolve(process.cwd(), ".github/pr-evidence");
        await mkdir(evidenceDir, { recursive: true });
        const sidebar = page.locator(".shell-nav:visible").first();
        await writeFile(
          path.join(evidenceDir, "mobile-categorized-spawned-session-after.png"),
          await takeControlUiElementScreenshot(page, sidebar, [office, group]),
        );
      }

      await page.keyboard.press("Escape");
      await expect
        .poll(() => page.locator(".shell").getAttribute("class"))
        .not.toContain("shell--nav-drawer-open");
      await page.keyboard.press("ControlOrMeta+k");
      const palette = page.locator(".cmd-palette");
      const paletteInput = page.locator(".cmd-palette__input");
      await paletteInput.waitFor({ state: "visible" });
      await paletteInput.fill("OFFICE HA");
      const paletteOption = page.locator(".cmd-palette__item").filter({ hasText: "OFFICE HA" });
      await paletteOption.waitFor({ state: "visible" });
      if (captureProof) {
        const evidenceDir = path.resolve(process.cwd(), ".github/pr-evidence");
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(
          path.join(evidenceDir, "mobile-categorized-spawned-session-command-palette-after.png"),
          await takeControlUiElementScreenshot(page, palette, [paletteInput, paletteOption]),
        );
      }
    } finally {
      await suite.closeBrowserContext(context);
    }
  });
});
