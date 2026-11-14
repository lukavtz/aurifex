import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export interface Database {
  readonly client: Sql;
  readonly db: PostgresJsDatabase<typeof schema>;
}

let database: Database | null | undefined;

export function getDb(url: string | undefined = process.env.DATABASE_URL): Database | null {
  if (database !== undefined) return database;
  if (url === undefined || url === "") {
    database = null;
    return database;
  }
  const client = postgres(url, { max: 10 });
  database = { client, db: drizzle(client, { schema }) };
  return database;
}

export async function closeDb(): Promise<void> {
  if (database !== null && database !== undefined) {
    await database.client.end();
  }
  database = undefined;
}
