import fs from 'node:fs/promises';
import {Type} from 'typebox';
import {describe,it,expect,vi} from 'vitest';
import {setRuntimeConfigSnapshot} from '../config/config.js';
import {createDirectChatContext} from '../gateway/server-chat.agent-events.test-helpers.js';
import {talkClientHandlers} from '../gateway/talk/handlers/client.js';
import {prepareTalkSessionTarget} from '../gateway/talk/session-target.js';
const inference=vi.hoisted(()=>({run:undefined as any}));
vi.mock('../auto-reply/dispatch.js',async(importOriginal)=>({...await importOriginal<any>(),dispatchInboundMessageWithProjectedDispatcher:async(options:any)=>{await inference.run(options.replyOptions.runId);return {queuedFinal:false,counts:{tool:0,block:0,final:0}};}}));
import {createOpenClawTestState} from '../test-utils/openclaw-test-state.js';
import {replaceSessionEntry,readSessionTranscriptMessageEvents} from '../config/sessions/session-accessor.js';
import {createOrResumeClientVoiceSession,appendClientVoiceTranscript,registerClientVoiceConsultRun} from './client-voice-session.js';
import {clientVoiceSessionTesting} from './client-voice-session.test-support.js';
import {authorizeObservedClientVoiceConfirmation,bindAuthorizedClientVoiceConfirmation,invalidateClientVoiceConfirmationUtterance} from './client-voice-confirmation.js';
import {resetClientVoiceConfirmationStateForTest} from './client-voice-confirmation.test-support.js';
import {wrapToolWithBeforeToolCallHook} from '../agents/agent-tools.before-tool-call.js';

describe('production chat-backed voice authority final-effect evidence',()=>{
 it.each(['exact-once','wrong-scope','changed-action','replay','pre-binding-invalidation'])('%s',async scenario=>{
 const state=await createOpenClawTestState({label:'voice-final-effect',applyEnv:true});
 try{
 const sessionKey='agent:main:evidence';const agentId='main'; const sessionId='evidence-session';
 const cfg={agents:{ownership:'explicit' as const,entries:{main:{}}}};setRuntimeConfigSnapshot(cfg,cfg);
 const context=createDirectChatContext({getRuntimeConfig:()=>cfg});
 await replaceSessionEntry({agentId,sessionKey},{sessionId,updatedAt:Date.now()});
 const voiceSessionId=createOrResumeClientVoiceSession({agentId,sessionKey,origin:'client',transcriptCapable:true});
 const scope={agentId,voiceSessionId};const target={...scope,sessionKey,sessionTarget:{sessionKey}};
 const sentinel=state.path('final-io.jsonl');let enteredIO=0;
 const action={task:'Create synthetic helper',label:'exact'};
 const bindRun=(runId:string,v=voiceSessionId)=>registerClientVoiceConsultRun({agentId,sessionKey,voiceSessionId:v,runId,config:{}});
 const execute=async(runId:string,params=action)=>{
 const tool=wrapToolWithBeforeToolCallHook({name:'sessions_spawn',label:'Safe final I/O sentinel',description:'Task-local file only; no session/provider launch',parameters:Type.Object({task:Type.String(),label:Type.String()}),execute:async(_id,p)=>{enteredIO++; await fs.appendFile(sentinel,JSON.stringify(p)+'\n');return {content:[{type:'text',text:'sentinel appended'}],details:{}};}},{agentId,sessionKey,runId,config:{}});
 return tool.execute('call-'+runId,params);
 };
 bindRun('blocked');await execute('blocked');expect(enteredIO).toBe(0);
 // Ensure the host-observed speech follows the challenge without sleeps.
 // Production enforces strict millisecond freshness; bounded host clock offset is diagnostic only.
 const original=Date.now;vi.spyOn(Date,'now').mockImplementation(()=>original()+10);
 let transcriptAck=false;
 await talkClientHandlers['talk.client.transcript']({req:{type:'req',id:'speech',method:'talk.client.transcript'},params:{sessionKey,voiceSessionId,entryId:'recorded-yes',role:'user',text:'yes'},context,client:null,sessionMutationAuthorization:{talkSessionTarget:prepareTalkSessionTarget(cfg,sessionKey),assertCurrent:()=>{}},respond:(ok:boolean)=>{transcriptAck=ok;}} as any);expect(transcriptAck).toBe(true);
 const recorded=readSessionTranscriptMessageEvents({agentId,sessionId});expect(JSON.stringify(recorded)).toContain('yes');
 let followScope=scope;
 if(scenario==='wrong-scope')followScope={agentId,voiceSessionId:createOrResumeClientVoiceSession({agentId,sessionKey,origin:'client',transcriptCapable:true,voiceSessionId:'other-voice'})};
 let completed!:()=>void;const finalEffect=new Promise<void>(r=>completed=r);
 let followRun='';let error:any;let acknowledged=false;
 inference.run=async(runId:string)=>{followRun=runId;await execute(runId,scenario==='changed-action'?{...action,label:'changed'}:action);completed();};
 const targetPrepared=prepareTalkSessionTarget(cfg,sessionKey);
 // Invalidation at production ACK is before onRunStarted binds the detached grant.
 // chatRunState.getOrCreate occurs between grant validation and binding.
 if(scenario==='pre-binding-invalidation'){
 const original=context.chatRunState.getOrCreate.bind(context.chatRunState);
 context.chatRunState.getOrCreate=(runId:string)=>{invalidateClientVoiceConfirmationUtterance(agentId,voiceSessionId);return original(runId);};
 }
 await talkClientHandlers['talk.client.toolCall']({req:{type:'req',id:'safe-evidence',method:'talk.client.toolCall'},params:{sessionKey,voiceSessionId:followScope.voiceSessionId,callId:'safe-call',name:'openclaw_agent_consult',args:{question:'Retry the pending action'}},client:null,context,sessionMutationAuthorization:{talkSessionTarget:targetPrepared,assertCurrent:()=>{}},respond:(ok:boolean,_result:any,e:any)=>{acknowledged=ok;error=e;}} as any);
 expect(error).toBeUndefined();expect(acknowledged).toBe(true);await finalEffect;
 const bound=!['wrong-scope','pre-binding-invalidation'].includes(scenario);
 if(['exact-once','replay'].includes(scenario)){
 expect(enteredIO).toBe(1);await execute(followRun);expect(enteredIO).toBe(1);
 expect(await fs.readFile(sentinel,'utf8')).toBe(JSON.stringify(action)+'\n');
 if(scenario==='replay'){expect(authorizeObservedClientVoiceConfirmation(scope)).toBeUndefined();bindRun('replay');await execute('replay');expect(enteredIO).toBe(1);}
 }else{expect(enteredIO).toBe(0);await expect(fs.stat(sentinel)).rejects.toThrow();}
 console.log(JSON.stringify({scenario,recordedSpeech:'yes',transcriptRpcAck:transcriptAck,consultRpcAck:acknowledged,omittedId:true,enteredFinalIO:enteredIO,finalFileRows:enteredIO,actualSentinelBytes:await fs.readFile(sentinel,'utf8').catch(()=>null)}));
 vi.restoreAllMocks();
 }finally{clientVoiceSessionTesting.reset();resetClientVoiceConfirmationStateForTest();await state.cleanup();}
 });
});
