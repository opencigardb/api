import type { LedgerEntryInput } from "./repository";

const MAX_TEXT_LENGTH = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseLedgerEntryInput(body: unknown): LedgerEntryInput {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object");
  }
  const b = body as Record<string, unknown>;

  const date = typeof b.date === "string" ? b.date.trim() : "";
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error("date must be a valid YYYY-MM-DD string");
  }

  const type = b.type;
  if (type !== "income" && type !== "expense") {
    throw new Error('type must be "income" or "expense"');
  }

  const source = typeof b.source === "string" ? b.source.trim() : "";
  if (!source || source.length > MAX_TEXT_LENGTH) {
    throw new Error(`source is required (max ${MAX_TEXT_LENGTH} chars)`);
  }

  const category = typeof b.category === "string" ? b.category.trim() : "";
  if (!category || category.length > MAX_TEXT_LENGTH) {
    throw new Error(`category is required (max ${MAX_TEXT_LENGTH} chars)`);
  }

  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (!description || description.length > MAX_TEXT_LENGTH * 2) {
    throw new Error(`description is required (max ${MAX_TEXT_LENGTH * 2} chars)`);
  }

  const amount_usd = typeof b.amount_usd === "number" ? b.amount_usd : Number(b.amount_usd);
  if (!Number.isFinite(amount_usd) || amount_usd <= 0) {
    throw new Error("amount_usd must be a positive number");
  }

  let reference_url: string | null = null;
  if (b.reference_url !== undefined && b.reference_url !== null && b.reference_url !== "") {
    if (typeof b.reference_url !== "string" || !/^https?:\/\//.test(b.reference_url)) {
      throw new Error("reference_url must be an http(s) URL");
    }
    reference_url = b.reference_url;
  }

  return {
    date,
    type,
    source,
    category,
    description,
    amount_usd: Math.round(amount_usd * 100) / 100,
    reference_url,
  };
}
