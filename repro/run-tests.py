import os,subprocess,json,time
from pathlib import Path
R=Path(os.environ['PROOF_OUTPUT_DIR']).resolve();R.mkdir(parents=True,exist_ok=True)
T=Path(os.environ['PROOF_PATCHED_TREE'])
N='/opt/homebrew/bin/node'
env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(R/'test-home'),'TMPDIR':str(R/'test-tmp'),'NO_COLOR':'1','TERM':'dumb','GOMAXPROCS':'2','RAYON_NUM_THREADS':'2','UV_THREADPOOL_SIZE':'2','OPENCLAW_VITEST_RUNTIME':'node'}
for k in ['HOME','TMPDIR']:Path(env[k]).mkdir(exist_ok=True)
def git(*a):return subprocess.check_output(['git','-C',str(T),*a],text=True).strip()
meta={'head':git('rev-parse','HEAD'),'base':'ded4d430df859f35599fbb4d0ef32d8dec31e3b5','os':subprocess.check_output(['sw_vers'],text=True),'uname':subprocess.check_output(['uname','-a'],text=True),'versions':json.loads(subprocess.check_output([N,'-p','JSON.stringify(process.versions)'],text=True)),'loadStart':os.getloadavg()}
cmd=[N,'scripts/run-vitest.mjs','src/logging/diagnostic-stall-flight-recorder.test.ts','src/gateway/server/event-loop-health.test.ts','--maxWorkers=1']
meta['command']=cmd
def test(label):
 t=time.monotonic()
 with (R/(label+'.log')).open('w') as f:r=subprocess.run(cmd,cwd=T,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600)
 return {'exitCode':r.returncode,'elapsedSeconds':round(time.monotonic()-t,2)}
try:
 meta['green']=test('tests-patched')
 src='src/logging/diagnostic-stall-flight-recorder.ts'
 subprocess.run(['git','restore','--source',meta['base'],'--',src],cwd=T,check=True)
 # A clean PR checkout has nothing to stash. Materialize only its stock source first,
 # stash that inverse source change, then apply the recorded stash for the red run.
 subprocess.run(['git','stash','push','-m','pr181551-proof-stock-source-only','--',src],cwd=T,check=True)
 meta['stash']=git('rev-parse','refs/stash')
 subprocess.run(['git','stash','apply',meta['stash']],cwd=T,check=True)
 meta['red']=test('tests-stock-source')
finally:
 subprocess.run(['git','restore','--source','HEAD','--','src/logging/diagnostic-stall-flight-recorder.ts'],cwd=T,check=True)
 meta['statusAfter']=git('status','--short')
 meta['loadEnd']=os.getloadavg()
 (R/'tests-result.json').write_text(json.dumps(meta,indent=2))
 print(json.dumps(meta,indent=2),flush=True)
