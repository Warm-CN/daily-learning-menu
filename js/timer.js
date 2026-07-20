(function() {
    'use strict';

    function validSubject(value) {
        return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
            !['energy', 'notes'].includes(value);
    }

    function createSessionId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function normalizeState(value) {
        if (!value || typeof value !== 'object') return null;
        const mode = value.mode === 'countdown' ? 'countdown' : 'countup';
        const subject = validSubject(value.subj) ? value.subj : 'math';
        const cdMin = Number(value.cdMin);
        const normalizedCdMin = Number.isFinite(cdMin) && cdMin >= 1 && cdMin <= 300 ? cdMin : 25;
        let elapsedBefore = Number(value.elapsedBefore);
        if (value.version !== 2 && mode === 'countdown' && Number.isFinite(elapsedBefore)) {
            elapsedBefore = Math.max(0, normalizedCdMin * 60 - elapsedBefore);
        }
        const phase = value.phase || (value.running ? 'running' : value.paused ? 'paused' : 'idle');
        if (!['running', 'paused'].includes(phase) || !Number.isFinite(elapsedBefore) || elapsedBefore < 0) return null;
        if (phase === 'running' && (!Number.isFinite(value.startTime) || value.startTime <= 0)) return null;
        const segments = Array.isArray(value.segments) ? value.segments.filter(validSegment).map(pair => [pair[0], pair[1]]) : [];
        const sessionStartedAt = Number.isFinite(value.sessionStartedAt) ? value.sessionStartedAt :
            (Number.isFinite(value.startTime) ? value.startTime - elapsedBefore * 1000 : Date.now() - elapsedBefore * 1000);
        if (value.version !== 2 && segments.length === 0 && elapsedBefore > 0) {
            segments.push([sessionStartedAt, sessionStartedAt + elapsedBefore * 1000]);
        }
        return {
            version: 2,
            sessionId: typeof value.sessionId === 'string' && value.sessionId ? value.sessionId : createSessionId(),
            sessionStartedAt,
            subj: subject,
            mode,
            cdMin: normalizedCdMin,
            phase,
            startTime: phase === 'running' ? value.startTime : null,
            elapsedBefore,
            segments
        };
    }

    function validSegment(pair) {
        return Array.isArray(pair) && pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]) &&
            pair[1] >= pair[0];
    }

    function elapsedSeconds(state, now = Date.now()) {
        const current = state.phase === 'running' ? Math.max(0, (now - state.startTime) / 1000) : 0;
        return Math.max(0, state.elapsedBefore + current);
    }

    function collectSegments(state, endedAt = Date.now(), limitSeconds = Infinity) {
        const segments = state.segments.filter(validSegment).map(pair => [pair[0], pair[1]]);
        if (state.phase === 'running' && Number.isFinite(state.startTime)) {
            segments.push([state.startTime, Math.max(state.startTime, endedAt)]);
        }
        let remainingMs = Math.max(0, limitSeconds * 1000);
        const clipped = [];
        for (const [start, end] of segments) {
            if (remainingMs <= 0) break;
            const duration = Math.max(0, end - start);
            const used = Math.min(duration, remainingMs);
            if (used > 0) clipped.push([start, start + used]);
            remainingMs -= used;
        }
        return clipped;
    }

    function localDateKey(timestamp) {
        const date = new Date(timestamp);
        const p2 = value => String(value).padStart(2, '0');
        return date.getFullYear() + '-' + p2(date.getMonth() + 1) + '-' + p2(date.getDate());
    }

    function splitByLocalDay(segments) {
        const milliseconds = {};
        segments.forEach(([segmentStart, segmentEnd]) => {
            let cursor = segmentStart;
            while (cursor < segmentEnd) {
                const date = new Date(cursor);
                const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
                const boundary = Math.min(segmentEnd, nextMidnight);
                const key = localDateKey(cursor);
                milliseconds[key] = (milliseconds[key] || 0) + (boundary - cursor);
                cursor = boundary;
            }
        });
        const entries = Object.entries(milliseconds).map(([key, value]) => ({ key, seconds: Math.floor(value / 1000),
            fraction: value % 1000 }));
        const targetSeconds = Math.round(Object.values(milliseconds).reduce((sum, value) => sum + value, 0) / 1000);
        let missing = targetSeconds - entries.reduce((sum, entry) => sum + entry.seconds, 0);
        entries.sort((a, b) => b.fraction - a.fraction);
        for (let index = 0; index < entries.length && missing > 0; index++, missing--) entries[index].seconds++;
        const result = {};
        entries.forEach(entry => result[entry.key] = entry.seconds);
        return result;
    }

    function applySessionCredit(studyData, sessionId, subject, secondsByDay, earnedSeconds, committedAt) {
        if (!studyData || typeof studyData !== 'object' || !sessionId || !validSubject(subject)) return false;
        if (!studyData._meta) studyData._meta = { creditedSessions: {} };
        if (!studyData._meta.creditedSessions) studyData._meta.creditedSessions = {};
        if (studyData._meta.creditedSessions[sessionId]) return false;
        Object.entries(secondsByDay).forEach(([key, value]) => {
            const seconds = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
            if (!seconds) return;
            const day = studyData[key] || { energy: 0, notes: '' };
            day[subject] = (day[subject] || 0) + seconds;
            studyData[key] = day;
        });
        studyData._meta.creditedSessions[sessionId] = { subject, seconds: Math.round(earnedSeconds), committedAt };
        return true;
    }

    window.KaoyanTimer = {
        createSessionId,
        normalizeState,
        elapsedSeconds,
        collectSegments,
        splitByLocalDay,
        applySessionCredit
    };
})();
