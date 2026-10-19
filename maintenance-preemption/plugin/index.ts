import fs from "node:fs";
const unchanged = {changed:false,bytesFreed:0,rewrittenEntries:0};
let instanceCounter=0;
function record(event, fields={}) {
  fs.appendFileSync(process.env.MAINT_FIXTURE_LOG!,JSON.stringify({ts:new Date().toISOString(),ms:Date.now(),event,pid:process.pid,...fields})+"\n");
}
export default {id:"maint-preempt-fixture",register(api) {
  if(api.registrationMode!=="full")return;
  record("plugin-register");
  api.registerContextEngine("maint-preempt-fixture",()=>{
    const instance=++instanceCounter;
    record("factory",{instance});
    return {
      info:{id:"maint-preempt-fixture",name:"Isolated Maintenance Probe",turnMaintenanceMode:"background",ownsCompaction:true,transcriptSemantics:{currentTurnFence:"before-current-turn-entry-v1",turnAdvancementIdempotency:"atomic-idempotent-v1"}},
      async bootstrap(){record("bootstrap",{instance});return {bootstrapped:true};},
      async ingest(){return {ingested:true};},
      async assemble({messages}){record("assemble",{instance});return {messages,estimatedTokens:0};},
      async compact(){return {ok:true,compacted:false};},
      async afterTurn(){record("after-turn",{instance});},
      // This pass-through fixture has no engine-owned transcript state to mutate;
      // accepting a committed host turn is an atomic, idempotent no-op.
      async commitTurn({advancementKey}){record("commit-turn",{instance,advancementKey});return {status:"committed"};},
      async maintain({sessionId,sessionKey,runtimeContext}){
        const background=runtimeContext?.allowDeferredCompactionExecution===true;
        record("maintain-start",{instance,sessionId,sessionKey,background});
        if(!background){record("maintain-skip-foreground",{instance});return unchanged;}
        try {
          // Intentionally no engine abort listener and no signal parameter:
          // cancellation of this capability must be supplied by the host.
          await runtimeContext.llm.complete({messages:[{role:"user",content:"MAINT-PREP"}]});
          record("maintain-settle",{instance,status:"fulfilled"});
          return unchanged;
        }catch(error){
          record("maintain-settle",{instance,status:"rejected",error:String(error)});
          throw error;
        }
      },
      async dispose(){record("dispose",{instance});}
    };
  });
}};
