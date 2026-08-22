# B站粉丝小时监控

一个 B站账号粉丝数监控网页，支持按小时持续记录多个 UID。数据由
GitHub Actions 定时采集并提交到仓库，GitHub Pages 展示，不需要本地电脑
一直开机。本地也可以运行同一个监控服务，实时添加账号并立即读取粉丝数。

## 为什么没有直接复用 GitHub 项目

我搜索了 GitHub，最接近的是
`MightyOwls/bilibili-followers-monitor`。它也是本地 Python + SQLite + 网页，
但记录粒度是“每天”，并且重点是粉丝名单差分和关注/取关事件。为了满足“按小时”
这个需求，本项目复用了它已验证过的 B站公开接口思路，但改成零依赖的小时级快照
工具。

## 文件说明

- `app.py`：本地服务和 B站接口请求逻辑
- `web/`：本地网页
- `docs/`：GitHub Pages 展示页面
- `data/followers.sqlite3`：运行后自动生成的本地数据库
- `.github/workflows/collect.yml`：GitHub Actions 定时采集与发布

## 启动

在项目目录打开 PowerShell：

```powershell
python app.py
```

如果系统没有把 Python 加入 PATH，可以直接双击：

```text
启动监控.cmd
```

启动后浏览器会自动打开：

```text
http://127.0.0.1:8765/
```

关闭命令窗口或按 `Ctrl+C` 会停止服务。服务停止期间不会继续记录。

## 使用

1. 在“B站 UID”输入账号 UID。
2. 备注名可留空，程序会尝试自动读取账号昵称。
3. 点击“添加并记录”。
4. 页面会显示当前粉丝数、小时变化、24 小时变化，以及两张折线图：
   - 小时新增
   - 总粉丝（天）

“立即记录”会把当前小时的数据刷新一次；“记录全部”会刷新所有已添加账号。

## 默认参数

- 监听地址：`127.0.0.1`
- 端口：`8765`
- 小时快照：每小时的 `10` 分左右自动记录
- 每日快照：每天 `00:30` 自动记录
- 数据库：`data/followers.sqlite3`

## GitHub 发布

公开页面：

```text
https://yinggege666666-alt.github.io/bilibili-follower-monitor/
```

公开页面中的“管理账号”会直接更新仓库里的 `config.json`，再触发一次采集任务。
GitHub Actions 按同样的小时和每日节奏采集数据。首次在公开页面管理账号前，
需要先粘贴一个具备 `Contents` 和 `Workflows` 权限的仓库级 Personal Access
Token；令牌只保存在当前浏览器。

GitHub 仓库设置里还需要把 Pages 的 Source 选为 **GitHub Actions**，这样
每次采集后页面才会自动发布。

定时任务的 cron 使用 UTC 时间。当前配置对应北京时间：

- 每小时 `10` 分左右采集一次小时快照
- 每天 `00:30` 采集一次天快照

可覆盖参数：

```powershell
python app.py --port 9000 --interval 1800
```

## 说明

程序使用 Bilibili 当前网页使用的公开关系接口读取粉丝总数。该接口未在开放平台
承诺长期稳定，可能因为风控、改版或账号隐私设置而变化。建议仅用于你本人拥有
或获授权管理的账号，并保持低频访问。
