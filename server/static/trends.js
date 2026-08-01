const trendElements={
  chart:document.getElementById('trendChart'),empty:document.getElementById('trendEmpty'),summary:document.getElementById('trendSummary'),
  project:document.getElementById('trendProject'),date:document.getElementById('trendDate'),dateWrap:document.getElementById('trendDateWrap'),
  rangeWrap:document.getElementById('trendRangeWrap'),rangeButtons:document.getElementById('trendRangeButtons'),
  title:document.getElementById('trendChartTitle'),explanation:document.getElementById('trendExplanation'),live:document.getElementById('trendLive')
};
const trendState={interval:'intraday',projectId:'all',date:chinaToday(),limits:{day:30,week:26},data:null,loading:false};
let trendChart=null,trendPoll=null,trendTick=null,projectsLoaded=false;
const trendColors={rise:'#ef5350',fall:'#26a269',flat:'#94a3b8',volume:'#6f91c8',line:'#4f8cf7'};

function chinaToday(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const part=type=>parts.find(item=>item.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function trendHours(seconds){return `${Math.round((Number(seconds)||0)/360)/10}h`}
function focusLength(seconds){
  seconds=Math.max(0,Math.round(Number(seconds)||0));
  if(seconds<60)return `${seconds}秒`;
  const minutes=Math.round(seconds/60);
  return minutes<60?`${minutes}分钟`:`${Math.floor(minutes/60)}小时${minutes%60?`${minutes%60}分钟`:''}`;
}
function chinaTime(timestamp){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(timestamp))}
function signedHours(seconds){const value=Math.round(Math.abs(seconds||0)/360)/10;return `${seconds>0?'+':seconds<0?'−':''}${value}h`}
function escapeTrend(value){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}

function activeTrendSeconds(){
  const active=trendState.data?.activeTimer;
  if(!active)return 0;
  let seconds=Number(active.elapsedSeconds)||0;
  if(active.phase==='running'){
    let delta=Math.max(0,(Date.now()-Date.parse(active.serverNow))/1000);
    if(active.mode==='countdown'&&active.remainingSeconds!=null)delta=Math.min(delta,Math.max(0,active.remainingSeconds));
    seconds+=delta;
  }
  return seconds;
}

function renderTrendControls(){
  document.querySelectorAll('[data-interval]').forEach(button=>button.classList.toggle('active',button.dataset.interval===trendState.interval));
  const intraday=trendState.interval==='intraday';
  trendElements.dateWrap.hidden=!intraday;trendElements.rangeWrap.hidden=intraday;
  if(!intraday){
    const choices=trendState.interval==='day'?[30,90,180]:[26,52,104];
    trendElements.rangeButtons.innerHTML=choices.map(value=>`<button type="button" data-range="${value}" class="${trendState.limits[trendState.interval]===value?'active':''}">${value}${trendState.interval==='day'?'天':'周'}</button>`).join('');
    trendElements.rangeButtons.querySelectorAll('[data-range]').forEach(button=>button.onclick=()=>{trendState.limits[trendState.interval]=Number(button.dataset.range);renderTrendControls();loadTrend()});
  }
}

function populateProjects(projects){
  if(projectsLoaded)return;
  trendElements.project.innerHTML='<option value="all">全部项目</option>'+projects.map(project=>`<option value="${escapeTrend(project.id)}">${escapeTrend(project.icon)} ${escapeTrend(project.name)}${project.archived?'（已归档）':''}</option>`).join('');
  trendElements.project.value=trendState.projectId;projectsLoaded=true;
}

async function loadTrend(){
  if(trendState.loading)return;
  trendState.loading=true;document.getElementById('refreshTrend').disabled=true;
  try{
    const params=new URLSearchParams({interval:trendState.interval,projectId:trendState.projectId});
    if(trendState.interval==='intraday')params.set('date',trendState.date);
    else params.set('limit',trendState.limits[trendState.interval]);
    trendState.data=await apiFetch(`/api/trends?${params}`);
    populateProjects(trendState.data.projects||[]);
    renderTrend();
  }catch(error){toast(error.message)}finally{trendState.loading=false;document.getElementById('refreshTrend').disabled=false}
}

function renderTrend(){
  if(!trendState.data)return;
  renderTrendSummary();
  if(trendState.interval==='intraday')renderIntradayChart();else renderCandleChart();
}

function summaryCard(value,label,color){return `<div class="stat-card" style="--color:${color}"><strong>${escapeTrend(value)}</strong><span>${escapeTrend(label)}</span></div>`}
function renderTrendSummary(){
  const data=trendState.data;
  if(trendState.interval==='intraday'){
    const active=activeTrendSeconds(),curve=data.sessionSeconds+active;
    trendElements.summary.innerHTML=summaryCard(trendHours(data.totalSeconds),'统计总时长',trendColors.volume)+summaryCard(trendHours(curve),'计时曲线（含当前）',trendColors.line)+summaryCard(String(data.sessions.length+(data.activeTimer?1:0)),'计时次数','#9b7ad6')+summaryCard(signedHours(data.adjustmentSeconds),'统计与已完成计时差额',data.adjustmentSeconds>=0?trendColors.rise:trendColors.fall);
    trendElements.title.textContent=`📈 ${data.date} 分时`;
    trendElements.explanation.textContent='实线为已完成计时的累计时长，虚线为当前活动计时；补录无法定位到具体时刻。';
    trendElements.live.hidden=!data.activeTimer;
    if(data.activeTimer)trendElements.live.querySelector('span').textContent=data.activeTimer.phase==='running'?'实时':'已暂停';
  }else{
    const candles=data.candles,sessionCount=candles.reduce((sum,item)=>sum+item.sessionCount,0),total=candles.reduce((sum,item)=>sum+item.totalSeconds,0),activePeriods=candles.filter(item=>item.sessionCount||item.totalSeconds).length,longest=Math.max(0,...candles.map(item=>item.highSeconds||0));
    trendElements.summary.innerHTML=summaryCard(trendHours(total),'区间总时长',trendColors.volume)+summaryCard(String(sessionCount),'完成计时次数',trendColors.line)+summaryCard(String(activePeriods),trendState.interval==='day'?'有记录天数':'有记录周数','#9b7ad6')+summaryCard(focusLength(longest),'最长单次专注',trendColors.rise);
    trendElements.title.textContent=trendState.interval==='day'?'📊 学习日线':'📊 学习周线';
    trendElements.explanation.textContent='蜡烛展示首次、最长、最短和末次专注；下方柱形展示包含补录的统计总时长。';
    trendElements.live.hidden=true;
  }
}

function ensureTrendChart(hasData){
  if(!window.echarts){trendElements.chart.hidden=true;trendElements.empty.hidden=false;trendElements.empty.querySelector('strong').textContent='图表组件加载失败';return false}
  trendElements.chart.hidden=!hasData;trendElements.empty.hidden=hasData;
  if(!hasData){trendChart?.clear();return false}
  if(!trendChart)trendChart=echarts.init(trendElements.chart,null,{renderer:'canvas'});
  return true;
}

function richTooltip(formatter){
  return {trigger:'axis',renderMode:'html',confine:true,backgroundColor:'rgba(15,23,42,.97)',borderColor:'rgba(148,163,184,.28)',borderWidth:1,padding:0,textStyle:{color:'#f8fafc',fontSize:12},extraCssText:'border-radius:12px;box-shadow:0 14px 35px rgba(15,23,42,.28);',axisPointer:{type:'cross',lineStyle:{color:'#64748b',width:1,type:'dashed'},crossStyle:{color:'#64748b',width:1,type:'dashed'},label:{color:'#fff',backgroundColor:'#334155',padding:[4,7],borderRadius:5}},formatter};
}

function renderIntradayChart(){
  const data=trendState.data,active=data.activeTimer,hasData=data.sessions.length>0||Boolean(active);
  if(!ensureTrendChart(hasData))return;
  const dayStart=Date.parse(`${data.date}T00:00:00+08:00`),dayEnd=dayStart+86400000-1;
  let cumulative=0;
  const completed=[{value:[dayStart,0],projectName:'起点'}];
  for(const session of data.sessions){
    const end=Math.min(dayEnd,Math.max(dayStart,session.endedAt));
    cumulative+=session.durationSeconds;
    completed.push({value:[end,cumulative/3600],projectName:session.projectName,durationSeconds:session.durationSeconds});
  }
  const activeSeconds=activeTrendSeconds(),activeData=[];
  if(active){
    const start=Math.min(dayEnd,Math.max(dayStart,Date.parse(active.sessionStartedAt)));
    const now=Math.min(dayEnd,Math.max(start,Date.now()));
    activeData.push({value:[start,cumulative/3600],projectName:active.projectName});
    activeData.push({value:[now,(cumulative+activeSeconds)/3600],projectName:active.projectName,durationSeconds:activeSeconds});
  }
  const tooltip=richTooltip(params=>{
    const point=params.find(item=>item.seriesName==='当前计时')||params.find(item=>item.seriesName==='累计学习');
    if(!point)return '';
    const raw=point.data||{},value=point.value;
    return `<div class="trend-tooltip"><div class="trend-tooltip-head"><span>${chinaTime(value[0])}</span><em>分时</em></div><div class="trend-tooltip-total"><small>累计学习</small><strong>${Number(value[1]).toFixed(2)} 小时</strong></div>${raw.projectName?`<div class="trend-tooltip-foot"><span>${escapeTrend(raw.projectName)}</span>${raw.durationSeconds?`<b>${focusLength(raw.durationSeconds)}</b>`:''}</div>`:''}</div>`;
  });
  trendChart.setOption({animation:false,grid:{left:54,right:20,top:30,bottom:58},tooltip,xAxis:{type:'time',min:dayStart,max:dayEnd,axisLabel:{formatter:value=>chinaTime(value).slice(0,5)},splitLine:{show:false}},yAxis:{type:'value',min:0,name:'累计小时',axisLabel:{formatter:value=>`${value}h`},splitLine:{lineStyle:{color:'#edf1f5'}}},series:[{name:'累计学习',type:'line',step:'end',showSymbol:data.sessions.length<12,symbolSize:6,data:completed,lineStyle:{width:2,color:trendColors.line},itemStyle:{color:trendColors.line},areaStyle:{color:'rgba(79,140,247,.13)'}},{name:'当前计时',type:'line',showSymbol:true,symbolSize:7,data:activeData,lineStyle:{width:2,type:'dashed',color:trendColors.rise},itemStyle:{color:trendColors.rise}}]},{notMerge:true});
}

function candleColor(item){if(item.openSeconds==null)return trendColors.volume;if(item.closeSeconds===item.openSeconds)return trendColors.flat;return item.closeSeconds>item.openSeconds?trendColors.rise:trendColors.fall}
function renderCandleChart(){
  const data=trendState.data,candles=data.candles,hasData=candles.some(item=>item.openSeconds!=null||item.totalSeconds>0);
  if(!ensureTrendChart(hasData))return;
  const labels=candles.map(item=>item.label);
  const candleData=candles.map(item=>({value:item.openSeconds==null?[item.label,'-','-','-','-']:[item.label,item.openSeconds/3600,item.closeSeconds/3600,item.lowSeconds/3600,item.highSeconds/3600],itemStyle:item.closeSeconds===item.openSeconds?{color:trendColors.flat,color0:trendColors.flat,borderColor:trendColors.flat,borderColor0:trendColors.flat}:undefined}));
  const volumes=candles.map(item=>({value:[item.label,item.totalSeconds/3600],itemStyle:{color:candleColor(item)}}));
  const tooltip=richTooltip(params=>{
    const index=params.find(item=>item.seriesName==='专注K线')?.dataIndex??params[0]?.dataIndex;
    const item=candles[index];
    if(!item)return '';
    const title=trendState.interval==='week'?`${item.key} 至 ${item.weekEnd}`:item.key;
    const color=candleColor(item);
    let status='无完成计时',statusClass='empty';
    if(item.openSeconds!=null){
      const delta=item.closeSeconds-item.openSeconds;
      status=delta>0?`末次比首次增加 ${focusLength(delta)}`:delta<0?`末次比首次减少 ${focusLength(-delta)}`:'末次与首次持平';
      statusClass=delta>0?'rise':delta<0?'fall':'flat';
    }
    const cells=item.openSeconds==null?'<div class="trend-tooltip-none">本周期没有完成计时，只有统计总量</div>':`<div class="trend-tooltip-grid"><div><span>开</span><strong>${focusLength(item.openSeconds)}</strong></div><div><span>高</span><strong>${focusLength(item.highSeconds)}</strong></div><div><span>低</span><strong>${focusLength(item.lowSeconds)}</strong></div><div><span>收</span><strong>${focusLength(item.closeSeconds)}</strong></div></div>`;
    return `<div class="trend-tooltip"><div class="trend-tooltip-head"><span>${title}</span><em>${trendState.interval==='week'?'周线':'日线'}</em></div><div class="trend-tooltip-status ${statusClass}"><i style="background:${color}"></i>${status}</div>${cells}<div class="trend-tooltip-total"><small>统计总时长（含补录）</small><strong>${trendHours(item.totalSeconds)}</strong></div><div class="trend-tooltip-foot"><span>完成计时</span><b>${item.sessionCount} 次</b></div></div>`;
  });
  trendChart.setOption({animationDuration:250,axisPointer:{link:[{xAxisIndex:[0,1]}]},tooltip,grid:[{left:56,right:22,top:28,height:'57%',containLabel:false},{left:56,right:22,top:'73%',height:'13%',containLabel:false}],xAxis:[{type:'category',gridIndex:0,data:labels,boundaryGap:true,axisLine:{onZero:false},axisTick:{alignWithLabel:true},splitLine:{show:false},min:'dataMin',max:'dataMax'},{type:'category',gridIndex:1,data:labels,boundaryGap:true,axisLine:{onZero:false},axisLabel:{show:false},axisTick:{show:false,alignWithLabel:true},splitLine:{show:false},min:'dataMin',max:'dataMax'}],yAxis:[{scale:true,name:'单次专注',axisLabel:{formatter:value=>`${value}h`},splitLine:{lineStyle:{color:'#edf1f5'}}},{scale:true,gridIndex:1,name:'总量',nameGap:8,axisLabel:{formatter:value=>`${value}h`},splitLine:{show:false}}],dataZoom:[{type:'inside',xAxisIndex:[0,1],filterMode:'none'},{type:'slider',xAxisIndex:[0,1],filterMode:'none',bottom:4,height:20,showDetail:false,borderColor:'#dfe5ed',fillerColor:'rgba(79,140,247,.12)'}],series:[{name:'专注K线',type:'candlestick',xAxisIndex:0,yAxisIndex:0,data:candleData,encode:{x:0,y:[1,2,3,4]},itemStyle:{color:trendColors.rise,color0:trendColors.fall,borderColor:trendColors.rise,borderColor0:trendColors.fall}},{name:'总学习时长',type:'bar',xAxisIndex:1,yAxisIndex:1,data:volumes,encode:{x:0,y:1},barWidth:'42%',barMaxWidth:24}]},{notMerge:true});
}

function resetTrendPolling(){clearInterval(trendPoll);trendPoll=setInterval(loadTrend,document.hidden?60000:15000)}
document.querySelectorAll('[data-interval]').forEach(button=>button.onclick=()=>{trendState.interval=button.dataset.interval;renderTrendControls();loadTrend()});
trendElements.project.onchange=()=>{trendState.projectId=trendElements.project.value;loadTrend()};
trendElements.date.value=trendState.date;trendElements.date.max=chinaToday();trendElements.date.onchange=()=>{trendState.date=trendElements.date.value||chinaToday();loadTrend()};
document.getElementById('refreshTrend').onclick=loadTrend;
document.addEventListener('visibilitychange',()=>{resetTrendPolling();if(!document.hidden)loadTrend()});
window.addEventListener('resize',()=>trendChart?.resize());
renderTrendControls();loadTrend();resetTrendPolling();trendTick=setInterval(()=>{if(!document.hidden&&trendState.interval==='intraday'&&trendState.data?.activeTimer){renderTrendSummary();renderIntradayChart()}},1000);
