'use strict';

const passwordDialog = document.getElementById('temporaryPasswordDialog');
const passwordValue = document.getElementById('temporaryPassword');
const passwordUsername = document.getElementById('passwordUsername');

async function runAdminAction(button) {
    const userId = button.dataset.userId;
    const username = button.dataset.username;
    const action = button.dataset.adminAction;
    let method = 'POST';
    let url = `/api/admin/users/${userId}/${action === 'reset' ? 'reset-password' : 'approve'}`;

    if (action === 'approve' && !confirm(`批准 ${username} 成为正式用户吗？`)) return;
    if (action === 'reset' && !confirm(`为 ${username} 生成新的随机临时密码吗？其旧登录会立即失效。`)) return;
    if (action === 'delete') {
        const confirmation = prompt(`此操作会永久删除 ${username} 及其全部学习数据。\n请输入用户名确认：`);
        if (confirmation !== username) {
            if (confirmation !== null) toast('用户名不匹配，已取消删除');
            return;
        }
        method = 'DELETE';
        url = `/api/admin/users/${userId}`;
    }

    button.disabled = true;
    try {
        const result = await apiFetch(url, { method });
        if (action === 'reset') {
            passwordUsername.textContent = result.username;
            passwordValue.textContent = result.temporaryPassword;
            passwordDialog.showModal();
            button.disabled = false;
            return;
        }
        location.reload();
    } catch (error) {
        button.disabled = false;
        toast(error.message);
    }
}

document.querySelectorAll('[data-admin-action]').forEach(button => {
    button.addEventListener('click', () => runAdminAction(button));
});

document.getElementById('copyTemporaryPassword').addEventListener('click', async () => {
    const value = passwordValue.textContent;
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(passwordValue);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
    }
    toast('临时密码已复制');
});

passwordDialog.addEventListener('close', () => {
    passwordValue.textContent = '';
    passwordUsername.textContent = '';
});
