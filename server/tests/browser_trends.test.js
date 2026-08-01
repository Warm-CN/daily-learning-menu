'use strict';

const assert=require('node:assert/strict');
class CdpClient{
  constructor(endpoint){this.endpoint=endpoint;this.nextId=1;this.pending=new Map()}
  async connect(){let pages;for(let i=0;i<50;i++){try{pages=await(await fetch(this.endpoint+'/json')).json();if(pages.length)break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}assert.ok(pages?.length,'浏览器连接失败');const page=pages.find(item=>item.type==='page');this.socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject});this.socket.onmessage=event=>{const message=JSON.parse(event.data),pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result)}}
  command(method,params={}){const id=this.nextId++;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))}
  async evaluate(expression){const result=await this.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
  async waitFor(expression){for(let i=0;i<100;i++){if(await this.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('等待超时：'+expression)}
  async close(){try{await this.command('Browser.close')}catch{}}
}

(async()=>{
  const browser=new CdpClient(process.argv[2]||'http://127.0.0.1:9251');
  try{
    await browser.connect();
    await browser.waitFor("document.querySelector('input[name=username]')!==null");
    await browser.evaluate("document.querySelector('input[name=username]').value='trend_browser';document.querySelector('input[name=password]').value='password123';HTMLFormElement.prototype.submit.call(document.querySelector('form'))");
    await browser.waitFor("location.pathname==='/dashboard' && typeof apiFetch==='function'");
    const completed=await browser.evaluate("apiFetch('/api/timer/start',{method:'POST',body:{projectId:'math',mode:'countup',targetSeconds:null}})");
    await new Promise(resolve=>setTimeout(resolve,1100));
    await browser.evaluate(`apiFetch('/api/timer/stop',{method:'POST',body:{sessionId:${JSON.stringify(completed.sessionId)},version:${completed.version}}})`);
    const active=await browser.evaluate("apiFetch('/api/timer/start',{method:'POST',body:{projectId:'english',mode:'countup',targetSeconds:null}})");
    await browser.evaluate("location.href='/trends'");
    await browser.waitFor("location.pathname==='/trends' && window.echarts && document.querySelector('#trendChart canvas') && trendState.data?.activeTimer");
    const controls=await browser.evaluate("['trendProject','trendDate','refreshTrend'].map(id=>{const rect=document.getElementById(id).getBoundingClientRect();return {id,width:rect.width,height:rect.height}})");
    assert.ok(controls.every(item=>Math.abs(item.height-42)<1),`趋势筛选控件高度应统一为42px：${JSON.stringify(controls)}`);
    assert.ok(Math.abs(controls[0].width-controls[1].width)<1,'项目选择和日期选择应等宽');
    const before=await browser.evaluate("activeTrendSeconds()");await new Promise(resolve=>setTimeout(resolve,1100));const after=await browser.evaluate("activeTrendSeconds()");
    assert.ok(after>before,'分时活动计时应实时增长');
    assert.equal(await browser.evaluate("document.getElementById('trendLive').hidden"),false);
    await browser.evaluate("document.querySelector('[data-interval=day]').click()");
    await browser.waitFor("trendState.interval==='day' && trendState.data?.interval==='day' && document.getElementById('trendChartTitle').textContent.includes('日线')");
    assert.equal(await browser.evaluate("document.getElementById('trendRangeWrap').hidden"),false);
    const alignment=await browser.evaluate("trendChart.dispatchAction({type:'dataZoom',start:50,end:100});new Promise(resolve=>setTimeout(()=>{const index=trendState.data.candles.length-1,m=trendChart.getModel(),candle=m.getSeriesByIndex(0).getData().getItemLayout(index),volume=m.getSeriesByIndex(1).getData().getItemLayout(index);resolve({index,top:trendChart.convertToPixel({xAxisIndex:0},index),bottom:trendChart.convertToPixel({xAxisIndex:1},index),topExtent:m.getComponent('xAxis',0).axis.getExtent(),bottomExtent:m.getComponent('xAxis',1).axis.getExtent(),candle,volume})},250))");
    assert.ok(Number.isFinite(alignment.top)&&Number.isFinite(alignment.bottom)&&Math.abs(alignment.top-alignment.bottom)<1,`蜡烛与总量柱的日期中心必须重合：${JSON.stringify(alignment)}`);
    await browser.evaluate("trendChart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:trendState.data.candles.length-1})");
    await browser.waitFor("document.querySelector('.trend-tooltip')?.textContent.includes('统计总时长')");
    const tooltip=await browser.evaluate("({width:document.querySelector('.trend-tooltip').getBoundingClientRect().width,text:document.querySelector('.trend-tooltip').textContent})");
    assert.ok(tooltip.width>=230);assert.ok(tooltip.text.includes('开')&&tooltip.text.includes('收'));
    await browser.evaluate("document.querySelector('[data-interval=week]').click()");
    await browser.waitFor("trendState.interval==='week' && trendState.data?.interval==='week'");
    assert.ok(await browser.evaluate("document.querySelectorAll('#trendProject option').length")>=5);
    for(const [width,height] of [[390,844],[768,1024]]){
      await browser.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
      await browser.evaluate("trendChart.resize()");
      const layout=await browser.evaluate("({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,chartWidth:document.getElementById('trendChart').getBoundingClientRect().width,navVisible:document.querySelector('a[href=\"/trends\"]').getBoundingClientRect().width>0})");
      assert.equal(layout.overflow,false,`${width}px 不应横向溢出`);assert.ok(layout.chartWidth>300);assert.equal(layout.navVisible,true);
    }
    await browser.evaluate(`apiFetch('/api/timer/stop',{method:'POST',body:{sessionId:${JSON.stringify(active.sessionId)},version:${active.version}}})`);
    console.log('trend browser workflow tests passed');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
