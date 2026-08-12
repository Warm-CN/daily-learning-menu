let state={projects:[],study:{},sessions:[],milestones:{},timer:null};
let selectedProject=null,selectedMode='countup',weekChart=null,pieChart=null,todayChart=null,calendarDate=new Date(),timerTick=null,timerSync=null,finishing=false;
let todayKnowledgeItems=[],knowledgeArchiveItems=[],knowledgePage=1,knowledgeHasMore=false,knowledgeExactDate=null,calendarKnowledgeCounts={},knowledgeSearchTimer=null;
let countdownRolloverTimer=null;
const VIEW_STORAGE_KEY='kaoyan_dashboard_view';
const PROJECT_STORAGE_KEY='kaoyan_selected_project';
const $=id=>document.getElementById(id);
const activeProjects=()=>state.projects.filter(project=>!project.archived);
function chinaDate(value=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);const get=t=>parts.find(p=>p.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`}
function dayTotal(day={}){return state.projects.reduce((sum,p)=>sum+(Number(day[p.id])||0),0)}
function formatDuration(seconds){seconds=Math.max(0,Math.floor(seconds||0));return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}
function formatHours(seconds){return `${Math.round((seconds||0)/360)/10}h`}
function calendarHeat(seconds){if(!seconds)return {alpha:0,dark:false};const hours=seconds/3600,alpha=Math.min(.82,.08+Math.min(hours,8)/8*.74);return {alpha:alpha.toFixed(3),dark:alpha>=.58}}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function readStorage(storage,key){try{return storage.getItem(key)}catch{return null}}
function writeStorage(storage,key,value){try{storage.setItem(key,value)}catch{}}

function calendarDayNumber(value){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));return match?Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])):NaN}
function countdownDaysFromToday(targetDate){return Math.round((calendarDayNumber(targetDate)-calendarDayNumber(chinaDate()))/86400000)}
function countdownDateLabel(targetDate){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date(`${targetDate}T00:00:00+08:00`))}
function countdownStatus(targetDate){
    const days=countdownDaysFromToday(targetDate);
    if(days>0)return {className:'upcoming',days,label:`还剩 ${days} 天`,amount:String(days),unit:'天'};
    if(days===0)return {className:'today',days,label:'就是今天',amount:'今天',unit:''};
    return {className:'elapsed',days,label:`已过去 ${Math.abs(days)} 天`,amount:String(Math.abs(days)),unit:'天'};
}
function bindCountdownControls(){
    $('openCountdown')?.addEventListener('click',openCountdownDialog);
    $('editCountdown')?.addEventListener('click',openCountdownDialog);
}
function renderCountdown(){
    const root=$('countdownBanner');if(!root)return;
    const countdown=state.countdown;
    if(!countdown?.date||!Number.isFinite(calendarDayNumber(countdown.date))){
        root.className='countdown-banner is-empty';
        root.innerHTML='<button id="openCountdown" type="button" class="countdown-empty-action"><span class="countdown-empty-icon">🎯</span><span><strong>设置目标日</strong><small>给未来的自己定一个清晰目标</small></span><em>＋ 设置</em></button>';
        bindCountdownControls();
        return;
    }
    const status=countdownStatus(countdown.date),name=String(countdown.name||'考研初试').trim()||'考研初试';
    root.className=`countdown-banner is-set ${status.className}`;
    root.innerHTML=`<div class="countdown-copy"><span class="countdown-kicker">🎯 目标日期</span><h2>${escapeHtml(name)}</h2><p>目标日 · ${escapeHtml(countdownDateLabel(countdown.date))}</p></div><div class="countdown-remaining" aria-label="${escapeHtml(status.label)}"><span>${status.label}</span><div><strong>${status.amount}</strong>${status.unit?`<em>${status.unit}</em>`:''}</div></div><button id="editCountdown" type="button" class="countdown-edit" aria-label="编辑目标日">编辑</button>`;
    bindCountdownControls();
}
function scheduleCountdownRerender(){
    clearTimeout(countdownRolloverTimer);
    const today=chinaDate(),dayNumber=calendarDayNumber(today),nextMidnight=dayNumber+86400000-(8*3600000);
    const delay=Math.max(1000,nextMidnight-Date.now()+1000);
    countdownRolloverTimer=setTimeout(()=>{renderCountdown();scheduleCountdownRerender()},delay);
}
function openCountdownDialog(){
    const dialog=$('countdownDialog');if(!dialog)return;
    const countdown=state.countdown||{};
    $('countdownName').value=countdown.name||'考研初试';
    $('countdownDate').value=countdown.date||'';
    $('clearCountdown').hidden=!countdown.date;
    if(!dialog.open)dialog.showModal();
    requestAnimationFrame(()=>$('countdownDate').focus());
}
async function saveCountdown(){
    const name=$('countdownName').value.trim(),targetDate=$('countdownDate').value;
    if(!name){toast('请填写目标名称');$('countdownName').focus();return}
    if(!targetDate){toast('请选择目标日期');$('countdownDate').focus();return}
    try{state.countdown=await apiFetch('/api/preferences/countdown',{method:'PATCH',body:{name,date:targetDate}});$('countdownDialog').close();renderCountdown();scheduleCountdownRerender();toast('目标日已保存')}catch(error){toast(error.message)}
}
async function clearCountdown(){
    try{await apiFetch('/api/preferences/countdown',{method:'PATCH',body:{date:null}});state.countdown=null;$('countdownDialog').close();renderCountdown();toast('目标日已清除')}catch(error){toast(error.message)}
}

function projectOptions(projects,selected){return projects.map(project=>`<option value="${escapeHtml(project.id)}"${project.id===selected?' selected':''}>${escapeHtml(project.icon)} ${escapeHtml(project.name)}${project.archived?'（已归档）':''}</option>`).join('')}
function renderKnowledgeInputs(){
    const today=chinaDate(),active=activeProjects(),quick=$('knowledgeProject'),filter=$('knowledgeFilterProject');
    $('knowledgeDate').max=today;$('editKnowledgeDate').max=today;
    if(!$('knowledgeDate').value)$('knowledgeDate').value=today;
    const quickSelected=quick.value||selectedProject||active[0]?.id;
    quick.innerHTML=projectOptions(active,quickSelected);
    const filterSelected=filter.value||'all';
    filter.innerHTML=`<option value="all">全部学科</option>${projectOptions(state.projects,filterSelected)}`;
    filter.value=state.projects.some(project=>project.id===filterSelected)?filterSelected:'all';
    if(!$('knowledgeMonth').value)$('knowledgeMonth').value=today.slice(0,7);
    $('knowledgeMonth').max=today.slice(0,7);
}
function knowledgeDateLabel(key){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(new Date(`${key}T00:00:00+08:00`))}
function knowledgeItemMarkup(item){return `<article class="knowledge-item" data-knowledge-id="${item.id}"><p>${escapeHtml(item.content)}</p><div class="knowledge-item-actions"><time>${new Date(item.updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</time><button type="button" data-edit-knowledge="${item.id}">编辑</button><button type="button" class="danger-text" data-delete-knowledge="${item.id}">删除</button></div></article>`}
function groupByProject(items){const groups=new Map();items.forEach(item=>{const key=item.project?.id||'unknown';if(!groups.has(key))groups.set(key,{project:item.project,items:[]});groups.get(key).items.push(item)});return [...groups.values()]}
function bindKnowledgeActions(root){
    root.querySelectorAll('[data-edit-knowledge]').forEach(button=>button.onclick=()=>openKnowledgeDialog(Number(button.dataset.editKnowledge)));
    root.querySelectorAll('[data-delete-knowledge]').forEach(button=>button.onclick=()=>deleteKnowledgePoint(Number(button.dataset.deleteKnowledge)));
}
function renderTodayKnowledge(){
    const root=$('todayKnowledge');
    if(!todayKnowledgeItems.length){root.innerHTML='<div class="knowledge-empty compact">今天还没有记录知识点，写下第一条收获吧。</div>';return}
    root.innerHTML=`<div class="today-knowledge-head"><strong>今天已收获 ${todayKnowledgeItems.length} 条</strong><button type="button" data-open-today-knowledge>在知识库查看</button></div>`+groupByProject(todayKnowledgeItems).map(group=>`<section class="knowledge-project-group" style="--project-color:${group.project?.color||'#4f8cf7'}"><h4>${escapeHtml(group.project?.icon||'📚')} ${escapeHtml(group.project?.name||'未知学科')}<span>${group.items.length} 条</span></h4>${group.items.map(knowledgeItemMarkup).join('')}</section>`).join('');
    bindKnowledgeActions(root);root.querySelector('[data-open-today-knowledge]').onclick=()=>openKnowledgeDate(chinaDate());
}
async function loadTodayKnowledge(){
    try{let page=1,items=[],data;do{data=await apiFetch(`/api/knowledge-points?date=${chinaDate()}&page=${page}`);items.push(...data.items);page+=1}while(data.hasMore);todayKnowledgeItems=items;renderTodayKnowledge()}catch(error){toast(error.message)}
}
function archiveQuery(page){const params=new URLSearchParams({page:String(page),projectId:$('knowledgeFilterProject').value||'all'});if(knowledgeExactDate)params.set('date',knowledgeExactDate);else params.set('month',$('knowledgeMonth').value||chinaDate().slice(0,7));const query=$('knowledgeQuery').value.trim();if(query)params.set('q',query);return params}
function renderKnowledgeArchive(total=knowledgeArchiveItems.length){
    const root=$('knowledgeArchive');
    $('knowledgeSummary').textContent=knowledgeExactDate?`${knowledgeDateLabel(knowledgeExactDate)} · 共 ${total} 条知识点`:`本月共 ${total} 条知识点`;
    $('knowledgeExactFilter').hidden=!knowledgeExactDate;if(knowledgeExactDate)$('knowledgeExactFilter').querySelector('span').textContent=`正在查看 ${knowledgeExactDate}`;
    if(!knowledgeArchiveItems.length){root.innerHTML='<div class="knowledge-empty"><span>💡</span><h3>没有找到知识点</h3><p>调整筛选条件，或者记录一条新的学习收获。</p></div>';return}
    const dates=new Map();knowledgeArchiveItems.forEach(item=>{if(!dates.has(item.date))dates.set(item.date,[]);dates.get(item.date).push(item)});
    root.innerHTML=[...dates.entries()].map(([key,items])=>`<section class="knowledge-day"><div class="knowledge-day-head"><time datetime="${key}">${knowledgeDateLabel(key)}</time><span>${key} · ${items.length} 条</span></div><div class="knowledge-day-projects">${groupByProject(items).map(group=>`<section class="knowledge-project-group" style="--project-color:${group.project?.color||'#4f8cf7'}"><h4>${escapeHtml(group.project?.icon||'📚')} ${escapeHtml(group.project?.name||'未知学科')}<span>${group.items.length} 条</span></h4>${group.items.map(knowledgeItemMarkup).join('')}</section>`).join('')}</div></section>`).join('');
    bindKnowledgeActions(root);
}
async function loadKnowledgeArchive(reset=true){
    try{const page=reset?1:knowledgePage+1,data=await apiFetch(`/api/knowledge-points?${archiveQuery(page)}`);knowledgePage=page;knowledgeHasMore=data.hasMore;knowledgeArchiveItems=reset?data.items:[...knowledgeArchiveItems,...data.items];renderKnowledgeArchive(data.total);$('loadMoreKnowledge').hidden=!knowledgeHasMore}catch(error){toast(error.message)}
}
function allKnownKnowledgeItems(){return [...todayKnowledgeItems,...knowledgeArchiveItems]}
function openKnowledgeDialog(itemId=null){
    const item=itemId?allKnownKnowledgeItems().find(entry=>entry.id===itemId):null,projects=item?state.projects:activeProjects();
    $('knowledgeDialog').dataset.itemId=item?.id||'';$('knowledgeDialogTitle').textContent=item?'编辑知识点':'新增知识点';
    $('editKnowledgeDate').value=item?.date||knowledgeExactDate||chinaDate();
    $('editKnowledgeProject').innerHTML=projectOptions(projects,item?.project?.id||selectedProject||projects[0]?.id);
    $('editKnowledgeContent').value=item?.content||'';$('knowledgeDialog').showModal();
}
async function refreshKnowledgeViews(){await Promise.all([loadTodayKnowledge(),loadKnowledgeArchive(true),loadCalendarKnowledge()])}
async function deleteKnowledgePoint(itemId){if(!confirm('确定删除这条知识点吗？'))return;try{await apiFetch(`/api/knowledge-points/${itemId}`,{method:'DELETE'});await refreshKnowledgeViews();toast('知识点已删除')}catch(error){toast(error.message)}}
async function loadCalendarKnowledge(){
    const month=`${calendarDate.getFullYear()}-${String(calendarDate.getMonth()+1).padStart(2,'0')}`;
    try{const data=await apiFetch(`/api/knowledge-points/calendar?month=${month}`);calendarKnowledgeCounts=data.counts;renderCalendar()}catch(error){console.warn(error)}
}
function openKnowledgeDate(key){knowledgeExactDate=key;$('knowledgeMonth').value=key.slice(0,7);switchView('knowledge')}

async function loadData(){
    state=await apiFetch('/api/bootstrap');
    const projects=activeProjects();
    const projectExists=projectId=>projects.some(project=>project.id===projectId);
    const storedProject=readStorage(localStorage,PROJECT_STORAGE_KEY);
    if(state.timer?.projectId&&projectExists(state.timer.projectId))selectedProject=state.timer.projectId;
    else if(!projectExists(selectedProject))selectedProject=projectExists(storedProject)?storedProject:projects[0]?.id;
    if(selectedProject)writeStorage(localStorage,PROJECT_STORAGE_KEY,selectedProject);
    renderAll();
    await Promise.all([loadTodayKnowledge(),loadCalendarKnowledge()]);
    if(window.pokemonDashboardRefresh)await window.pokemonDashboardRefresh();
    const storedView=readStorage(sessionStorage,VIEW_STORAGE_KEY);
    const initialView=state.timer?'timer':['home','timer','stats','calendar','knowledge'].includes(storedView)?storedView:'home';
    switchView(initialView);
}
function renderAll(){renderHome();renderCountdown();renderKnowledgeInputs();renderProjectPicker();renderTimer();renderStats();renderCalendar();renderProjectDialog();updateFooter();updateTodaySummary();scheduleCountdownRerender()}
function renderHome(){const key=chinaDate(),day=state.study[key]||{},total=dayTotal(day),energy=day.energy||0;$('homeDate').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());$('todayCards').innerHTML=`<div class="stat-card total" style="--color:#ff6b5e"><strong>${formatHours(total)}</strong><span>📅 今日总时长</span></div>`+activeProjects().map(p=>`<div class="stat-card" style="--color:${p.color}"><strong>${formatHours(day[p.id]||0)}</strong><span>${escapeHtml(p.icon)} ${escapeHtml(p.name)}</span></div>`).join('');$('energy').value=energy;$('energyValue').textContent=energy;$('energyValue').style.background=`conic-gradient(var(--accent) 0 ${energy}%,#e7edf4 ${energy}% 100%)`;$('notes').value=day.notes||''}
function updateFooter(){const today=chinaDate(),parts=today.split('-').map(Number),cursor=new Date(Date.UTC(parts[0],parts[1]-1,parts[2])),weekday=cursor.getUTCDay()||7;let week=0;for(let offset=weekday-1;offset>=0;offset--){const day=new Date(cursor);day.setUTCDate(day.getUTCDate()-offset);const key=`${day.getUTCFullYear()}-${String(day.getUTCMonth()+1).padStart(2,'0')}-${String(day.getUTCDate()).padStart(2,'0')}`;week+=dayTotal(state.study[key]||{})}$('footToday').textContent=formatHours(dayTotal(state.study[today]||{}));$('footWeek').textContent=formatHours(week)}
function renderProjectPicker(){$('projectPicker').innerHTML=activeProjects().map(p=>`<button class="project-pill ${p.id===selectedProject?'active':''}" style="--color:${p.color}" data-project="${p.id}">${escapeHtml(p.icon)} ${escapeHtml(p.name)}</button>`).join('');document.querySelectorAll('[data-project]').forEach(button=>button.onclick=()=>{if(state.timer)return;selectedProject=button.dataset.project;writeStorage(localStorage,PROJECT_STORAGE_KEY,selectedProject);renderProjectPicker();renderTimer()})}
function currentTimerElapsedSeconds(){const timer=state.timer;if(!timer)return 0;let elapsed=timer.elapsedSeconds||0;if(timer.phase==='running'){const serverNow=Date.parse(timer.serverNow);elapsed+=Math.max(0,(Date.now()-serverNow)/1000)}return Math.max(0,elapsed)}
function currentTimerSeconds(){const timer=state.timer;if(!timer)return 0;const elapsed=currentTimerElapsedSeconds();return timer.mode==='countdown'?Math.max(0,(timer.targetSeconds||0)-elapsed):elapsed}
function renderTimer(){const timer=state.timer,locked=Boolean(timer);$('countupMode').classList.toggle('active',(timer?.mode||selectedMode)==='countup');$('countdownMode').classList.toggle('active',(timer?.mode||selectedMode)==='countdown');$('durationRow').hidden=(timer?.mode||selectedMode)!=='countdown';$('timerProject').textContent=timer?`${timer.projectName} · ${timer.phase==='running'?'进行中':'已暂停'}`:(state.projects.find(p=>p.id===selectedProject)?.name||'请选择项目');$('timerDisplay').textContent=formatDuration(currentTimerSeconds());$('startTimer').hidden=timer?.phase==='running';$('startTimer').textContent=timer?.phase==='paused'?'▶ 继续':'▶ 开始';$('pauseTimer').hidden=timer?.phase!=='running';$('stopTimer').hidden=!timer;$('resetTimer').hidden=!timer;[$('countupMode'),$('countdownMode'),$('durationMinutes'),$('manageProjects')].forEach(el=>el.disabled=locked);clearInterval(timerTick);if(timer){timerTick=setInterval(async()=>{$('timerDisplay').textContent=formatDuration(currentTimerSeconds());if(timer.mode==='countdown'&&currentTimerSeconds()<=0&&!finishing){finishing=true;try{await syncTimer();await loadData();toast('倒计时完成，学习记录已保存')}finally{finishing=false}}},250)}clearInterval(timerSync);if(timer)timerSync=setInterval(syncTimer,5000)}
async function syncTimer(){try{state.timer=await apiFetch('/api/timer/state');if(state.timer?.projectId&&selectedProject!==state.timer.projectId){selectedProject=state.timer.projectId;writeStorage(localStorage,PROJECT_STORAGE_KEY,selectedProject);renderProjectPicker()}renderTimer();renderTodayChart()}catch(error){console.warn(error)}}
async function timerAction(action,extra={}){try{let body=extra;if(action!=='start')body={sessionId:state.timer?.sessionId,version:state.timer?.version,...extra};const result=await apiFetch(`/api/timer/${action}`,{method:'POST',body});if(action==='stop'||action==='reset'){await loadData();toast(action==='stop'?'学习记录已保存':'计时已重置')}else{state.timer=result;if(state.timer?.projectId){selectedProject=state.timer.projectId;writeStorage(localStorage,PROJECT_STORAGE_KEY,selectedProject)}renderProjectPicker();renderTimer();renderTodayChart()}}catch(error){toast(error.message);if(error.status===409)await loadData()}}

function todayProjectSeconds(projectId){const saved=Number(state.study[chinaDate()]?.[projectId])||0;const active=state.timer?.projectId===projectId?currentTimerElapsedSeconds():0;return saved+active}
function updateTodaySummary(){const total=state.projects.reduce((sum,project)=>sum+todayProjectSeconds(project.id),0);if($('timerTodayTotal'))$('timerTodayTotal').textContent=formatHours(total)}
function renderTodayChart(){
    updateTodaySummary();
    if(!window.Chart||!$('todayChart'))return;
    const projects=state.projects.filter(project=>!project.archived||todayProjectSeconds(project.id)>0);
    const values=projects.map(project=>Math.round(todayProjectSeconds(project.id)/360)/10);
    todayChart?.destroy();
    todayChart=new Chart($('todayChart'),{
        type:'bar',
        data:{
            labels:projects.map(project=>`${project.icon} ${project.name}`),
            datasets:[{label:'今日学习',data:values,backgroundColor:projects.map(project=>project.color),borderWidth:0,borderRadius:7,maxBarThickness:54}],
        },
        options:{
            responsive:true,
            maintainAspectRatio:false,
            scales:{x:{grid:{display:false}},y:{beginAtZero:true,title:{display:true,text:'学习时长（小时）'},ticks:{callback:value=>`${value}h`}}},
            plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>`${context.label}: ${context.parsed.y} 小时`}}},
        },
    });
}
function renderStats(){
    const allDays=Object.entries(state.study).filter(([key])=>/^\d{4}-\d{2}-\d{2}$/.test(key));
    const total=allDays.reduce((sum,[,day])=>sum+dayTotal(day),0);
    const visibleProjects=activeProjects();
    $('overviewCards').innerHTML=`<div class="stat-card" style="--color:#ff6b5e"><strong>${allDays.filter(([,day])=>dayTotal(day)>0).length}</strong><span>累计学习天数</span></div><div class="stat-card" style="--color:#4f8cf7"><strong>${formatHours(total)}</strong><span>累计学习时长</span></div>`+visibleProjects.map(project=>`<div class="stat-card" style="--color:${project.color}"><strong>${formatHours(allDays.reduce((sum,[,day])=>sum+(day[project.id]||0),0))}</strong><span>${escapeHtml(project.name)}</span></div>`).join('');
    const days=[];
    for(let offset=6;offset>=0;offset--){const day=new Date();day.setDate(day.getDate()-offset);days.push(chinaDate(day))}
    const datasets=visibleProjects.map(project=>({
        label:project.name,
        data:days.map(key=>Math.round((state.study[key]?.[project.id]||0)/360)/10),
        backgroundColor:project.color,
        borderWidth:0,
        borderRadius:0,
    }));
    if(window.Chart){
        weekChart?.destroy();
        weekChart=new Chart($('weekChart'),{
            type:'bar',
            data:{labels:days.map(key=>key.slice(5)),datasets},
            options:{
                responsive:true,
                maintainAspectRatio:false,
                scales:{x:{stacked:true},y:{stacked:true,title:{display:true,text:'学习时长（小时）'},ticks:{callback:value=>`${value}h`}}},
                plugins:{
                    legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,boxHeight:8}},
                    tooltip:{callbacks:{label:context=>`${context.dataset.label}: ${context.parsed.y} 小时`}},
                },
            },
        });
        const totals=visibleProjects.map(project=>Math.round(allDays.reduce((sum,[,day])=>sum+(day[project.id]||0),0)/360)/10);
        const hasPieData=totals.some(Boolean);
        pieChart?.destroy();
        pieChart=new Chart($('pieChart'),{
            type:'doughnut',
            data:{
                labels:visibleProjects.map(project=>project.name),
                datasets:[{
                    data:hasPieData?totals:totals.map(()=>1),
                    backgroundColor:hasPieData?visibleProjects.map(project=>project.color):visibleProjects.map(()=>'#e5e7eb'),
                }],
            },
            options:{
                responsive:true,
                maintainAspectRatio:false,
                plugins:{
                    legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:8,boxHeight:8}},
                    tooltip:{callbacks:{label:context=>`${context.label}: ${hasPieData?context.raw:0} 小时`}},
                },
            },
        });
    }
    $('editDate').value=$('editDate').value||chinaDate();
    renderEditDurations();
}
function renderEditDurations(){const day=state.study[$('editDate').value]||{};$('editDurations').innerHTML=activeProjects().map(p=>`<label>${escapeHtml(p.icon)} ${escapeHtml(p.name)}<input class="duration-input" data-id="${p.id}" type="number" min="0" max="24" step="0.1" value="${Math.round((day[p.id]||0)/360)/10}"> 小时</label>`).join('')}
function renderCalendar(){const year=calendarDate.getFullYear(),month=calendarDate.getMonth();$('monthLabel').textContent=`${year}年 ${month+1}月`;const first=new Date(year,month,1).getDay(),count=new Date(year,month+1,0).getDate();let html=['日','一','二','三','四','五','六'].map(d=>`<div class="day head">${d}</div>`).join('');for(let i=0;i<first;i++)html+='<div></div>';for(let d=1;d<=count;d++){const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,seconds=dayTotal(state.study[key]),knowledgeCount=Number(calendarKnowledgeCounts[key])||0,heat=calendarHeat(seconds);html+=`<div class="day${seconds?' has-study':''}${knowledgeCount?' has-knowledge':''}${heat.dark?' heat-dark':''}${key===chinaDate()?' today':''}" style="--heat:${heat.alpha}" title="${key}${seconds?` · 学习 ${formatHours(seconds)}`:''}${knowledgeCount?` · ${knowledgeCount} 条知识点`:!seconds?' · 暂无记录':''}"${knowledgeCount?` data-knowledge-date="${key}" role="button" tabindex="0"`:''}><span>${d}</span>${seconds?`<small>${formatHours(seconds)}</small>`:''}${knowledgeCount?`<em>${knowledgeCount} 条收获</em>`:''}</div>`}$('calendar').innerHTML=html;document.querySelectorAll('[data-knowledge-date]').forEach(day=>{day.onclick=()=>openKnowledgeDate(day.dataset.knowledgeDate);day.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();day.click()}}})}
function renderProjectDialog(){$('projectRows').innerHTML=state.projects.map(p=>`<div class="project-row" data-row="${p.id}" style="opacity:${p.archived?.55:1}"><input class="p-icon" value="${escapeHtml(p.icon)}"><input class="p-name" value="${escapeHtml(p.name)}"><input class="p-color" type="color" value="${p.color}"><button class="p-archive">${p.archived?'恢复':'归档'}</button></div>`).join('');document.querySelectorAll('[data-row]').forEach(row=>{const id=row.dataset.row,project=state.projects.find(p=>p.id===id);row.querySelectorAll('input').forEach(input=>input.onchange=async()=>{try{const body=input.classList.contains('p-name')?{name:input.value}:input.classList.contains('p-icon')?{icon:input.value}:{color:input.value};await apiFetch(`/api/projects/${id}`,{method:'PATCH',body});await loadData()}catch(error){toast(error.message)}});row.querySelector('.p-archive').onclick=async()=>{try{await apiFetch(`/api/projects/${id}`,{method:'PATCH',body:{archived:!project.archived}});await loadData()}catch(error){toast(error.message)}}})}

