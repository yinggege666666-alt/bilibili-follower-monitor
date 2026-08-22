# B站粉丝小时监控

一个本地运行的网页，用来按小时记录 B站账号的粉丝数。你只要输入账号 UID，
页面会立即读取当前粉丝数，之后只要这个本地服务保持运行，就会每小时自动记录
一个快照，并同步到 GitHub Pages 供其他电脑查看。

## 为什么没有直接复用 GitHub 项目

我搜索了 GitHub，最接近的是
`MightyOwls/bilibili-followers-monitor`。它也是本地 Python + SQLite + 网页，
但记录粒度是“每天”，并且重点是粉丝名单差分和关注/取关事件。为了满足“按小时”
这个需求，本项目复用了它已验证过的 B站公开接口思路，但改成零依赖的小时级快照
工具。

## 文件说明

- `app.py`：本地服务和 B站接口请求逻辑
- `web/index.html`：网页结构
- `web/styles.css`：网页样式
- `web/app.js`：网页交互和趋势图
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

本地网页添加或删除 UID 后，会自动更新仓库里的 `config.json` 和
`docs/data.json`，并推送到 GitHub。GitHub Actions 也会按同样的小时和每日
节奏采集数据。

可覆盖参数：

```powershell
python app.py --port 9000 --interval 1800
```

## 说明

程序使用 Bilibili 当前网页使用的公开关系接口读取粉丝总数。该接口未在开放平台
承诺长期稳定，可能因为风控、改版或账号隐私设置而变化。建议仅用于你本人拥有
或获授权管理的账号，并保持低频访问。
