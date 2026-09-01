"""A tiny stateful in-memory fake of the supabase-py client.

The `analyses` flow is stateful (queued → processing → done) and the
sweeper filters on `status` + `updated_at`, which deep MagicMock chains
model badly. This fake implements just the query surface those paths use
— `table().insert()/select()/update()` with
`.eq()/.in_()/.lt()/.gte()/.limit()/.execute()`, plus `select(count="exact")`
— over real dict rows, so tests assert on actual state transitions.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def _iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class _Result:
    def __init__(self, data: list[dict[str, Any]], count: int | None = None):
        self.data = data
        #: Mirrors supabase-py: populated only when the query asked for it.
        #: Callers that didn't ask must see `None`, not a number, or a fallback
        #: path that exists for older clients would never be exercised.
        self.count = count


class _Query:
    def __init__(self, table: "_Table", op: str, payload: dict | None = None):
        self._table = table
        self._op = op
        self._payload = payload
        self._filters: list[tuple[str, str, Any]] = []
        self._limit: int | None = None
        self._count: str | None = None

    def eq(self, col: str, val: Any) -> "_Query":
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col: str, vals: list[Any]) -> "_Query":
        self._filters.append(("in", col, vals))
        return self

    def lt(self, col: str, val: Any) -> "_Query":
        self._filters.append(("lt", col, val))
        return self

    def gte(self, col: str, val: Any) -> "_Query":
        self._filters.append(("gte", col, val))
        return self

    def is_(self, col: str, val: Any) -> "_Query":
        # PostgREST spells "IS NULL" as `.is_(col, "null")`, with the string
        # `"null"` rather than None. Only that form is modelled, because only
        # that form is used.
        self._filters.append(("is", col, val))
        return self

    @property
    def not_(self) -> "_Not":
        return _Not(self)

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
            if kind == "gte" and not (str(row.get(col)) >= str(val)):
                return False
            if kind == "is" and row.get(col) is not None:
                return False
            if kind == "not is" and row.get(col) is None:
                return False
        return True

    def execute(self) -> _Result:
        return self._table._execute(self)


class _Not:
    """`query.not_.is_(col, "null")`, which is how PostgREST spells IS NOT NULL.

    A separate object because `not_` is a property on the real client that
    returns a builder, and modelling it as one keeps the call site in the
    application identical to the one that runs against Supabase.
    """

    def __init__(self, query: "_Query"):
        self._query = query

    def is_(self, col: str, _val: Any) -> "_Query":
        self._query._filters.append(("not is", col, None))
        return self._query


class _Table:
    def __init__(self, rows: list[dict]):
        self.rows = rows

    def insert(self, payload: dict | list[dict]) -> _Query:
        return _Query(self, "insert", payload)

    def select(self, *_cols, count: str | None = None) -> _Query:
        query = _Query(self, "select")
        query._count = count
        return query

    def update(self, payload: dict) -> _Query:
        return _Query(self, "update", payload)

    def delete(self) -> _Query:
        return _Query(self, "delete")

    def _execute(self, q: _Query) -> _Result:
        if q._op == "insert":
            # A list payload is a bulk insert, which is how `training_corrections`
            # writes every bar of one save in a single call.
            payload = q._payload if isinstance(q._payload, list) else [q._payload or {}]
            written: list[dict[str, Any]] = []
            for one in payload:
                row = dict(one)
                row.setdefault("id", str(uuid4()))
                row.setdefault("created_at", _iso())
                row.setdefault("updated_at", _iso())
                row.setdefault("metronome_mode", "off")
                row.setdefault("result_json", None)
                row.setdefault("failure_reason", None)
                row.setdefault("alignment_quality", None)
                row.setdefault("finished_at", None)
                self.rows.append(row)
                written.append(dict(row))
            return _Result(written)

        matched = [r for r in self.rows if q._matches(r)]
        # The count is of everything matching, before any limit — that is what
        # PostgREST returns, and a count that shrank to fit a page would make
        # a quota check silently wrong.
        total = len(matched)
        if q._limit is not None:
            matched = matched[: q._limit]

        if q._op == "select":
            return _Result(
                [dict(r) for r in matched],
                count=total if q._count else None,
            )
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
