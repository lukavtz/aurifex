from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from aiogram.types import Message
from pydantic import ValidationError

from app.services import api104


def test_widget_method_metadata() -> None:
    assert api104.SendWidget.__api_method__ == "sendWidget"
    assert api104.SendWidget.__returning__ is Message
    assert api104.SendSharedWidget.__api_method__ == "sendSharedWidget"
    assert api104.AnswerWidgetQuery.__api_method__ == "answerWidgetQuery"
    assert api104.EditMessageWidgetData.__api_method__ == "editMessageWidgetData"
    assert api104.EditSharedWidgetData.__api_method__ == "editSharedWidgetData"
    assert api104.SendRichMessage.__api_method__ == "sendRichMessage"
    assert api104.SendRichMessageDraft.__api_method__ == "sendRichMessageDraft"


def test_send_widget_bounds() -> None:
    assert api104.SendWidget(chat_id=1, html="<b>x</b>").html == "<b>x</b>"
    with pytest.raises(ValidationError):
        api104.SendWidget(chat_id=1, html="")
    with pytest.raises(ValidationError):
        api104.SendWidget(chat_id=1, html="x" * 32769)
    with pytest.raises(ValidationError):
        api104.SendWidget(chat_id=1, html="<b>x</b>", public_data="x" * 1025)


def test_edit_shared_widget_cache_time_bounds() -> None:
    method = api104.EditSharedWidgetData(
        widget_id="w", public_data="data", cache_time=5
    )
    assert method.cache_time == 5
    with pytest.raises(ValidationError):
        api104.EditSharedWidgetData(widget_id="w", public_data="data", cache_time=4)
    with pytest.raises(ValidationError):
        api104.EditSharedWidgetData(widget_id="w", public_data="data", cache_time=3601)


def test_answer_widget_query_data_bound() -> None:
    assert api104.AnswerWidgetQuery(widget_query_id="q", data="x" * 1024).data
    with pytest.raises(ValidationError):
        api104.AnswerWidgetQuery(widget_query_id="q", data="x" * 1025)


def test_edit_message_widget_data_requires_target() -> None:
    with pytest.raises(ValidationError):
        api104.EditMessageWidgetData(public_data="x")
    assert api104.EditMessageWidgetData(inline_message_id="i", public_data="x")


def test_rich_message_requires_chat_or_callback_reply() -> None:
    with pytest.raises(ValidationError):
        api104.SendRichMessage(rich_message={"html": "<b>x</b>"})
    assert api104.SendRichMessage(
        rich_message={"html": "<b>x</b>"},
        ephemeral_message_parameters={"callback_query_id": "cb"},
    )


def test_rich_draft_rejects_zero_id() -> None:
    with pytest.raises(ValidationError):
        api104.SendRichMessageDraft(
            chat_id=1, draft_id=0, rich_message={"html": "<b>x</b>"}
        )


@pytest.mark.asyncio
async def test_answer_widget_query_helper_calls_bot() -> None:
    bot: Any = AsyncMock(return_value=True)
    result = await api104.answer_widget_query(bot, widget_query_id="q", data="ack")
    assert result is True
    method = bot.await_args.args[0]
    assert isinstance(method, api104.AnswerWidgetQuery)
    assert method.widget_query_id == "q"
