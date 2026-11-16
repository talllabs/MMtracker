// Keeps saved data tidy: only known fields, sensible types.

export const KINDS = ["airline", "hotel", "card", "other"];

function str(v, max = 200) {
  return v === null || v === undefined || v === "" ? null : String(v).slice(0, max);
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function isoDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function cleanProgram(p) {
  return {
    id: str(p.id, 60) || cryptoId(),
    name: str(p.name, 80) || "Unnamed program",
    kind: KINDS.includes(p.kind) ? p.kind : "other",
    balance: num(p.balance),
    unit: str(p.unit, 20) || "points",
    tier: str(p.tier, 60),
    expires: str(p.expires, 40),
    memberLast4: str(p.memberLast4, 4),
    notes: str(p.notes, 500),
    // When YOU last confirmed / updated this number in the app.
    updatedAt: isoDate(p.updatedAt),
    // The date the balance was actually true (e.g. "as of" date in a statement).
    asOf: isoDate(p.asOf),
    // "paste", "manual" or "checked"
    source: str(p.source, 20),
    // Short quote from the pasted text that the number came from.
    evidence: str(p.evidence, 300),
    confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : null,
  };
}

export function cleanPrograms(list) {
  if (!Array.isArray(list)) throw new Error("programs must be a list");
  return list.slice(0, 200).map(cleanProgram);
}

function cryptoId() {
  return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
