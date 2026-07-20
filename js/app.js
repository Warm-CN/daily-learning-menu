(function() {
            'use strict';
            const Storage = window.KaoyanStorage;
            const Timer = window.KaoyanTimer;
            let projects = Storage.loadProjects();
            let SUBJS = [], ACTIVE_SUBJS = [], SUBJ_NAMES = {}, SUBJ_COLORS = {}, SUBJ_ICONS = {};
            function rebuildProjectMaps() {
                SUBJS = projects.map(project => project.id);
                ACTIVE_SUBJS = projects.filter(project => !project.archived).map(project => project.id);
                SUBJ_NAMES = Object.fromEntries(projects.map(project => [project.id, project.name]));
                SUBJ_COLORS = Object.fromEntries(projects.map(project => [project.id, project.color]));
                SUBJ_ICONS = Object.fromEntries(projects.map(project => [project.id, project.icon]));
            }
            rebuildProjectMaps();
            recoverOrphanProjects();

            function recoverOrphanProjects() {
                const known = new Set(projects.map(project => project.id));
                const orphanIds = new Set();
                const all = Storage.loadStudyData();
                Object.entries(all).forEach(([date, day]) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day) return;
                    Object.keys(day).forEach(key => { if (!['energy', 'notes'].includes(key) && !known.has(key)) orphanIds.add(key); }); });
                if (!orphanIds.size) return;
                orphanIds.forEach(id => projects.push({ id, name: id, color: '#4f8cf7', icon: '📚', archived: false }));
                try { Storage.saveProjects(projects); projects = Storage.loadProjects(); }
                catch (error) { console.warn('孤立项目配置暂时无法写入', error); }
                rebuildProjectMaps();
            }
            const EXAM_DATE = new Date(2026, 11, 20);
            const QUOTES = [
                { cn: '不积跬步，无以至千里。', en: '"A journey of a thousand miles begins with a single step." — Lao Tzu' },
                { cn: '天行健，君子以自强不息。', en: '"The superior man strives for self-improvement." — I Ching' },
                { cn: '宝剑锋从磨砺出，梅花香自苦寒来。', en: '"A blade is sharpened by grinding." — Proverb' },
                { cn: '志当存高远。', en: '"Set your aspirations high." — Zhuge Liang' },
                { cn: '业精于勤，荒于嬉。', en: '"Mastery comes from diligence." — Han Yu' },
                { cn: 'Stay hungry, stay foolish.', en: '"Stay hungry, stay foolish." — Steve Jobs' },
                { cn: '自律给我自由。', en: '"Self-discipline gives me freedom." — Greek Philosophy' },
                { cn: '水滴石穿，绳锯木断。', en: '"Dripping water pierces stone." — Proverb' },
                { cn: '长风破浪会有时。', en: '"There will be a time to ride the wind." — Li Bai' },
                { cn: '每一个优秀的人都有一段沉默的时光。', en: '"Every great person has endured a silent period." — Saying' },
                { cn: '学而不思则罔，思而不学则殆。', en: '"Learning without thinking is labor lost." — Confucius' },
                { cn: '千里之行，始于足下。', en: '"The journey begins beneath your feet." — Lao Tzu' },
                { cn: '锲而不舍，金石可镂。', en: '"With persistent effort, stone can be carved." — Xunzi' },
                { cn: '书山有路勤为径。', en: '"Diligence is the path to knowledge." — Han Yu' },
                { cn: '天才就是百分之九十九的汗水。', en: '"Genius is 1% inspiration, 99% perspiration." — Edison' },
                { cn: '成功不是终点，失败也不是终结。', en: '"Success is not final, failure is not fatal." — Churchill' },
                { cn: '你只管努力，剩下的交给时间。', en: '"Do your best and let time do the rest." — Proverb' },
                { cn: '今日事，今日毕。', en: '"Never put off till tomorrow." — Franklin' },
                { cn: '博观而约取，厚积而薄发。', en: '"Read widely, accumulate deeply." — Su Shi' },
                { cn: '会当凌绝顶，一览众山小。', en: '"I will ascend the highest peak." — Du Fu' },
            ];
            let curPage = 'home';
            let curSubj = ACTIVE_SUBJS[0] || SUBJS[0] || 'math';
            let curMode = 'countup';
            let cdMin = 25;
            let running = false,
                paused = false,
                startTime = null,
                elapsedBefore = 0,
                intervalId = null;
            let sessionId = null,
                sessionStartedAt = null,
                activeSegments = [];
            let chartRange = 'week';
            let chartUnit = 'hour';
            let barChart = null,
                pieChart = null,
                overviewPieC = null,
                weekStackC = null;
            let calYear, calMonth;
            let statsTab = 'overview';
            let toastT = null;

            function loadAll() { return Storage.loadStudyData(); }

            function saveAll(d) { try { Storage.saveStudyData(d); } catch (error) {
                    showToast('⚠️ 数据保存失败，请立即导出备份');
                    throw error; } }

            function loadSessions() { return Storage.loadSessions(); }

            function saveSessions(a) { try { Storage.saveSessions(a); } catch (error) {
                    showToast('⚠️ 会话记录保存失败');
                    throw error; } }

            function loadMilestones() { return Storage.loadMilestones(); }

            function saveMilestones(o) { try { Storage.saveMilestones(o); } catch (error) {
                    console.warn('里程碑保存失败', error);
                    showToast('⚠️ 里程碑保存失败，学习时长已保留'); } }

            function todayKey() { const n = new Date(); return n.getFullYear() + '-' + p2(n.getMonth() + 1) + '-' + p2(n
                .getDate()); }

            function p2(n) { return String(n).padStart(2, '0'); }

            function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;',
                    '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

            function emptyDay() { const day = { energy: 0, notes: '' }; SUBJS.forEach(id => day[id] = 0); return day; }

            function sumDay(day) { return SUBJS.reduce((total, id) => total + (Number(day && day[id]) || 0), 0); }

            function getDayData(key) { const a = loadAll(); if (!a[key]) a[key] = emptyDay(); for (const s of SUBJS)
                    if (typeof a[key][s] !== 'number') a[key][s] = 0; return { data: a[key], all: a, key }; }

            function saveEnergy(val) { const { data, all, key } = getDayData(todayKey());
                data.energy = Math.round(val);
                all[key] = data;
                saveAll(all); }

            function saveNotes(txt) { const { data, all, key } = getDayData(todayKey());
                data.notes = txt;
                all[key] = data;
                saveAll(all); }

            function getDateRange(days) { const r = []; const n = new Date(); for (let i = days - 1; i >= 0; i--) { const d = new Date(
                    n);
                    d.setDate(d.getDate() - i); r.push({ key: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d
                            .getDate()), label: (d.getMonth() + 1) + '/' + d.getDate(), dow: ['日', '一', '二', '三', '四', '五',
                            '六'
                        ][d.getDay()] }); } return r; }

            function calcWeekTotal() {
             const all = loadAll();
            const now = new Date();
            const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
            // 计算本周一的日期
            const monday = new Date(now);
            monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
            let totalSec = 0;
            const d = new Date(monday);
            while (d <= now) {
            const key = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
            const data = all[key] || {};
            totalSec += sumDay(data);
            d.setDate(d.getDate() + 1);
            }
            return totalSec;
            }
            

            function elapsedSec(now = Date.now()) { return elapsedBefore + (running && startTime ? Math.max(0, now -
                    startTime) / 1000 : 0); }

            function curSec(now = Date.now()) { const elapsed = elapsedSec(now); return curMode === 'countup' ? elapsed :
                    Math.max(0, cdMin * 60 - elapsed); }

            function fmtTime(s) { const sec = Math.max(0, Math.floor(s)); return p2(Math.floor(sec / 3600)) + ':' + p2(Math
                    .floor((sec % 3600) / 60)) + ':' + p2(sec % 60); }

            function startTimer() { if (running) return; const now = Date.now(); if (paused) { startTime = now;
                    running = true;
                    paused = false; } else { elapsedBefore = 0;
                    startTime = now;
                    running = true;
                    paused = false;
                    sessionId = Timer.createSessionId();
                    sessionStartedAt = now;
                    activeSegments = []; }
                updateTimerRunningUI();
                saveTimerState();
                startTimerInterval(); }

            function startTimerInterval() { clearInterval(intervalId);
                intervalId = setInterval(() => { updateTimerUI(); if (curMode === 'countdown' && curSec() <= 0)
                    finishTimer(); }, 250); }

            function pauseTimer() { if (!running) return; const now = Date.now();
                elapsedBefore = elapsedSec(now);
                activeSegments.push([startTime, now]);
                running = false;
                paused = true;
                startTime = null;
                clearInterval(intervalId);
                intervalId = null;
                updateTimerPausedUI();
                updateTimerUI();
                saveTimerState(); }

            function stopTimer() { const endedAt = Date.now(); const earned = getElapsedSec(endedAt);
                const snapshot = timerSnapshot();
                running = false;
                paused = false;
                startTime = null;
                clearInterval(intervalId);
                intervalId = null; if (earned >= 1 && commitSession(snapshot, endedAt, earned))
                    showEnergyPrompt(snapshot.subj, earned, snapshot.sessionId);
                elapsedBefore = 0;
                sessionId = null;
                sessionStartedAt = null;
                activeSegments = [];
                updateTimerStoppedUI();
                updateTimerUI();
                clearTimerState();
                playSound(); }

            function finishTimer() { if (!sessionId) return; const endedAt = Date.now(); const earned = cdMin * 60;
                const snapshot = timerSnapshot();
                running = false;
                paused = false;
                startTime = null;
                clearInterval(intervalId);
                intervalId = null;
                elapsedBefore = earned;
                if (commitSession(snapshot, endedAt, earned)) showEnergyPrompt(snapshot.subj, earned, snapshot.sessionId);
                sessionId = null;
                sessionStartedAt = null;
                activeSegments = [];
                updateTimerStoppedUI();
                updateTimerUI();
                clearTimerState();
                playSound(); }

            function resetTimer() { running = false;
                paused = false;
                startTime = null;
                clearInterval(intervalId);
                intervalId = null;
                elapsedBefore = 0;
                sessionId = null;
                sessionStartedAt = null;
                activeSegments = [];
                updateTimerStoppedUI();
                updateTimerUI();
                clearTimerState(); }

            function getElapsedSec(now = Date.now()) { const elapsed = elapsedSec(now); return curMode === 'countdown' ?
                    Math.min(cdMin * 60, elapsed) : elapsed; }

            function timerSnapshot() { return { phase: running ? 'running' : paused ? 'paused' : 'idle', sessionId,
                    sessionStartedAt, subj: curSubj, mode: curMode, cdMin, startTime, elapsedBefore,
                    segments: activeSegments.map(pair => [...pair]) }; }

            function commitSession(snapshot, endedAt, earned) {
                const segments = Timer.collectSegments(snapshot, endedAt, earned);
                const byDay = Timer.splitByLocalDay(segments);
                const all = loadAll();
                if (Timer.applySessionCredit(all, snapshot.sessionId, snapshot.subj, byDay, earned, endedAt)) saveAll(all);
                let sessionSaved = true;
                try { recordSession(snapshot, endedAt, earned, segments); } catch (error) {
                    sessionSaved = false;
                    console.warn('会话明细保存失败，累计时长已安全保存', error); }
                checkMilestones();
                updateAllDisplays();
                return sessionSaved;
            }

            function recordSession(snapshot, endedAt, sec, segments) { const sessions = loadSessions();
                if (sessions.some(item => item.id === snapshot.sessionId)) return;
                const startedAt = segments.length ? segments[0][0] : snapshot.sessionStartedAt;
                const finishedAt = segments.length ? segments[segments.length - 1][1] : endedAt;
                const startDate = new Date(startedAt), endDate = new Date(finishedAt);
                sessions.push({ id: snapshot.sessionId, date: todayKeyFor(startDate), startedAt, endedAt: finishedAt,
                    startHour: startDate.getHours(), startMin: startDate.getMinutes(), endHour: endDate.getHours(),
                    endMin: endDate.getMinutes(), durationMin: Math.round(sec / 60), durationSec: Math.round(sec),
                    subject: snapshot.subj, energy: null });
                saveSessions(sessions); }

            function todayKeyFor(date) { return date.getFullYear() + '-' + p2(date.getMonth() + 1) + '-' + p2(date.getDate()); }

            function showEnergyPrompt(subj, sec, completedSessionId) { const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.innerHTML =
                    `<div class="modal"><h4>⚡ 本次学习精力评分</h4><p>${escapeHtml(SUBJ_NAMES[subj] || subj)} · ${Math.round(sec/60)}分钟</p><input type="range" min="0" max="100" value="70" id="epSlider" style="width:100%"><div style="text-align:center;font-weight:700;" id="epVal">70 分</div><div class="btn-row"><button class="btn btn-outline btn-sm" id="epSkip">跳过</button><button class="btn btn-go btn-sm" id="epSave">保存</button></div></div>`;
                document.body.appendChild(modal);
                modal.querySelector('#epSlider').oninput = function() { modal.querySelector('#epVal').textContent = this
                        .value + ' 分'; };
                modal.querySelector('#epSkip').onclick = () => modal.remove();
                modal.querySelector('#epSave').onclick = () => { const s = loadSessions(); const session = s.find(item =>
                        item.id === completedSessionId); if (session) session.energy = parseInt(modal.querySelector('#epSlider').value);
                    saveSessions(s);
                    modal.remove();
                    showToast('✅ 精力已保存'); };
                modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); }); }

            function saveTimerState() { if (!sessionId) return; try { Storage.saveTimerState({ version: 2, subj: curSubj,
                        mode: curMode, cdMin, phase: running ? 'running' : 'paused', sessionId, sessionStartedAt, startTime,
                        elapsedBefore, segments: activeSegments, savedAt: Date.now() }); } catch (error) {
                    console.error('计时状态保存失败', error);
                    showToast('⚠️ 计时状态无法保存，请勿刷新页面'); } }

            function clearTimerState() { Storage.clearTimerState(); }

            function playSound() { try { const ctx = new(window.AudioContext || window.webkitAudioContext)();
        [523, 659, 784, 1047].forEach((f, i) => { const o = ctx.createOscillator(),
                        g = ctx.createGain();
                    o.type = 'sine';
                    o.frequency.value = f;
                    g.gain.setValueAtTime(.1, ctx.currentTime + i * .12);
                    g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + i * .12 + .28);
                    o.connect(g);
                    g.connect(ctx.destination);
                    o.start(ctx.currentTime + i * .12);
                    o.stop(ctx.currentTime + i * .12 + .28); });
                setTimeout(() => ctx.close(), 1200); } catch (e) {} }

            function updateTimerUI() { const el = document.getElementById('timerDisplay'); if (el) el.textContent = fmtTime(
                    curSec()); }

            function updateTimerRunningUI() { toggleTimerBtns('running'); }

            function updateTimerPausedUI() { toggleTimerBtns('paused'); }

            function updateTimerStoppedUI() { toggleTimerBtns('stopped'); }

            function toggleTimerBtns(state) {
                const s = document.getElementById('btnStart'),
                    p = document.getElementById('btnPause'),
                    st = document.getElementById('btnStop'),
                    r = document.getElementById('btnReset');
                if (!s) return;
                s.style.display = state === 'running' ? 'none' : '';
                s.textContent = state === 'paused' ? '▶ 继续' : '▶ 开始';
                p.style.display = state === 'running' ? '' : 'none';
                st.style.display = (state === 'running' || state === 'paused') ? '' : 'none';
                r.style.display = state === 'stopped' ? '' : 'none';
                const locked = state === 'running' || state === 'paused';
                document.querySelectorAll('#modeBtns button, #subjRow button, #cdPresets button, #customCd, #btnManageProjects').forEach(el =>
                    el.disabled = locked);
            }

            function updateModeUI() {
                const btns = document.querySelectorAll('#modeBtns button');
                btns.forEach(b => b.classList.toggle('active', b.dataset.mode === curMode));
                document.getElementById('cdPresets').style.display = curMode === 'countdown' ? 'flex' : 'none';
                document.getElementById('timerModeLabel').textContent = curMode === 'countdown' ? '倒计时模式' : '正向计时模式';
            }

            function checkMilestones() {
                const { data } = getDayData(todayKey());
                const totalSec = sumDay(data);
                const totalHr = totalSec / 3600;
                const ms = loadMilestones();
                const tk = todayKey();
                if (!ms[tk]) ms[tk] = [];
                const levels = [{ hr: 8, label: '标准', icon: '🎯' }, { hr: 9, label: '优秀', icon: '🌟' }, { hr: 10, label: '完美',
                        icon: '💎' }, { hr: 11, label: '神级', icon: '👑' }
                ];
                levels.forEach(l => { if (totalHr >= l.hr && !ms[tk].includes(l.label)) { ms[tk].push(l.label);
                        saveMilestones(ms);
                        showBadge(l); } });
            }

            function showBadge(l) {
                const pop = document.getElementById('badgePop');
                pop.innerHTML =
                    `<div style="font-size:2.8rem;">${l.icon}</div><h3 style="margin:8px 0;">达成里程碑：${l.label}</h3><p style="color:var(--text2);">今日学习时长 ≥ ${l.hr} 小时</p><button class="btn btn-go btn-sm" style="margin-top:12px;" onclick="document.getElementById('badgePop').classList.remove('show')">太棒了！</button>`;
                pop.classList.add('show');
                setTimeout(() => pop.classList.remove('show'), 3500);
            }

            function showToast(msg) { if (toastT) clearTimeout(toastT); const el = document.getElementById('toast');
                el.textContent = msg;
                el.classList.add('show');
                toastT = setTimeout(() => el.classList.remove('show'), 2000); }

            function updateAllDisplays() {
                renderHome();
                updateFootBar();
                updateChartsIfVisible();
                updateOverviewIfVisible();
                updateWeekViewIfVisible();
                updateWeekStatsIfVisible();
                renderCalendarIfVisible();
            }

            function updateFootBar() { const { data } = getDayData(todayKey()); const td = sumDay(data);
                document.getElementById('footToday').textContent = Math.round(td / 3600 * 10) / 10 + 'h';
                document.getElementById('footWeek').textContent = Math.round(calcWeekTotal() / 3600 * 10) / 10 + 'h'; }

            function updateChartsIfVisible() { if (curPage === 'timer') updateCharts(); }

            function updateOverviewIfVisible() { if (curPage === 'stats' && statsTab === 'overview') updateOverviewPage(); }

            function updateWeekViewIfVisible() { if (curPage === 'stats' && statsTab === 'weekview') updateWeekViewChart(); }

            function updateWeekStatsIfVisible() { if (curPage === 'stats' && statsTab === 'weekstats') updateWeekStats(); }

            function renderCalendarIfVisible() { if (curPage === 'calendar') renderCalendar(); }

            function renderHome() {
                const now = new Date();
                const diff = Math.ceil((EXAM_DATE - now) / (1000 * 60 * 60 * 24));
                const q = getDailyQuote();
                const { data } = getDayData(todayKey());
                const totalSec = sumDay(data);
                const th = Math.floor(totalSec / 3600),
                    tm = Math.floor((totalSec % 3600) / 60);
                document.getElementById('page-home').innerHTML = `
            <div class="countdown-banner">📅 距考研还有 <span class="cd-num">${diff}</span> 天</div>
            <div class="home-date">${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${['日','一','二','三','四','五','六'][now.getDay()]}</div>
            <div class="home-quote" id="homeQuote" title="点击换一句"><span>${q.cn}</span><span class="en">${q.en}</span></div>
            <div class="stats-row">
              <div class="stat-card total"><div class="val">${th}h ${tm}m</div><div class="lbl">📅 今日总时长</div></div>
              ${ACTIVE_SUBJS.map(s=>`<div class="stat-card sub" style="border-left-color:${SUBJ_COLORS[s]};"><div class="val">${(data[s]||0)/3600>=0.1?Math.round((data[s]||0)/3600*10)/10+'h':'0h'}</div><div class="lbl">${escapeHtml(SUBJ_ICONS[s])} ${escapeHtml(SUBJ_NAMES[s])}</div></div>`).join('')}
            </div>
            <div class="card">
              <div class="card-title">⚡ 今日精力评分</div>
              <div class="energy-wrap">
                <div class="energy-ring"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" stroke="#eef1f5" stroke-width="7"/><circle id="energyCircle" cx="32" cy="32" r="28" fill="none" stroke="#4f8cf7" stroke-width="7" stroke-dasharray="175.93" stroke-dashoffset="175.93" stroke-linecap="round"/></svg><div class="score" id="energyScore">${data.energy||0}</div></div>
                <input type="range" min="0" max="100" value="${data.energy||0}" id="energySlider" style="flex:1;accent-color:#4f8cf7;">
              </div>
            </div>
            <div class="card">
              <div class="collapse-header" id="notesToggle">📝 今日学习内容记录 <span id="notesArrow">▶</span></div>
              <div class="collapse-body" id="notesBody"><textarea class="notes-area" id="notesArea" placeholder="记录今天的学习内容、收获、反思...">${data.notes||''}</textarea><button class="btn btn-outline btn-sm" style="margin-top:8px;" id="btnSaveNotes">💾 保存笔记</button></div>
            </div>`;
                document.getElementById('homeQuote').onclick = randomQuote;
                document.getElementById('energySlider').oninput = function() { const v = parseInt(this.value);
                    document.getElementById('energyScore').textContent = v;
                    document.getElementById('energyCircle').style.strokeDashoffset = 175.93 - (v / 100) * 175.93;
                    saveEnergy(v); };
                document.getElementById('notesToggle').onclick = function() { const b = document.getElementById(
                        'notesBody');
                    b.classList.toggle('open');
                    document.getElementById('notesArrow').textContent = b.classList.contains('open') ? '▼' :
                    '▶'; };
                document.getElementById('btnSaveNotes').onclick = () => { saveNotes(document.getElementById('notesArea')
                        .value.trim());
                    showToast('📝 笔记已保存'); };
                const ev = data.energy || 0;
                document.getElementById('energyCircle').style.strokeDashoffset = 175.93 - (ev / 100) * 175.93;
            }

            function getDailyQuote() { const tk = todayKey(); let h = 0; for (let i = 0; i < tk.length; i++) h = ((h << 5) - h) + tk
                    .charCodeAt(i) | 0; return QUOTES[Math.abs(h) % QUOTES.length]; }

            function randomQuote() { const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
                document.querySelector('#page-home .home-quote span:first-child').textContent = q.cn;
                document.querySelector('#page-home .home-quote .en').textContent = q.en;
                showToast('🔄 已更换名言'); }

            function renderTimerPage() {
                document.getElementById('page-timer').innerHTML = `
            <div style="display:flex;justify-content:center;"><div class="mode-btns" id="modeBtns"><button class="active" data-mode="countup">📈 正向计时</button><button data-mode="countdown">⏳ 倒计时</button></div></div>
            <div class="subject-row" id="subjRow">${ACTIVE_SUBJS.map(s=>`<button class="subj-tag${s===curSubj?' active':''}" data-subj="${s}" style="--subj-color:${SUBJ_COLORS[s]};">${escapeHtml(SUBJ_ICONS[s])} ${escapeHtml(SUBJ_NAMES[s])}</button>`).join('')}<button class="btn btn-outline btn-sm" id="btnManageProjects">⚙ 管理项目</button></div>
            <div class="timer-mode-label" id="timerModeLabel">${curMode==='countdown'?'倒计时模式':'正向计时模式'}</div>
            <div class="timer-big" id="timerDisplay">${fmtTime(curSec())}</div>
            <div class="btn-row"><button class="btn btn-go" id="btnStart">▶ 开始</button><button class="btn btn-pause" id="btnPause" style="display:none;">⏸ 暂停</button><button class="btn btn-outline" id="btnStop" style="display:none;color:#e05555;border-color:#e05555;">⏹ 停止</button><button class="btn btn-outline btn-sm" id="btnReset">↺ 重置</button></div>
            <div id="cdPresets" style="display:${curMode==='countdown'?'flex':'none'};justify-content:center;gap:6px;flex-wrap:wrap;margin-top:10px;">${[25,30,45,60,90].map(m=>`<button class="btn btn-outline btn-sm preset-btn" data-min="${m}">${m}分钟</button>`).join('')}<input type="number" class="btn btn-outline btn-sm" id="customCd" placeholder="自定义" min="1" max="300" style="width:76px;text-align:center;"></div>
            <div class="card" style="margin-top:14px;">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                <div class="chart-tabs" id="chartTabs"><button class="chart-tab active" data-range="week">📅 本周</button><button class="chart-tab" data-range="month">🗓️ 本月</button></div>
                <button class="btn btn-outline btn-sm" id="toggleChartUnit">📊 ${chartUnit==='hour'?'切换为分钟':'切换为小时'}</button>
              </div>
              <div class="chart-row"><div class="chart-wrap"><canvas id="barChart"></canvas></div><div class="chart-wrap"><canvas id="pieChart"></canvas></div></div>
              <div class="no-data" id="noDataHint" style="display:none;">今日还没有学习记录，开始计时吧 🍅</div>
            </div>`;
                document.getElementById('btnStart').onclick = startTimer;
                document.getElementById('btnPause').onclick = pauseTimer;
                document.getElementById('btnStop').onclick = stopTimer;
                document.getElementById('btnReset').onclick = resetTimer;
                document.getElementById('btnManageProjects').onclick = () => { if (!running && !paused) showProjectManager(); };
                document.getElementById('modeBtns').onclick = e => { const b = e.target.closest('button'); if (!b || running || paused)
                        return;
                    curMode = b.dataset.mode;
                    updateModeUI();
                    elapsedBefore = 0;
                    updateTimerUI();
                    clearTimerState(); };
                document.getElementById('subjRow').onclick = e => { const b = e.target.closest('button'); if (!b || running || paused)
                        return;
                    curSubj = b.dataset.subj;
                    document.querySelectorAll('#subjRow button').forEach(btn => btn.classList.toggle('active', btn
                        .dataset.subj === curSubj)); };
                document.querySelectorAll('#subjRow button').forEach(b => b.title = '');
                document.getElementById('cdPresets').onclick = e => { const b = e.target.closest('.preset-btn'); if (!b || running || paused)
                        return;
                    cdMin = parseInt(b.dataset.min);
                    elapsedBefore = 0;
                    updateTimerUI();
                    clearTimerState(); };
                document.getElementById('customCd').oninput = function() { if (running || paused) return; const v = parseInt(this.value); if (v >= 1 && v <=
                        300) { cdMin = v;
                        elapsedBefore = 0;
                        updateTimerUI();
                        clearTimerState(); } };
                document.getElementById('chartTabs').onclick = e => { const b = e.target.closest('.chart-tab'); if (!b)
                        return;
                    chartRange = b.dataset.range;
                    document.querySelectorAll('#chartTabs .chart-tab').forEach(t => t.classList.toggle('active', t ===
                        b));
                    updateCharts(); };
                document.getElementById('toggleChartUnit').onclick = function() { chartUnit = chartUnit === 'hour' ? 'minute' :
                        'hour';
                    this.textContent = '📊 ' + (chartUnit === 'hour' ? '切换为分钟' : '切换为小时');
                    updateCharts();
                    updateWeekViewChartIfNeeded(); };
                updateCharts();
                updateModeUI();
                if (running) updateTimerRunningUI(); else if (paused) updateTimerPausedUI(); else updateTimerStoppedUI();
            }

            function showProjectManager() {
                let draft = projects.map(project => ({ ...project }));
                const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.innerHTML = `<div class="modal" style="max-width:620px;"><h4>⚙ 管理学习项目</h4>
                    <p style="color:var(--text2);font-size:.78rem;margin-bottom:12px;">归档项目不会删除历史数据，也不会再出现在计时选择中。</p>
                    <div id="projectList"></div>
                    <div class="row" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
                      <label>新增项目</label><input id="newProjectIcon" value="📚" maxlength="4" style="width:58px;">
                      <input id="newProjectName" placeholder="例如：计算机网络" maxlength="20" style="flex:1;min-width:130px;">
                      <input id="newProjectColor" type="color" value="#4f8cf7" style="width:48px;padding:2px;">
                      <button class="btn btn-outline btn-sm" id="btnAddProject">添加</button>
                    </div>
                    <div class="btn-row" style="margin-top:14px;"><button class="btn btn-outline btn-sm" id="btnProjectCancel">取消</button><button class="btn btn-go btn-sm" id="btnProjectSave">✅ 保存项目</button></div>
                </div>`;
                document.body.appendChild(modal);
                const list = modal.querySelector('#projectList');

                function renderList() {
                    list.innerHTML = draft.map(project => `<div class="row" data-project-id="${project.id}" style="opacity:${project.archived?'.55':'1'};">
                        <input class="project-icon" value="${escapeHtml(project.icon)}" maxlength="4" style="width:58px;">
                        <input class="project-name" value="${escapeHtml(project.name)}" maxlength="20" style="flex:1;min-width:130px;">
                        <input class="project-color" type="color" value="${project.color}" style="width:48px;padding:2px;">
                        <button class="btn btn-outline btn-sm project-toggle">${project.archived?'恢复':'归档'}</button>
                    </div>`).join('');
                }

                list.addEventListener('input', event => { const row = event.target.closest('[data-project-id]'); if (!row) return;
                    const project = draft.find(item => item.id === row.dataset.projectId); if (!project) return;
                    if (event.target.classList.contains('project-name')) project.name = event.target.value;
                    if (event.target.classList.contains('project-icon')) project.icon = event.target.value;
                    if (event.target.classList.contains('project-color')) project.color = event.target.value; });
                list.addEventListener('click', event => { const button = event.target.closest('.project-toggle'); if (!button) return;
                    const row = button.closest('[data-project-id]');
                    const project = draft.find(item => item.id === row.dataset.projectId); if (!project) return;
                    if (!project.archived && draft.filter(item => !item.archived).length <= 1) {
                        showToast('⚠️ 至少保留一个可用项目'); return;
                    }
                    project.archived = !project.archived;
                    renderList(); });
                modal.querySelector('#btnAddProject').onclick = () => {
                    const name = modal.querySelector('#newProjectName').value.trim();
                    if (!name) { showToast('⚠️ 请输入项目名称'); return; }
                    if (draft.length >= 20) { showToast('⚠️ 最多创建 20 个项目'); return; }
                    const id = 'project_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                    draft.push({ id, name, icon: modal.querySelector('#newProjectIcon').value.trim() || '📚',
                        color: modal.querySelector('#newProjectColor').value, archived: false });
                    modal.querySelector('#newProjectName').value = '';
                    renderList();
                };
                modal.querySelector('#btnProjectCancel').onclick = () => modal.remove();
                modal.querySelector('#btnProjectSave').onclick = () => {
                    if (draft.some(project => !project.name.trim())) { showToast('⚠️ 项目名称不能为空'); return; }
                    try { Storage.saveProjects(draft); projects = Storage.loadProjects(); }
                    catch (error) { console.error(error); showToast('⚠️ 项目设置保存失败'); return; }
                    rebuildProjectMaps();
                    if (!ACTIVE_SUBJS.includes(curSubj)) curSubj = ACTIVE_SUBJS[0];
                    modal.remove();
                    renderTimerPage();
                    updateAllDisplays();
                    showToast('✅ 项目设置已保存');
                };
                modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
                renderList();
            }

            function updateWeekViewChartIfNeeded() { if (curPage === 'stats' && statsTab === 'weekview') updateWeekViewChart(); }

            function updateCharts() {
                const all = loadAll();
                const days = chartRange === 'week' ? 7 : 30;
                const dr = getDateRange(days);
                const labels = dr.map(d => d.label);
                const divisor = chartUnit === 'hour' ? 3600 : 60;
                const unitLabel = chartUnit === 'hour' ? '小时' : '分钟';
                const series = Object.fromEntries(SUBJS.map(subject => [subject, dr.map(day =>
                    Math.round((all[day.key]?.[subject] || 0) / divisor * 10) / 10)]));
                const totalAll = SUBJS.reduce((total, subject) => total + series[subject].reduce((a, b) => a + b, 0), 0);
                const nh = document.getElementById('noDataHint');
                if (nh) nh.style.display = totalAll === 0 ? 'block' : 'none';
                const bc = document.getElementById('barChart');
                if (bc) { const bctx = bc.getContext('2d'); if (barChart) barChart.destroy();
                    barChart = new Chart(bctx, { type: 'bar', data: { labels, datasets: SUBJS.map(subject => ({
                                label: SUBJ_NAMES[subject], data: series[subject], backgroundColor: SUBJ_COLORS[subject],
                                borderWidth: 0, borderRadius: 0, borderSkipped: false })) },
                        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true,
                                    ticks: { font: { size: 9 }, maxRotation: 0 }, grid: { display: false },
                                    categoryPercentage: 0.75, barPercentage: 0.85 },
                                y: { stacked: true, title: { display: true, text: unitLabel,
                                font: { size: 10, weight: 'bold' } }, ticks: { font: { size: 9 } },
                                    grid: { color: '#f1f5f9' } } }, plugins: { legend: { position: 'bottom',
                            labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 10 },
                                boxWidth: 8, boxHeight: 8 } } } } }); }
                const pc = document.getElementById('pieChart');
                if (pc) { const pctx = pc.getContext('2d'); if (pieChart) pieChart.destroy();
                    const pd = SUBJS.map(subject => series[subject].reduce((a, b) => a + b, 0));
                    const pt = pd.reduce((a, b) => a + b, 0);
                    pieChart = new Chart(pctx, { type: 'doughnut', data: { labels: SUBJS.map(subject => SUBJ_NAMES[subject]),
                            datasets: [{ data: pt > 0 ? pd : SUBJS.map(() => 1), backgroundColor: pt > 0 ?
                                SUBJS.map(subject => SUBJ_COLORS[subject]) : SUBJS.map(() => '#e5e7eb'), borderWidth: 3,
                                borderColor: '#fff', hoverBorderWidth: 4 }] }, options: { responsive: true,
                            maintainAspectRatio: false, plugins: { legend: { position: 'bottom',
                            labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 10 },
                                boxWidth: 8, boxHeight: 8 } }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx
                                        .raw + ' ' + unitLabel } } } } }); }
            }

            function renderStatsPage() {
                document.getElementById('page-stats').innerHTML = `
            <div class="chart-tabs" id="statsTabs">
              <button class="chart-tab active" data-stab="overview">📊 总览</button>
              <button class="chart-tab" data-stab="weekview">📈 周视图</button>
              <button class="chart-tab" data-stab="weekstats">📋 周统计</button>
            </div>
            <div id="stab-overview"></div>
            <div id="stab-weekview" style="display:none;"><div class="card"><div class="chart-wrap" style="height:290px;"><canvas id="weekStackChart"></canvas></div></div></div>
            <div id="stab-weekstats" style="display:none;"><div class="card" id="weekStatsCard"></div></div>
            <div class="btn-row" style="margin-top:12px;">
              <button class="btn btn-outline btn-sm" id="btnQuickWeek">📥 快捷补录本周</button>
              <button class="btn btn-outline btn-sm" id="btnEditData">✏️ 手动修改历史</button>
              <button class="btn btn-outline btn-sm" id="btnExportData">💾 导出备份</button>
              <button class="btn btn-outline btn-sm" id="btnImportData">📂 导入备份</button>
              <button class="btn btn-outline btn-sm" id="btnRestoreBackup">↩ 恢复安全副本</button>
              <input type="file" id="backupFileInput" accept="application/json,.json" hidden>
            </div>`;
                document.getElementById('statsTabs').onclick = e => { const b = e.target.closest('.chart-tab'); if (!b)
                        return;
                    statsTab = b.dataset.stab;
                    document.querySelectorAll('#statsTabs .chart-tab').forEach(t => t.classList.toggle('active', t ===
                        b));
                    ['overview', 'weekview', 'weekstats'].forEach(s => { const el = document.getElementById('stab-' + s); if (
                            el) el.style.display = s === statsTab ? 'block' : 'none'; }); if (statsTab === 'overview')
                        updateOverviewPage(); if (statsTab === 'weekview') updateWeekViewChart(); if (statsTab ===
                        'weekstats') updateWeekStats(); };
                document.getElementById('btnQuickWeek').onclick = showQuickWeekModal;
                document.getElementById('btnEditData').onclick = showEditModal;
                document.getElementById('btnExportData').onclick = () => { try { Storage.downloadBackup();
                        showToast('✅ 备份文件已导出'); } catch (error) { showToast('⚠️ 备份导出失败'); } };
                document.getElementById('btnImportData').onclick = () => { if (running || paused) {
                        showToast('⚠️ 请先结束当前计时再导入数据'); return; }
                    document.getElementById('backupFileInput').click(); };
                document.getElementById('backupFileInput').onchange = importBackupFile;
                const restoreButton = document.getElementById('btnRestoreBackup');
                restoreButton.disabled = !Storage.hasAutoBackup();
                restoreButton.onclick = restoreSafetyBackup;
                updateOverviewPage();
                updateWeekViewChart();
                updateWeekStats();
            }

            async function importBackupFile(event) {
                const input = event.target;
                const file = input.files && input.files[0];
                if (!file || running || paused) return;
                try {
                    const bundle = JSON.parse(await file.text());
                    if (!confirm('导入会替换当前学习记录。系统会先保留一份当前数据的安全副本，确定继续吗？')) return;
                    Storage.importBundle(bundle);
                    reloadProjects();
                    updateAllDisplays();
                    if (curPage === 'stats') renderStatsPage();
                    showToast('✅ 备份已导入');
                } catch (error) {
                    console.error(error);
                    showToast('⚠️ 导入失败：备份文件无效');
                } finally {
                    input.value = '';
                }
            }

            function restoreSafetyBackup() {
                if (!Storage.hasAutoBackup()) return;
                if (running || paused) { showToast('⚠️ 请先结束当前计时再恢复数据'); return; }
                if (!confirm('将当前数据替换为最近的安全副本吗？当前数据也会被保留为新的安全副本。')) return;
                try {
                    Storage.restoreAutoBackup();
                    reloadProjects();
                    renderStatsPage();
                    updateAllDisplays();
                    showToast('✅ 已恢复安全副本');
                } catch (error) {
                    console.error(error);
                    showToast('⚠️ 安全副本恢复失败');
                }
            }

            function reloadProjects() {
                projects = Storage.loadProjects();
                rebuildProjectMaps();
                recoverOrphanProjects();
                if (!SUBJS.includes(curSubj) || (!running && !paused && !ACTIVE_SUBJS.includes(curSubj)))
                    curSubj = ACTIVE_SUBJS[0] || SUBJS[0];
            }

            function updateOverviewPage() {
                const all = loadAll();
                const keys = Object.keys(all).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && sumDay(all[k]) > 0);
                const totalDays = keys.length;
                let totalSec = 0,
                    st = Object.fromEntries(SUBJS.map(subject => [subject, 0]));
                keys.forEach(k => { for (const s of SUBJS) { const v = all[k][s] || 0;
                        totalSec += v;
                        st[s] += v; } });
                const totalHr = Math.round(totalSec / 3600 * 10) / 10;
                const streak = calcStreak(all),
                    maxStreak = calcMaxStreak(all);
                const el = document.getElementById('stab-overview');
                if (!el) return;
                el.innerHTML = `
            <div class="big-nums">
              <div class="big-num"><div class="v">${totalDays}</div><div class="l">累计记录天数</div></div>
              <div class="big-num"><div class="v">${totalHr}h</div><div class="l">累计学习时长</div></div>
              <div class="big-num"><div class="v">${streak}</div><div class="l">连续打卡天数</div></div>
              <div class="big-num"><div class="v">${maxStreak}</div><div class="l">历史最长连续</div></div>
            </div>
            <div class="card"><div class="card-title">各项目累计时长（小时）</div><div class="bar-list">${SUBJS.map(s=>{const h=Math.round(st[s]/3600*10)/10;const maxH=Math.max(1,...SUBJS.map(ss=>st[ss]/3600));const pct=Math.round(h/maxH*100);return`<div class="bar-item"><span style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(SUBJ_ICONS[s])} ${escapeHtml(SUBJ_NAMES[s])}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${SUBJ_COLORS[s]};"></div></div><span style="font-weight:700;">${h}h</span></div>`;}).join('')}</div></div>
            <div class="card"><div class="card-title">累计专注时长分布（小时）</div><div class="chart-wrap" style="height:230px;"><canvas id="overviewPie"></canvas></div></div>`;
                const opc = document.getElementById('overviewPie');
                if (opc) { const opctx = opc.getContext('2d'); if (overviewPieC) overviewPieC.destroy();
                    const od = SUBJS.map(s => Math.round(st[s] / 3600 * 10) / 10);
                    const ot = od.reduce((a, b) => a + b, 0);
                    overviewPieC = new Chart(opctx, { type: 'doughnut', data: { labels: SUBJS.map(s => SUBJ_NAMES[s]),
                            datasets: [{ data: ot > 0 ? od : SUBJS.map(() => 1), backgroundColor: ot > 0 ? SUBJS.map(s =>
                                    SUBJ_COLORS[s]) : SUBJS.map(() => '#e5e7eb'),
                                borderWidth: 3, borderColor: '#fff', hoverBorderWidth: 4 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom',
                                    labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 10 },
                                        boxWidth: 8, boxHeight: 8 } },
                                tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.raw + 'h' + (
                                            ot > 0 ? ' (' + Math.round(ctx.raw / ot * 100) + '%)' :
                                        '') } } } } }); }
            }

            function calcStreak(all) { let s = 0; const n = new Date(); while (true) { const k = n.getFullYear() + '-' + p2(n
                        .getMonth() + 1) + '-' + p2(n.getDate()); const d = all[k]; if (d && sumDay(d) > 0) { s++;
                    n.setDate(n.getDate() - 1); } else break; } return s; }

            function calcMaxStreak(all) { const ks = Object.keys(all).sort(); let max = 0,
                    cur = 0,
                    pd = null;
                ks.filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).forEach(k => { const d = all[k]; if (d && sumDay(d) > 0) {
                    if (pd && (new Date(k) - new Date(pd)) === 86400000) cur++; else { max =
                            Math.max(max, cur);
                        cur = 1; }
                    pd = k; } else { max = Math.max(max, cur);
                    cur = 0;
                    pd = null; } });
                max = Math.max(max, cur); return max; }

            function updateWeekViewChart() {
                const all = loadAll();
                const dr = getDateRange(7);
                const labels = dr.map(d => d.label + '(' + d.dow + ')');
                const divisor = chartUnit === 'hour' ? 3600 : 60;
                const series = Object.fromEntries(SUBJS.map(subject => [subject, dr.map(day =>
                    Math.round((all[day.key]?.[subject] || 0) / divisor * 10) / 10)]));
                const wc = document.getElementById('weekStackChart');
                if (!wc) return;
                const wctx = wc.getContext('2d');
                if (weekStackC) weekStackC.destroy();
                weekStackC = new Chart(wctx, { type: 'bar', data: { labels, datasets: SUBJS.map(subject => ({
                            label: SUBJ_NAMES[subject], data: series[subject], backgroundColor: SUBJ_COLORS[subject],
                            borderWidth: 0, borderRadius: 0, borderSkipped: false })) },
                    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true,
                                ticks: { font: { size: 9 } }, grid: { display: false }, categoryPercentage: 0.75,
                                barPercentage: 0.85 }, y: { stacked: true, title: { display: true,
                                text: chartUnit === 'hour' ? '小时' : '分钟', font: { size: 10, weight: 'bold' } },
                                ticks: { font: { size: 9 } }, grid: { color: '#f1f5f9' } } },
                    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12,
                    font: { size: 10 }, boxWidth: 8, boxHeight: 8 } } } } });
            }

            function updateWeekStats() {
                const all = loadAll();
                const dr = getDateRange(7);
                let totalSec = 0,
                    active = 0;
                let html =
                    '<div class="card-title">📋 本周统计详情</div><div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:10px;font-size:.88rem;"><span>本周时长：<b id="wsTotal" style="color:var(--accent);">0h</b></span><span>活跃天数：<b id="wsActive" style="color:var(--accent);">0</b></span></div>';
                dr.forEach(d => { const dd = all[d.key] || {}; const t = sumDay(dd); if (t > 0) active++;
                    totalSec += t;
                    html +=
                    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:.82rem;"><span>${d.label} (${d.dow})</span><span style="font-weight:600;">${t>0?Math.round(t/3600*10)/10+'h':'—'}</span></div>`; });
                html +=
                    `<div style="margin-top:8px;color:var(--text2);font-size:.78rem;">日均：${active>0?Math.round(totalSec/active/3600*10)/10+'h':'—'}</div>`;
                const card = document.getElementById('weekStatsCard');
                if (card) { card.innerHTML = html;
                    document.getElementById('wsTotal').textContent = Math.round(totalSec / 3600 * 10) / 10 + 'h';
                    document.getElementById('wsActive').textContent = active; }
            }

            function showQuickWeekModal() {
                const days = getDateRange(7);
                const all = loadAll();
                let html = '<h4>📥 快捷补录本周学习时长</h4><p style="color:var(--text2);font-size:.8rem;margin-bottom:10px;">输入各项目分钟数（已填为当前记录）</p>';
                days.forEach(d => { const dd = all[d.key] || {};
                    html +=
                    `<div style="margin:10px 0;padding:8px;background:#fafbfc;border-radius:8px;"><strong>${d.label} (${d.dow})</strong><br><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${ACTIVE_SUBJS.map(s=>'<label style="font-size:.72rem;display:flex;align-items:center;gap:3px;">'+escapeHtml(SUBJ_ICONS[s])+' '+escapeHtml(SUBJ_NAMES[s])+'<input type="number" min="0" value="'+Math.round((dd[s]||0)/60*10)/10+'" style="width:54px;padding:5px;border-radius:6px;border:1px solid #e2e8f0;text-align:center;font-weight:600;"></label>').join('')}</div></div>`; });
                html +=
                    '<div class="btn-row" style="margin-top:14px;"><button class="btn btn-go btn-sm" id="saveQuickWeek">✅ 保存本周</button><button class="btn btn-outline btn-sm" id="cancelQuickWeek">取消</button></div>';
                const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.innerHTML = `<div class="modal">${html}</div>`;
                document.body.appendChild(modal);
                modal.querySelector('#cancelQuickWeek').onclick = () => modal.remove();
                modal.querySelector('#saveQuickWeek').onclick = () => { const inputs = modal.querySelectorAll('input');
                    const alld = loadAll();
                    days.forEach((d, i) => { const base = i * ACTIVE_SUBJS.length; if (!alld[d.key]) alld[d.key] = emptyDay();
                        ACTIVE_SUBJS.forEach((subject, index) => alld[d.key][subject] = Math.max(0,
                            Math.round((parseFloat(inputs[base + index].value) || 0) * 60))); });
                    saveAll(alld);
                    modal.remove();
                    updateAllDisplays();
                    showToast('✅ 本周数据已补录'); };
                modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
            }

            function showEditModal() {
                const tk = todayKey();
                const all = loadAll();
                const dd = all[tk] || {};
                const html =
                    `<h4>✏️ 手动修改学习时长</h4><p style="color:var(--text2);font-size:.78rem;margin-bottom:10px;">输入分钟数，保存后自动换算为小时显示</p><div class="row"><label>📅 日期</label><input type="date" id="editDate" value="${tk}"><button class="btn btn-outline btn-sm" id="btnEditToday">今天</button></div>${SUBJS.map(s=>`<div class="row"><label>${escapeHtml(SUBJ_ICONS[s])} ${escapeHtml(SUBJ_NAMES[s])}</label><input type="number" id="edit_${s}" value="${Math.round((dd[s]||0)/60*10)/10}" step="0.5" min="0"> <span style="font-size:.75rem;color:var(--text2);">分钟</span></div>`).join('')}<div class="btn-row" style="margin-top:12px;"><button class="btn btn-outline btn-sm" id="btnEditCancel">取消</button><button class="btn btn-go btn-sm" id="btnEditSave">✅ 保存修改</button></div>`;
                const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.innerHTML = `<div class="modal">${html}</div>`;
                document.body.appendChild(modal);
                modal.querySelector('#btnEditCancel').onclick = () => modal.remove();
                modal.querySelector('#btnEditToday').onclick = () => { document.getElementById('editDate').value =
                    todayKey();
                    loadEditForm(todayKey()); };
                modal.querySelector('#editDate').onchange = function() { loadEditForm(this.value); };
                modal.querySelector('#btnEditSave').onclick = () => { const key = document.getElementById('editDate')
                    .value; if (!key) return; const alld = loadAll(); if (!alld[key]) alld[key] = emptyDay();
                    SUBJS.forEach(s => alld[key][s] = Math.max(0, Math.round((parseFloat(document.getElementById('edit_' + s)
                        .value) || 0) * 60)));
                    saveAll(alld);
                    modal.remove();
                    updateAllDisplays();
                    showToast('✅ 数据已更新：' + key); };
                modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

                function loadEditForm(key) { const a = loadAll(); const d = a[key] || {};
                    SUBJS.forEach(s => { const el = document.getElementById('edit_' + s); if (el) el.value = Math.round(
                            (d[s] || 0) / 60 * 10) / 10; }); }
            }

            function renderCalendar() {
                const now = new Date();
                if (!calYear) { calYear = now.getFullYear();
                    calMonth = now.getMonth() + 1; }
                const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
                const daysInMonth = new Date(calYear, calMonth, 0).getDate();
                const all = loadAll();
                const todayK = todayKey();
                let html =
                    '<div class="card"><div class="cal-header"><button class="btn btn-outline btn-sm" id="calPrev">◀ 上月</button><span class="month-label">' +
                    calYear + '年 ' + calMonth + '月</span><button class="btn btn-outline btn-sm" id="calNext">下月 ▶</button></div><div class="cal-grid">';
                ['日', '一', '二', '三', '四', '五', '六'].forEach(d => html += `<div class="cal-day-name">${d}</div>`);
                for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell other-month"></div>';
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = calYear + '-' + p2(calMonth) + '-' + p2(d);
                    const dd = all[key] || {};
                    const totalSec = sumDay(dd);
                    const totalHr = totalSec / 3600;
                    const energy = dd.energy || 0;
                    // 1-12小时对应从浅到深的颜色，12小时达到最深
                    const inten = Math.min(totalHr / 12, 1);
                    const bg = totalHr > 0 ? `rgba(79,140,247,${0.05 + inten * 0.78})` : '#fafbfc';
                    html +=
                        `<div class="cal-cell${key===todayK?' today':''}" style="background:${bg};" data-key="${key}">${d}${totalHr>0?'<span class="dur">'+Math.round(totalHr*10)/10+'h</span>':''}${energy>0?'<span class="engy">⚡'+energy+'</span>':''}</div>`;
                }
                html += '</div></div>';
                document.getElementById('page-calendar').innerHTML = html;
                document.getElementById('calPrev').onclick = () => { calMonth--;
                    if (calMonth < 1) { calMonth = 12;
                        calYear--; }
                    renderCalendar(); };
                document.getElementById('calNext').onclick = () => { calMonth++; if (calMonth > 12) { calMonth = 1;
                        calYear++; }
                    renderCalendar(); };
                document.querySelectorAll('.cal-cell[data-key]').forEach(cell => cell.onclick = function() {
                    const key = this.dataset.key;
                    const dd = all[key] || {};
                    const totalSec = sumDay(dd);
                    alert('📅 ' + key + '\n总时长：' + Math.round(totalSec / 3600 * 10) / 10 + '小时\n精力评分：' + (dd.energy ||
                            '未评分') + '/100\n笔记：' + (dd.notes || '暂无'));
                });
            }

            function switchPage(p) {
                document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
                document.getElementById('page-' + p).classList.add('active');
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === p));
                curPage = p;
                if (p === 'home') renderHome();
                if (p === 'timer') renderTimerPage();
                if (p === 'stats') renderStatsPage();
                if (p === 'calendar') renderCalendar();
                updateFootBar();
            }

            document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => switchPage(b.dataset.page));
            restoreTimerState();
            renderHome();
            updateFootBar();

            function restoreTimerState() {
                const raw = Storage.loadTimerState();
                const state = Timer.normalizeState(raw);
                if (!state) { if (raw) Storage.clearTimerState(); return; }
                if (!SUBJS.includes(state.subj)) {
                    projects.push({ id: state.subj, name: state.subj, color: '#4f8cf7', icon: '📚', archived: false });
                    try { Storage.saveProjects(projects); } catch (error) { console.warn('恢复计时项目配置失败', error); }
                    rebuildProjectMaps();
                } else { const restoredProject = projects.find(project => project.id === state.subj);
                    if (restoredProject && restoredProject.archived) { restoredProject.archived = false;
                        try { Storage.saveProjects(projects); } catch (error) { console.warn('恢复计时项目配置失败', error); }
                        rebuildProjectMaps(); }
                }
                curSubj = state.subj;
                curMode = state.mode;
                cdMin = state.cdMin;
                sessionId = state.sessionId;
                sessionStartedAt = state.sessionStartedAt;
                elapsedBefore = state.elapsedBefore;
                activeSegments = state.segments;
                // 旧版状态无法判断用户是否已暂停，迁移时按暂停处理，避免把离开页面的时间误计入。
                const migrateAsPaused = !raw || raw.version !== 2;
                running = state.phase === 'running' && !migrateAsPaused;
                paused = !running;
                startTime = running ? state.startTime : null;
                if (migrateAsPaused) saveTimerState();
                if (running && curMode === 'countdown' && curSec() <= 0) finishTimer();
                else if (running) startTimerInterval();
            }

            window.addEventListener('pagehide', () => { if (running || paused) saveTimerState(); });
            setInterval(() => { const tk = todayKey(); if (sessionStorage.getItem('kaoyan_ld') !== tk) { sessionStorage
                        .setItem('kaoyan_ld', tk);
                    updateAllDisplays();
                    showToast('🌅 新的一天，加油！'); } }, 30000);
            console.log('🍅 考研看板已就绪 | 柱状图美化·热力图已移除·日历颜色优化');
        })();
