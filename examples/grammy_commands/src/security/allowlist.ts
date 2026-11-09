export function parseAdminIds(value: string | undefined = process.env.ADMIN_IDS): number[] {
  if (value === undefined || value === "") return [];
  const ids: number[] = [];
  for (const part of value.split(",")) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

export function isAdmin(
  userId: number | undefined,
  value: string | undefined = process.env.ADMIN_IDS,
): boolean {
  if (userId === undefined || !Number.isSafeInteger(userId)) return false;
  return parseAdminIds(value).includes(userId);
}
