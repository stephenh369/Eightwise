const STORAGE_KEY = "eightwise:shakes";
const MAX_ENTRIES = 10;

export type AskMode = "classic" | "noul";

export type ShakeLogEntry = {
  question: string;
  reply: string;
  ms: number;
  probability: number;
  mode: AskMode;
  at: number;
};

function isAskMode(value: unknown): value is AskMode {
  return value === "classic" || value === "noul";
}

function parseEntry(raw: unknown): ShakeLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.question !== "string" || typeof o.reply !== "string") return null;
  if (typeof o.ms !== "number" || !Number.isFinite(o.ms)) return null;
  if (typeof o.probability !== "number" || !Number.isFinite(o.probability)) {
    return null;
  }
  if (!isAskMode(o.mode)) return null;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  return {
    question: o.question,
    reply: o.reply,
    ms: o.ms,
    probability: o.probability,
    mode: o.mode,
    at: o.at,
  };
}

export function loadShakeLog(): ShakeLogEntry[] {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return [];
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: ShakeLogEntry[] = [];
    for (const item of parsed) {
      const entry = parseEntry(item);
      if (entry) entries.push(entry);
    }
    return entries.slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function appendShakeLog(entry: Omit<ShakeLogEntry, "at">): ShakeLogEntry[] {
  const full: ShakeLogEntry = { ...entry, at: Date.now() };
  const existing = loadShakeLog();
  const next = [full, ...existing].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota or private mode — keep asking without persistence
  }
  return next;
}

export function formatLogMeta(ms: number, probability: number, mode: AskMode): string {
  const rounded = `${Math.round(ms)}ms`;
  if (mode === "noul") {
    return `${rounded} · P(yes) ${probability.toFixed(2)}`;
  }
  return `${rounded} · ${probability.toFixed(2)}`;
}
