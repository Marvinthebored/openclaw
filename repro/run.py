import os,json,time,subprocess,signal,socket,urllib.request,sqlite3,shutil,sys
from pathlib import Path
R=Path(__file__).resolve().parent
NODE=os.environ.get('NODE_BINARY','node')
os.chmod(R/'codex-wire.py',0o755)
def snap(root,n):
 target=root/('snapshot-'+n);target.mkdir(exist_ok=True)
 for db in (root/'state').rglob('*.sqlite'):
  try:
   with sqlite3.connect(str(db)) as src,sqlite3.connect(str(target/(db.name))) as dst:src.backup(dst)
  except Exception as e:(target/'errors.txt').write_text(str(e))
 for j in (root/'state').rglob('sessions.json'):
  shutil.copyfile(j,target/('sessions-'+j.parent.parent.name+'.json'))
 print(root.name+' snapshot '+n,flush=True)
labels=sys.argv[1:] or ['stock-r1','patched-r1','stock-r2','patched-r2']
for label in labels:
 variant=label.split('-')[0];T=Path(os.environ[variant.upper()+'_TREE'])
 root=R/label;root.mkdir(exist_ok=False)
 for d in ['home','state','workspace','cache','tmp','data','config','codex-home']:(root/d).mkdir()
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 cfg={'logging':{'file':str(root/'runtime.log')},'gateway':{'mode':'local','bind':'loopback','port':port,'auth':{'mode':'token','token':'synthetic-proof-only'},'controlUi':{'enabled':False}},'update':{'checkOnStart':False},'discovery':{'mdns':{'mode':'off'}},'cron':{'enabled':False},'browser':{'enabled':False},'plugins':{'slots':{'memory':'none'},'allow':['codex','openai'],'entries':{'codex':{'enabled':True,'config':{'sessionCatalog':{'enabled':False},'appServer':{'command':str(R/'codex-wire.py'),'homeScope':'agent','approvalPolicy':'never'}}},'openai':{'enabled':True}}},'agents':{'ownership':'explicit','defaults':{'workspace':str(root/'workspace'),'skipBootstrap':True,'model':{'primary':'openai/gpt-6.1-sol'},'thinkingDefault':'low'},'entries':{'main':{}}},'models':{'providers':{'openai':{'baseUrl':'https://api.openai.com/v1','api':'openai-responses','apiKey':'${OPENAI_API_KEY}','models':[{'id':'gpt-6.1-sol','name':'gpt-6.1-sol','reasoning':True,'input':['text'],'contextWindow':400000,'maxTokens':8192,'agentRuntime':{'id':'codex'}}]}}},'tools':{'deny':['exec'],'subagents':{'tools':{'deny':['exec','browser','write','edit']}}}}
 (root/'openclaw.json').write_text(json.dumps(cfg,indent=2))
 env={'PATH':os.environ.get('PATH',os.defpath),'CODEX_BINARY':os.environ['CODEX_BINARY'],'HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'USER':'isolated-proof','LOGNAME':'isolated-proof','XDG_CACHE_HOME':str(root/'cache'),'XDG_DATA_HOME':str(root/'data'),'XDG_CONFIG_HOME':str(root/'config'),'OPENCLAW_HOME':str(root/'home'),'OPENCLAW_STATE_DIR':str(root/'state'),'OPENCLAW_CONFIG_PATH':str(root/'openclaw.json'),'CODEX_HOME':str(root/'codex-home'),'OPENCLAW_NO_RESPAWN':'1','OPENCLAW_NODE_OPTIONS_READY':'1','OPENCLAW_SKIP_CHANNELS':'1','OPENCLAW_SKIP_GMAIL_WATCHER':'1','OPENCLAW_SKIP_CRON':'1','OPENCLAW_SKIP_CANVAS_HOST':'1','OPENCLAW_SKIP_BROWSER_CONTROL_SERVER':'1','OPENCLAW_DISABLE_BONJOUR':'1','OPENCLAW_SKIP_UPDATE_CHECK':'1','NODE_COMPILE_CACHE':str(root/'cache/node'),'NO_COLOR':'1','TERM':'dumb','PROOF_RUN_ROOT':str(root),'PROOF_TREE':str(T),'PROOF_PORT':str(port),'GOMAXPROCS':'2','RAYON_NUM_THREADS':'2','UV_THREADPOOL_SIZE':'2','OPENCLAW_VITEST_RUNTIME':'node','OPENCLAW_QA_PARENT_PID':str(os.getpid()),'OPENAI_API_KEY':os.environ.get('PRIV_OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY','')}
 cmd=['nice','-n','15',NODE,'--import',str(T/'scripts/tsx.mjs'),str(T/'src/entry.ts'),'gateway','run','--port',str(port),'--bind','loopback']
 result={'label':label,'head':subprocess.check_output(['git','-C',str(T),'rev-parse','HEAD'],text=True).strip(),'port':port,'status':'starting'}
 def save(): (root/'result.json').write_text(json.dumps(result,indent=2))
 p=c=None;save()
 try:
  glog=(root/'gateway.log').open('w');p=subprocess.Popen(cmd,cwd=T,env=env,stdout=glog,stderr=subprocess.STDOUT,start_new_session=True);result['gatewayPid']=p.pid;save()
  deadline=time.monotonic()+600
  while time.monotonic()<deadline:
   if p.poll() is not None:raise RuntimeError('Gateway exited '+str(p.returncode))
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/readyz',timeout=1) as f:
     if f.status==200 and json.load(f).get('ready'):break
   except Exception:pass
   time.sleep(1)
  else:raise RuntimeError('Gateway startup timeout')
  print(label+' gateway ready port '+str(port),flush=True);result['status']='running';save()
  clog=(root/'client.log').open('w');c=subprocess.Popen(['nice','-n','15',NODE,'--import',str(T/'scripts/tsx.mjs'),str(R/'client.mjs')],cwd=T,env=env,stdout=clog,stderr=subprocess.STDOUT,start_new_session=True)
  seen=set();deadline=time.monotonic()+900
  while c.poll() is None and time.monotonic()<deadline:
   for f in root.glob('snapshot-request-*'):
    if f.name not in seen:snap(root,f.name.rsplit('-',1)[1]);seen.add(f.name)
   time.sleep(.5)
  if c.poll() is None:raise RuntimeError('scenario timeout')
  for f in root.glob('snapshot-request-*'):
   if f.name not in seen:snap(root,f.name.rsplit('-',1)[1]);seen.add(f.name)
  result['clientExitCode']=c.returncode
  if c.returncode:raise RuntimeError('client exited '+str(c.returncode))
  result['status']='completed';save()
 except Exception as e:result['status']='failed';result['error']=str(e);save();print(label+' FAILED '+str(e),flush=True)
 finally:
  if c and c.poll() is None:os.killpg(c.pid,signal.SIGTERM);c.wait(timeout=10)
  if p and p.poll() is None:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=20)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  result['gatewayExitCode']=p.returncode if p else None
  # Explicit native PID cleanup, in case stdio shutdown was interrupted.
  for f in root.glob('codex-*.json'):
   for key in ['pid','wrapperPid']:
    pid=json.loads(f.read_text())[key]
    try:os.kill(pid,signal.SIGTERM)
    except ProcessLookupError:pass
  with socket.socket() as s:result['portClosed']=s.connect_ex(('127.0.0.1',port))!=0
  save();print(label+' '+result['status']+' portClosed='+str(result['portClosed']),flush=True)
 if result['status']=='failed':break
print('Runner finished',flush=True)
