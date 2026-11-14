# Groups, topics, and membership

**Goal.** Work correctly in group chats where the bot is a guest, one message is
public, and permissions can be revoked at any moment.

**Read this when.** The spec asks for group support, moderation, forum topics,
membership tracking, ephemeral replies, or publishing into a chat.

## What is different from a private chat

| Aspect               | Private chat        | Group                                 |
| -------------------- | ------------------- | ------------------------------------- |
| Who reads the answer | The user            | Everyone in the chat                  |
| Identity             | One person per chat | Shared chat id, many actors           |
| Permissions          | Usually all         | Only what the admin granted           |
| State                | Per chat            | Per chat plus per user plus per topic |
| Message stream       | Complete            | Filtered by privacy mode              |
| Deletion             | Rarely relevant     | Moderation and retention apply        |

Consequences: never key user data by `chat_id` alone in a group; never render
private data into a group message; never assume the bot sees every message.

## Steps

1. **Check rights when you need them.** `getChatMember` returns the bot's and a
   user's status and rights. It is reliable while the bot is an administrator;
   outside that it can fail. A failed check is a refusal, never an allow.
2. **Track the bot's own membership.** `my_chat_member` fires when the bot is
   added, promoted, restricted, or removed. Stop scheduled work for a chat that
   removed the bot instead of collecting 403s.
3. **Keep `message_thread_id`.** In a forum, every reply must carry the thread id
   of the trigger, or it lands in the wrong topic. Store it with the state and the
   job payload, not only with the message.
4. **Answer where you were called.** Reply to the triggering message; do not post
   a new top-level message for every command.
5. **Use ephemeral messages for private feedback**, with a fallback. They live for
   15 seconds, are visible only to one user, and are not a delivery guarantee.
6. **Treat `sender_chat` and anonymous admins carefully.** An anonymous admin
   message has no trustworthy personal `from.id`; do not grant a role from it.

## grammY / TypeScript

```ts
bot.on("message:text", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const threadId = ctx.message.message_thread_id;

  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
  const isAdmin = member.status === "creator" || member.status === "administrator";

  if (!isAdmin) {
    await ctx.reply("Команда только для администраторов чата.", {
      message_thread_id: threadId,
      reply_parameters: { message_id: ctx.message.message_id },
    });
    return;
  }
  await moderate(ctx);
});

bot.on("my_chat_member", async (ctx) => {
  const update = ctx.myChatMember;
  const status = update.new_chat_member.status;
  if (status === "left" || status === "kicked") {
    await chatRegistry.disable(update.chat.id); // stop scheduled work
  }
  if (status === "administrator") {
    await chatRegistry.enable(update.chat.id, update.new_chat_member.can_delete_messages ?? false);
  }
});
```

Rights check helper — the same shape for any capability:

```ts
async function canPublish(api: Api, chatId: number): Promise<boolean> {
  try {
    const me = await api.getChatMember(chatId, api.botInfo.id);
    return me.status === "creator" || (me.status === "administrator" && me.can_post_messages);
  } catch {
    return false;
  }
}
```

## aiogram / Python

```python
from aiogram import F
from aiogram.types import ChatMemberUpdated, Message

@router.message(F.chat.type.in_({"group", "supergroup"}))
async def on_group_message(message: Message) -> None:
    member = await message.bot.get_chat_member(message.chat.id, message.from_user.id)
    if member.status not in {"creator", "administrator"}:
        await message.reply("Команда только для администраторов чата.",
                            message_thread_id=message.message_thread_id)
        return
    await moderate(message)

@router.my_chat_member()
async def on_bot_membership(update: ChatMemberUpdated, chats: ChatRegistry) -> None:
    status = update.new_chat_member.status
    if status in {"left", "kicked"}:
        await chats.disable(update.chat.id)
    elif status == "administrator":
        await chats.enable(update.chat.id)
```

Replying inside the topic:

```python
await message.answer(text, message_thread_id=message.message_thread_id)
```

For an aiogram `ChatMemberAdministrator`, rights are typed attributes such as
`can_delete_messages`; for `ChatMemberMember` there are none. Model the result as
"missing permission", not as a boolean field that might be absent.

## Ephemeral messages

Bot API 10.4 adds ephemeral replies through `ephemeral_message_parameters`. They
are visible only to the addressed user and expire after 15 seconds.

```ts
// Raw adapter: grammY 1.46.0 types stop at 10.3. See ../bot-api-104.md.
await ctx.api.raw.sendMessage({
  chat_id: ctx.chat.id,
  text: "Это видно только вам.",
  ephemeral_message_parameters: { receiver_user_id: ctx.from.id },
});
```

```python
# Raw call: aiogram 3.31.0 types stop at 10.3. See ../bot-api-104.md.
await bot("sendMessage", {
    "chat_id": message.chat.id,
    "text": "Это видно только вам.",
    "ephemeral_message_parameters": {"receiver_user_id": message.from_user.id},
})
```

Always have a fallback: if the call fails, send a normal message or a private
message with a deep link. Never put the only copy of a confirmation into an
ephemeral message.

## Group state rules

- Key rows by `(chat_id, user_id, thread_id)`; a user can be mid-dialog in two
  topics.
- A setting changed in one chat must not leak into another chat.
- Removing a role must invalidate its buttons on the next press; re-check the role
  in the handler.
- Store `migrate_to_chat_id` handling for the group-to-supergroup transition:
  update stored ids when the service message arrives.

## Checks

- Non-admin pressing an admin button gets a refusal and no side effect.
- Bot removed from a chat: scheduled job skips the chat, no 403 storm.
- Two topics in one group keep separate dialog state.
- A promotion event enables the feature only if the required right is present.
- `message_thread_id` is preserved in replies, in state, and in job payloads.
- Ephemeral failure path still delivers a fallback message.
