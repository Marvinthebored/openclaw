import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const [root, out, host] = process.argv.slice(2);
const { default: WebSocket, WebSocketServer } = await import(pathToFileURL(root + '/node_modules/ws/wrapper.mjs'));
let phase = 'setup', serial = 0;
const log = fs.createWriteStream(out + '/wire.public.jsonl', { flags: 'a' });
const record = item => log.write(JSON.stringify({ time: new Date().toISOString(), phase, ...item }) + '\n');
const control = http.createServer(async (req,res) => {
  if (req.method !== 'POST' || !/^\/phase\/[a-z0-9-]+$/.test(req.url)) { res.writeHead(404).end(); return; }
  phase = req.url.slice('/phase/'.length);
  record({ kind: 'phase' });
  if(phase==='wait-model' || phase==='release-model') {
    try { await fetch('http://localhost:19155/'+(phase==='wait-model'?'wait':'release'),{method:'POST'}); }
    catch { res.writeHead(502).end();return; }
  }
  res.writeHead(200).end('{}');
});
control.listen(19153, host);
const server = new WebSocketServer({ host, port: 19151, perMessageDeflate: false });
server.on('connection', client => {
  const connection = ++serial, pending = new Map(), queue = [];
  const upstream = new WebSocket('ws://localhost:19150', { perMessageDeflate: false });
  client.on('message', (buf,binary) => {
    try {
      const m = JSON.parse(String(buf));
      if(m.type === 'req') {
        pending.set(m.id, {method:m.method, phase});
        if(m.method === 'chat.history') record({kind:'request',connection,method:m.method,
          cursorPresent:typeof m.params?.cursor === 'string', requestBytes:buf.length});
        if(m.method === 'connect') record({kind:'connect',connection,client:m.params?.client?.id,
          role:m.params?.role,deviceIdentityPresent:Boolean(m.params?.device)});
      }
    } catch {}
    if(upstream.readyState === WebSocket.OPEN) upstream.send(buf,{binary}); else queue.push({buf,binary});
  });
  upstream.on('open',()=> { for(const m of queue) upstream.send(m.buf,{binary:m.binary}); queue.length=0; });
  upstream.on('message',(buf,binary)=> {
    try {
      const m=JSON.parse(String(buf)), p=pending.get(m.id);
      if(m.type==='res' && p) {
        pending.delete(m.id);
        if(p.method === 'connect') record({kind:'connected',connection,ok:m.ok,errorCode:m.error?.details?.code});
        if(p.method==='chat.history') {
          const payload=m.payload ?? {};
          record({kind:'response',phase:p.phase,connection,method:p.method,ok:m.ok,
            responseFrameBytes:buf.length,payloadJSONBytes:Buffer.byteLength(JSON.stringify(payload)),
            payloadKeys:Object.keys(payload).sort(), messageCount:payload.messages?.length ?? null,
            historyKind:payload.kind ?? 'full', reset:payload.kind==='reset', unchanged:payload.kind==='delta' && payload.messages?.length===0,
            cursorPresent:typeof payload.deltaCursor==='string', hasInFlightRun:Boolean(payload.inFlightRun?.runId), hasActiveRun:payload.sessionInfo?.hasActiveRun===true,
            // Never persist raw cursors, session IDs, tokens or message text.
            errorCode:m.error?.code});
        }
      }
    } catch {}
    if(client.readyState===WebSocket.OPEN) client.send(buf,{binary});
  });
  client.on('error',()=>upstream.close()); upstream.on('error',()=>client.close());
  client.on('close',()=>upstream.close()); upstream.on('close',()=>client.close());
});
console.log('WIRE_RELAY_READY');
process.on('SIGTERM',()=> {
 for(const c of server.clients)c.terminate();
 control.close();server.close(()=>log.end(()=>process.exit(0)));
});
