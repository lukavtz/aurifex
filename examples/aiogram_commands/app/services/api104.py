"""Typed raw adapter for Bot API 10.4 methods missing from aiogram 3.31.0."""

from __future__ import annotations

from typing import Any

from aiogram import Bot
from aiogram.methods.base import TelegramMethod
from aiogram.types import (
    Chat,
    ChatIdUnion,
    InputRichMessage,
    Message,
    MessageEntity,
    ReplyMarkupUnion,
    ReplyParameters,
    SuggestedPostParameters,
    User,
)
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EphemeralMessageParameters(BaseModel):
    model_config = ConfigDict(extra="allow")

    receiver_user_id: int | None = None
    callback_query_id: str | None = None
    replace_callback_query_message: bool | None = None


class WidgetQuery(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    from_: User = Field(alias="from")
    chat: Chat | None = None
    message_id: int | None = None
    inline_message_id: str | None = None
    chat_instance: str = ""
    chat_type: str | None = None
    type: dict[str, Any] = Field(default_factory=dict)
    data: str = ""
    widget_id: str | None = None


class SharedWidgetQuery(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    from_: User = Field(alias="from")
    type: dict[str, Any] = Field(default_factory=dict)
    data: str = ""
    widget_id: str


class SendWidget(TelegramMethod[Message]):
    __returning__ = Message
    __api_method__ = "sendWidget"

    chat_id: ChatIdUnion
    html: str = Field(min_length=1, max_length=32768)
    message_thread_id: int | None = None
    width: int | None = None
    height: int | None = None
    public_data: str | None = Field(default=None, max_length=1024)
    chat_data: str | None = Field(default=None, max_length=1024)
    caption: str | None = Field(default=None, max_length=1024)
    parse_mode: str | None = None
    caption_entities: list[MessageEntity] | None = None
    show_caption_above_media: bool | None = None
    allow_queries: bool | None = None
    is_shared: bool | None = None
    disable_notification: bool | None = None
    protect_content: bool | None = None
    allow_paid_broadcast: bool | None = None
    message_effect_id: str | None = None
    reply_parameters: ReplyParameters | None = None
    reply_markup: ReplyMarkupUnion | None = None


class SendSharedWidget(TelegramMethod[Message]):
    __returning__ = Message
    __api_method__ = "sendSharedWidget"

    chat_id: ChatIdUnion
    widget_id: str
    message_thread_id: int | None = None
    chat_data: str | None = Field(default=None, max_length=1024)
    caption: str | None = Field(default=None, max_length=1024)
    parse_mode: str | None = None
    caption_entities: list[MessageEntity] | None = None
    show_caption_above_media: bool | None = None
    disable_notification: bool | None = None
    protect_content: bool | None = None
    allow_paid_broadcast: bool | None = None
    message_effect_id: str | None = None
    reply_parameters: ReplyParameters | None = None
    reply_markup: ReplyMarkupUnion | None = None


class AnswerWidgetQuery(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "answerWidgetQuery"

    widget_query_id: str
    data: str | None = Field(default=None, max_length=1024)


class EditMessageWidgetData(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "editMessageWidgetData"

    chat_id: ChatIdUnion | None = None
    message_id: int | None = None
    inline_message_id: str | None = None
    public_data: str | None = Field(default=None, max_length=1024)
    chat_data: str | None = Field(default=None, max_length=1024)

    @model_validator(mode="after")
    def _require_target(self) -> EditMessageWidgetData:
        if self.inline_message_id is None and (
            self.chat_id is None or self.message_id is None
        ):
            raise ValueError(
                "chat_id and message_id are required unless inline_message_id is set"
            )
        return self


class EditSharedWidgetData(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "editSharedWidgetData"

    widget_id: str
    public_data: str = Field(max_length=1024)
    cache_time: int | None = Field(default=None, ge=5, le=3600)


class SendRichMessage(TelegramMethod[Message]):
    __returning__ = Message
    __api_method__ = "sendRichMessage"

    business_connection_id: str | None = None
    chat_id: ChatIdUnion | None = None
    message_thread_id: int | None = None
    direct_messages_topic_id: int | None = None
    ephemeral_message_parameters: EphemeralMessageParameters | None = None
    rich_message: InputRichMessage
    disable_notification: bool | None = None
    protect_content: bool | None = None
    allow_paid_broadcast: bool | None = None
    message_effect_id: str | None = None
    suggested_post_parameters: SuggestedPostParameters | None = None
    reply_parameters: ReplyParameters | None = None
    reply_markup: ReplyMarkupUnion | None = None

    @model_validator(mode="after")
    def _require_target(self) -> SendRichMessage:
        if self.chat_id is None:
            parameters = self.ephemeral_message_parameters
            if parameters is None or parameters.callback_query_id is None:
                raise ValueError(
                    "chat_id is required unless the message replies to a callback query"
                )
        return self


class SendRichMessageDraft(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "sendRichMessageDraft"

    chat_id: int
    draft_id: int
    rich_message: InputRichMessage
    message_thread_id: int | None = None
    can_stop: bool | None = None
    keep_on_stop: bool | None = None

    @field_validator("draft_id")
    @classmethod
    def _validate_draft_id(cls, value: int) -> int:
        if value == 0:
            raise ValueError("draft_id must be non-zero")
        return value



class GetUniqueGift(TelegramMethod[dict[str, Any]]):
    __returning__ = dict
    __api_method__ = "getUniqueGift"

    gift_id: str


class GetChatShareThemeBackdrops(TelegramMethod[dict[str, Any]]):
    __returning__ = dict
    __api_method__ = "getChatShareThemeBackdrops"

    chat_id: int | str


class DeleteBusinessAccountGift(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "deleteBusinessAccountGift"

    business_connection_id: str
    gift_id: str


class VerifyUser(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "verifyUser"

    user_id: int
    custom_description: str | None = None
    custom_description_parse_mode: str | None = None
    custom_description_entities: list[MessageEntity] | None = None


class VerifyChat(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "verifyChat"

    chat_id: int | str
    custom_description: str | None = None
    custom_description_parse_mode: str | None = None
    custom_description_entities: list[MessageEntity] | None = None


def _build_rich_message(
    rich_message: InputRichMessage | None,
    html: str | None,
    markdown: str | None,
) -> InputRichMessage:
    if rich_message is not None:
        return rich_message
    if (html is None) == (markdown is None):
        raise ValueError("provide exactly one of rich_message, html, or markdown")
    return InputRichMessage(html=html, markdown=markdown)



async def get_unique_gift(bot: Bot, gift_id: str) -> dict[str, Any]:
    return await bot(GetUniqueGift(gift_id=gift_id))


async def get_chat_share_theme_backdrops(bot: Bot, chat_id: int | str) -> dict[str, Any]:
    return await bot(GetChatShareThemeBackdrops(chat_id=chat_id))


async def delete_business_account_gift(
    bot: Bot, business_connection_id: str, gift_id: str
) -> bool:
    return await bot(
        DeleteBusinessAccountGift(
            business_connection_id=business_connection_id, gift_id=gift_id
        )
    )


async def verify_user(
    bot: Bot,
    user_id: int,
    custom_description: str | None = None,
    custom_description_parse_mode: str | None = None,
    custom_description_entities: list[MessageEntity] | None = None,
) -> bool:
    return await bot(
        VerifyUser(
            user_id=user_id,
            custom_description=custom_description,
            custom_description_parse_mode=custom_description_parse_mode,
            custom_description_entities=custom_description_entities,
        )
    )


async def verify_chat(
    bot: Bot,
    chat_id: int | str,
    custom_description: str | None = None,
    custom_description_parse_mode: str | None = None,
    custom_description_entities: list[MessageEntity] | None = None,
) -> bool:
    return await bot(
        VerifyChat(
            chat_id=chat_id,
            custom_description=custom_description,
            custom_description_parse_mode=custom_description_parse_mode,
            custom_description_entities=custom_description_entities,
        )
    )

async def send_widget(
    bot: Bot,
    *,
    chat_id: int | str,
    html: str,
    width: int | None = None,
    height: int | None = None,
    public_data: str | None = None,
    chat_data: str | None = None,
    caption: str | None = None,
    allow_queries: bool = False,
    is_shared: bool = False,
    reply_markup: ReplyMarkupUnion | None = None,
) -> Message:
    return await bot(
        SendWidget(
            chat_id=chat_id,
            html=html,
            width=width,
            height=height,
            public_data=public_data,
            chat_data=chat_data,
            caption=caption,
            allow_queries=allow_queries,
            is_shared=is_shared,
            reply_markup=reply_markup,
        )
    )


async def send_shared_widget(
    bot: Bot,
    *,
    chat_id: int | str,
    widget_id: str,
    chat_data: str | None = None,
    caption: str | None = None,
    reply_markup: ReplyMarkupUnion | None = None,
) -> Message:
    return await bot(
        SendSharedWidget(
            chat_id=chat_id,
            widget_id=widget_id,
            chat_data=chat_data,
            caption=caption,
            reply_markup=reply_markup,
        )
    )


async def answer_widget_query(
    bot: Bot, *, widget_query_id: str, data: str = ""
) -> bool:
    return await bot(AnswerWidgetQuery(widget_query_id=widget_query_id, data=data))


async def edit_message_widget_data(
    bot: Bot,
    *,
    chat_id: int | str | None = None,
    message_id: int | None = None,
    inline_message_id: str | None = None,
    public_data: str | None = None,
    chat_data: str | None = None,
) -> bool:
    return await bot(
        EditMessageWidgetData(
            chat_id=chat_id,
            message_id=message_id,
            inline_message_id=inline_message_id,
            public_data=public_data,
            chat_data=chat_data,
        )
    )


async def edit_shared_widget_data(
    bot: Bot,
    *,
    widget_id: str,
    public_data: str,
    cache_time: int | None = None,
) -> bool:
    return await bot(
        EditSharedWidgetData(
            widget_id=widget_id,
            public_data=public_data,
            cache_time=cache_time,
        )
    )


async def send_rich_message(
    bot: Bot,
    *,
    chat_id: int | str | None = None,
    rich_message: InputRichMessage | None = None,
    html: str | None = None,
    markdown: str | None = None,
    reply_markup: ReplyMarkupUnion | None = None,
    ephemeral_message_parameters: EphemeralMessageParameters | None = None,
) -> Message:
    return await bot(
        SendRichMessage(
            chat_id=chat_id,
            rich_message=_build_rich_message(rich_message, html, markdown),
            reply_markup=reply_markup,
            ephemeral_message_parameters=ephemeral_message_parameters,
        )
    )


async def send_rich_message_draft(
    bot: Bot,
    *,
    chat_id: int,
    draft_id: int,
    rich_message: InputRichMessage | None = None,
    html: str | None = None,
    markdown: str | None = None,
    can_stop: bool = False,
    keep_on_stop: bool = False,
) -> bool:
    return await bot(
        SendRichMessageDraft(
            chat_id=chat_id,
            draft_id=draft_id,
            rich_message=_build_rich_message(rich_message, html, markdown),
            can_stop=can_stop,
            keep_on_stop=keep_on_stop,
        )
    )
