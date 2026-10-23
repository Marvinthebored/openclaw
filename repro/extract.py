import json,sqlite3,sys,collections,re
from pathlib import Path
R=Path(__file__).resolve().parent

def readrows(p):
 out=[]
 if p.exists():
  for l in p.open():
   try:out.append(json.loads(l))
   except json.JSONDecodeError:pass
 return out

def extract(root):
 result=json.loads((root/'result.json').read_text());scenario=json.loads((root/'scenario.json').read_text()) if (root/'scenario.json').exists() else {}
 if not scenario:return {'run':root.name,'result':result,'turns':[]}
 phrase=scenario['phrase'];wire=[]
 for p in root.glob('wire-*.jsonl'):
  for line,x in enumerate(readrows(p),1):wire.append({**x,'source':p.name,'line':line})
 wire.sort(key=lambda x:x['at']);pending={};configs={};starts=[]
 for x in wire:
  d=x['data'];m=d.get('method');v=d.get('params',{});wk=(x['source'],str(d.get('id')))
  if x['direction']=='in' and m in ['thread/start','thread/resume','turn/start']:pending[wk]=x
  if x['direction']=='out' and 'result' in d and wk in pending:
   req=pending[wk];rv=req['data']['params'];rm=req['data']['method'];res=d['result']
   if rm in ['thread/start','thread/resume']:
    tid=res.get('thread',{}).get('id')
    if tid:
     if rm=='thread/start':configs[tid]={'toolNames':[t['name'] for t in rv.get('dynamicTools',[])],'config':rv.get('config',{}),'source':req['source'],'line':req['line']}
   if rm=='turn/start':
    inputText='\n'.join(i.get('text','') for i in rv.get('input',[]) if isinstance(i,dict));turn=res.get('turn',{}).get('id');tid=rv['threadId']
    if inputText.rstrip().endswith('What word did the subagent reply with? Answer in one word.'):n=4
    elif inputText.rstrip().endswith('Reply with the single word DONE.'):n=5
    elif inputText.rstrip().endswith('reply only with the word SPAWNED.'):n=2
    elif inputText.rstrip().endswith('Reply with the single word READY.'):n=1
    elif 'sourceTool=subagent_announce' in inputText:n=3
    else:n='child'
    starts.append({'turn':n,'threadId':tid,'turnId':turn,'inputText':inputText,'nativeInput':rv.get('input'),'source':req['source'],'sourceLine':req['line'],'toolNames':configs.get(tid,{}).get('toolNames',[]),'nativeConfig':configs.get(tid,{}).get('config',{}),'requestAt':req['at']})
 usages={};rawtokens=[]
 for p in root.rglob('rollout-*.jsonl'):
  current=None;previous=None
  for lineno,x in enumerate(readrows(p),1):
   v=x.get('payload',{})
   if x.get('type')=='turn_context':current=v.get('turn_id',current)
   if x.get('type')=='event_msg' and v.get('type')=='task_started':current=v['turn_id'];usages.setdefault(current,{'events':[],'answer':None})
   if x.get('type')=='event_msg' and v.get('type')=='token_count' and v.get('info') and current:
    info=v['info'];total=info.get('total_token_usage');entry={'source':str(p.relative_to(root)),'sourceLine':lineno,'turnId':current,'event':x};rawtokens.append(entry)
    if total!=previous:
     usages.setdefault(current,{'events':[],'answer':None})['events'].append(entry)
     previous=total
   if x.get('type')=='event_msg' and v.get('type')=='task_complete':usages.setdefault(v['turn_id'],{'events':[]})['answer']=v.get('last_agent_message')
 policies=readrows(root/'policy.jsonl');ownerpolicies=[v for v in policies if v.get('sessionKey')==scenario['sessionKey']]
 parents=[v for v in starts if v['turn']!='child'];parents.sort(key=lambda v:v['requestAt'])
 aliases={};letters=iter('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
 for s in parents:
  tid=s['threadId'];aliases.setdefault(tid,next(letters) if tid not in aliases else aliases[tid]);s['thread']=aliases[tid]
  usage=usages.get(s['turnId'],{'events':[]});s['answer']=usage.get('answer');s['tokenEventCount']=len(usage['events']);s['tokenEvents']=[{'source':x['source'],'sourceLine':x['sourceLine']} for x in usage['events']]
  last=usage['events'][-1]['event']['payload']['info']['last_token_usage'] if usage['events'] else {}
  s['lastRequestTokens']=last;s['input_tokens']=sum(x['event']['payload']['info']['last_token_usage'].get('input_tokens',0) for x in usage['events']);s['cached_input_tokens']=sum(x['event']['payload']['info']['last_token_usage'].get('cached_input_tokens',0) for x in usage['events'])
  s['policy']=next((p for p in ownerpolicies if abs(__import__('datetime').datetime.fromisoformat(p['at'].replace('Z','+00:00')).timestamp()-s['requestAt'])<65 and (p['runId'].startswith('announce:') if s['turn']==3 else not p['runId'].startswith('announce:'))),None)
 # Order correlation is unambiguous: five parent attempts correspond to five parent turn/start requests.
 if len(ownerpolicies)==len(parents):
  for s,p in zip(parents,ownerpolicies):s['policy']=p
 bindings=[];envelopes=[]
 for snap in sorted(root.glob('snapshot-*')):
  if not snap.is_dir():continue
  for db in snap.glob('*.sqlite'):
   c=sqlite3.connect(db)
   if c.execute("select 1 from sqlite_master where name='plugin_state_entries'").fetchone():
    for namespace,key,value in c.execute("select namespace,entry_key,value_json from plugin_state_entries where plugin_id='codex' and namespace='app-server-thread-bindings'"):
     v=json.loads(value);b=v.get('binding',{});bindings.append({'snapshot':snap.name,'source':str(db.relative_to(root)),'table':'plugin_state_entries','namespace':namespace,'entry_key':key,'state':v.get('state'),'threadId':b.get('threadId'),'nativeToolPolicyRestricted':b.get('nativeToolPolicyRestricted',False),'historyCoveredThrough':b.get('historyCoveredThrough'),'dynamicToolsFingerprint':b.get('dynamicToolsFingerprint')})
   if c.execute("select 1 from sqlite_master where name='session_nodes'").fetchone():
    for key,value in c.execute('select session_key,entry_json from session_nodes'):
     v=json.loads(value)
     if v.get('spawnedBy'):envelopes.append({'snapshot':snap.name,'source':str(db.relative_to(root)),'sessionKey':key,**{k:z for k,z in v.items() if k.startswith('inheritedTool') or k in ['spawnedBy','sessionId']}})
   c.close()
 child=[s for s in starts if s['turn']=='child']
 for s in child:
  s['answer']=usages.get(s['turnId'],{}).get('answer');s['policy']=next((p for p in policies if p.get('sessionKey')!=scenario['sessionKey']),None)
 checks={}
 byn={s['turn']:s for s in parents}
 if len(byn)==5:
  checks={'sequence':','.join(byn[n]['thread'] for n in [1,2,3,4,5]),'recallAnswerCorrect':byn[4]['answer']==phrase,'turn4InputContainsPhrase':phrase in byn[4]['inputText'],'turn4HasQuotedContext':'OpenClaw assembled context for this turn:' in byn[4]['inputText'],'turn5InputContainsPhrase':phrase in byn[5]['inputText'],'completionRestricted':byn[3]['policy'].get('pluginHarnessToolPolicyRestricted') if byn[3]['policy'] else None,'completionScope':byn[3]['policy'].get('pluginHarnessToolPolicyScope') if byn[3]['policy'] else None,'ownerThreadRestored':byn[4]['threadId']==byn[1]['threadId'],'childPersistentPoliciesEqual':len({json.dumps({k:v for k,v in e.items() if k.startswith('inheritedTool')},sort_keys=True) for e in envelopes})==1,'childEnvelopeSnapshots':[e['snapshot'] for e in envelopes]}
 summary={'run':root.name,'result':result,'scenario':scenario,'checks':checks,'turns':parents,'childTurns':child,'policies':policies,'bindings':bindings,'childEnvelopes':envelopes,'rawTokenEvents':rawtokens,'threadConfigurations':configs}
 (root/'extracted.json').write_text(json.dumps(summary,indent=2));return summary
if __name__=='__main__':
 for name in sys.argv[1:]:
  s=extract(R/name);print(name,json.dumps(s.get('checks',{})))
  for t in s['turns']:print(t['turn'],t['thread'],t['input_tokens'],t['cached_input_tokens'],'last',t['lastRequestTokens'].get('input_tokens'),t['lastRequestTokens'].get('cached_input_tokens'),t['answer'])
