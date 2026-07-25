'use strict';

const assert = require('node:assert/strict');

class CdpClient {
    constructor(endpoint) { this.endpoint=endpoint;this.nextId=1;this.pending=new Map() }
    async connect(){let pages;for(let i=0;i<50;i++){try{pages=await(await fetch(this.endpoint+'/json')).json();if(pages.length)break}catch{}await new Promise(r=>setTimeout(r,200))}assert.ok(pages?.length,'浏览器连接失败');const page=pages.find(p=>p.type==='page');this.socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject});this.socket.onmessage=event=>{const message=JSON.parse(event.data),pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result)}}
    command(method,params={}){const id=this.nextId++;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))}
    async evaluate(expression){const result=await this.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
    async waitFor(expression){for(let i=0;i<80;i++){if(await this.evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw new Error('等待超时：'+expression)}
    async close(){try{await this.command('Browser.close')}catch{}}
}

(async()=>{
    const browser=new CdpClient(process.argv[2]||'http://127.0.0.1:9241');
    const username=`poke_${Date.now().toString(36)}`;
    const adminUsername=process.env.POKEMON_TEST_ADMIN_USERNAME||'admin';
    const adminPassword=process.env.POKEMON_TEST_ADMIN_PASSWORD;
    assert.ok(adminPassword,'请通过 POKEMON_TEST_ADMIN_PASSWORD 提供测试管理员密码');
    try{
        await browser.connect();
        await browser.waitFor("document.querySelector('input[name=username]')!==null");
        await browser.evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(username)};document.querySelector('input[name=password]').value='password123';HTMLFormElement.prototype.submit.call(document.querySelector('form'))`);
        await browser.waitFor("location.pathname==='/login' && new URLSearchParams(location.search).get('registered')==='pending'");
        await browser.evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(adminUsername)};document.querySelector('input[name=password]').value=${JSON.stringify(adminPassword)};HTMLFormElement.prototype.submit.call(document.querySelector('form'))`);
        await browser.waitFor("location.pathname==='/admin' && typeof apiFetch==='function'");
        const pendingId=await browser.evaluate(`(()=>{const card=[...document.querySelectorAll('.admin-user-card')].find(item=>item.querySelector('h3')?.textContent===${JSON.stringify(username)});return card?.dataset.userId||null})()`);
        assert.ok(pendingId,'管理员后台应显示待审批测试用户');
        await browser.evaluate(`apiFetch('/api/admin/users/${pendingId}/approve',{method:'POST'})`);
        await browser.evaluate("HTMLFormElement.prototype.submit.call(document.querySelector('.account form'))");
        await browser.waitFor("location.pathname==='/login'");
        await browser.evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(username)};document.querySelector('input[name=password]').value='password123';HTMLFormElement.prototype.submit.call(document.querySelector('form'))`);
        await browser.waitFor("location.pathname==='/dashboard' && typeof apiFetch==='function'");
        await browser.evaluate("document.querySelector('[data-app-version=pokemon]').click()");
        await browser.waitFor("location.pathname==='/pokemon' && window.pokemonDashboardRefresh && document.querySelector('#claimPokemon:not([hidden])')");
        await browser.evaluate("document.getElementById('claimPokemon').click()");
        await browser.waitFor("document.querySelector('#pokemonChoiceDialog[open] [data-choice]')!==null");
        await browser.evaluate("document.querySelector('#pokemonChoiceDialog [data-choice]').click()");
        await browser.waitFor("document.querySelector('.pokemon-partner h2')!==null");
        const timer=await browser.evaluate("apiFetch('/api/timer/start',{method:'POST',body:{projectId:'math',mode:'countup',targetSeconds:null}})");
        await new Promise(resolve=>setTimeout(resolve,1200));
        await browser.evaluate(`apiFetch('/api/timer/stop',{method:'POST',body:{sessionId:${JSON.stringify(timer.sessionId)},version:${timer.version}}})`);
        const game=await browser.evaluate("apiFetch('/api/pokemon/bootstrap',{method:'POST'})");
        assert.ok(game.owned[0].experienceSeconds>=1,'计时完成后应获得经验');
        assert.equal(await browser.evaluate("apiFetch('/api/bootstrap').then(data=>data.preferredVersion)"),'pokemon');
        for(const [width,height] of [[390,844],[768,1024]]){
            await browser.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
            const layout=await browser.evaluate("({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,switchVisible:document.querySelector('.version-switch').getBoundingClientRect().width>0,pokedexColumns:getComputedStyle(document.querySelector('.pokedex-grid')).gridTemplateColumns.split(' ').length})");
            assert.equal(layout.overflow,false,`${width}px 不应产生横向溢出`);assert.equal(layout.switchVisible,true);assert.ok(layout.pokedexColumns>=3);
        }
        console.log('pokemon browser workflow tests passed');
    }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
