#!/usr/bin/env python3
import os,sys,json,subprocess,threading,time,signal
from pathlib import Path
root=Path(os.environ['PROOF_RUN_ROOT']); log=root/('wire-'+str(os.getpid())+'.jsonl')
lock=threading.Lock()
def clean(v):
 if isinstance(v,dict):return {k:('<redacted>' if k.lower() in ['apikey','access_token','accesstoken','refreshtoken','authorization','idtoken'] else clean(x)) for k,x in v.items()}
 if isinstance(v,list):return [clean(x) for x in v]
 return v
def capture(direction,line):
 try:v=json.loads(line)
 except: return
 with lock:
  with log.open('a') as f:f.write(json.dumps({'at':time.time(),'direction':direction,'data':clean(v)})+'\n')
p=subprocess.Popen([os.environ['CODEX_BINARY']]+sys.argv[1:],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=None)
(root/('codex-'+str(os.getpid())+'.json')).write_text(json.dumps({'wrapperPid':os.getpid(),'pid':p.pid,'home':os.environ.get('CODEX_HOME'),'args':sys.argv[1:]}))
def inward():
 for line in sys.stdin.buffer:
  capture('in',line)
  try:p.stdin.write(line);p.stdin.flush()
  except BrokenPipeError:return
 try:p.stdin.close()
 except:pass
threading.Thread(target=inward,daemon=True).start()
for line in p.stdout:
 capture('out',line);sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
sys.exit(p.wait())
