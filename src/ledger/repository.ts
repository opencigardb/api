import { rename, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const LEDGER_PATH = resolve(import.meta.dir, "entries.json");

export interface LedgerEntry {
  id: string;
  date: string;
  type: "income" | "expense";
  source: string;
  category: string;
  description: string;
  amount_usd: number;
  reference_url: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface LedgerEntryWithBalance extends LedgerEntry {
  balance_usd: number;
}

export interface LedgerSummary {
  total_income_usd: number;
  total_expenses_usd: number;
  balance_usd: number;
  currency: "USD";
  entry_count: number;
  updated_at: string;
}

export interface Ledger {
  entries: LedgerEntryWithBalance[];
  summary: LedgerSummary;
}

interface LedgerFile {
  updated_at: string;
  entries: LedgerEntry[];
}

export interface LedgerEntryInput {
  date: string;
  type: "income" | "expense";
  source: string;
  category: string;
  description: string;
  amount_usd: number;
  reference_url: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function readLedgerFile(): Promise<LedgerFile> {
  const raw = await readFile(LEDGER_PATH, "utf8");
  return JSON.parse(raw) as LedgerFile;
}

/** Write via temp file + rename so a crash mid-write can't corrupt entries.json. */
async function writeLedgerFile(file: LedgerFile): Promise<void> {
  const tmpPath = `${LEDGER_PATH}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tmpPath, LEDGER_PATH);
}

function withBalances(entries: LedgerEntry[]): {
  entries: LedgerEntryWithBalance[];
  totalIncome: number;
  totalExpenses: number;
  balance: number;
} {
  const chronological = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  let balance = 0;
  let totalIncome = 0;
  let totalExpenses = 0;
  const result: LedgerEntryWithBalance[] = chronological.map((entry) => {
    if (entry.type === "income") {
      balance += entry.amount_usd;
      totalIncome += entry.amount_usd;
    } else {
      balance -= entry.amount_usd;
      totalExpenses += entry.amount_usd;
    }
    return { ...entry, balance_usd: round2(balance) };
  });

  return { entries: result, totalIncome, totalExpenses, balance };
}

function stripAdminFields(entry: LedgerEntryWithBalance): LedgerEntryWithBalance {
  // Public responses omit who entered/edited a transaction — the amounts and
  // dates are the transparency commitment, not admin identities.
  const { created_by: _createdBy, updated_by: _updatedBy, ...rest } = entry;
  return { ...rest, created_by: "", updated_by: null };
}

export async function getLedger(): Promise<Ledger> {
  const file = await readLedgerFile();
  const { entries, totalIncome, totalExpenses, balance } = withBalances(file.entries);

  return {
    entries: entries.reverse().map(stripAdminFields),
    summary: {
      total_income_usd: round2(totalIncome),
      total_expenses_usd: round2(totalExpenses),
      balance_usd: round2(balance),
      currency: "USD",
      entry_count: entries.length,
      updated_at: file.updated_at,
    },
  };
}

/** Same shape as getLedger() but includes created_by/updated_by for the admin UI. */
export async function getLedgerForAdmin(): Promise<Ledger> {
  const file = await readLedgerFile();
  const { entries, totalIncome, totalExpenses, balance } = withBalances(file.entries);

  return {
    entries: entries.reverse(),
    summary: {
      total_income_usd: round2(totalIncome),
      total_expenses_usd: round2(totalExpenses),
      balance_usd: round2(balance),
      currency: "USD",
      entry_count: entries.length,
      updated_at: file.updated_at,
    },
  };
}

export async function createLedgerEntry(
  input: LedgerEntryInput,
  adminUsername: string,
): Promise<LedgerEntry> {
  const file = await readLedgerFile();
  const now = new Date().toISOString();
  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    ...input,
    created_by: adminUsername,
    created_at: now,
    updated_by: null,
    updated_at: null,
  };
  file.entries.push(entry);
  file.updated_at = now;
  await writeLedgerFile(file);
  return entry;
}

export async function updateLedgerEntry(
  id: string,
  input: LedgerEntryInput,
  adminUsername: string,
): Promise<LedgerEntry | null> {
  const file = await readLedgerFile();
  const index = file.entries.findIndex((e) => e.id === id);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const existing = file.entries[index]!;
  const updated: LedgerEntry = {
    ...existing,
    ...input,
    updated_by: adminUsername,
    updated_at: now,
  };
  file.entries[index] = updated;
  file.updated_at = now;
  await writeLedgerFile(file);
  return updated;
}

export async function deleteLedgerEntry(id: string): Promise<boolean> {
  const file = await readLedgerFile();
  const index = file.entries.findIndex((e) => e.id === id);
  if (index === -1) return false;

  file.entries.splice(index, 1);
  file.updated_at = new Date().toISOString();
  await writeLedgerFile(file);
  return true;
}
