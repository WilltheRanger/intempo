"""The one error `pages.py` raises, in a module that imports nothing.

Separate so the worker can catch it without importing the join — and so this
does not become the file that grows a circular import the day something else
needs to know about it.
"""

from __future__ import annotations


class NoPagesToJoin(ValueError):
    """`join_pages` was handed an empty list. A caller bug, not a bad page."""
