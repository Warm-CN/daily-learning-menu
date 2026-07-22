let state={projects:[],study:{},sessions:[],milestones:{},timer:null};
let selectedProject=null,selectedMode='countup',weekChart=null,pieChart=null,todayChart=null,calendarDate=new Date(),timerTick=null,timerSync=null,finishing=false;
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

async function loadData(){
    state=await apiFetch('/api/bootstrap');
    const projects=activeProjects();
    const projectExists=projectId=>projects.some(project=>project.id===projectId);
    const storedProject=readStorage(localStorage,PROJECT_STORAGE_KEY);
    if(state.timer?.projectId&&projectExists(state.timer.projectId))selectedProject=state.timer.projectId;
    else if(!projectExists(selectedProject))selectedProject=projectExists(storedProject)?storedProject:projects[0]?.id;
    if(selectedProject)writeStorage(localStorage,PROJECT_STORAGE_KEY,selectedProject);
    renderAll();
    const storedView=readStorage(sessionStorage,VIEW_STORAGE_KEY);
    const initialView=state.timer?'timer':['home','timer','stats','calendar'].includes(storedView)?storedView:'home';
    switchView(initialView);
}
function renderAll(){renderHome();renderProjectPicker();renderTimer();renderStats();renderCalendar();renderProjectDialog();updateFooter();updateTodaySummary()}
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
    $('overviewCards').innerHTML=`<div class="stat-card" style="--color:#ff6b5e"><strong>${allDays.filter(([,day])=>dayTotal(day)>0).length}</strong><span>累计学习天数</span></div><div class="stat-card" style="--color:#4f8cf7"><strong>${formatHours(total)}</strong><span>累计学习时长</span></div>`+state.projects.map(project=>`<div class="stat-card" style="--color:${project.color}"><strong>${formatHours(allDays.reduce((sum,[,day])=>sum+(day[project.id]||0),0))}</strong><span>${escapeHtml(project.name)}</span></div>`).join('');
    const days=[];
    for(let offset=6;offset>=0;offset--){const day=new Date();day.setDate(day.getDate()-offset);days.push(chinaDate(day))}
    const datasets=state.projects.map(project=>({
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
        const totals=state.projects.map(project=>Math.round(allDays.reduce((sum,[,day])=>sum+(day[project.id]||0),0)/360)/10);
        const hasPieData=totals.some(Boolean);
        pieChart?.destroy();
        pieChart=new Chart($('pieChart'),{
            type:'doughnut',
            data:{
                labels:state.projects.map(project=>project.name),
                datasets:[{
                    data:hasPieData?totals:totals.map(()=>1),
                    backgroundColor:hasPieData?state.projects.map(project=>project.color):state.projects.map(()=>'#e5e7eb'),
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
function renderEditDurations(){const day=state.study[$('editDate').value]||{};$('editDurations').innerHTML=state.projects.map(p=>`<label>${escapeHtml(p.icon)} ${escapeHtml(p.name)}<input class="duration-input" data-id="${p.id}" type="number" min="0" max="24" step="0.1" value="${Math.round((day[p.id]||0)/360)/10}"> 小时</label>`).join('')}
function renderCalendar(){const year=calendarDate.getFullYear(),month=calendarDate.getMonth();$('monthLabel').textContent=`${year}年 ${month+1}月`;const first=new Date(year,month,1).getDay(),count=new Date(year,month+1,0).getDate();let html=['日','一','二','三','四','五','六'].map(d=>`<div class="day head">${d}</div>`).join('');for(let i=0;i<first;i++)html+='<div></div>';for(let d=1;d<=count;d++){const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,seconds=dayTotal(state.study[key]),heat=calendarHeat(seconds);html+=`<div class="day${seconds?' has-study':''}${heat.dark?' heat-dark':''}${key===chinaDate()?' today':''}" style="--heat:${heat.alpha}" title="${key}${seconds?` · 学习 ${formatHours(seconds)}`:' · 暂无记录'}"><span>${d}</span>${seconds?`<small>${formatHours(seconds)}</small>`:''}</div>`}$('calendar').innerHTML=html}
function renderProjectDialog(){$('projectRows').innerHTML=state.projects.map(p=>`<div class="project-row" data-row="${p.id}" style="opacity:${p.archived?.55:1}"><input class="p-icon" value="${escapeHtml(p.icon)}"><input class="p-name" value="${escapeHtml(p.name)}"><input class="p-color" type="color" value="${p.color}"><button class="p-archive">${p.archived?'恢复':'归档'}</button></div>`).join('');document.querySelectorAll('[data-row]').forEach(row=>{const id=row.dataset.row,project=state.projects.find(p=>p.id===id);row.querySelectorAll('input').forEach(input=>input.onchange=async()=>{try{const body=input.classList.contains('p-name')?{name:input.value}:input.classList.contains('p-icon')?{icon:input.value}:{color:input.value};await apiFetch(`/api/projects/${id}`,{method:'PATCH',body});await loadData()}catch(error){toast(error.message)}});row.querySelector('.p-archive').onclick=async()=>{try{await apiFetch(`/api/projects/${id}`,{method:'PATCH',body:{archived:!project.archived}});await loadData()}catch(error){toast(error.message)}}})}

function switchView(viewName){
    const target=['home','timer','stats','calendar'].includes(viewName)?viewName:'home';
    document.querySelectorAll('.view-tabs button').forEach(button=>button.classList.toggle('active',button.dataset.view===target));
    document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===`view-${target}`));
    writeStorage(sessionStorage,VIEW_STORAGE_KEY,target);
    if(target==='stats')renderStats();
    if(target==='timer')requestAnimationFrame(renderTodayChart);
}

document.querySelectorAll('.view-tabs button').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('energy').oninput=()=>{const value=$('energy').value;$('energyValue').textContent=value;$('energyValue').style.background=`conic-gradient(var(--accent) 0 ${value}%,#e7edf4 ${value}% 100%)`};$('energy').onchange=async()=>{try{await apiFetch(`/api/study/meta/${chinaDate()}`,{method:'PATCH',body:{energy:Number($('energy').value)}});state.study[chinaDate()]={...(state.study[chinaDate()]||{}),energy:Number($('energy').value)}}catch(error){toast(error.message)}};
$('saveNotes').onclick=async()=>{try{await apiFetch(`/api/study/meta/${chinaDate()}`,{method:'PATCH',body:{notes:$('notes').value}});toast('笔记已保存')}catch(error){toast(error.message)}};
$('countupMode').onclick=()=>{if(!state.timer){selectedMode='countup';renderTimer()}};$('countdownMode').onclick=()=>{if(!state.timer){selectedMode='countdown';renderTimer()}};
$('startTimer').onclick=()=>state.timer?timerAction('resume'):timerAction('start',{projectId:selectedProject,mode:selectedMode,targetSeconds:selectedMode==='countdown'?Math.round(Number($('durationMinutes').value)*60):null});$('pauseTimer').onclick=()=>timerAction('pause');$('stopTimer').onclick=()=>timerAction('stop');$('resetTimer').onclick=()=>timerAction('reset');
$('manageProjects').onclick=()=>$('projectDialog').showModal();$('addProject').onclick=async()=>{try{await apiFetch('/api/projects',{method:'POST',body:{name:$('newName').value,icon:$('newIcon').value,color:$('newColor').value}});$('newName').value='';await loadData()}catch(error){toast(error.message)}};
$('editDate').onchange=renderEditDurations;$('saveDay').onclick=async()=>{const durations={};document.querySelectorAll('.duration-input').forEach(input=>durations[input.dataset.id]=Math.min(24,Math.max(0,Number(input.value)||0))*3600);try{await apiFetch(`/api/study/day/${$('editDate').value}`,{method:'PUT',body:{durations}});await loadData();toast('学习时长已更新')}catch(error){toast(error.message)}};
$('importFile').onchange=async event=>{const file=event.target.files[0];if(!file)return;if(!confirm('导入会替换当前账号数据，确定继续吗？'))return;try{await apiFetch('/api/data/import',{method:'POST',body:JSON.parse(await file.text())});await loadData();toast('数据已导入')}catch(error){toast(error.message)}finally{event.target.value=''}};
$('restoreBackup').onclick=async()=>{if(!confirm('恢复导入前的数据吗？'))return;try{await apiFetch('/api/data/restore',{method:'POST'});await loadData();toast('安全副本已恢复')}catch(error){toast(error.message)}};
$('prevMonth').onclick=()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1);renderCalendar()};$('nextMonth').onclick=()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1);renderCalendar()};
loadData().catch(error=>toast(error.message));
