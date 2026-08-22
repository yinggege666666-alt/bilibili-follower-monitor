from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import argparse


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import BilibiliClient, LOCAL_TIMEZONE  # noqa: E402


CONFIG_PATH = ROOT / "config.json"
DATA_PATH = ROOT / "docs" / "data.json"
MAX_HOURLY_POINTS = 24 * 365
MAX_DAILY_POINTS = 3650


def load_json(path: Path) -> dict:
    if path.is_file():
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    return {}


def save_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def collect(mode: str = "hourly") -> None:
    if mode == "both":
        collect("hourly")
        collect("daily")
        return

    config = load_json(CONFIG_PATH)
    existing_data = load_json(DATA_PATH)
    existing_by_uid = {
        int(account["uid"]): account
        for account in existing_data.get("accounts", [])
        if isinstance(account, dict) and "uid" in account
    }
    configured_accounts = config.get("accounts", [])
    client = BilibiliClient()
    collected_at = datetime.now(timezone.utc)
    local_hour = collected_at.astimezone(LOCAL_TIMEZONE).strftime("%Y-%m-%dT%H")

    output_accounts = []
    for item in configured_accounts:
        try:
            uid = int(item["uid"])
        except (KeyError, TypeError, ValueError):
            print(f"跳过无效账号：{item!r}")
            continue

        try:
            follower_count = client.get_follower_total(uid)
        except Exception as error:
            print(f"UID {uid} 采集失败：{error}")
            continue

        name = str(item.get("name") or "").strip()

        existing = existing_by_uid.get(uid)
        hourly_history = (
            [dict(point) for point in existing.get("hourlyHistory", [])]
            if existing else []
        )
        daily_history = (
            [dict(point) for point in existing.get("dailyHistory", [])]
            if existing else []
        )
        collected_at_text = collected_at.isoformat(timespec="seconds")
        username = str(item.get("username") or "").strip()
        try:
            username = client.get_account_name(uid) or username
        except Exception:
            pass
        if not username and existing:
            username = str(existing.get("username") or "").strip()

        if mode == "daily":
            date_key = collected_at.astimezone(LOCAL_TIMEZONE).strftime("%Y-%m-%d")
            daily_snapshot = {
                "date": date_key,
                "collectedAt": collected_at_text,
                "count": follower_count,
            }
            if daily_history and daily_history[-1].get("date") == date_key:
                daily_history[-1] = daily_snapshot
            else:
                daily_history.append(daily_snapshot)
                daily_history = daily_history[-MAX_DAILY_POINTS:]
        else:
            hourly_snapshot = {
                "hour": local_hour,
                "collectedAt": collected_at_text,
                "count": follower_count,
            }
            if hourly_history and hourly_history[-1].get("hour") == local_hour:
                hourly_history[-1] = hourly_snapshot
            else:
                hourly_history.append(hourly_snapshot)
                hourly_history = hourly_history[-MAX_HOURLY_POINTS:]

        output_accounts.append(
            {
                "uid": uid,
                "name": name,
                "username": username,
                "hourlyHistory": hourly_history,
                "dailyHistory": daily_history,
            }
        )
        print(f"UID {uid}：{follower_count}")

    data = {
        "updatedAt": collected_at.isoformat(timespec="seconds"),
        "accounts": output_accounts,
    }
    save_json(DATA_PATH, data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("hourly", "daily", "both"),
        default="hourly",
    )
    args = parser.parse_args()
    collect(args.mode)
