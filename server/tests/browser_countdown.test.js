'use strict';

const assert = require('node:assert/strict');

class CdpClient {
    constructor(endpoint) { this.endpoint=endpoint;this.nextId=1;this.pending=new Map(); }
    async connect(){let pages;for(let i=0;i<50;i++){try{pages=await(await fetch(this.endpoint+'/json')).json();if(pages.length)break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}assert.ok(pages?.length,'浏览器连接失败');const page=pages.find(item=>item.type==='page');this.socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject});this.socket.onmessage=event=>{const message=JSON.parse(event.data),pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result)};}
    command(method,params={}){const id=this.nextId++;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}));}
    async evaluate(expression){const result=await this.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
    async waitFor(expression){for(let i=0;i<100;i++){if(await this.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('等待超时：'+expression);}
    async close(){try{await this.command('Browser.close');}catch{}}
}

(async()=>{
    const browser=new CdpClient(process.argv[2]||'http://127.0.0.1:9262');
    try{
        await browser.connect();
        await browser.waitFor("document.querySelector('input[name=username]')!==null");
        await browser.evaluate("document.querySelector('input[name=username]').value='countdown_browser';document.querySelector('input[name=password]').value='password123';HTMLFormElement.prototype.submit.call(document.querySelector('form'))");
        await browser.waitFor("location.pathname==='/dashboard' && document.getElementById('countdownBanner')!==null && typeof countdownStatus==='function'");
        await browser.evaluate("apiFetch('/api/preferences/countdown',{method:'PATCH',body:{date:null}}).then(()=>{state.countdown=null;renderCountdown()})");
        await browser.waitFor("document.getElementById('openCountdown')!==null");
        assert.equal(await browser.evaluate("document.getElementById('countdownBanner').previousElementSibling.classList.contains('home-intro')"),true);
        await browser.evaluate("document.getElementById('openCountdown').click()");
        await browser.waitFor("document.getElementById('countdownDialog').open");
        assert.equal(await browser.evaluate("document.getElementById('countdownName').value"),'考研初试');
        const tomorrow=await browser.evaluate("(()=>{const [year,month,day]=chinaDate().split('-').map(Number),date=new Date(Date.UTC(year,month-1,day+1));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`})()");
        await browser.evaluate(`document.getElementById('countdownName').value='2027 考研初试';document.getElementById('countdownDate').value=${JSON.stringify(tomorrow)};document.getElementById('saveCountdown').click()`);
        await browser.waitFor("!document.getElementById('countdownDialog').open && document.querySelector('.countdown-banner.is-set')?.textContent.includes('2027 考研初试')");
        assert.equal(await browser.evaluate("document.querySelector('.countdown-remaining').textContent.includes('还剩 1 天')"),true);
        assert.deepEqual(await browser.evaluate("[countdownStatus(chinaDate()).label,countdownStatus('2000-01-01').className]"),['就是今天','elapsed']);
        console.log('countdown e2e: save and day status ready');

        await browser.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),true,'390px 不应横向溢出');
        assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.countdown-banner')).gridTemplateColumns.split(' ').length"),2);
        await browser.command('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:false});
        await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),true,'768px 不应横向溢出');
        console.log('countdown e2e: responsive ready');

        await browser.evaluate("document.querySelector('[data-app-version=pokemon]').click()");
        await browser.waitFor("location.pathname==='/pokemon' && document.querySelector('.pokemon-home #countdownBanner.is-set')?.textContent.includes('2027 考研初试')");
        await browser.evaluate("document.getElementById('editCountdown').click()");
        await browser.waitFor("document.getElementById('countdownDialog').open");
        assert.equal(await browser.evaluate("document.getElementById('countdownDate').value"),tomorrow);
        await browser.evaluate("document.getElementById('clearCountdown').click()");
        await browser.waitFor("document.getElementById('openCountdown')!==null");
        console.log('countdown browser workflow tests passed');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
