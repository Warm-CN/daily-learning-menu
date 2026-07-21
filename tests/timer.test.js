'use strict';

const assert = require('node:assert/strict');
global.window = global;
require('../js/timer.js');

const Timer = global.KaoyanTimer;
const now = new Date(2026, 6, 20, 12, 0, 0).getTime();
const state = Timer.normalizeState({
    version: 2,
    sessionId: 'session-1',
    sessionStartedAt: now - 15000,
    subj: 'math',
    mode: 'countup',
    cdMin: 25,
    phase: 'running',
    startTime: now - 5000,
    elapsedBefore: 10,
    segments: [[now - 15000, now - 5000]]
});

assert.equal(Timer.elapsedSeconds(state, now), 15);
assert.deepEqual(Timer.collectSegments(state, now, 12), [
    [now - 15000, now - 5000],
    [now - 5000, now - 3000]
]);

const midnight = new Date(2026, 6, 21, 0, 0, 0).getTime();
const split = Timer.splitByLocalDay([[midnight - 1500, midnight + 2500]]);
assert.equal(Object.values(split).reduce((sum, value) => sum + value, 0), 4);
assert.equal(Object.keys(split).length, 2);

const legacyCountdown = Timer.normalizeState({
    subj: 'english', mode: 'countdown', cdMin: 25, running: false, paused: true,
    startTime: null, elapsedBefore: 1200
});
assert.equal(legacyCountdown.elapsedBefore, 300);
assert.equal(legacyCountdown.segments.length, 1);

const study = {};
assert.equal(Timer.applySessionCredit(study, 'same-session', 'math', { '2026-07-20': 600 }, 600, now), true);
assert.equal(Timer.applySessionCredit(study, 'same-session', 'math', { '2026-07-20': 600 }, 600, now), false);
assert.equal(study['2026-07-20'].math, 600);
assert.equal(Timer.applySessionCredit(study, 'custom-session', 'project_network', { '2026-07-20': 300 }, 300, now), true);
assert.equal(study['2026-07-20'].project_network, 300);

console.log('timer tests passed');
