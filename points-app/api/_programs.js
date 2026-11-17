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
    owner: str(p.owner, 40),
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

export const BOOKING_TYPES = ["flight", "hotel", "car", "other"];

function dateOnly(v) {
  const s = str(v, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function httpsUrl(v) {
  const s = str(v, 1000);
  try {
    return s && new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

export function cleanBooking(b) {
  return {
    id: str(b.id, 60) || cryptoId().replace("p_", "b_"),
    type: BOOKING_TYPES.includes(b.type) ? b.type : "other",
    provider: str(b.provider, 60) || "Unknown",
    owner: str(b.owner, 40),
    title: str(b.title, 120) || "Booking",
    location: str(b.location, 160),
    startDate: dateOnly(b.startDate),
    startTime: str(b.startTime, 20),
    endDate: dateOnly(b.endDate),
    confirmation: str(b.confirmation, 40),
    travelers: str(b.travelers, 200),
    price: str(b.price, 40),
    cancelBy: dateOnly(b.cancelBy),
    cancelPolicy: str(b.cancelPolicy, 300),
    cancelUrl: httpsUrl(b.cancelUrl),
    status: b.status === "cancelled" ? "cancelled" : "confirmed",
    notes: str(b.notes, 500),
    evidence: str(b.evidence, 300),
    confidence: ["high", "medium", "low"].includes(b.confidence) ? b.confidence : null,
    updatedAt: isoDate(b.updatedAt),
    source: str(b.source, 20),
  };
}

export function cleanBookings(list) {
  if (!Array.isArray(list)) throw new Error("bookings must be a list");
  return list.slice(0, 300).map(cleanBooking);
}

export function cleanPrograms(list) {
  if (!Array.isArray(list)) throw new Error("programs must be a list");
  return list.slice(0, 200).map(cleanProgram);
}

function cryptoId() {
  return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
