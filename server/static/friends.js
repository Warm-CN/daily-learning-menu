const list = document.getElementById('friendList');
const query = document.getElementById('friendQuery');
const avatars = ['🐼', '🦊', '🐰', '🐯', '🐨', '🐧', '🦁', '🐸', '🦄', '🐳', '🦉', '🐙'];
const palettes = [
    ['#4f8cf7', '#eef4ff'],
    ['#ff6b5e', '#fff1ef'],
    ['#34b878', '#eafaf3'],
    ['#b58ddb', '#f6f0fb'],
    ['#f5a623', '#fef8ef'],
    ['#28a9b7', '#eaf9fb'],
];

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}

function hash(value) {
    return [...String(value)].reduce((total, character) => ((total * 31) + character.codePointAt(0)) >>> 0, 7);
}

function duration(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    if (!hours) return `${minutes}分钟`;
    return minutes ? `${hours}小时 ${minutes}分钟` : `${hours}小时`;
}

function achievement(seconds) {
    const hours = (Number(seconds) || 0) / 3600;
    if (hours >= 8) return ['🏆', '今日卷王'];
    if (hours >= 6) return ['🔥', '专注达人'];
    if (hours >= 3) return ['🚀', '高效推进'];
    if (hours >= 1) return ['🌱', '渐入佳境'];
    if (hours > 0) return ['✨', '今天已出发'];
    return ['☕', '等待开局'];
}

function lastSeen(value) {
    if (!value) return '暂无在线记录';
    const seen = new Date(value);
    if (Number.isNaN(seen.getTime())) return '暂无在线记录';
    const now = new Date();
    const elapsed = Math.max(0, now.getTime() - seen.getTime());
    if (elapsed < 60 * 1000) return '刚刚';
    if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / 60000)}分钟前`;

    const time = seen.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const seenDay = new Date(seen.getFullYear(), seen.getMonth(), seen.getDate());
    const dayDifference = Math.round((today - seenDay) / 86400000);
    if (dayDifference === 0) return `今天 ${time}`;
    if (dayDifference === 1) return `昨天 ${time}`;
    if (seen.getFullYear() === now.getFullYear()) return `${seen.getMonth() + 1}月${seen.getDate()}日 ${time}`;
    return `${seen.getFullYear()}年${seen.getMonth() + 1}月${seen.getDate()}日 ${time}`;
}

function friendCard(friend) {
    const identityHash = hash(friend.username);
    const avatar = avatars[identityHash % avatars.length];
    const [color, soft] = palettes[identityHash % palettes.length];
    const todaySeconds = Number(friend.todaySeconds) || 0;
    const progress = Math.min(100, Math.round(todaySeconds / (8 * 3600) * 100));
    const [achievementIcon, achievementText] = achievement(todaySeconds);
    const timer = friend.timer;

    let stateClass = 'offline';
    let stateLabel = '离线';
    let focusText = `上次在线 · ${lastSeen(friend.lastSeenAt)}`;
    if (friend.online && timer?.phase === 'running') {
        stateClass = 'studying';
        stateLabel = '专注中';
        focusText = `${timer.projectName} · 已专注 ${duration(timer.elapsedSeconds)}`;
    } else if (friend.online && timer) {
        stateClass = 'paused';
        stateLabel = '休息中';
        focusText = `${timer.projectName} · 暂停片刻`;
    } else if (friend.online) {
        stateClass = 'online';
        stateLabel = '在线';
        focusText = '在线空闲，随时准备开始';
    }

    return `<article class="friend-card ${stateClass}" style="--friend-color:${color};--friend-soft:${soft}">
        <div class="friend-head">
            <div class="friend-avatar">${avatar}<span class="presence ${friend.online ? 'online' : ''}"></span></div>
            <div class="friend-identity"><h3>${escapeHtml(friend.username)}</h3><span class="status-badge ${stateClass}">${stateLabel}</span></div>
            <button class="remove" data-id="${friend.id}" aria-label="删除好友 ${escapeHtml(friend.username)}" title="删除好友">×</button>
        </div>
        <div class="friend-focus"><span>${stateClass === 'studying' ? '⏱️' : stateClass === 'paused' ? '🌿' : friend.online ? '👋' : '🌙'}</span><p>${escapeHtml(focusText)}</p></div>
        <div class="friend-progress-head"><span>今日学习</span><strong>${duration(todaySeconds)}</strong></div>
        <div class="friend-progress" aria-label="8 小时目标完成 ${progress}%"><i style="width:${progress}%"></i></div>
        <div class="friend-footer"><span>${achievementIcon} ${achievementText}</span><span>${Math.round(todaySeconds / 360) / 10} / 8h</span></div>
    </article>`;
}

async function loadFriends() {
    try {
        const friends = await apiFetch('/api/friends/status');
        list.innerHTML = friends.length
            ? friends.map(friendCard).join('')
            : '<div class="friends-empty"><span>🪴</span><h3>好友位还是空的</h3><p>添加一位研友，互相看见每一天的坚持。</p></div>';
        document.querySelectorAll('.remove').forEach(button => {
            button.onclick = async () => {
                if (!confirm('确定删除这位好友吗？')) return;
                try {
                    await apiFetch(`/api/friends/${button.dataset.id}`, { method: 'DELETE' });
                    await loadFriends();
                } catch (error) {
                    toast(error.message);
                }
            };
        });
    } catch (error) {
        toast(error.message);
    }
}

document.getElementById('addFriend').onclick = async () => {
    const username = query.value.trim();
    if (!username) return;
    try {
        await apiFetch('/api/friends/add', { method: 'POST', body: { username } });
        query.value = '';
        await loadFriends();
        toast('好友已添加');
    } catch (error) {
        toast(error.message);
    }
};

let searchTimer;
query.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
        const box = document.getElementById('searchResults');
        const searchQuery = query.value.trim();
        if (!searchQuery) {
            box.innerHTML = '';
            return;
        }
        try {
            const users = await apiFetch(`/api/friends/search?q=${encodeURIComponent(searchQuery)}`);
            box.innerHTML = users.map(user => `<button class="search-user" data-name="${escapeHtml(user.username)}">${escapeHtml(user.username)}</button>`).join('');
            document.querySelectorAll('.search-user').forEach(button => {
                button.onclick = () => {
                    query.value = button.dataset.name;
                    box.innerHTML = '';
                };
            });
        } catch {
            box.innerHTML = '';
        }
    }, 250);
};

let friendTimer = setInterval(loadFriends, 15000);
document.addEventListener('visibilitychange', () => {
    clearInterval(friendTimer);
    friendTimer = setInterval(loadFriends, document.hidden ? 60000 : 15000);
    if (!document.hidden) loadFriends();
});
loadFriends();
