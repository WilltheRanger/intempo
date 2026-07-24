"""A tiny stateful in-memory fake of the supabase-py client.

The `analyses` flow is stateful (queued → processing → done) and the
sweeper filters on `status` + `updated_at`, which deep MagicMock chains
model badly. This fake implements just the query surface those paths use
— `table().insert()/select()/update()` with `.eq()/.in_()/.lt()/.limit()
.execute()` — over real dict rows, so tests assert on actual state
transitions.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def _iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class _Result:
    def __init__(self, data: list[dict[str, Any]]):
        self.data = data


class _Query:
    def __init__(self, table: "_Table", op: str, payload: dict | None = None):
        self._table = table
        self._op = op
        self._payload = payload
        self._filters: list[tuple[str, str, Any]] = []
        self._limit: int | None = None

    def eq(self, col: str, val: Any) -> "_Query":
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col: str, vals: list[Any]) -> "_Query":
        self._filters.append(("in", col, vals))
        return self

    def lt(self, col: str, val: Any) -> "_Query":
        self._filters.append(("lt", col, val))
        return self

    def limit(self, n: int) -> "_Query":
        self._limit = n
        return self

    def order(self, *_a, **_k) -> "_Query":
        return self

    def range(self, *_a, **_k) -> "_Query":
        return self

    def _matches(self, row: dict) -> bool:
        for kind, col, val in self._filters:
            if kind == "eq" and str(row.get(col)) != str(val):
                return False
            if kind == "in" and row.get(col) not in val:
                return False
            if kind == "lt" and not (str(row.get(col)) < str(val)):
                return False
        return True

    def execute(self) -> _Result:
        return self._table._execute(self)


class _Table:
    def __init__(self, rows: list[dict]):
        self.rows = rows

    def insert(self, payload: dict) -> _Query:
        return _Query(self, "insert", payload)

    def select(self, *_cols) -> _Query:
        return _Query(self, "select")

    def update(self, payload: dict) -> _Query:
        return _Query(self, "update", payload)

    def delete(self) -> _Query:
        return _Query(self, "delete")

    def _execute(self, q: _Query) -> _Result:
        if q._op == "insert":
            row = dict(q._payload or {})
            row.setdefault("id", str(uuid4()))
            row.setdefault("created_at", _iso())
            row.setdefault("updated_at", _iso())
            row.setdefault("metronome_mode", "off")
            row.setdefault("result_json", None)
            row.setdefault("failure_reason", None)
            row.setdefault("alignment_quality", None)
            row.setdefault("finished_at", None)
            self.rows.append(row)
            return _Result([dict(row)])

        matched = [r for r in self.rows if q._matches(r)]
        if q._limit is not None:
            matched = matched[: q._limit]

        if q._op == "select":
            return _Result([dict(r) for r in matched])
        if q._op == "update":
            for r in matched:
                r.update(q._payload or {})
            return _Result([dict(r) for r in matched])
        if q._op == "delete":
            for r in matched:
                self.rows.remove(r)
            return _Result([dict(r) for r in matched])
        raise AssertionError(f"unhandled op {q._op}")


class FakeSupabase:
    def __init__(self) -> None:
        self._tables: dict[str, _Table] = {}

    def table(self, name: str) -> _Table:
        return self._tables.setdefault(name, _Table([]))

    def seed(self, name: str, rows: list[dict]) -> None:
        self.table(name).rows.extend(rows)
