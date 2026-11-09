/**
 * Generated Hypothesis fuzz suite for the Mini App `initData` parser.
 *
 * The parser is the only generated code that consumes attacker-controlled
 * strings before authentication succeeds, so the fuzz target asserts two
 * contracts: it never raises anything except `MiniAppAuthError`, and
 * arbitrary text never parses as a valid signed payload.
 */

export function renderFuzzPy(): string {
  return `from __future__ import annotations

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.runtime.miniapp_session import (
    MiniAppAuthError,
    ValidatedInitData,
    validate_init_data,
)

BOT_TOKEN = "123456:fuzz-only-token"

FUZZ_SETTINGS = settings(
    max_examples=500,
    deadline=None,
    derandomize=True,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


@given(init_data=st.text())
@FUZZ_SETTINGS
def test_malformed_init_data_never_raises_unexpected(init_data: str) -> None:
    try:
        result = validate_init_data(init_data, BOT_TOKEN)
    except MiniAppAuthError:
        return
    assert isinstance(result, ValidatedInitData)


@given(init_data=st.text())
@FUZZ_SETTINGS
def test_unsigned_init_data_is_always_rejected(init_data: str) -> None:
    with pytest.raises(MiniAppAuthError):
        validate_init_data(init_data, BOT_TOKEN)
`;
}