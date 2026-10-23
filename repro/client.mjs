import fs from 'node:fs';import {pathToFileURL} from 'node:url';import crypto from 'node:crypto';
const root=process.env.PROOF_RUN_ROOT;const tree=process.env.PROOF_TREE;
const {GatewayClient}=await import(pathToFileURL(tree+'/src/gateway/client.ts'));
const record=(x)=>fs.appendFileSync(root+'/client.jsonl',JSON.stringify({at:new Date().toISOString(),...x})+'\n');
let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
const client=new GatewayClient({url:'ws://127.0.0.1:'+process.env.PROOF_PORT,token:'synthetic-proof-only',clientName:'cli',mode:'cli',scopes:['operator.admin','operator.read','operator.write'],onEvent:e=>record({event:e}),onHelloOk:readyResolve,onConnectError:readyReject});
client.start();const connectTimer=setTimeout(()=>readyReject(new Error('connect timeout')),30000);await ready;clearTimeout(connectTimer);
const key='agent:main:proof:'+crypto.randomUUID();const phrase='PONG-'+crypto.randomBytes(6).toString('hex').toUpperCase();fs.writeFileSync(root+'/scenario.json',JSON.stringify({sessionKey:key,phrase}));
const rpc=async(method,params)=>{record({method,params});const r=await client.request(method,params,{timeoutMs:200000});record({response:method,result:r});return r};
async function turn(n,message){record({phase:'turn-'+n});const r=await rpc('agent',{sessionKey:key,message,idempotencyKey:crypto.randomUUID(),deliver:false});if(r.runId)await rpc('agent.wait',{runId:r.runId,timeoutMs:180000});fs.writeFileSync(root+'/snapshot-request-'+n,String(Date.now()));await rpc('sessions.list',{});record({phase:'turn-'+n+'-done'});}
try {
 await turn(1,'Reply with the single word READY.');
 await turn(2,'Use sessions_spawn to start one subagent whose task is: Reply with the single word '+phrase+'. Set cleanup to keep. Do not wait for it. After spawning, reply only with the word SPAWNED.');
 record({phase:'waiting-for-completion'});
 // Completion readiness is signalled by native turn/completed, verified from the wire log.
 await new Promise((resolve,reject)=>{let started=Date.now();const timer=setInterval(()=>{const files=fs.readdirSync(root).filter(n=>/^wire-.*jsonl$/.test(n));let finished=0;for(const name of files){const rows=fs.readFileSync(root+'/'+name,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));finished+=rows.filter(x=>x.direction==='out'&&x.data.method==='turn/completed').length;}if(finished>=4){clearInterval(timer);resolve();}else if(Date.now()-started>240000){clearInterval(timer);reject(new Error('completion timeout; native completions='+finished));}},1000);});
 record({phase:'completion-done'});fs.writeFileSync(root+'/snapshot-request-3',String(Date.now()));await rpc('sessions.list',{});
 await turn(4,'What word did the subagent reply with? Answer in one word.');
 await turn(5,'Reply with the single word DONE.');
 record({phase:'scenario-complete'});
}finally{await client.stopAndWait({timeoutMs:2000});}
