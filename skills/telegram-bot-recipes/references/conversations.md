# Conversations and multi-step forms

**Goal.** A stepped dialog that survives a restart, can always be cancelled, and
writes nothing until the last step commits.

**Read this when.** The spec asks for a form, onboarding, checkout, wizard, or any
flow with more than one question.

## Steps

1. **Model the steps as data.** A small set of named states plus the collected
   values. The state name is stable and independent of the message text.
2. **Persist state in the database**, keyed by chat, user, and thread when topics
   exist. Memory storage loses every dialog on deploy, and a single-process
   assumption breaks the day a second instance starts.
3. **Validate at the step boundary.** A bad answer keeps the user on the current
   step with a concrete example of accepted input and preserves whatever was
   already accepted.
4. **Give `/cancel` and "Back" priority.** Both must work from any step, whatever
   the text looks like. "Back" restores the previous step with its value still
   editable; "Cancel" drops the draft and shows a stable screen.
5. **Perform side effects only after the final commit.** The draft lives in the
   state; the business row, the payment, and the notification are created in one
   transaction at the confirmation step. After that commit, "Cancel" no longer
   cancels anything — say so in the UI.
6. **Expire abandoned dialogs.** Set a TTL (for example 24 hours) and a cleanup
   job. On the next message after expiry, start fresh instead of resuming stale
   input.

## grammY / TypeScript

State read and write are explicit service calls; no in-memory session.

```ts
type Step = "await_title" | "await_date" | "confirm";

interface Draft {
  step: Step;
  title?: string;
  date?: string;
}

const isCancel = (text: string) => text === "/cancel" || text === "Отмена";

bot.on("message:text", async (ctx) => {
  const text = ctx.text.trim();
  const key = { chatId: ctx.chat.id, userId: ctx.from.id, threadId: ctx.message_thread_id };
  const draft = await drafts.load(key);

  if (isCancel(text)) {
    await drafts.clear(key);
    return ctx.reply("Отменено.", { reply_markup: mainMenuKeyboard() });
  }

  if (draft?.step === "await_title") {
    if (text.length < 3) return ctx.reply("Название короче 3 символов. Ещё раз:");
    await drafts.save(key, { ...draft, title: text, step: "await_date" });
    return ctx.reply("Дата в формате ГГГГ-ММ-ДД:");
  }

  if (draft?.step === "await_date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ctx.reply("Формат ГГГГ-ММ-ДД. Ещё раз:");
    const next = { ...draft, date: text, step: "confirm" as const };
    await drafts.save(key, next);
    return ctx.reply(`Проверьте: ${next.title}, ${next.date}`, {
      reply_markup: new InlineKeyboard()
        .text("Создать", "draft:commit")
        .text("Назад", "draft:back")
        .text("Отмена", "draft:cancel"),
    });
  }

  return ctx.reply("Начните с /start.");
});

bot.callbackQuery("draft:commit", async (ctx) => {
  await ctx.answerCallbackQuery();
  const key = { chatId: ctx.chat!.id, userId: ctx.from.id, threadId: undefined };
  const committed = await drafts.commit(key); // transaction: insert + clear state
  if (committed === null) return ctx.editMessageText("Черновик устарел. Начните заново.");
  await ctx.editMessageText(`Создано: #${committed.id}`);
});

bot.callbackQuery("draft:back", async (ctx) => {
  await ctx.answerCallbackQuery();
  await drafts.save(
    { chatId: ctx.chat!.id, userId: ctx.from.id, threadId: undefined },
    {
      ...(await drafts.load({ chatId: ctx.chat!.id, userId: ctx.from.id, threadId: undefined }))!,
      step: "await_title",
    },
  );
  await ctx.editMessageText("Название:");
});
```

`drafts.commit` must do `SELECT ... FOR UPDATE`, insert the row, and clear the
state in one transaction; it returns `null` when the draft is gone.

## aiogram / Python

Use a real storage (Redis or a database-backed storage), never the default memory
storage in production.

```python
import re

from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

class NewRequest(StatesGroup):
    title = State()
    date = State()
    confirm = State()

@router.message(NewRequest.title)
async def got_title(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if text in {"/cancel", "Отмена"}:
        await state.clear()
        await message.answer("Отменено.", reply_markup=main_menu())
        return
    if len(text) < 3:
        await message.answer("Название короче 3 символов. Ещё раз:")
        return
    await state.update_data(title=text)
    await state.set_state(NewRequest.date)
    await message.answer("Дата в формате ГГГГ-ММ-ДД:")

@router.message(NewRequest.date)
async def got_date(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        await message.answer("Формат ГГГГ-ММ-ДД. Ещё раз:")
        return
    await state.update_data(date=text)
    await state.set_state(NewRequest.confirm)
    data = await state.get_data()
    await message.answer(f"Проверьте: {data['title']}, {data['date']}", reply_markup=confirm_kb())
```

```python
from aiogram import F
from aiogram.filters import Command
from aiogram.types import CallbackQuery

@router.callback_query(F.data == "draft:commit")
async def commit(query: CallbackQuery, state: FSMContext, requests: RequestsRepo) -> None:
    await query.answer()
    data = await state.get_data()
    created = await requests.create_from_state(query.from_user.id, data, state)  # one transaction
    if created is None:
        await query.message.edit_text("Черновик устарел. Начните заново.")
        return
    await state.clear()
    await query.message.edit_text(f"Создано: #{created.id}")
```

Register a global cancel handler before the step handlers:

```python
@router.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Отменено.", reply_markup=main_menu())
```

Middleware order matters: the identity guard runs as an outer middleware before
FSM handlers, so the actor is known when a step validates ownership of the draft.

## State shape

```text
dialog_state(chat_id, user_id, thread_id, step, data json, version, updated_at)
```

- Unique key `(chat_id, user_id, thread_id)` with `thread_id` defaulting to 0.
- `version` guards concurrent updates from two devices.
- A cleanup job deletes rows older than the TTL; the handler also treats an old
  row as absent.
- `data` holds only draft fields, never tokens or entitlement decisions.

## Checks

- Cancel from every step leaves no business row and one stable screen.
- Back from the confirm step returns to the first question with the old value.
- Restart between steps resumes the dialog at the same step.
- A TTL-expired draft restarts cleanly, no partial row.
- Two devices writing the same draft produce one commit and one conflict message.
- A step handler never writes the business row before the confirm step.
