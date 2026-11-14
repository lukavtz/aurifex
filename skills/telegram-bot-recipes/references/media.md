# Media, files, and albums

**Goal.** Send and receive files within platform limits, without leaking the bot
token through a download URL.

**Read this when.** The spec asks for photos, documents, voice, video, albums,
user uploads, generated images, or `file_id` caching.

## Limits to design around

| What                                        | Limit                                |
| ------------------------------------------- | ------------------------------------ |
| Uploading a photo via multipart             | 10 MB                                |
| Uploading any other file via multipart      | 50 MB                                |
| Downloading with `getFile` on the cloud API | 20 MB                                |
| Album (`sendMediaGroup`)                    | 2–10 items                           |
| Caption                                     | 1024 characters after entity parsing |

Detailed unit rules: `../../telegram-bot-api/SKILL.md`. A local Bot API server
raises the download ceiling; the cloud API does not.

## Steps

1. **Receive by `file_id`, not by bytes.** Store the `file_id` (and `file_unique_id`
   for deduplication) the first time you see a file. Re-sending a `file_id` needs
   no upload and works across restarts. A file sent from one chat can be reused by
   the same bot; treat foreign ids as untrusted input and validate what you need.
2. **Check `file_size` before downloading.** Reject over the ceiling with a clear
   message instead of half-downloading. Verify the content type from the bytes,
   not the filename or the declared MIME.
3. **Download to a private path.** `getFile` returns a path; the URL that serves
   it embeds the bot token. Never log it, never send it to a client, never put it
   in a message.
4. **Stream to storage, then hand out your own reference.** Save under a random
   key and serve through your domain or a signed URL. If you truly need Telegram's
   URL, fetch it server-side and proxy the bytes.
5. **Build albums from already uploaded items** or from 2–10 new files in one
   call. Do not loop `sendPhoto` for a gallery; the client groups them wrongly and
   the flood limits hit fast.

## grammY / TypeScript

Receiving a photo and caching the id:

```ts
import { InputFile } from "grammy";

bot.on("message:photo", async (ctx) => {
  const sizes = ctx.message.photo;
  const largest = sizes[sizes.length - 1];
  if ((largest.file_size ?? 0) > 20 * 1024 * 1024) {
    return ctx.reply("Файл больше 20 МБ.");
  }
  await uploadedFiles.save({
    ownerId: ctx.from.id,
    fileId: largest.file_id,
    uniqueId: largest.file_unique_id,
    size: largest.file_size ?? 0,
  });
  await ctx.reply("Фото принято.");
});
```

Downloading server-side — the resulting URL is secret:

```ts
const file = await ctx.api.getFile(fileId);
// file.file_path must never reach the client or the logs.
const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`download failed: ${response.status}`);
await storage.put(randomKey(), response.body);
```

Sending from a stored id and from a fresh upload:

```ts
await ctx.replyWithPhoto(savedFile.fileId, { caption: "Ваш документ" });

await ctx.replyWithPhoto(new InputFile(Buffer.from(imageBytes), "preview.jpg"), {
  caption: "Новое превью",
});

await ctx.replyWithMediaGroup([
  { type: "photo", media: firstId },
  { type: "photo", media: secondId, caption: "Подпись" },
]);
```

## aiogram / Python

```python
from aiogram.types import FSInputFile, InputMediaPhoto, Message

@router.message(F.photo)
async def on_photo(message: Message, files: FileRepo) -> None:
    largest = message.photo[-1]
    if (largest.file_size or 0) > 20 * 1024 * 1024:
        await message.answer("Файл больше 20 МБ.")
        return
    await files.save(owner_id=message.from_user.id, file_id=largest.file_id,
                     unique_id=largest.file_unique_id, size=largest.file_size)
    await message.answer("Фото принято.")
```

```python
import secrets

async def download(bot: Bot, file_id: str, storage: Storage) -> str:
    tg_file = await bot.get_file(file_id)  # file_path stays server-side
    buffer = await bot.download_file(tg_file.file_path)
    key = secrets.token_urlsafe(16)
    await storage.put(key, buffer.read())
    return key
```

```python
await message.answer_photo(stored.file_id, caption="Ваш документ")
await message.answer_photo(FSInputFile("/srv/media/preview.jpg"), caption="Превью")
await message.answer_media_group([
    InputMediaPhoto(media=first_id),
    InputMediaPhoto(media=second_id, caption="Подпись"),
])
```

`message.answer_document` handles PDFs and archives; check `document.file_size`
before any download and remember that `file_unique_id` is stable across bots while
`file_id` is bot-specific.

## Token leak checklist

- Download URLs and `file_path` never appear in logs, error messages, traces,
  analytics, or bot replies.
- The error handler redacts `api.telegram.org/file/bot…` and `api.telegram.org/bot…`.
- No proxy endpoint returns a raw Telegram URL; it streams bytes.
- Client-side code (including a Mini App bundle) never learns the token.

## Checks

- A 21 MB file is refused before download; a 19 MB file is downloaded.
- The same photo sent twice stores one row via `file_unique_id`, and the second
  send reuses `file_id`.
- An album of 2 works, an album of 11 is rejected by the test before the call.
- Logs from a failed download contain no token; grep the log fixture.
- Captions longer than 1024 characters after entity parsing are split or refused.
