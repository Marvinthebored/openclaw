import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const evidence=path.dirname(fileURLToPath(import.meta.url));
const trees={patched:process.env.PATCHED_TREE,stock:process.env.STOCK_TREE};
const [tree='patched',run='1']=process.argv.slice(2);
if(!trees[tree]||!['1','2','pilot','pilot2','pilot3','pilot4','final1','final2'].includes(run))throw Error('invalid tree/run');
const root='/tmp/maint-preempt-gw/'+tree+'/run-'+run;
if(fs.existsSync(root))throw Error('Refusing to reuse existing run root '+root);
for(const sub of ['home','state','workspace','tmp','cache','data','config'])fs.mkdirSync(root+'/'+sub,{recursive:true});
const prefix=(tree==='patched'?'green':'red')+'-'+run;
const runLog=evidence+'/'+prefix+'.log';
const fakeLog=evidence+'/'+prefix+'-model.jsonl';
const engineLog=evidence+'/'+prefix+'-engine.jsonl';
const gatewayLog=evidence+'/'+prefix+'-gateway.log';
const record=(event,fields={})=>{
  const row={ts:new Date().toISOString(),ms:Date.now(),event,...fields};
  fs.appendFileSync(runLog,JSON.stringify(row)+'\n');console.log(JSON.stringify(row));return row;
};
const steps=text=>fs.appendFileSync(evidence+'/STEPS.md','- '+new Date().toISOString()+': '+text+'\n');
const readEvents=file=>{try{return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}};
const waitFor=async(fn,ms,label)=>{
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){const result=await fn();if(result)return result;await delay(50);}
  throw Error('Timed out waiting for '+label);
};
const children=[];
function start(command,args,env,log,cwd){
  const fd=fs.openSync(log,'a');
  const child=spawn(command,args,{cwd,env,detached:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  children.push(child);record('child-start',{pid:child.pid,command,args});
  return child;
}
async function freePort(){
  const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
  const port=s.address().port;await new Promise(resolve=>s.close(resolve));
  if(port===18789)throw Error('Forbidden port');return port;
}
const env={
  PATH:process.env.PATH,HOME:root+'/home',USER:'isolated-maint-fixture',LOGNAME:'isolated-maint-fixture',
  TMPDIR:root+'/tmp',XDG_CACHE_HOME:root+'/cache',XDG_DATA_HOME:root+'/data',XDG_CONFIG_HOME:root+'/config',
  OPENCLAW_HOME:root+'/home',OPENCLAW_STATE_DIR:root+'/state',OPENCLAW_CONFIG_PATH:root+'/openclaw.json',
  OPENCLAW_DEV_SOURCE_ROOT:trees[tree],OPENCLAW_NO_RESPAWN:'1',OPENCLAW_NODE_OPTIONS_READY:'1',
  OPENCLAW_SKIP_CHANNELS:'1',OPENCLAW_SKIP_GMAIL_WATCHER:'1',OPENCLAW_SKIP_CRON:'1',
  OPENCLAW_SKIP_CANVAS_HOST:'1',OPENCLAW_SKIP_BROWSER_CONTROL_SERVER:'1',OPENCLAW_SKIP_PROVIDERS:'1',
  OPENCLAW_DISABLE_BUNDLED_PLUGINS:'1',OPENCLAW_DISABLE_BONJOUR:'1',OPENCLAW_SKIP_UPDATE_CHECK:'1',
  NODE_COMPILE_CACHE:root+'/cache/node',MAINT_FIXTURE_LOG:engineLog,
  NO_COLOR:'1',TERM:'dumb'
};
let released=false;
function release(reason){if(!released){released=true;fs.writeFileSync(root+'/release','release');record('release-written',{reason});}}
async function stopChildren(){
  release('cleanup');
  // These are exclusively detached process groups started above.
  for(const child of children.toReversed()){
    if(child.exitCode!==null||child.signalCode!==null)continue;
    record('child-stop',{pid:child.pid});
    try{process.kill(-child.pid,'SIGTERM');}catch{}
  }
  await delay(2000);
  for(const child of children.toReversed()){
    if(child.exitCode===null&&child.signalCode===null){
      record('child-force-stop',{pid:child.pid});
      try{process.kill(-child.pid,'SIGKILL');}catch{}
    }
  }
}
let summary;
try{
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:trees[tree],encoding:'utf8'}).trim();
  steps('Begin '+prefix+' using '+tree+' '+commit+'; source-only Gateway and fresh isolated HOME/state.');
  const sourceDiff=execFileSync('git',['diff','--binary','HEAD'],{cwd:trees[tree],encoding:'utf8'});
  fs.writeFileSync(evidence+'/'+prefix+'-source.diff',sourceDiff);
  record('run-start',{tree,run,commit,root,workingTreeDirty:sourceDiff.length>0});
  start(process.execPath,[evidence+'/fake-model.mjs',root,fakeLog],env,evidence+'/'+prefix+'-fake.log',root);
  const fake=await waitFor(()=>fs.existsSync(root+'/fake-ready.json')&&JSON.parse(fs.readFileSync(root+'/fake-ready.json','utf8')),10000,'fake ready');
  const port=await freePort();
  const modelRef='fixture/local-fixture';
  const config={
    gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token:'isolated-fixture-token'},controlUi:{enabled:false},http:{endpoints:{chatCompletions:{enabled:true}}}},
    update:{checkOnStart:false},discovery:{mdns:{mode:'off'}},
    cron:{enabled:false},browser:{enabled:false},
    agents:{ownership:'explicit',defaults:{workspace:root+'/workspace',skipBootstrap:true,heartbeat:{every:'0m'},model:{primary:modelRef},thinkingDefault:'off',timeoutSeconds:240},entries:{main:{}}},
    models:{mode:'replace',providers:{fixture:{baseUrl:'http://127.0.0.1:'+fake.port+'/v1',apiKey:'fake-local-only',api:'openai-completions',request:{allowPrivateNetwork:true},models:[{id:'local-fixture',name:'Local Fixture',api:'openai-completions',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4096}]}}},
    plugins:{enabled:true,allow:['maint-preempt-fixture'],load:{paths:[evidence+'/plugin']},entries:{'maint-preempt-fixture':{enabled:true}},slots:{memory:'none',contextEngine:'maint-preempt-fixture'}},
    tools:{profile:'minimal'}
  };
  fs.writeFileSync(root+'/openclaw.json',JSON.stringify(config,null,2)+'\n');
  fs.writeFileSync(evidence+'/'+prefix+'-config.json',JSON.stringify(config,null,2)+'\n');
  const gateway=start(process.execPath,['--import',trees[tree]+'/scripts/tsx.mjs',trees[tree]+'/src/entry.ts','gateway','run','--port',String(port),'--bind','loopback'],env,gatewayLog,trees[tree]);
  fs.writeFileSync(root+'/pids.json',JSON.stringify({gateway:gateway.pid,fake:fake.pid,port,fakePort:fake.port}));
  const base='http://127.0.0.1:'+port;
  await waitFor(async()=>{
    if(gateway.exitCode!==null||gateway.signalCode!==null)throw Error('Gateway exited '+gateway.exitCode+' '+gateway.signalCode);
    try{const r=await fetch(base+'/readyz',{signal:AbortSignal.timeout(1000)});return r.ok;}catch{return false;}
  },180000,'gateway readyz');
  record('gateway-ready',{port});
  async function send(turn){
    record('turn-send',{turn});
    const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer isolated-fixture-token','x-openclaw-session-key':'agent:main:maint-proof-'+tree+'-'+run},body:JSON.stringify({model:'openclaw/main',messages:[{role:'user',content:'TURN-'+turn+' Reply with a short text. Do not call tools.'}],user:'maint-proof-'+tree+'-'+run,stream:false}),signal:AbortSignal.timeout(turn===1?210000:110000)});
    const body=await response.text();record('turn-reply',{turn,status:response.status,body});
    if(!response.ok)throw Error('Turn '+turn+' HTTP '+response.status+': '+body);
    return body;
  }
  await send(1);
  const stalled=await waitFor(()=>readEvents(fakeLog).find(e=>e.event==='stall-active'),60000,'stalled MAINT-PREP');
  record('maintenance-confirmed-stalled',{requestId:stalled.id});
  const sent2=Date.now();
  const second=send(2);
  let hitCap=false;
  const cap=setTimeout(()=>{hitCap=true;release('40-second-stock-comparison-cap');},40000);
  try{await second;}finally{clearTimeout(cap);}
  const replied2=Date.now();
  // Read abort evidence before releasing anything still stalled.
  await delay(150);
  const events=readEvents(fakeLog),engines=readEvents(engineLog);
  const admission=events.find(e=>e.event==='request-received'&&e.turn===2&&!e.maintenance);
  if(!admission)throw Error('No turn-2 model admission recorded');
  const firstMaint=events.find(e=>e.event==='request-received'&&e.id===stalled.id);
  const disconnected=events.find(e=>e.event==='client-disconnected'&&e.id===stalled.id);
  const maintStart=engines.find(e=>e.event==='maintain-start'&&e.background===true);
  const disposal=engines.find(e=>e.event==='dispose'&&e.instance===maintStart?.instance&&e.ms>=maintStart.ms);
  const endingCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:trees[tree],encoding:'utf8'}).trim();
  const endingDiff=execFileSync('git',['diff','--binary','HEAD'],{cwd:trees[tree],encoding:'utf8'});
  fs.writeFileSync(evidence+'/'+prefix+'-source-end.diff',endingDiff);
  const sourceDiffSha256=createHash('sha256').update(sourceDiff).digest('hex');
  const sourceStable=commit===endingCommit&&sourceDiff===endingDiff;
  summary={tree,run,commit,endingCommit,workingTreeDirty:sourceDiff.length>0,sourceDiffSha256,sourceStable,sent2Ms:sent2,sent2Ts:new Date(sent2).toISOString(),admissionMs:admission.ms,admissionTs:admission.ts,admissionLatencyMs:admission.ms-sent2,replyLatencyMs:replied2-sent2,maintenanceRequestTs:firstMaint?.ts,aborted:!!disconnected,abortTs:disconnected?.ts??null,abortBeforeAdmission:!!disconnected&&disconnected.ms<=admission.ms,disposeTs:disposal?.ts??null,disposeBeforeAdmission:!!disposal&&disposal.ms<=admission.ms,stockCapHit:hitCap};
  fs.writeFileSync(evidence+'/'+prefix+'-summary.json',JSON.stringify(summary,null,2)+'\n');
  record('run-result',summary);
  steps(prefix+' result: turn-2 admission '+summary.admissionLatencyMs+' ms, MAINT-PREP aborted='+summary.aborted+', dispose='+summary.disposeTs+', cap='+hitCap+'.');
}catch(error){
  record('run-error',{error:String(error),stack:error.stack});steps(prefix+' failed: '+String(error));process.exitCode=1;
}finally{
  await stopChildren();
  record('cleanup-complete');
}
