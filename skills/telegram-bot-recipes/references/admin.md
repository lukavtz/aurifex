# Admin surface: roles, audit, confirmation

**Goal.** Privileged actions that are checked on the server, recorded, and hard to
trigger by accident.

**Read this when.** The spec asks for an owner, admins, moderation, user
management, refunds, mass actions, or any screen that changes other people's data.

The security rubric lives in `../../telegram-security/SKILL.md`; this file is the
build recipe.

## Steps

1. **Define the owner by numeric id from the environment.** `OWNER_IDS` is read at
   startup, validated, and never empty-by-accident. The first `/start` is not an
   owner, a username is not an owner, and a forwarded message is not proof.
2. **Store roles in the database.** A `roles` table with `(user_id, role, scope,
granted_by, granted_at)`. Load the role in middleware for every update; do not
   cache it in the client or in `callback_data`.
3. **Check on every privileged path.** Command, callback, conversation step, and
   scheduled job each re-read the role. A button that is still visible after a
   demotion must fail.
4. **Show consequences before a destructive action.** Confirmation names the
   object, the effect, and the scope. The confirmation token is single-use,
   bound to actor, action, target, and expiry.
5. **Audit with the change.** In the same transaction write `actor_id`, `role`,
   `action`, `object_type`, `object_id`, safe diff, UTC timestamp, and result.
   Log "changed" for secrets, never plaintext values.
6. **Protect the last owner.** Refuse a change that would remove every owner or
   grant a role the actor cannot grant.

## grammY / TypeScript

Authorization middleware — the single place roles are loaded:

```ts
import type { Context, NextFunction } from "grammy";

export async function withRole(ctx: Context, next: NextFunction) {
  if (ctx.from === undefined) return next();
  const role = await roles.resolve(ctx.from.id);
  ctx.state.actor = { id: ctx.from.id, role }; // "owner" | "admin" | "operator" | "user"
  await next();
}

export function requireRole(...allowed: readonly string[]) {
  return async (ctx: Context, next: NextFunction) => {
    const actor = ctx.state.actor;
    if (actor === undefined || !allowed.includes(actor.role)) {
      await ctx.reply("Недоступно.");
      return;
    }
    await next();
  };
}

bot.use(withRole);
```

Destructive action with confirmation and audit:

```ts
import { InlineKeyboard } from "grammy";

bot.callbackQuery(/^adm:delete:(\d+)$/, requireRole("owner", "admin"), async (ctx) => {
  await ctx.answerCallbackQuery();
  const targetId = Number(ctx.match[1]);
  const token = await confirmations.issue({
    actorId: ctx.from!.id,
    action: "user.delete",
    targetId,
    expiresAt: new Date(Date.now() + 300_000),
  });
  await ctx.editMessageText(`Удалить пользователя ${targetId}? Действие необратимо.`, {
    reply_markup: new InlineKeyboard()
      .text("Удалить", `adm:confirm:${token}`)
      .text("Отмена", "adm:cancel"),
  });
});

bot.callbackQuery(/^adm:confirm:(.+)$/, requireRole("owner", "admin"), async (ctx) => {
  await ctx.answerCallbackQuery();
  const result = await admin.deleteUser(ctx.from!.id, ctx.match[1]); // transaction + audit
  if (result.kind === "expired" || result.kind === "used") {
    return ctx.editMessageText("Подтверждение устарело. Начните заново.");
  }
  if (result.kind === "denied") return ctx.editMessageText("Недостаточно прав.");
  await ctx.editMessageText("Пользователь удалён.");
});
```

## aiogram / Python

```python
from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message

class RoleMiddleware(BaseMiddleware):
    def __init__(self, roles: RolesRepo, owner_ids: set[int]) -> None:
        self.roles, self.owner_ids = roles, owner_ids

    async def __call__(self, handler, event, data):
        user = data.get("event_from_user")
        role = "owner" if user and user.id in self.owner_ids else await self.roles.resolve(user.id)
        data["actor"] = Actor(id=user.id, role=role)
        return await handler(event, data)

router.message.outer_middleware(RoleMiddleware(roles, owner_ids))
router.callback_query.outer_middleware(RoleMiddleware(roles, owner_ids))
```

```python
@router.callback_query(F.data.regexp(r"^adm:confirm:(.+)$"))
async def confirm(query: CallbackQuery, actor: Actor, admin: AdminService) -> None:
    await query.answer()
    if actor.role not in {"owner", "admin"}:
        await query.message.edit_text("Недоступно.")
        return
    token = query.data.split(":", 2)[2]
    result = await admin.apply(actor, token)  # one transaction, includes audit row
    if result.kind in {"expired", "used"}:
        await query.message.edit_text("Подтверждение устарело. Начните заново.")
    elif result.kind == "denied":
        await query.message.edit_text("Недостаточно прав.")
    else:
        await query.message.edit_text("Готово.")
```

Audit insert, same transaction as the change:

```sql
INSERT INTO audit_log (actor_id, role, action, object_type, object_id, change, created_at, result)
VALUES ($1, $2, $3, $4, $5, $6, now(), $7);
```

## Role model

| Role       | Typical abilities                                            |
| ---------- | ------------------------------------------------------------ |
| `owner`    | Grant and revoke roles, change settings, destructive actions |
| `admin`    | Moderate content, manage objects in scope, no role grants    |
| `operator` | Work the queue assigned to them, no settings                 |
| `user`     | Own objects only                                             |

Adapt to the spec: a bot with no operators must not ship an operator table.

## Checks

- A non-owner cannot become owner by pressing anything, and the first `/start`
  grants nothing.
- Every privileged handler refuses after the role is revoked, even with an old
  button.
- A confirmation token works once; reuse and expiry show a stable message.
- The audit row exists for successes and for refusals, with actor and UTC time.
- The last owner cannot be removed or demoted.
- An action by username in the text does not act on that user's data.
