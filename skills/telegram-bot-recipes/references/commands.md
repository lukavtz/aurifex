# Commands, menu, and deep links

**Goal.** A small, discoverable command surface with correct registration and
safe handling of `/start` payloads.

**Read this when.** The spec asks for `/start`, `/help`, `/cancel`, `/settings`,
a command menu, commands scoped to a chat, or a deep link from a channel.

Limits live in `../../telegram-bot-api/SKILL.md`; this file only uses them.

## Steps

1. **Pick the minimum set.** `/start` almost always; `/help` when there is more
   than one path; `/cancel` when conversations exist; `/settings` only if
   something is changeable. A new command is a new public contract.
2. **Respect the name grammar.** 1–32 characters, lowercase Latin letters,
   digits, and underscore, starting with a letter. No spaces, no Cyrillic, no
   punctuation. The same name is used in code, in `setMyCommands`, and in docs.
3. **Register per scope.** The default scope covers everyone; private, group, and
   per-chat scopes override it. One scope holds at most 100 commands, so keep the
   list short instead of paging it. A scope hides a command from the menu; it never
   blocks the command from being sent. Authorization stays server-side.
4. **Set the menu button.** For a command-driven bot the button opens the command
   list. For a Mini App bot it opens the app. Do not set both behaviours blindly;
   a Mini App button without a served page is a broken first screen.
5. **Parse `/start` payload defensively.** The deep-link payload is 64 characters
   of `A-Z a-z 0-9 _ -`, it is user-controlled, and it may be forwarded. Treat it
   as an opaque key: look it up in your database, check purpose and expiry, and
   act only on a match. Never encode a role, a price, or a user id you then trust.
6. **Answer unknown commands.** Silence looks like a broken bot. Reply with the
   help screen or a one-line hint, without echoing the raw text back as markup.

## grammY / TypeScript

```ts
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("start", async (ctx) => {
  const payload = ctx.match.trim(); // text after "/start", may be empty
  const invite = payload ? await invites.consume(payload, ctx.from.id) : null;
  await ctx.reply(invite ? welcomeBack(invite) : welcome(), {
    reply_markup: mainMenuKeyboard(),
  });
});

bot.command("help", (ctx) => ctx.reply(helpText()));
bot.command("cancel", (ctx) => cancelConversation(ctx));
bot.on("message:text", (ctx) => ctx.reply("Не понял. /help — список команд."));
```

Registration, default scope plus one private-only command:

```ts
await bot.api.setMyCommands(
  [
    { command: "start", description: "Запуск и главное меню" },
    { command: "help", description: "Как пользоваться ботом" },
    { command: "cancel", description: "Отменить текущий ввод" },
  ],
  { scope: { type: "all_private_chats" } },
);

await bot.api.setMyCommands([{ command: "start", description: "Запуск" }], {
  scope: { type: "all_group_chats" },
});

await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
```

## aiogram / Python

```python
from aiogram import Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import BotCommand, BotCommandScopeAllGroupChats, BotCommandScopeDefault, MenuButtonCommands

router = Router()

@router.message(CommandStart(deep_link=True))
async def start_with_link(message: Message, command: CommandObject, invites: Invites) -> None:
    invite = await invites.consume(command.args or "", message.from_user.id)
    await message.answer(welcome_back(invite) if invite else welcome())

@router.message(CommandStart())
async def start(message: Message) -> None:
    await message.answer(welcome(), reply_markup=main_menu())

@router.message(Command("help"))
async def help_cmd(message: Message) -> None:
    await message.answer(help_text())
```

```python
await bot.set_my_commands(
    [BotCommand(command="start", description="Запуск"),
     BotCommand(command="help", description="Помощь")],
    scope=BotCommandScopeDefault(),
)
await bot.set_my_commands(
    [BotCommand(command="start", description="Запуск")],
    scope=BotCommandScopeAllGroupChats(),
)
await bot.set_chat_menu_button(menu_button=MenuButtonCommands())
```

Registration order matters: the deep-link filter must be registered before the
plain `/start` handler, otherwise the payload is dropped.

## Separate chat scope

Registering a command for one chat is useful for an operator chat, not for
product permissions:

```ts
await bot.api.setMyCommands([{ command: "queue", description: "Очередь заявок" }], {
  scope: { type: "chat", chat_id: Number(process.env.OPERATOR_CHAT_ID) },
});
```

```python
await bot.set_my_commands(
    [BotCommand(command="queue", description="Очередь заявок")],
    scope=BotCommandScopeChat(chat_id=int(os.environ["OPERATOR_CHAT_ID"])),
)
```

Anyone can still type `/queue` in that chat; the handler must check the role.

## Checks

- Every registered command has a handler; every handler command is registered.
- A 33-character name fails at registration, a 32-character name passes.
- `/start` with an unknown, expired, and already-used payload all land on the
  safe welcome screen, and each consumes nothing twice.
- `/start` payload longer than 64 characters is rejected by the client; your
  handler still bounds the string it reads.
- The menu button opens the intended surface on a real client.
- Command list length stays well under the per-scope cap.
