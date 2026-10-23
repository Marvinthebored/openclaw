import { mkdirSync, writeFileSync } from "node:fs";
import { expect as browserExpect } from "playwright/test";
import { expect, it } from "vitest";
import { controlUiSessionUrl, installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
const suite = createControlUiE2eSuite({ name: "Shipped chat narration proof" });
const out = process.env.CHAT_PROOF_OUT!;
const baseline = process.env.CHAT_PROOF_BASELINE === "1";
const msg = (role: string, content: unknown, seq: number, extra = {}) => ({
 role, content, timestamp: Date.UTC(2026,9,23,6,0,seq), runId: "proof-run",
 __openclaw: { id: "proof-" + seq, seq, runId: "proof-run" }, ...extra
});
suite.define(() => {
 it("preserves narration, independent work and reply actions through the built chat entry point", async () => {
  mkdirSync(out, {recursive:true});
  await suite.withPage({viewport:{width:1440,height:1100},colorScheme:"dark",reducedMotion:"reduce"},async ({page}) => {
   const history = [
    msg("user","Inspect the two synthetic reports.",1),
    msg("assistant","First finding: the synthetic report is complete.",2),
    msg("assistant",[{type:"toolCall",id:"read-one",name:"read",arguments:{path:"synthetic-report-one.txt"}}],3),
    msg("toolResult","First synthetic report loaded.",4,{toolCallId:"read-one",toolName:"read"}),
    msg("assistant","Second finding: both synthetic reports agree.",5),
    msg("assistant",[{type:"toolCall",id:"read-two",name:"read",arguments:{path:"synthetic-report-two.txt"}}],6),
    msg("toolResult","Second synthetic report loaded.",7,{toolCallId:"read-two",toolName:"read"}),
    msg("assistant","Final answer: the synthetic checks passed.",8,{phase:"final_answer",stopReason:"stop",usage:{input:120,output:40,totalTokens:160}})
   ];
   const sessionKey="agent:main:dashboard:shipped-proof";
   await installMockGateway(page,{sessionKey,historyMessages:history});
   await page.goto(controlUiSessionUrl(suite.server.baseUrl,sessionKey));
   await browserExpect(page.locator(".chat-thread-inner").getByText("Final answer: the synthetic checks passed.",{exact:true})).toBeVisible();
   const work=page.locator(".chat-work-group > .chat-activity-group__summary");
   await browserExpect(work).toHaveCount(baseline ? 1 : 2);
   await browserExpect(work.first()).toHaveAttribute("aria-expanded","false");
   await browserExpect(page.locator(".chat-group.assistant .chat-group-footer").last()).toContainText("OpenClaw");
   await page.locator(".chat-thread-inner").getByText("Final answer: the synthetic checks passed.",{exact:true}).hover();
   await page.screenshot({path:out+"/collapsed.png",animations:"disabled"});
   if (!baseline) {
    await browserExpect(page.getByText("First finding: the synthetic report is complete.",{exact:true})).toBeVisible();
    await browserExpect(page.getByText("Second finding: both synthetic reports agree.",{exact:true})).toBeVisible();
    await work.first().click();
    await browserExpect(work.first()).toHaveAttribute("aria-expanded","true");
    await browserExpect(work.nth(1)).toHaveAttribute("aria-expanded","false");
    await page.locator(".chat-thread-inner").getByText("Final answer: the synthetic checks passed.",{exact:true}).hover();
    await page.screenshot({path:out+"/expanded.png",animations:"disabled"});
    const narration=page.locator(".chat-group.assistant").filter({hasText:"First finding: the synthetic report is complete."}).first();
    await narration.hover();
    await page.locator(".agent-chat__composer-combobox textarea").focus();
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta+f" : "Control+f");
    await page.keyboard.press(shortcut);
    await page.getByRole("textbox",{name:"Search messages",exact:true}).fill("First finding");
    await page.getByText("First finding: the synthetic report is complete.",{exact:true}).click({button:"right"});
    writeFileSync(out+"/menu.html",await page.content());
    await page.getByRole("menuitem",{name:/Reply/}).click();
    await browserExpect(page.locator(".chat-reply-preview")).toBeVisible();
    await browserExpect(page.locator(".chat-reply-preview")).toContainText("First finding");
    await page.getByRole("button",{name:"Close search",exact:true}).click();
    const final=page.locator(".chat-group.assistant").filter({hasText:"Final answer: the synthetic checks passed."}).last();
    await browserExpect(final.locator(".chat-group-footer-actions")).toBeVisible();
    await browserExpect(final.getByRole("button",{name:"Copy as markdown",exact:true})).toHaveCount(1);
    await browserExpect(final.locator(".chat-group-footer")).toContainText("OpenClaw");
    await page.locator(".chat-thread-inner").getByText("Final answer: the synthetic checks passed.",{exact:true}).hover();
    await page.screenshot({path:out+"/reply.png",animations:"disabled"});
   }
   writeFileSync(out+"/page.txt",await page.locator("body").innerText());
   writeFileSync(out+"/receipt.json",JSON.stringify({entry:"chat",builtUi:true,baseline,workChunks:await work.count(),urlPath:new URL(page.url()).pathname},null,2));
  });
 },60000);
});
