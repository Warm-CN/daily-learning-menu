'use strict';

const assert = require('node:assert/strict');

class MemoryStorage {
    constructor() { this.data = new Map(); }
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
    setItem(key, value) { this.data.set(key, String(value)); }
    removeItem(key) { this.data.delete(key); }
}

global.window = global;
global.localStorage = new MemoryStorage();
require('../js/storage.js');

const Storage = global.KaoyanStorage;
Storage.saveStudyData({
    '2026-07-20': { math: 90.4, english: -10, politics: 0, professional: 12, project_network: 45,
        energy: 120, notes: '测试' },
    invalid: { math: 999 }
});
const study = Storage.loadStudyData();
assert.equal(study['2026-07-20'].math, 90);
assert.equal(study['2026-07-20'].english, 0);
assert.equal(study['2026-07-20'].energy, 100);
assert.equal(study['2026-07-20'].project_network, 45);
assert.equal(study.invalid, undefined);
Storage.saveProjects([
    { id: 'notes', name: '保留字段', color: '#000000', archived: false },
    { id: 'project_os', name: '操作系统', color: '#abcdef', icon: '💻', archived: true }
]);
assert.equal(Storage.loadProjects().length, 1);
assert.equal(Storage.loadProjects()[0].id, 'project_os');
assert.equal(Storage.loadProjects()[0].archived, false);

Storage.importBundle({
    format: 'kaoyan-study-backup', version: 1,
    study: { '2026-07-19': { math: 60, project_network: 30 } }, sessions: [], milestones: {},
    projects: [{ id: 'project_network', name: '计算机网络', color: '#123456', icon: '🌐', archived: false }]
});
assert.equal(Storage.loadStudyData()['2026-07-19'].math, 60);
assert.equal(Storage.loadProjects()[0].name, '计算机网络');
assert.ok(localStorage.getItem('kaoyan_auto_backup_v3'));
assert.equal(Storage.hasAutoBackup(), true);
Storage.restoreAutoBackup();
assert.equal(Storage.loadStudyData()['2026-07-20'].math, 90);

localStorage.setItem('kaoyan_study_v3', '{broken-json');
assert.equal(Storage.loadStudyData()['2026-07-19'].math, 60);

assert.throws(() => Storage.importBundle({ format: 'kaoyan-study-backup', version: 1, study: {}, sessions: null,
    milestones: {} }), /内容不完整/);

console.log('storage tests passed');
