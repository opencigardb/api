import { openWritable } from "../src/db/index";

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("Usage: bun run create-admin <username> <password>");
  process.exit(1);
}
if (username.length < 3 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
  console.error("Username must be at least 3 characters: letters, numbers, _ . - only.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const db = openWritable();

const existing = db
  .query<{ id: string }, [string]>("SELECT id FROM admins WHERE username = ? COLLATE NOCASE")
  .get(username);
if (existing) {
  console.error(`An admin named "${username}" already exists.`);
  process.exit(1);
}

const passwordHash = await Bun.password.hash(password);
const id = crypto.randomUUID();

db.prepare(
  "INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
).run(id, username, passwordHash, new Date().toISOString());

console.log(`Created admin "${username}" (${id}).`);
db.close();
