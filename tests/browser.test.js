'use strict';

const assert = require('node:assert/strict');

const endpoint = process.argv[2] || 'http://127.0.0.1:9229';
let socket;
let nextId = 1;
const pending = new Map();

async function connect() {
    let pages;
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            pages = await (await fetch(endpoint + '/json')).json();
            if (pages.length) break;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(pages && pages.length, '无法连接无界面浏览器');
    const page = pages.find(item => item.url && item.url.startsWith('file:')) || pages.find(item => item.type === 'page');
    assert.ok(page, '未找到本地网页标签：' + pages.map(item => item.url).join(', '));
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => { const message = JSON.parse(event.data); if (!message.id) return;
        const request = pending.get(message.id); if (!request) return; pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); };
}

function command(method, params = {}) {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
    const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
}

async function waitFor(expression) {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('等待页面状态超时：' + expression);
}

(async () => {
    await connect();
    await waitFor("document.querySelector('[data-page=timer]') !== null");
    await evaluate("document.querySelector('[data-page=timer]').click()");
    await waitFor("document.getElementById('btnManageProjects') !== null");
    await evaluate("document.getElementById('btnManageProjects').click(); document.getElementById('newProjectName').value='计算机网络'; document.getElementById('newProjectIcon').value='🌐'; document.getElementById('newProjectColor').value='#123456'; document.getElementById('btnAddProject').click(); document.getElementById('btnProjectSave').click()");
    const projectId = await evaluate("JSON.parse(localStorage.getItem('kaoyan_projects_v1')).find(p=>p.name==='计算机网络').id");
    assert.ok(projectId.startsWith('project_'));
    await evaluate(`document.querySelector('[data-subj="${projectId}"]').click(); document.getElementById('btnStart').click()`);
    await new Promise(resolve => setTimeout(resolve, 1200));
    await evaluate("document.getElementById('btnPause').click()");
    const pausedState = await evaluate("JSON.parse(localStorage.getItem('kaoyan_timer_st'))");
    assert.equal(pausedState.phase, 'paused');
    assert.ok(pausedState.elapsedBefore >= 1);
    await command('Page.reload');
    await waitFor("document.querySelector('[data-page=timer]') !== null");
    await evaluate("document.querySelector('[data-page=timer]').click()");
    await waitFor("document.getElementById('btnStart') && document.getElementById('btnStart').textContent.includes('继续')");
    await evaluate("document.getElementById('btnStop').click()");
    const result = await evaluate(`(() => { const data=JSON.parse(localStorage.getItem('kaoyan_study_v3')); const date=new Date(); const p=n=>String(n).padStart(2,'0'); const key=date.getFullYear()+'-'+p(date.getMonth()+1)+'-'+p(date.getDate()); return {seconds:data[key]['${projectId}'], ledger:Object.keys(data._meta.creditedSessions).length, timer:localStorage.getItem('kaoyan_timer_st')}; })()`);
    assert.ok(result.seconds >= 1);
    assert.equal(result.ledger, 1);
    assert.equal(result.timer, null);
    console.log('browser workflow tests passed');
    await command('Browser.close');
})().catch(async error => {
    console.error(error);
    try { await command('Browser.close'); } catch {}
    process.exitCode = 1;
});
