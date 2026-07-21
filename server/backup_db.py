from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path


def main():
    configured = os.environ.get("SQLITE_DB_PATH")
    database_url = os.environ.get("DATABASE_URL", "")
    if not configured and database_url.startswith("sqlite:///"):
        configured = database_url.removeprefix("sqlite:///")
    source = Path(configured or Path(__file__).parent / "instance" / "kaoyan.db")
    target_dir = Path(os.environ.get("BACKUP_DIR", Path(__file__).parent / "backups"))
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"kaoyan-{datetime.now():%Y%m%d-%H%M%S}.db"
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    backups = sorted(target_dir.glob("kaoyan-*.db"), reverse=True)
    for old in backups[7:]:
        old.unlink()
    print(target)


if __name__ == "__main__":
    main()
