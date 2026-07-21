'use strict';

const assert = require('node:assert/strict');

class CdpClient {
    constructor(endpoint) { this.endpoint=endpoint; this.nextId=1; this.pending=new Map(); }
    async connect(){let pages;for(let i=0;i<40;i++){try{pages=await(await fetch(this.endpoint+'/json')).json();if(pages.length)break}catch{}await new Promise(r=>setTimeout(r,250))}assert.ok(pages?.length,'浏览器连接失败');const page=pages.find(p=>p.type==='page');this.socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject});this.socket.onmessage=event=>{const msg=JSON.parse(event.data),pending=this.pending.get(msg.id);if(!pending)return;this.pending.delete(msg.id);msg.error?pending.reject(new Error(msg.error.message)):pending.resolve(msg.result)}}
    command(method,params={}){const id=this.nextId++;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))}
    async evaluate(expression){const result=await this.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
    async waitFor(expression){for(let i=0;i<50;i++){if(await this.evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('等待超时：'+expression)}
    async close(){try{await this.command('Browser.close')}catch{}}
}

async function register(client,username){await client.waitFor("document.querySelector('input[name=username]')!==null");await client.evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(username)};document.querySelector('input[name=password]').value='password123';HTMLFormElement.prototype.submit.call(document.querySelector('form'))`);await client.waitFor("location.pathname==='/dashboard' && typeof apiFetch==='function'")}

(async()=>{
    const alice=new CdpClient(process.argv[2]||'http://127.0.0.1:9231');
    const bob=new CdpClient(process.argv[3]||'http://127.0.0.1:9232');
    try{
        await Promise.all([alice.connect(),bob.connect()]);
        await Promise.all([register(alice,'alice_browser'),register(bob,'bob_browser')]);
        await alice.evaluate("apiFetch('/api/friends/add',{method:'POST',body:{username:'bob_browser'}})");
        const timer=await alice.evaluate("apiFetch('/api/timer/start',{method:'POST',body:{projectId:'math',mode:'countup',targetSeconds:null}})");
        await new Promise(r=>setTimeout(r,1200));
        const visible=await bob.evaluate("apiFetch('/api/friends/status')");
        assert.equal(visible[0].username,'alice_browser');assert.equal(visible[0].online,true);assert.equal(visible[0].timer.projectName,'数学');
        await alice.evaluate(`apiFetch('/api/timer/stop',{method:'POST',body:{sessionId:${JSON.stringify(timer.sessionId)},version:${timer.version}}})`);
        const completed=await bob.evaluate("apiFetch('/api/friends/status')");
        assert.ok(completed[0].todaySeconds>=1);assert.equal(completed[0].timer,null);
        console.log('server browser workflow tests passed');
    }finally{await Promise.all([alice.close(),bob.close()])}
})().catch(error=>{console.error(error);process.exitCode=1});
