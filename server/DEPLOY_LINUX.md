# Linux 服务器部署指南

本文以 Ubuntu 22.04/24.04、域名 `study.example.com` 和安装目录 `/opt/kaoyan` 为例。最终结构为：

```text
/opt/kaoyan/
├── server/
│   ├── .venv/
│   ├── .env
│   ├── instance/kaoyan.db
│   └── ...
├── css/
├── js/
└── ...
```

部署前需要：一台能用 SSH 登录的 Linux 服务器、一个 GitHub 仓库，以及已经解析到服务器公网 IP 的域名。以下命令中的域名和仓库地址必须替换成自己的值。

## 1. 上传到 GitHub

在本地项目根目录检查即将提交的内容：

```bash
git status --short
git status --short --ignored
```

确认以下内容没有出现在待提交文件中：

- `server/.env`
- `server/.venv/`
- `server/instance/`
- `server/backups/`
- `*.db`、`*.db-wal`、`*.db-shm`

`server/.env.example` 和两个 `tests/` 目录应当出现在可提交文件中。然后执行：

```bash
git add .
git commit -m "Add Flask server version"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

如果已经配置过 `origin`，不要再次执行 `git remote add`，改用 `git remote -v` 检查地址。

## 2. 安装系统依赖

登录服务器后执行：

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip nginx sqlite3 certbot python3-certbot-nginx
```

如果启用了 UFW，先保留 SSH，再开放网站端口：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 3. 创建运行用户并拉取代码

创建一个不能直接登录的系统用户：

```bash
sudo useradd --system --home /opt/kaoyan --shell /usr/sbin/nologin kaoyan
sudo mkdir -p /opt/kaoyan
sudo chown "$USER":"$USER" /opt/kaoyan
git clone https://github.com/你的用户名/你的仓库.git /opt/kaoyan
sudo chown -R kaoyan:kaoyan /opt/kaoyan
```

私有仓库建议在服务器配置只读 Deploy Key，然后使用 SSH 仓库地址克隆，不要把 GitHub Token 写入脚本或 `.env`。

## 4. 创建 Python 环境

```bash
sudo -u kaoyan python3 -m venv /opt/kaoyan/server/.venv
sudo -u kaoyan /opt/kaoyan/server/.venv/bin/pip install --upgrade pip
sudo -u kaoyan /opt/kaoyan/server/.venv/bin/pip install -r /opt/kaoyan/server/requirements.txt
```

## 5. 配置环境变量

复制模板并生成随机密钥：

```bash
sudo -u kaoyan cp /opt/kaoyan/server/.env.example /opt/kaoyan/server/.env
openssl rand -hex 32
sudo nano /opt/kaoyan/server/.env
```

将文件修改为：

```dotenv
SECRET_KEY=粘贴刚才生成的随机字符串
DATABASE_URL=sqlite:////opt/kaoyan/server/instance/kaoyan.db
COOKIE_SECURE=1
APP_TIMEZONE=Asia/Shanghai
RATELIMIT_STORAGE_URI=memory://
```

限制密钥文件权限：

```bash
sudo chown kaoyan:kaoyan /opt/kaoyan/server/.env
sudo chmod 600 /opt/kaoyan/server/.env
```

不要将生产 `.env` 提交到 GitHub。

## 6. 初始化数据库

```bash
sudo -u kaoyan bash -c 'cd /opt/kaoyan/server && .venv/bin/flask --app app:app init-db'
```

确认数据库已生成且归属正确：

```bash
sudo ls -l /opt/kaoyan/server/instance/kaoyan.db
```

## 7. 安装 systemd 服务

仓库中的服务文件已经使用 `/opt/kaoyan/server` 和 `kaoyan` 用户：

```bash
sudo cp /opt/kaoyan/server/deploy/kaoyan.service /etc/systemd/system/
sudo cp /opt/kaoyan/server/deploy/kaoyan-backup.service /etc/systemd/system/
sudo cp /opt/kaoyan/server/deploy/kaoyan-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kaoyan.service
sudo systemctl enable --now kaoyan-backup.timer
```

检查应用是否正常：

```bash
sudo systemctl status kaoyan.service --no-pager
curl http://127.0.0.1:8000/health
```

健康检查应返回包含 `"status":"ok"` 的 JSON。

Gunicorn 使用一个 worker 和四个线程，这是本项目小规模 SQLite 部署的预期配置；不要擅自增加多个 worker。

## 8. 配置 Nginx

复制模板并替换域名：

