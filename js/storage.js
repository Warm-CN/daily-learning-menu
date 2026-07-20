(function() {
    'use strict';

    const KEYS = {
        study: 'kaoyan_study_v3',
        sessions: 'kaoyan_sessions_v3',
        milestones: 'kaoyan_milestones_v3',
        projects: 'kaoyan_projects_v1',
        timer: 'kaoyan_timer_st',
        autoBackup: 'kaoyan_auto_backup_v3',
        backupDate: 'kaoyan_auto_backup_date_v3'
    };
    const DEFAULT_PROJECTS = [
        { id: 'math', name: '数学', color: '#4f8cf7', icon: '📐', archived: false },
        { id: 'english', name: '英语', color: '#34b878', icon: '📝', archived: false },
        { id: 'politics', name: '政治', color: '#b58ddb', icon: '🏛️', archived: false },
        { id: 'professional', name: '专业课', color: '#f5a623', icon: '📖', archived: false }
    ];

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (error) {
            console.warn('读取本地数据失败：' + key, error);
            return fallback;
        }
    }

    function writeJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function readPrimary(key, bundleField, fallback, isValid) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            const value = JSON.parse(raw);
            if (!isValid(value)) throw new Error('本地数据结构无效');
            return value;
        } catch (error) {
            console.warn('主数据读取失败，尝试使用安全副本：' + key + '（' + error.message + '）');
            const backup = readJson(KEYS.autoBackup, null);
            const recovered = backup && backup[bundleField];
            return isValid(recovered) ? recovered : fallback;
        }
    }

    function localDateKey(date = new Date()) {
        const p2 = value => String(value).padStart(2, '0');
        return date.getFullYear() + '-' + p2(date.getMonth() + 1) + '-' + p2(date.getDate());
    }

    function validSeconds(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    }

    function validProjectId(value) {
        return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
            !['_meta', 'energy', 'notes'].includes(value);
    }

    function normalizeProjects(value) {
        const source = Array.isArray(value) ? value : DEFAULT_PROJECTS;
        const seen = new Set();
        const projects = source.filter(item => item && validProjectId(item.id) && !seen.has(item.id)).map(item => {
            seen.add(item.id);
            const fallback = DEFAULT_PROJECTS.find(project => project.id === item.id);
            const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 20) :
                (fallback ? fallback.name : item.id);
            return { id: item.id, name, color: /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color :
                    (fallback ? fallback.color : '#4f8cf7'), icon: typeof item.icon === 'string' && item.icon ?
                    item.icon.slice(0, 8) : (fallback ? fallback.icon : '📚'), archived: Boolean(item.archived) };
        });
        const normalized = projects.length ? projects : DEFAULT_PROJECTS.map(item => ({ ...item }));
        if (normalized.every(project => project.archived)) normalized[0].archived = false;
        return normalized;
    }

    function normalizeStudyData(value) {
        const result = {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
        Object.entries(value).forEach(([key, day]) => {
            if (key === '_meta') {
                const credited = day && day.creditedSessions && typeof day.creditedSessions === 'object' ?
                    day.creditedSessions : {};
                result._meta = { creditedSessions: { ...credited } };
                return;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day || typeof day !== 'object') return;
            result[key] = {
                energy: Math.max(0, Math.min(100, Number.isFinite(Number(day.energy)) ? Math.round(Number(day.energy)) : 0)),
                notes: typeof day.notes === 'string' ? day.notes : ''
            };
            Object.entries(day).forEach(([projectId, seconds]) => {
                if (validProjectId(projectId) && projectId !== 'energy' && projectId !== 'notes')
                    result[key][projectId] = validSeconds(seconds);
            });
        });
        return result;
    }

    function normalizeSessions(value) {
        return Array.isArray(value) ? value.filter(item => item && typeof item === 'object').map(item => ({ ...item })) : [];
    }

    function normalizeMilestones(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function loadStudyData() {
        return normalizeStudyData(readPrimary(KEYS.study, 'study', {}, value => value && typeof value === 'object' &&
            !Array.isArray(value)));
    }

    function loadSessions() {
        return normalizeSessions(readPrimary(KEYS.sessions, 'sessions', [], Array.isArray));
    }

    function loadMilestones() {
        return normalizeMilestones(readPrimary(KEYS.milestones, 'milestones', {}, value => value &&
            typeof value === 'object' && !Array.isArray(value)));
    }

    function loadProjects() {
        return normalizeProjects(readPrimary(KEYS.projects, 'projects', DEFAULT_PROJECTS, Array.isArray));
    }

    function saveProjects(value) {
        tryDailyBackup();
        writeJson(KEYS.projects, normalizeProjects(value));
    }

    function currentBundle() {
        return {
            format: 'kaoyan-study-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            study: loadStudyData(),
            sessions: loadSessions(),
            milestones: loadMilestones(),
            projects: loadProjects()
        };
    }

    function ensureDailyBackup() {
        const today = localDateKey();
        if (localStorage.getItem(KEYS.backupDate) === today) return;
        writeJson(KEYS.autoBackup, currentBundle());
        localStorage.setItem(KEYS.backupDate, today);
    }

    function tryDailyBackup() {
        try {
            ensureDailyBackup();
        } catch (error) {
            console.warn('自动安全副本创建失败，将继续保存当前数据', error);
        }
    }

    function saveStudyData(value) {
        tryDailyBackup();
        writeJson(KEYS.study, normalizeStudyData(value));
    }

    function saveSessions(value) {
        tryDailyBackup();
        writeJson(KEYS.sessions, normalizeSessions(value));
    }

    function saveMilestones(value) {
        tryDailyBackup();
        writeJson(KEYS.milestones, normalizeMilestones(value));
    }

    function loadTimerState() {
        return readJson(KEYS.timer, null);
    }

    function saveTimerState(value) {
        writeJson(KEYS.timer, value);
    }

    function clearTimerState() {
        localStorage.removeItem(KEYS.timer);
    }

    function validateBundle(value) {
        if (!value || value.format !== 'kaoyan-study-backup' || value.version !== 1) {
            throw new Error('不是受支持的考研看板备份文件');
        }
        if (!value.study || typeof value.study !== 'object' || Array.isArray(value.study) ||
            !Array.isArray(value.sessions) || !value.milestones || typeof value.milestones !== 'object') {
            throw new Error('备份文件内容不完整');
        }
        if (value.projects !== undefined && !Array.isArray(value.projects)) throw new Error('项目配置无效');
        return {
            study: normalizeStudyData(value.study),
            sessions: normalizeSessions(value.sessions),
            milestones: normalizeMilestones(value.milestones),
            projects: normalizeProjects(value.projects)
        };
    }

    function importBundle(value) {
        const incoming = validateBundle(value);
        const beforeImport = currentBundle();
        writeJson(KEYS.autoBackup, beforeImport);
        try {
            writeJson(KEYS.study, incoming.study);
            writeJson(KEYS.sessions, incoming.sessions);
            writeJson(KEYS.milestones, incoming.milestones);
            writeJson(KEYS.projects, incoming.projects);
            localStorage.setItem(KEYS.backupDate, localDateKey());
        } catch (error) {
            writeJson(KEYS.study, beforeImport.study);
            writeJson(KEYS.sessions, beforeImport.sessions);
            writeJson(KEYS.milestones, beforeImport.milestones);
            writeJson(KEYS.projects, beforeImport.projects);
            throw error;
        }
    }

    function hasAutoBackup() {
        return localStorage.getItem(KEYS.autoBackup) !== null;
    }

    function restoreAutoBackup() {
        const backup = readJson(KEYS.autoBackup, null);
        if (!backup) throw new Error('没有可恢复的安全副本');
        importBundle(backup);
    }

    function downloadBackup() {
        const blob = new Blob([JSON.stringify(currentBundle(), null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = '考研学习数据-' + localDateKey() + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    window.KaoyanStorage = {
        loadStudyData,
        saveStudyData,
        loadSessions,
        saveSessions,
        loadMilestones,
        saveMilestones,
        loadProjects,
        saveProjects,
        loadTimerState,
        saveTimerState,
        clearTimerState,
        downloadBackup,
        importBundle,
        hasAutoBackup,
        restoreAutoBackup
    };
})();
