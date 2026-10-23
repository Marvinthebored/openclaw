import os,json,time,subprocess,signal,socket,urllib.request,urllib.error,hashlib
from pathlib import Path
R=Path(os.environ['PROOF_OUTPUT_DIR']).resolve();R.mkdir(parents=True,exist_ok=True)
HOOK=Path(__file__).with_name('gateway-hook.mjs')
NODE='/opt/homebrew/bin/node'
TREES=[('patched',Path(os.environ['PROOF_PATCHED_TREE'])),('stock',Path(os.environ['PROOF_STOCK_TREE']))]
def probe(port,path='/readyz'):
 start=time.monotonic()
 try:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=2) as f:return {'status':f.status,'body':json.loads(f.read()),'elapsedMs':round((time.monotonic()-start)*1000,2)}
 except urllib.error.HTTPError as e:return {'status':e.code,'body':e.read().decode()}
 except Exception as e:return {'status':None,'error':str(e)}
results=[]
for label,T in TREES:
 root=R/('gateway-r2-'+label);root.mkdir(exist_ok=False)
 for d in ['home','state','workspace','cache','tmp','data','config']:(root/d).mkdir()
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 assert port!=18789
 cfg={'gateway':{'mode':'local','bind':'loopback','port':port,'auth':{'mode':'token','token':'<synthetic-token>'},'controlUi':{'enabled':False}},'update':{'checkOnStart':False},'discovery':{'mdns':{'mode':'off'}},'cron':{'enabled':False},'browser':{'enabled':False},'plugins':{'enabled':False},'agents':{'ownership':'explicit','defaults':{'workspace':str(root/'workspace'),'skipBootstrap':True},'entries':{'main':{}}}}
 (root/'openclaw.json').write_text(json.dumps(cfg,indent=2))
 env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'USER':'isolated-proof','LOGNAME':'isolated-proof','XDG_CACHE_HOME':str(root/'cache'),'XDG_DATA_HOME':str(root/'data'),'XDG_CONFIG_HOME':str(root/'config'),'OPENCLAW_HOME':str(root/'home'),'OPENCLAW_STATE_DIR':str(root/'state'),'OPENCLAW_CONFIG_PATH':str(root/'openclaw.json'),'OPENCLAW_NO_RESPAWN':'1','OPENCLAW_NODE_OPTIONS_READY':'1','OPENCLAW_SKIP_CHANNELS':'1','OPENCLAW_SKIP_GMAIL_WATCHER':'1','OPENCLAW_SKIP_CRON':'1','OPENCLAW_SKIP_CANVAS_HOST':'1','OPENCLAW_SKIP_BROWSER_CONTROL_SERVER':'1','OPENCLAW_SKIP_PROVIDERS':'1','OPENCLAW_DISABLE_BUNDLED_PLUGINS':'1','OPENCLAW_DISABLE_BONJOUR':'1','OPENCLAW_SKIP_UPDATE_CHECK':'1','NODE_COMPILE_CACHE':str(root/'cache/node'),'NO_COLOR':'1','TERM':'dumb','PROOF_RUN_ROOT':str(root),'PROOF_TREE':str(T),'GOMAXPROCS':'2','RAYON_NUM_THREADS':'2','UV_THREADPOOL_SIZE':'2','OPENCLAW_VITEST_RUNTIME':'node'}
 cmd=[NODE,'--import',str(T/'scripts/tsx.mjs'),'--import',str(HOOK),str(T/'src/entry.ts'),'gateway','run','--port',str(port),'--bind','loopback']
 result={'label':label,'head':subprocess.check_output(['git','-C',str(T),'rev-parse','HEAD'],text=True).strip(),'port':port,'command':cmd,'environment':env,'loadStart':os.getloadavg(),'health':[]}
 p=None;start=time.monotonic()
 def save():
  (root/'result.json').write_text(json.dumps(result,indent=2))
 def sample(name):
  target=root/(name+'.txt')
  r=subprocess.run(['/usr/bin/sample',str(p.pid),'5','-file',str(target)],capture_output=True,text=True,timeout=30)
  (root/(name+'.capture.log')).write_text(r.stdout+r.stderr)
  contents=target.read_text(errors='replace') if target.exists() else ''
  return {'exitCode':r.returncode,'bytes':len(contents),'profilerThreadLines':[l for l in contents.splitlines() if any(x in l for x in ['ProfEvntProc','SamplingThread','Sampler::','CpuProfiler'])]}
 try:
  with (root/'gateway.log').open('w') as log:
   p=subprocess.Popen(cmd,cwd=T,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   result['pid']=p.pid;save()
   deadline=time.monotonic()+660
   while time.monotonic()<deadline:
    if p.poll() is not None:raise RuntimeError('Gateway exited during startup: '+str(p.returncode))
    health=probe(port)
    if health['status']==200 and health['body'].get('ready'):break
    result['lastStartupHealth']=health
    time.sleep(1)
   else:raise RuntimeError('Gateway readiness timeout (660s)')
   result['startupSeconds']=round(time.monotonic()-start,2);result['startupHealth']=health;save()
   print(label+' ready '+str(result['startupSeconds'])+'s',flush=True)
   result['sampleBefore']=sample('sample-before');save()
   (root/'trigger-stall').write_text('synthetic CPU block: 1500ms')
   until=time.monotonic()+25
   while time.monotonic()<until:
    h=probe(port);h['atSeconds']=round(time.monotonic()-start,2);result['health'].append(h);save()
    if p.poll() is not None:raise RuntimeError('Gateway exited during observation: '+str(p.returncode))
    time.sleep(.5)
   result['sampleAfter']=sample('sample-after');result['finalHealth']=probe(port);result['liveness']=probe(port,'/healthz')
   result['status']='completed';save()
 except Exception as e:result.update(status='failed',error=str(e));save()
 finally:
  if p is not None and p.poll() is None:
   p.send_signal(signal.SIGTERM)
   try:p.wait(timeout=25);result['cleanup']='SIGTERM exited'
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait();result['cleanup']='SIGKILL required after 25s'
  result['exitCode']=None if p is None else p.returncode
  result['loadEnd']=os.getloadavg();save();results.append(result)
  (R/'gateway-r2-results.json').write_text(json.dumps(results,indent=2))
  print(label+': '+result['status']+' cleanup='+result.get('cleanup','already exited'),flush=True)
print('Gateway proof runner finished',flush=True)
