# 考研看板服务器版

服务器版使用 Flask、SQLite 和普通 HTTP 轮询实现账号同步与好友状态。现有本地版不受影响。

## 本地启动

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
$env:FLASK_APP="app:app"
.venv\Scripts\flask init-db
.venv\Scripts\flask run --debug
```

打开 `http://127.0.0.1:5000/register` 注册账号。开发环境允许 HTTP Cookie；生产环境必须设置 `COOKIE_SECURE=1` 并启用 HTTPS。

## Linux 部署

完整的从零部署、HTTPS、备份、升级和故障排查步骤见 [DEPLOY_LINUX.md](DEPLOY_LINUX.md)。下面仅保留快速概要。

1. 将 `server/` 放到 `/opt/kaoyan/server`，创建 `kaoyan` 系统用户和 Python 虚拟环境。
2. 复制 `.env.example` 为 `.env`，生成随机密钥：

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

3. 安装依赖并初始化数据库：

   ```bash
   .venv/bin/pip install -r requirements.txt
   FLASK_APP=app:app .venv/bin/flask init-db
   ```

4. 修改 `deploy/nginx.conf` 中的域名和证书路径，将 systemd 文件复制到 `/etc/systemd/system/`。
5. 启动服务和每日备份：

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now kaoyan.service kaoyan-backup.timer
   ```

Gunicorn 固定使用一个 worker、四个线程，默认监听 `127.0.0.1:8010`，以适配小规模 SQLite 写入并避免占用公网 80/443 端口。SQLite 已启用 WAL、外键和 5 秒 busy timeout。

## 管理命令

```bash
FLASK_APP=app:app .venv/bin/flask reset-password 用户名
.venv/bin/python backup_db.py
curl https://你的域名/health
```

数据库默认位于 `instance/kaoyan.db`。备份脚本使用 SQLite 在线备份接口，默认保存到 `backups/` 并保留最近 7 份。

## 数据迁移

在原本地版统计页导出 JSON，登录服务器版后在“统计”页选择“导入备份”。导入前的云端数据会保留为一个可恢复快照。

## 测试

```bash
.venv/bin/python -m pytest tests -q
node --check static/dashboard.js
node --check static/friends.js
```
