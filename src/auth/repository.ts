import { getDb } from "../db";

export interface Admin {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export function findAdminByUsername(username: string): Admin | null {
  return (
    getDb()
      .query<Admin, [string]>(
        "SELECT id, username, password_hash, created_at FROM admins WHERE username = ? COLLATE NOCASE",
      )
      .get(username) ?? null
  );
}
