import http from 'node:http';
import fs from 'node:fs';
const [root, logFile] = process.argv.slice(2);
const stamp=(event,extra={})=>fs.appendFileSync(logFile,JSON.stringify({ts:new Date().toISOString(),ms:Date.now(),event,...extra})+'\n');
let sequence=0;
const server=http.createServer(async(req,res)=>{
  const chunks=[]; for await(const c of req) chunks.push(c);
  let body; try { body=JSON.parse(Buffer.concat(chunks).toString()||'{}'); } catch {res.writeHead(400).end();return;}
  const messages=body.messages??body.input??[];
  const userMessages=Array.isArray(messages)?messages.filter(m=>m.role==='user'):[];
  const text=JSON.stringify(userMessages.length?userMessages:messages);
  const maintenance=text.includes('MAINT-PREP');
  const turn=text.includes('TURN-2')?2:text.includes('TURN-1')?1:null;
  const id=++sequence;
  stamp('request-received',{id,url:req.url,maintenance,turn,stream:body.stream,model:body.model,userText:text});
  let timer;
  res.on('close',()=>{clearInterval(timer);if(!res.writableEnded)stamp('client-disconnected',{id,maintenance,turn});});
  const respond=()=>{
    if(res.destroyed)return;
    const reply=maintenance?'maintenance released':'Fixture reply '+(turn??'normal');
    if(body.stream){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const base={id:'chatcmpl-fixture-'+id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:body.model??'local-fixture'};
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:reply},finish_reason:null}]})+'\n\n');
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:4,total_tokens:34}})+'\n\n');
      res.end('data: [DONE]\n\n');
    }else{
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({id:'chatcmpl-fixture-'+id,object:'chat.completion',created:Math.floor(Date.now()/1000),model:body.model??'local-fixture',choices:[{index:0,message:{role:'assistant',content:reply},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:4,total_tokens:34}}));
    }
    stamp('response-sent',{id,maintenance,turn});
  };
  if(maintenance&&!fs.existsSync(root+'/release')){
    stamp('stall-active',{id}); timer=setInterval(()=>{if(fs.existsSync(root+'/release')){clearInterval(timer);stamp('release-observed',{id});respond();}},25);
  }else respond();
});
server.listen(0,'127.0.0.1',()=>{const port=server.address().port;fs.writeFileSync(root+'/fake-ready.json',JSON.stringify({pid:process.pid,port}));stamp('server-ready',{pid:process.pid,port});});
process.on('SIGTERM',()=>{stamp('server-stopping',{pid:process.pid});server.closeAllConnections();server.close(()=>process.exit(0));});