function switchView(viewName){
    const target=['home','timer','stats','calendar','knowledge'].includes(viewName)?viewName:'home';
    document.querySelectorAll('.view-tabs button').forEach(button=>button.classList.toggle('active',button.dataset.view===target));
    document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===`view-${target}`));
    writeStorage(sessionStorage,VIEW_STORAGE_KEY,target);
    if(target==='stats')renderStats();
    if(target==='timer')requestAnimationFrame(renderTodayChart);
    if(target==='knowledge')loadKnowledgeArchive(true);
}

document.querySelectorAll('.view-tabs button').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('energy').oninput=()=>{const value=$('energy').value;$('energyValue').textContent=value;$('energyValue').style.background=`conic-gradient(var(--accent) 0 ${value}%,#e7edf4 ${value}% 100%)`};$('energy').onchange=async()=>{try{await apiFetch(`/api/study/meta/${chinaDate()}`,{method:'PATCH',body:{energy:Number($('energy').value)}});state.study[chinaDate()]={...(state.study[chinaDate()]||{}),energy:Number($('energy').value)}}catch(error){toast(error.message)}};
$('saveNotes').onclick=async()=>{try{await apiFetch(`/api/study/meta/${chinaDate()}`,{method:'PATCH',body:{notes:$('notes').value}});toast('笔记已保存')}catch(error){toast(error.message)}};
$('saveKnowledge').onclick=async()=>{try{await apiFetch('/api/knowledge-points',{method:'POST',body:{date:$('knowledgeDate').value,projectId:$('knowledgeProject').value,content:$('knowledgeContent').value}});$('knowledgeContent').value='';await refreshKnowledgeViews();toast('知识点已保存')}catch(error){toast(error.message)}};
$('newKnowledge').onclick=()=>openKnowledgeDialog();
$('submitKnowledge').onclick=async()=>{const itemId=$('knowledgeDialog').dataset.itemId,body={date:$('editKnowledgeDate').value,projectId:$('editKnowledgeProject').value,content:$('editKnowledgeContent').value};try{await apiFetch(itemId?`/api/knowledge-points/${itemId}`:'/api/knowledge-points',{method:itemId?'PATCH':'POST',body});$('knowledgeDialog').close();await refreshKnowledgeViews();toast(itemId?'知识点已更新':'知识点已保存')}catch(error){toast(error.message)}};
$('knowledgeMonth').onchange=()=>{knowledgeExactDate=null;loadKnowledgeArchive(true)};
$('knowledgeFilterProject').onchange=()=>loadKnowledgeArchive(true);
$('knowledgeQuery').oninput=()=>{clearTimeout(knowledgeSearchTimer);knowledgeSearchTimer=setTimeout(()=>loadKnowledgeArchive(true),300)};
$('clearKnowledgeDate').onclick=()=>{knowledgeExactDate=null;loadKnowledgeArchive(true)};
$('loadMoreKnowledge').onclick=()=>loadKnowledgeArchive(false);
$('countupMode').onclick=()=>{if(!state.timer){selectedMode='countup';renderTimer()}};$('countdownMode').onclick=()=>{if(!state.timer){selectedMode='countdown';renderTimer()}};
$('startTimer').onclick=()=>state.timer?timerAction('resume'):timerAction('start',{projectId:selectedProject,mode:selectedMode,targetSeconds:selectedMode==='countdown'?Math.round(Number($('durationMinutes').value)*60):null});$('pauseTimer').onclick=()=>timerAction('pause');$('stopTimer').onclick=()=>timerAction('stop');$('resetTimer').onclick=()=>timerAction('reset');
$('manageProjects').onclick=()=>$('projectDialog').showModal();$('addProject').onclick=async()=>{try{await apiFetch('/api/projects',{method:'POST',body:{name:$('newName').value,icon:$('newIcon').value,color:$('newColor').value}});$('newName').value='';await loadData()}catch(error){toast(error.message)}};
$('editDate').onchange=renderEditDurations;$('saveDay').onclick=async()=>{const durations={};document.querySelectorAll('.duration-input').forEach(input=>durations[input.dataset.id]=Math.min(24,Math.max(0,Number(input.value)||0))*3600);try{await apiFetch(`/api/study/day/${$('editDate').value}`,{method:'PUT',body:{durations}});await loadData();toast('学习时长已更新')}catch(error){toast(error.message)}};
$('importFile').onchange=async event=>{const file=event.target.files[0];if(!file)return;if(!confirm('导入会替换当前账号数据，确定继续吗？'))return;try{await apiFetch('/api/data/import',{method:'POST',body:JSON.parse(await file.text())});await loadData();toast('数据已导入')}catch(error){toast(error.message)}finally{event.target.value=''}};
$('restoreBackup').onclick=async()=>{if(!confirm('恢复导入前的数据吗？'))return;try{await apiFetch('/api/data/restore',{method:'POST'});await loadData();toast('安全副本已恢复')}catch(error){toast(error.message)}};
$('prevMonth').onclick=()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1);loadCalendarKnowledge()};$('nextMonth').onclick=()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1);loadCalendarKnowledge()};
$('saveCountdown').onclick=saveCountdown;$('clearCountdown').onclick=clearCountdown;
document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderCountdown();scheduleCountdownRerender()}});
loadData().catch(error=>toast(error.message));
