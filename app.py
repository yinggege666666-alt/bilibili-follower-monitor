from __future__ import annotations

import argparse
import base64
import json
import sqlite3
import subprocess
import threading
import time
import webbrowser
from contextlib import closing
from datetime import datetime, timezone
from functools import partial
from hashlib import md5
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


API_BASE = "https://api.bilibili.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)
WBI_MIXIN_KEY_ORDER = (
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
)
LOCAL_TIMEZONE = ZoneInfo("Asia/Shanghai")


SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    uid INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follower_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_uid INTEGER NOT NULL
        REFERENCES accounts(uid) ON DELETE CASCADE,
    collected_at TEXT NOT NULL,
    collected_hour TEXT NOT NULL,
    follower_count INTEGER NOT NULL,
    UNIQUE (account_uid, collected_hour)
);

CREATE TABLE IF NOT EXISTS daily_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_uid INTEGER NOT NULL
        REFERENCES accounts(uid) ON DELETE CASCADE,
    collected_at TEXT NOT NULL,
    collected_date TEXT NOT NULL,
    follower_count INTEGER NOT NULL,
    UNIQUE (account_uid, collected_date)
);

CREATE INDEX IF NOT EXISTS idx_history_account_hour
ON follower_history(account_uid, collected_hour);

CREATE INDEX IF NOT EXISTS idx_daily_history_account_date
ON daily_history(account_uid, collected_date);
"""


class BilibiliAPIError(RuntimeError):
    def __init__(self, code: int | None, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class BilibiliClient:
    def __init__(self, timeout_seconds: float = 20.0) -> None:
        self.timeout_seconds = timeout_seconds
        self._mixin_key: str | None = None

    def _request_json(self, url: str, referer: str) -> dict[str, Any]:
        request = Request(
            url,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": referer,
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = response.read().decode("utf-8")
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise BilibiliAPIError(
                error.code, f"HTTP {error.code}: {body[:160]}"
            ) from error
        except URLError as error:
            raise BilibiliAPIError(None, f"网络请求失败：{error.reason}") from error

        try:
            data = json.loads(payload)
        except json.JSONDecodeError as error:
            raise BilibiliAPIError(None, "Bilibili 返回了无法解析的数据") from error
        if not isinstance(data, dict):
            raise BilibiliAPIError(None, "Bilibili 返回格式异常")
        return data

    def _api_data(self, path: str, params: dict[str, Any], referer: str) -> dict[str, Any]:
        url = f"{API_BASE}{path}?{urlencode(params)}"
        response = self._request_json(url, referer)
        code = response.get("code")
        if code != 0:
            message = str(
                response.get("message")
                or response.get("msg")
                or f"接口错误 {code}"
            )
            raise BilibiliAPIError(
                int(code) if isinstance(code, int) else None,
                message,
            )
        data = response.get("data")
        if not isinstance(data, dict):
            raise BilibiliAPIError(None, "Bilibili 响应缺少 data")
        return data

    def get_follower_total(self, uid: int) -> int:
        data = self._api_data(
            "/x/relation/stat",
            {"vmid": uid},
            referer=f"https://space.bilibili.com/{uid}/",
        )
        follower = data.get("follower")
        if not isinstance(follower, int) or follower < 0:
            raise BilibiliAPIError(None, "粉丝总数返回格式异常")
        return follower

    def _get_wbi_mixin_key(self) -> str:
        if self._mixin_key:
            return self._mixin_key
        response = self._request_json(
            f"{API_BASE}/x/web-interface/nav",
            "https://www.bilibili.com/",
        )
        wbi_img = response.get("data", {}).get("wbi_img")
        if not isinstance(wbi_img, dict):
            raise BilibiliAPIError(None, "无法取得 WBI 签名信息")

        keys = []
        for field in ("img_url", "sub_url"):
            value = wbi_img.get(field)
            if not isinstance(value, str):
                raise BilibiliAPIError(None, "WBI 签名信息不完整")
            filename = urlparse(value).path.rsplit("/", 1)[-1]
            keys.append(filename.split(".", 1)[0])
        source = "".join(keys)
        self._mixin_key = "".join(
            source[index]
            for index in WBI_MIXIN_KEY_ORDER
            if index < len(source)
        )[:32]
        return self._mixin_key

    def _sign_wbi(self, params: dict[str, Any]) -> dict[str, Any]:
        signed = {
            key: str(value).translate(str.maketrans("", "", "!'()*"))
            for key, value in params.items()
        }
        signed["wts"] = str(int(time.time()))
        query = urlencode(sorted(signed.items()))
        signed["w_rid"] = md5(
            f"{query}{self._get_wbi_mixin_key()}".encode()
        ).hexdigest()
        return signed

    def get_account_name(self, uid: int) -> str:
        try:
            data = self._api_data(
                "/x/web-interface/card",
                {"mid": uid},
                referer=f"https://space.bilibili.com/{uid}/",
            )
            card = data.get("card")
            name = card.get("name") if isinstance(card, dict) else data.get("name")
            return name if isinstance(name, str) and name else ""
        except BilibiliAPIError:
            return ""


class MonitorStorage:
    def __init__(self, database: str | Path) -> None:
        self.database = Path(database)

    def connect(self) -> sqlite3.Connection:
        self.database.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        with closing(self.connect()) as connection:
            connection.executescript(SCHEMA)
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(accounts)")
            }
            if "username" not in columns:
                connection.execute(
                    "ALTER TABLE accounts ADD COLUMN username TEXT NOT NULL DEFAULT ''"
                )
    def save_snapshot(
        self,
        uid: int,
        follower_count: int,
        name: str | None = None,
        username: str | None = None,
        collected_at: datetime | None = None,
    ) -> dict[str, Any]:
        return self.save_hourly_snapshot(
            uid,
            follower_count,
            name,
            username,
            collected_at,
        )

    def _upsert_account(
        self,
        connection: sqlite3.Connection,
        uid: int,
        name: str | None,
        username: str | None,
        timestamp: str,
    ) -> None:
        connection.execute(
            """
            INSERT INTO accounts(uid, name, username, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(uid) DO UPDATE SET
                name = CASE WHEN excluded.name <> ''
                    THEN excluded.name ELSE accounts.name END,
                username = CASE WHEN excluded.username <> ''
                    THEN excluded.username ELSE accounts.username END
            """,
            (uid, name or "", username or "", timestamp),
        )

    def save_hourly_snapshot(
        self,
        uid: int,
        follower_count: int,
        name: str | None = None,
        username: str | None = None,
        collected_at: datetime | None = None,
    ) -> dict[str, Any]:
        now = collected_at or datetime.now(timezone.utc)
        local_time = now.astimezone(LOCAL_TIMEZONE)
        hour_key = local_time.strftime("%Y-%m-%dT%H")
        timestamp = now.isoformat(timespec="seconds")

        with closing(self.connect()) as connection, connection:
            self._upsert_account(connection, uid, name, username, timestamp)
            connection.execute(
                """
                INSERT INTO follower_history(
                    account_uid, collected_at, collected_hour, follower_count
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(account_uid, collected_hour) DO UPDATE SET
                    collected_at = excluded.collected_at,
                    follower_count = excluded.follower_count
                """,
                (uid, timestamp, hour_key, follower_count),
            )

        return self.account_summary(uid)

    def save_daily_snapshot(
        self,
        uid: int,
        follower_count: int,
        name: str | None = None,
        username: str | None = None,
        collected_at: datetime | None = None,
    ) -> dict[str, Any]:
        now = collected_at or datetime.now(timezone.utc)
        local_time = now.astimezone(LOCAL_TIMEZONE)
        date_key = local_time.strftime("%Y-%m-%d")
        timestamp = now.isoformat(timespec="seconds")

        with closing(self.connect()) as connection, connection:
            self._upsert_account(connection, uid, name, username, timestamp)
            connection.execute(
                """
                INSERT INTO daily_history(
                    account_uid, collected_at, collected_date, follower_count
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(account_uid, collected_date) DO UPDATE SET
                    collected_at = excluded.collected_at,
                    follower_count = excluded.follower_count
                """,
                (uid, timestamp, date_key, follower_count),
            )

        return self.account_summary(uid)

    def account_summary(self, uid: int) -> dict[str, Any]:
        with closing(self.connect()) as connection:
            row = connection.execute(
                """
                SELECT
                    a.uid,
                    a.name,
                    a.username,
                    a.created_at,
                    h.follower_count AS latest_count,
                    h.collected_at AS latest_at,
                    h.collected_hour AS latest_hour,
                    dh.follower_count AS daily_count,
                    dh.collected_date AS daily_date,
                    (
                        SELECT COUNT(*)
                        FROM follower_history h2
                        WHERE h2.account_uid = a.uid
                    ) AS snapshot_count,
                    (
                        SELECT COUNT(*)
                        FROM daily_history dh2
                        WHERE dh2.account_uid = a.uid
                    ) AS daily_snapshot_count
                FROM accounts a
                LEFT JOIN follower_history h ON h.id = (
                    SELECT h3.id
                    FROM follower_history h3
                    WHERE h3.account_uid = a.uid
                    ORDER BY h3.collected_hour DESC
                    LIMIT 1
                )
                LEFT JOIN daily_history dh ON dh.id = (
                    SELECT dh3.id
                    FROM daily_history dh3
                    WHERE dh3.account_uid = a.uid
                    ORDER BY dh3.collected_date DESC
                    LIMIT 1
                )
                WHERE a.uid = ?
                """,
                (uid,),
            ).fetchone()
        if row is None:
            raise KeyError(uid)
        return dict(row)

    def list_accounts(self) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT
                    a.uid,
                    a.name,
                    a.username,
                    a.created_at,
                    h.follower_count AS latest_count,
                    h.collected_at AS latest_at,
                    h.collected_hour AS latest_hour,
                    dh.follower_count AS daily_count,
                    dh.collected_date AS daily_date,
                    (
                        SELECT COUNT(*)
                        FROM follower_history h2
                        WHERE h2.account_uid = a.uid
                    ) AS snapshot_count,
                    (
                        SELECT COUNT(*)
                        FROM daily_history dh2
                        WHERE dh2.account_uid = a.uid
                    ) AS daily_snapshot_count
                FROM accounts a
                LEFT JOIN follower_history h ON h.id = (
                    SELECT h3.id
                    FROM follower_history h3
                    WHERE h3.account_uid = a.uid
                    ORDER BY h3.collected_hour DESC
                    LIMIT 1
                )
                LEFT JOIN daily_history dh ON dh.id = (
                    SELECT dh3.id
                    FROM daily_history dh3
                    WHERE dh3.account_uid = a.uid
                    ORDER BY dh3.collected_date DESC
                    LIMIT 1
                )
                ORDER BY a.created_at ASC
                """,
            ).fetchall()
        return [dict(row) for row in rows]

    def history(self, uid: int, limit: int = 168) -> list[dict[str, Any]]:
        return self.hourly_history(uid, limit)

    def hourly_history(self, uid: int, limit: int = 168) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT id, collected_at, collected_hour, follower_count
                FROM (
                    SELECT id, collected_at, collected_hour, follower_count
                    FROM follower_history
                    WHERE account_uid = ?
                    ORDER BY collected_hour DESC, id DESC
                    LIMIT ?
                )
                ORDER BY collected_hour ASC, id ASC
                """,
                (uid, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def daily_history(self, uid: int, limit: int = 3650) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT id, collected_at, collected_date, follower_count
                FROM (
                    SELECT id, collected_at, collected_date, follower_count
                    FROM daily_history
                    WHERE account_uid = ?
                    ORDER BY collected_date DESC, id DESC
                    LIMIT ?
                )
                ORDER BY collected_date ASC, id ASC
                """,
                (uid, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def delete_account(self, uid: int) -> bool:
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(
                "DELETE FROM accounts WHERE uid = ?", (uid,)
            )
            return cursor.rowcount > 0


def export_github_data(storage: MonitorStorage, project_root: Path) -> bool:
    accounts = storage.list_accounts()
    if not accounts:
        print("本地账号为空，跳过 GitHub 导出，避免覆盖云端账号。")
        return False
    config_path = project_root / "config.json"
    data_path = project_root / "docs" / "data.json"

    config = {
        "accounts": [
            {
                "uid": int(account["uid"]),
                "name": str(account.get("name") or ""),
            }
            for account in accounts
        ]
    }
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    data_accounts = []
    for account in accounts:
        uid = int(account["uid"])
        hourly = [
            {
                "hour": str(row["collected_hour"]),
                "collectedAt": str(row["collected_at"]),
                "count": int(row["follower_count"]),
            }
            for row in storage.hourly_history(uid)
        ]
        daily = [
            {
                "date": str(row["collected_date"]),
                "collectedAt": str(row["collected_at"]),
                "count": int(row["follower_count"]),
            }
            for row in storage.daily_history(uid)
        ]
        data_accounts.append(
            {
                "uid": uid,
                "name": str(account.get("name") or ""),
                "username": str(account.get("username") or ""),
                "hourlyHistory": hourly,
                "dailyHistory": daily,
            }
        )

    data = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "accounts": data_accounts,
    }
    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return True


def sync_to_github(project_root: Path) -> None:
    repo = _github_repo_slug(project_root)
    if not repo:
        return
    for relative_path in ("config.json", "docs/data.json"):
        file_path = project_root / relative_path
        if not file_path.is_file():
            continue
        try:
            _put_github_file(repo, relative_path, file_path)
        except (OSError, ValueError):
            continue


def _github_repo_slug(project_root: Path) -> str | None:
    safe = f"safe.directory={project_root}"
    result = subprocess.run(
        ["git", "-c", safe, "-C", str(project_root), "remote", "get-url", "origin"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        return None
    url = result.stdout.strip()
    for prefix in ("https://github.com/", "git@github.com:"):
        if url.startswith(prefix):
            path = url[len(prefix):]
            if path.endswith(".git"):
                path = path[:-4]
            return path.strip("/")
    return None


def _github_file_sha(repo: str, path: str) -> str | None:
    result = subprocess.run(
        ["gh", "api", f"repos/{repo}/contents/{path}"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return data.get("sha") if isinstance(data, dict) else None


def _put_github_file(repo: str, path: str, file_path: Path) -> None:
    content = file_path.read_bytes()
    encoded = base64.b64encode(content).decode("ascii")
    sha = _github_file_sha(repo, path)
    endpoint = f"repos/{repo}/contents/{path}"
    command = [
        "gh",
        "api",
        "-X",
        "PUT",
        endpoint,
        "-f",
        "message=chore: sync follower data",
        "-f",
        f"content={encoded}",
        "-f",
        "branch=main",
    ]
    if sha:
        command.extend(["-f", f"sha={sha}"])
    subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


WEB_DIR = Path(__file__).resolve().parent / "web"


class DashboardRequestHandler(BaseHTTPRequestHandler):
    server_version = "BilibiliFollowerMonitor/1.0"

    def __init__(
        self,
        *args: Any,
        storage: MonitorStorage,
        client: BilibiliClient,
        collect_lock: threading.Lock,
        project_root: Path,
        **kwargs: Any,
    ) -> None:
        self.storage = storage
        self.client = client
        self.collect_lock = collect_lock
        self.project_root = project_root
        super().__init__(*args, **kwargs)

    def _send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, value: object) -> None:
        body = json.dumps(
            value, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        self._send(status, "application/json; charset=utf-8", body)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("请求体不是有效的 JSON")
        if not isinstance(value, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return value

    def _static(self, filename: str) -> None:
        file_path = WEB_DIR / filename
        if not file_path.is_file():
            self._send_json(404, {"error": "未找到页面"})
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(file_path.suffix, "application/octet-stream")
        self._send(200, content_type, file_path.read_bytes())

    def _collect_account(self, uid: int, name: str | None = None) -> dict[str, Any]:
        with self.collect_lock:
            follower_count = self.client.get_follower_total(uid)
            username = self.client.get_account_name(uid)
            summary = self.storage.save_snapshot(
                uid=uid,
                follower_count=follower_count,
                name=name,
                username=username,
            )
        self._schedule_sync()
        return summary

    def _schedule_sync(self) -> None:
        project_root = self.project_root

        def run() -> None:
            try:
                if export_github_data(self.storage, project_root):
                    sync_to_github(project_root)
            except Exception:
                return

        threading.Thread(target=run, daemon=True).start()

    def do_GET(self) -> None:
        request = urlsplit(self.path)
        path = request.path

        if path in {"/", "/index.html"}:
            self._static("index.html")
            return
        if path in {"/styles.css", "/app.js", "/favicon.svg"}:
            self._static(path.lstrip("/"))
            return
        if path == "/api/accounts":
            self._send_json(200, {"accounts": self.storage.list_accounts()})
            return
        if path.startswith("/api/accounts/") and path.endswith("/history"):
            segments = path.split("/")
            try:
                uid = int(segments[3])
            except (IndexError, ValueError):
                self._send_json(400, {"error": "UID 格式不正确"})
                return
            try:
                hours = int(parse_qs(request.query).get("hours", ["168"])[0])
                if not 1 <= hours <= 8760:
                    raise ValueError
            except ValueError:
                self._send_json(400, {"error": "hours 必须在 1 到 8760 之间"})
                return
            try:
                self._send_json(
                    200,
                    {
                        "account": self.storage.account_summary(uid),
                        "history": self.storage.history(uid, hours),
                        "dailyHistory": self.storage.daily_history(uid),
                    },
                )
            except KeyError:
                self._send_json(404, {"error": "账号不存在"})
            return
        if path == "/favicon.ico":
            self._send(204, "image/x-icon", b"")
            return

        self._send_json(404, {"error": "未找到页面"})

    def do_POST(self) -> None:
        request = urlsplit(self.path)
        path = request.path

        if path == "/api/accounts":
            try:
                body = self._read_json()
                uid_raw = body.get("uid")
                uid = int(uid_raw) if uid_raw is not None else 0
                if uid <= 0:
                    raise ValueError
                name = body.get("name")
                if name is not None and not isinstance(name, str):
                    raise ValueError
            except (TypeError, ValueError):
                self._send_json(400, {"error": "请提供有效的正数 UID"})
                return
            try:
                summary = self._collect_account(uid, name or None)
            except BilibiliAPIError as error:
                self._send_json(502, {"error": error.message})
                return
            except Exception as error:
                self._send_json(500, {"error": f"记录失败：{error}"})
                return
            self._send_json(
                200,
                {
                    "account": summary,
                    "history": self.storage.history(uid),
                    "dailyHistory": self.storage.daily_history(uid),
                },
            )
            return

        if path.startswith("/api/accounts/") and path.endswith("/collect"):
            segments = path.split("/")
            try:
                uid = int(segments[3])
            except (IndexError, ValueError):
                self._send_json(400, {"error": "UID 格式不正确"})
                return
            try:
                summary = self._collect_account(uid)
            except BilibiliAPIError as error:
                self._send_json(502, {"error": error.message})
                return
            except Exception as error:
                self._send_json(500, {"error": f"记录失败：{error}"})
                return
            self._send_json(
                200,
                {
                    "account": summary,
                    "history": self.storage.history(uid),
                    "dailyHistory": self.storage.daily_history(uid),
                },
            )
            return

        if path == "/api/collect-all":
            accounts = self.storage.list_accounts()
            errors: list[dict[str, Any]] = []
            summaries: list[dict[str, Any]] = []
            for account in accounts:
                uid = int(account["uid"])
                try:
                    summaries.append(self._collect_account(uid))
                except (BilibiliAPIError, Exception) as error:
                    errors.append(
                        {
                            "uid": uid,
                            "error": getattr(error, "message", str(error)),
                        }
                    )
            self._send_json(200, {"accounts": summaries, "errors": errors})
            return

        self._send_json(404, {"error": "未找到页面"})

    def do_DELETE(self) -> None:
        request = urlsplit(self.path)
        if not request.path.startswith("/api/accounts/"):
            self._send_json(404, {"error": "未找到页面"})
            return
        segments = request.path.split("/")
        try:
            uid = int(segments[3])
        except (IndexError, ValueError):
            self._send_json(400, {"error": "UID 格式不正确"})
            return
        if self.storage.delete_account(uid):
            self._schedule_sync()
            self._send_json(200, {"ok": True})
        else:
            self._send_json(404, {"error": "账号不存在"})

    def log_message(self, format: str, *args: object) -> None:
        return


class HourlyScheduler:
    def __init__(
        self,
        storage: MonitorStorage,
        client: BilibiliClient,
        collect_lock: threading.Lock,
        project_root: Path,
        interval_seconds: int = 3600,
    ) -> None:
        self.storage = storage
        self.client = client
        self.collect_lock = collect_lock
        self.project_root = project_root
        self.interval_seconds = interval_seconds
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_hour_key: str | None = None
        self._last_daily_date: str | None = None

    def collect_accounts(self, kind: str) -> None:
        for account in self.storage.list_accounts():
            uid = int(account["uid"])
            try:
                with self.collect_lock:
                    follower_count = self.client.get_follower_total(uid)
                    name = str(account.get("name") or "")
                    username = self.client.get_account_name(uid)
                    if kind == "daily":
                        self.storage.save_daily_snapshot(
                            uid=uid,
                            follower_count=follower_count,
                            name=name,
                            username=username,
                        )
                    else:
                        self.storage.save_hourly_snapshot(
                            uid=uid,
                            follower_count=follower_count,
                            name=name,
                            username=username,
                        )
            except BilibiliAPIError:
                continue
            except Exception:
                continue

        try:
            if export_github_data(self.storage, self.project_root):
                sync_to_github(self.project_root)
        except Exception:
            pass

    def _run(self) -> None:
        if self.storage.list_accounts():
            self.collect_accounts("hourly")
            self.collect_accounts("daily")
            now = datetime.now(LOCAL_TIMEZONE)
            self._last_hour_key = now.strftime("%Y-%m-%dT%H")
            self._last_daily_date = now.strftime("%Y-%m-%d")

        while not self._stop_event.is_set():
            now = datetime.now(LOCAL_TIMEZONE)
            hour_key = now.strftime("%Y-%m-%dT%H")
            date_key = now.strftime("%Y-%m-%d")

            if now.minute == 30 and hour_key != self._last_hour_key:
                self.collect_accounts("hourly")
                self._last_hour_key = hour_key

            if (
                now.hour == 0
                and now.minute == 30
                and date_key != self._last_daily_date
            ):
                self.collect_accounts("daily")
                self._last_daily_date = date_key

            self._stop_event.wait(20)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run,
            name="bilibili-hourly-scheduler",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()


def create_server(
    database: str | Path,
    host: str = "127.0.0.1",
    port: int = 8765,
    project_root: Path | None = None,
) -> ThreadingHTTPServer:
    storage = MonitorStorage(database)
    storage.initialize()
    client = BilibiliClient()
    collect_lock = threading.Lock()
    root = (project_root or Path.cwd()).resolve()
    handler = partial(
        DashboardRequestHandler,
        storage=storage,
        client=client,
        collect_lock=collect_lock,
        project_root=root,
    )
    server = ThreadingHTTPServer((host, port), handler)
    server.storage = storage
    server.client = client
    server.collect_lock = collect_lock
    server.project_root = root
    return server


def run_server(
    database: str | Path,
    host: str = "127.0.0.1",
    port: int = 8765,
    open_browser: bool = True,
    interval_seconds: int = 3600,
    project_root: Path | None = None,
) -> int:
    root = (project_root or Path.cwd()).resolve()
    server = create_server(database, host, port, root)
    scheduler = HourlyScheduler(
        server.storage,
        server.client,
        server.collect_lock,
        project_root=root,
        interval_seconds=interval_seconds,
    )
    scheduler.start()

    url = f"http://{host}:{server.server_port}/"
    print(f"B站粉丝小时监控已启动：{url}")
    print("按 Ctrl+C 可停止服务。")
    if open_browser:
        threading.Timer(0.4, webbrowser.open_new_tab, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        scheduler.stop()
        server.server_close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="B站粉丝数小时级本地监控")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--database", default="data/followers.sqlite3")
    parser.add_argument("--interval", type=int, default=3600)
    parser.add_argument("--no-browser", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not 1 <= args.port <= 65535:
        print("--port 必须在 1 到 65535 之间")
        return 2
    if not 60 <= args.interval <= 86400:
        print("--interval 必须在 60 到 86400 秒之间")
        return 2
    return run_server(
        database=args.database,
        host=args.host,
        port=args.port,
        open_browser=not args.no_browser,
        interval_seconds=args.interval,
        project_root=Path.cwd(),
    )


if __name__ == "__main__":
    raise SystemExit(main())
