from __future__ import annotations

import asyncio

DEFAULT_RETRY_AFTER = 1.0
MAX_RETRY_AFTER = 30.0


def get_retry_after(exception: BaseException) -> float | None:
    value = getattr(exception, "retry_after", None)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def is_retry_after_error(exception: BaseException) -> bool:
    return get_retry_after(exception) is not None


async def sleep_retry_after(exception: BaseException) -> float:
    delay = get_retry_after(exception) or DEFAULT_RETRY_AFTER
    delay = max(DEFAULT_RETRY_AFTER, min(delay, MAX_RETRY_AFTER))
    await asyncio.sleep(delay)
    return delay
