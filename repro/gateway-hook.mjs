import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
// Instrument only this isolated Gateway main thread, never workers.
// No profiler API is called here, and no Gateway implementation is replaced.
if (isMainThread) {
 const root=process.env.PROOF_RUN_ROOT;
 const event=(data)=>fs.appendFileSync(root+'/hook-events.jsonl',JSON.stringify({at:new Date().toISOString(),pid:process.pid,...data})+'\n');
 event({event:'hook-loaded',platform:process.platform,node:process.version});
 let started=false;
 const timer=setInterval(async()=>{
  if(started || !fs.existsSync(root+'/trigger-stall')) return;
  started=true;clearInterval(timer);
  const {runWithMainThreadTask}=await import(pathToFileURL(process.env.PROOF_TREE+'/src/infra/main-thread-stall.ts').href);
  event({event:'synthetic-stall-start',requestedMs:1500});
  const start=performance.now();
  runWithMainThreadTask('proof.synthetic-cpu-block',()=>{while(performance.now()-start<1500){}});
  event({event:'synthetic-stall-end',elapsedMs:performance.now()-start});
 },250);
 timer.unref();
}
