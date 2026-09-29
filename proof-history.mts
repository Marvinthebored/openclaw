import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { startControlUiE2eServer, installMockGateway, resolvePlaywrightChromiumExecutablePath } from './ui/src/test-helpers/control-ui-e2e.ts';
import { createControlUiE2eArtifactDir } from './ui/src/test-helpers/control-ui-e2e-artifacts.ts';

const out = createControlUiE2eArtifactDir('parser-history', process.env.PROOF_OUT ?? path.resolve('.artifacts/parser-history-proof'));
const main = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const question = (id: string, title: string, seq: number) => ({role:'assistant', content:title, timestamp:1789000000000+seq,
  __openclaw:{id,seq}, openclawAsyncDelivery:{itemId:id, questions:[{title,options:['Engineers','Everyone']}]}});
const user = (id: string, content: string, seq: number, replyToId?: string) => ({role:'user',content,timestamp:1789000000000+seq,
  __openclaw:{id,seq,...(replyToId?{replyToId}:{})}});
const history = Array.from({length:20},(_,i)=>question(`pending-${i}`,`Planning question ${String(i).padStart(2,'0')}: which audience should receive the detailed project progress summary?`,i+1));
for(let i=0;i<600;i++) history.push(user(`ordinary-${i}`,`Continue the project work and report progress for step ${i}.`,21+i) as any);
history.push(question('quoted-check','Which audience?',621));
history.push(user('quoted-answer','> Which audience?\n\nEngineers',622) as any);
history.push(question('plain-check','Which distribution?',623));
history.push(user('plain-answer','Everyone',624,'plain-check') as any);
const fixtureHash=createHash('sha256').update(JSON.stringify(history)).digest('hex');
fs.writeFileSync(path.join(out,'fixture.json'),JSON.stringify(history,null,2));
fs.copyFileSync('proof-history.mts',path.join(out,'proof-history.mts'));
const server=await startControlUiE2eServer(undefined,{source:true});
const browser=await chromium.launch({headless:true,executablePath:resolvePlaywrightChromiumExecutablePath(chromium.executablePath())});
const results:any[]=[];
try {
  const modes=process.env.PROOF_QUICK ? ['stock','guard'] : ['stock','guard','guard','stock','stock','guard'];
  for(const [run,mode] of modes.entries()) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',colorScheme:'dark',serviceWorkers:'block'});
    const page=await context.newPage();
    page.setDefaultTimeout(120000);
    const errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    let parserServed=0,historyServed=0;
    await page.addInitScript(()=>{(window as any).__historyProof={scans:[]};});
    await page.route('**/src/pages/chat/components/chat-async-question-summary.ts*',async route=>{
      const response=await route.fetch();
      let body=await response.text();
      const marker='function parseGeneratedAsyncAnswer(question, message) {';
      assert.equal(body.split(marker).length,2,'exactly one parser entry');
      assert(!body.includes('if (!message.startsWith("> "))'),'stock source lacks PR guard');
      if(mode==='guard') body=body.replace(marker,marker+'\n  if (!message.startsWith("> ")) { return null; }');
      fs.writeFileSync(path.join(out,`${run}-parser-served.js`),body);
      parserServed++;
      await route.fulfill({response,body});
    });
    await page.route('**/src/pages/chat/components/chat-async-question.ts*',async route=>{
      const response=await route.fetch();
      let body=await response.text();
      const start='function readQuestionHistory(messages) {';
      const end=body.match(/return\s*\{\s*history,\s*resolved\s*\};/)?.[0];
      assert(end,'history result return located');
      assert.equal(body.split(start).length,2);
      assert.equal(body.split(end).length,2);
      body=body.replace(start,start+'\n const __proofStart=performance.now();');
      body=body.replace(end,`const __proofEnd=performance.now();
        window.__historyProof.scans.push({messages:messages.length,ms:__proofEnd-__proofStart,questions:history.length,resolved:[...resolved.keys()]});
        performance.measure('readQuestionHistory', {start:__proofStart,end:__proofEnd});\n`+end);
      historyServed++;
      fs.writeFileSync(path.join(out,`${run}-history-served.js`),body);
      await route.fulfill({response,body});
    });
    await installMockGateway(page,{historyMessages:history,communityInvite:false});
    const cdp=await context.newCDPSession(page);
    if(process.env.PROOF_PROFILE) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    await page.goto(`${server.baseUrl}chat`,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction((count)=> (window as any).__historyProof?.scans.some((s:any)=>s.messages===count),history.length,{timeout:120000});
    await expect(page.locator('.chat-thread-inner')).toBeVisible();
    await page.waitForFunction(()=>document.querySelectorAll('.chat-question-summary').length>0);
    const scans=await page.evaluate(()=>(window as any).__historyProof.scans);
    const full=scans.filter((s:any)=>s.messages===history.length);
    assert(full.length>0);
    for(const s of full) assert.deepEqual([...s.resolved].sort(),['plain-check','quoted-check']);
    fs.writeFileSync(path.join(out,`${run}-scans.json`),JSON.stringify(scans,null,2));
    await page.evaluate(()=>{const el=document.querySelector('.chat-thread');if(el) el.scrollTop=el.scrollHeight;});
    await page.screenshot({path:path.join(out,`${run}-loaded.png`)});
    const summary=page.locator('.chat-question-summary').filter({hasText:'Everyone'});
    await expect(summary).toBeVisible({timeout:15000});
    await expect(summary).toContainText('Everyone');
    const quoted=page.locator('.chat-question-summary').filter({hasText:'Which audience?'});
    await expect(quoted).toBeVisible();
    await expect(quoted).toContainText('Engineers');
    const beforeResize=scans.length;
    await page.setViewportSize({width:1200,height:1000});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const afterResize=await page.evaluate(()=>(window as any).__historyProof.scans.length);
    assert.equal(afterResize,beforeResize,'memoized history does not rescan on resize');
    const traceEvents=await page.evaluate(()=>performance.getEntriesByName('readQuestionHistory').map(e=>({name:e.name,cat:'blink.user_timing',ph:'X',pid:1,tid:1,ts:e.startTime*1000,dur:e.duration*1000})));
    fs.writeFileSync(path.join(out,`${run}-${mode}.trace.json`),JSON.stringify({traceEvents},null,2));
    if(process.env.PROOF_PROFILE) {
      const profile=await cdp.send('Profiler.stop');
      fs.writeFileSync(path.join(out,`${run}-${mode}.cpuprofile`),JSON.stringify(profile.profile));
    }
    await page.screenshot({path:path.join(out,`${run}-${mode}.png`)});
    assert(parserServed>0 && historyServed>0);
    assert.deepEqual(errors,[],'no browser page errors');
    const result={run,mode,parserServed,historyServed,scans,resizeRescans:afterResize-beforeResize,quotedAnswerVisible:true,canonicalPlainAnswerVisible:true,errors};
    results.push(result);
    console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({main,fixtureHash,messages:history.length,browser:browser.version(),results},null,2));
    await context.close();
  }
} finally {await browser.close();await server.close();}
console.log('PROOF_COMPLETE '+out);
