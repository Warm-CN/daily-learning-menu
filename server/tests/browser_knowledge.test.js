'use strict';

const assert = require('node:assert/strict');

class CdpClient {
    constructor(endpoint) { this.endpoint=endpoint;this.nextId=1;this.pending=new Map(); }
    async connect(){let pages;for(let i=0;i<50;i++){try{pages=await(await fetch(this.endpoint+'/json')).json();if(pages.length)break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}assert.ok(pages?.length,'浏览器连接失败');const page=pages.find(item=>item.type==='page');this.socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject});this.socket.onmessage=event=>{const message=JSON.parse(event.data),pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result)}}
    command(method,params={}){const id=this.nextId++;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))}
    async evaluate(expression){const result=await this.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
    async waitFor(expression){for(let i=0;i<100;i++){if(await this.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('等待超时：'+expression)}
    async close(){try{await this.command('Browser.close')}catch{}}
}

(async()=>{
    const browser=new CdpClient(process.argv[2]||'http://127.0.0.1:9261');
    try{
        await browser.connect();
        await browser.waitFor("document.querySelector('input[name=username]')!==null");
        await browser.evaluate("document.querySelector('input[name=username]').value='knowledge_browser';document.querySelector('input[name=password]').value='password123';HTMLFormElement.prototype.submit.call(document.querySelector('form'))");
        await browser.waitFor("location.pathname==='/dashboard' && document.getElementById('knowledgeProject')?.options.length>=4");
        console.log('knowledge e2e: dashboard ready');
        await browser.evaluate("document.getElementById('knowledgeProject').value='math';document.getElementById('knowledgeContent').value='导数为零不代表取得极值\\n还要检查单调性';document.getElementById('saveKnowledge').click()");
        await browser.waitFor("document.querySelector('#todayKnowledge .knowledge-item')?.textContent.includes('检查单调性')");
        assert.equal(await browser.evaluate("todayKnowledgeItems.length"),1);
        console.log('knowledge e2e: quick entry ready');

        await browser.evaluate("document.querySelector('[data-view=knowledge]').click()");
        await browser.waitFor("document.getElementById('view-knowledge').classList.contains('active') && document.querySelector('#knowledgeArchive .knowledge-item')");
        await browser.evaluate("document.getElementById('knowledgeQuery').value='检查单调性';document.getElementById('knowledgeQuery').dispatchEvent(new Event('input'))");
        await browser.waitFor("document.getElementById('knowledgeSummary').textContent.includes('1 条')");
        await browser.evaluate("document.querySelector('#knowledgeArchive [data-edit-knowledge]').click()");
        await browser.waitFor("document.getElementById('knowledgeDialog').open");
        await browser.evaluate("document.getElementById('editKnowledgeContent').value='极值点需要结合导数变号判断';document.getElementById('submitKnowledge').click()");
        await browser.waitFor("document.querySelector('#todayKnowledge .knowledge-item')?.textContent.includes('导数变号')");
        console.log('knowledge e2e: search and edit ready');

        await browser.evaluate("document.querySelector('[data-view=calendar]').click()");
        await browser.waitFor("document.querySelector('.calendar .has-knowledge')?.textContent.includes('1 条收获')");
        await browser.evaluate("document.querySelector('.calendar .has-knowledge').click()");
        await browser.waitFor("document.getElementById('view-knowledge').classList.contains('active') && !document.getElementById('knowledgeExactFilter').hidden");
        console.log('knowledge e2e: calendar link ready');

        for(const [width,height] of [[390,844],[768,1024]]){
            await browser.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
            await new Promise(resolve=>setTimeout(resolve,100));
            assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),true,`${width}px 不应横向溢出`);
        }
        console.log('knowledge e2e: responsive ready');
        await browser.evaluate("apiFetch('/api/preferences/version',{method:'PATCH',body:{version:'pokemon'}}).then(()=>location.href='/pokemon')");
        await browser.waitFor("location.pathname==='/pokemon' && document.querySelector('.pokemon-home .knowledge-quick-card') && todayKnowledgeItems.length===1");
        console.log('knowledge browser workflow tests passed');
    }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