```bash
sudo cp /opt/kaoyan/server/deploy/nginx.conf /etc/nginx/sites-available/kaoyan
sudo sed -i 's/study\.example\.com/你的域名/g' /etc/nginx/sites-available/kaoyan
sudo ln -s /etc/nginx/sites-available/kaoyan /etc/nginx/sites-enabled/kaoyan
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

此时可先访问 `http://你的域名/health` 验证 Nginx 代理。

## 9. 启用 HTTPS

```bash
sudo certbot --nginx -d 你的域名 --redirect
```

Certbot 会修改 Nginx 配置、安装证书并把 HTTP 重定向到 HTTPS。完成后检查：

```bash
curl https://你的域名/health
sudo certbot renew --dry-run
```

生产环境配置了 `COOKIE_SECURE=1`，因此必须使用 HTTPS 登录；直接用 HTTP 访问时登录 Cookie 不会生效。

## 10. 验证网站

浏览器打开：

```text
https://你的域名/register
```

建议依次验证：

1. 注册两个测试账号。
2. 用其中一个账号添加另一个账号为好友。
3. 开始计时，确认另一账号能看到在线和学习状态。
4. 停止计时，确认好友今日时长和个人统计更新。
5. 从原本地版导出 JSON，在服务器版统计页测试导入。

## 11. 数据库备份

备份定时器每天 03:30 执行，使用 SQLite 在线备份接口并保留最近 7 份：

```bash
systemctl list-timers kaoyan-backup.timer
sudo systemctl start kaoyan-backup.service
sudo journalctl -u kaoyan-backup.service -n 50 --no-pager
sudo ls -lh /opt/kaoyan/server/backups/
```

建议额外把备份目录同步到另一台机器或对象存储；同一块磁盘上的备份不能防止磁盘损坏。

### 从数据库备份恢复

先停止应用，再替换数据库，避免 WAL 中仍有未合并的数据：

```bash
sudo systemctl stop kaoyan.service
sudo cp /opt/kaoyan/server/instance/kaoyan.db /opt/kaoyan/server/instance/kaoyan-before-restore.db
sudo cp /opt/kaoyan/server/backups/你选择的备份.db /opt/kaoyan/server/instance/kaoyan.db
sudo rm -f /opt/kaoyan/server/instance/kaoyan.db-wal /opt/kaoyan/server/instance/kaoyan.db-shm
sudo chown kaoyan:kaoyan /opt/kaoyan/server/instance/kaoyan.db
sudo systemctl start kaoyan.service
curl https://你的域名/health
```

## 12. 更新版本

```bash
sudo systemctl stop kaoyan.service
sudo -u kaoyan git -C /opt/kaoyan pull --ff-only
sudo -u kaoyan /opt/kaoyan/server/.venv/bin/pip install -r /opt/kaoyan/server/requirements.txt
sudo -u kaoyan bash -c 'cd /opt/kaoyan/server && .venv/bin/flask --app app:app init-db'
sudo systemctl start kaoyan.service
sudo systemctl status kaoyan.service --no-pager
```

当前版本使用 `db.create_all()` 初始化新表。将来如果修改已有表字段，应先加入数据库迁移工具和迁移脚本，不要直接删除生产数据库重建。

## 13. 常用维护命令

查看实时日志：

```bash
sudo journalctl -u kaoyan.service -f
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

重置用户密码：

```bash
sudo -u kaoyan bash -c 'cd /opt/kaoyan/server && .venv/bin/flask --app app:app reset-password 用户名'
```

重启和检查服务：

```bash
sudo systemctl restart kaoyan.service
sudo systemctl status kaoyan.service --no-pager
sudo nginx -t
```

## 14. 常见故障

- **Nginx 返回 502**：运行 `journalctl -u kaoyan.service -n 100`，检查 Gunicorn 是否启动以及 `127.0.0.1:8000` 是否监听。
- **登录后仍回到登录页**：确认使用 HTTPS、`.env` 中 `COOKIE_SECURE=1`，并检查系统时间是否准确。
- **数据库只读或无法打开**：确认 `server/instance/` 和数据库归 `kaoyan:kaoyan` 所有。
- **SQLite database is locked**：确认只启动了一个 Gunicorn worker，没有重复启动第二个应用实例。
- **好友很快显示离线**：检查浏览器是否限制后台页面、服务器时间是否正确；60 秒没有心跳会判定离线。
- **Git 拉取失败**：检查仓库权限和 Deploy Key，不要把个人 Token 写入代码仓库。
