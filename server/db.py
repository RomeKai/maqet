"""Persistence skeleton — the real store lands on Day 5 (Deliver).

This module exists so `server.api` and future code import a stable
persistence surface without pulling SQLite/SQLModel today. Scene state stays
in memory until Deliver wires the database.
"""

from __future__ import annotations

__all__ = ["init_db"]


def init_db() -> None:
    """Create tables. Not implemented until Deliver (Day 5)."""
    raise NotImplementedError("persistence lands on Day 5 (Deliver)")
