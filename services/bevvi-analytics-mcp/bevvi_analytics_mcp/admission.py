from __future__ import annotations

import asyncio


class CalculationAdmission:
    """Bound concurrent in-process subprocess calculations."""

    def __init__(self, limit: int) -> None:
        if limit < 1:
            raise ValueError("admission limit must be >= 1")
        self._sem = asyncio.Semaphore(limit)

    async def acquire(self) -> None:
        await self._sem.acquire()

    def release(self) -> None:
        self._sem.release()
