"""Build an isolated guard-compliant snapshot for real handler acceptance (not production data)."""
from __future__ import annotations

import csv
import io
import json
from calendar import monthrange
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _month_end(year: int, month: int) -> str:
    last = monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-{last:02d}"


def _iter_months(start: str, end: str):
    sy, sm = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    y, m = sy, sm
    while (y, m) <= (ey, em):
        yield f"{y:04d}-{m:02d}"
        if m == 12:
            y += 1
            m = 1
        else:
            m += 1


def build_acceptance_snapshot(root: Path, *, fetched_at: datetime | None = None) -> None:
    root = root.resolve()
    fetched_at = fetched_at or (datetime.now(timezone.utc) - timedelta(hours=2))
    fetched_iso = fetched_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    norm = root / "ml/cache/transactions_normalized"
    raw = root / "ml/cache/transactions_raw"
    norm.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)

    (root / "ml/reports").mkdir(parents=True, exist_ok=True)
    (root / "ml/reports/phase1_preview_state.json").write_text(
        json.dumps({"phase1_active": True}), encoding="utf-8"
    )
    (root / "calibration_config.json").write_text(
        json.dumps({"use_xgboost_forecast": False}), encoding="utf-8"
    )

    store_csv = "order_id,order_date,revenue_usd,status\naccept-1,2024-01-01,1.00,delivered\n"
    tableau_csv = "orderNumber,orderDate,price,quantity\naccept-1,2024-01-01,1.00,1\n"

    order_seq = 0
    for month in _iter_months("2024-01", "2026-09"):
        y, m = map(int, month.split("-"))
        end = _month_end(y, m)
        order_seq += 1
        oid = f"iso-{month}-{order_seq}"
        day = f"{month}-15"
        if month == "2026-09":
            day = "2026-09-30"

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["order_id", "order_date", "revenue_usd", "status", "source", "customer_name"])
        writer.writerow([oid, day, "150.00", "delivered", "store_txn", "Acme Corp"])
        (norm / f"{month}.csv").write_text(buf.getvalue(), encoding="utf-8")

        meta = {
            "month_start": f"{month}-01",
            "month_end": end,
            "fetched_at": fetched_iso,
            "errors": [],
            "stats": {"merged_rows": 1},
            "store_txn_csv": store_csv,
            "tableau_csv": tableau_csv,
        }
        (raw / f"{month}.json").write_text(json.dumps(meta), encoding="utf-8")

    (root / ".generation").write_text(
        f"generation_id=acceptance-isolated-v1\nfetched_at_utc={fetched_iso}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1] if len(sys.argv) > 1 else "acceptance_snapshot")
    build_acceptance_snapshot(target)
    print(f"built acceptance snapshot at {target.resolve()}")
