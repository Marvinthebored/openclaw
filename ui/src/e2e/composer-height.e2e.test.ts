import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createControlUiE2eArtifactDir } from "../test-helpers/control-ui-e2e-artifacts.ts";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({ name: "Automatic composer height" });

suite.define(() => {
  it.each([
    { route: "chat", width: 1440, height: 900 },
    { route: "chat", width: 1600, height: 900 },
    { route: "new", width: 1440, height: 900 },
    { route: "new", width: 1600, height: 900 },
    { route: "chat", width: 390, height: 844 },
    { route: "new", width: 390, height: 844 },
    { route: "chat", width: 1440, height: 400 },
  ])(
    "grows and scrolls $route drafts at $width × $height without changing width",
    async ({ route, width, height }) => {
      await suite.withPage({ viewport: { width, height } }, async ({ page }) => {
        await installMockGateway(page);
        await page.goto(`${suite.server.baseUrl}${route}`);
        const editor = page.locator(".agent-chat__composer-combobox textarea");
        await editor.fill("Short draft");
        const shell = page.locator(".agent-chat__composer-shell");
        const measure = () =>
          editor.evaluate((el) => ({
            height: el.clientHeight,
            scrollHeight: el.scrollHeight,
            lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
            width: el.getBoundingClientRect().width,
            resize: getComputedStyle(el).resize,
          }));
        const initial = await measure();
        const initialShell = await shell.boundingBox();
        await editor.fill(Array.from({ length: 12 }, (_, i) => `Draft line ${i + 1}`).join("\n"));
        const expanded = await measure();
        const artifacts = createControlUiE2eArtifactDir(
          `composer-height-${route}-${width}-${height}`,
        );
        await page.screenshot({ path: `${artifacts}/expanded.png`, animations: "disabled" });
        if (height === 900) {
          await expect
            .poll(async () => (await measure()).height)
            .toBeGreaterThan(initial.lineHeight * (route === "new" ? 10 : 6));
          await expect
            .poll(async () => {
              const m = await measure();
              return m.scrollHeight - m.height;
            })
            .toBeLessThanOrEqual(1);
        }
        await editor.fill("Long draft\n".repeat(100));
        await expect
          .poll(async () => {
            const m = await measure();
            return m.scrollHeight - m.height;
          })
          .toBeGreaterThan(0);
        const capped = await measure();
        expect(capped.resize).toBe("none");
        expect((await shell.boundingBox())!.width).toBeCloseTo(initialShell!.width, 0);
        expect(await page.getByRole("separator", { name: "Resize message width" }).count()).toBe(0);
        const send = page.getByRole("button", { name: /^(Send|Start)/ }).last();
        await send.scrollIntoViewIfNeeded();
        await send.click({ trial: true });
        await page.screenshot({ path: `${artifacts}/capped.png`, animations: "disabled" });
        if (route === "chat" && width > 600) {
          const thread = await page.locator(".chat-thread").boundingBox();
          expect(thread!.height).toBeGreaterThanOrEqual(height === 900 ? 159 : 59);
        }
        await editor.fill("Short draft");
        await expect.poll(async () => (await measure()).height).toBe(initial.height);
        writeFileSync(
          `${artifacts}/geometry.json`,
          JSON.stringify({ route, width, height, initial, expanded, capped }, null, 2),
        );
      });
    },
  );
});
