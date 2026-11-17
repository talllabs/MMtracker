import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireLogin, loadData, readJson, sendError } from "./_lib.js";

// POST /api/parse { text } → a list of SUGGESTED changes.
// Nothing is saved here. The app shows you the suggestions and you tap "Apply".

export const config = { maxDuration: 60 };

const Change = z.object({
  action: z.enum(["update", "add"]),
  programId: z.string().nullable().describe("id of the existing program for 'update', null for 'add'"),
  owner: z.string().nullable().describe("Whose account this is, if the text says (a person's first name), else null"),
  name: z.string().describe("Program name, e.g. 'United MileagePlus', 'Marriott Bonvoy', 'Chase Ultimate Rewards'"),
  kind: z.enum(["airline", "hotel", "card", "other"]),
  balance: z.number().nullable().describe("Points/miles balance as a plain number, null if not stated"),
  unit: z.string().describe("'miles' or 'points' (or what the program calls them)"),
  tier: z.string().nullable().describe("Elite status / tier if stated"),
  expires: z.string().nullable().describe("Expiration date or rule if stated, as written"),
  memberLast4: z.string().nullable().describe("Last 4 characters of the member/account number if visible. Never more than 4."),
  notes: z.string().nullable().describe("Short useful note from the text about this account (e.g. expected bonus, plan to cancel), else null"),
  asOf: z.string().nullable().describe("Date the balance was true if the text states one (YYYY-MM-DD), else null"),
  evidence: z.string().describe("Short exact quote from the pasted text that shows this number"),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().describe("One short sentence explaining the change, for a non-technical reader"),
});

const Booking = z.object({
  action: z.enum(["update", "add"]),
  bookingId: z.string().nullable().describe("id of the existing booking for 'update' (same confirmation code / same trip), null for 'add'"),
  type: z.enum(["flight", "hotel", "car", "other"]),
  provider: z.string().describe("Company, e.g. 'United', 'Marriott', 'Hertz', 'Airbnb'"),
  owner: z.string().nullable().describe("Traveler / whose booking, first name, if stated"),
  title: z.string().describe("Short label: for flights 'SFO → JFK' (add flight number if known, e.g. 'UA 1234 SFO → JFK'); for hotels the hotel name"),
  location: z.string().nullable().describe("City or address for hotels/cars, else null"),
  startDate: z.string().nullable().describe("Departure / check-in date as YYYY-MM-DD"),
  startTime: z.string().nullable().describe("Departure / check-in time as written, e.g. '7:15 AM'"),
  endDate: z.string().nullable().describe("Return / check-out date as YYYY-MM-DD"),
  confirmation: z.string().nullable().describe("Confirmation / record locator code exactly as written"),
  travelers: z.string().nullable().describe("Names of travelers if listed"),
  price: z.string().nullable().describe("Total price as written, e.g. '$412.30' or '25,000 miles'"),
  cancelBy: z.string().nullable().describe("Last date to cancel for free/refund as YYYY-MM-DD, only if the text states it"),
  cancelPolicy: z.string().nullable().describe("Short summary of the cancellation rule if stated"),
  cancelUrl: z.string().nullable().describe("A manage/cancel/view-reservation link that appears in the text (must start with https://), else null. Never invent a link."),
  status: z.enum(["confirmed", "cancelled"]),
  notes: z.string().nullable(),
  evidence: z.string().describe("Short exact quote from the text identifying this booking"),
  confidence: z.enum(["high", "medium", "low"]),
});

const Result = z.object({
  changes: z.array(Change),
  bookings: z.array(Booking).describe("Flights, hotel stays, car rentals and other reservations found in the text"),
  warnings: z.array(z.string()).describe("Anything ambiguous the user should double-check"),
});

const SYSTEM = `You read raw text a person copied from airline, hotel and credit card websites, apps, emails or statements, and turn it into (1) points balance updates and (2) travel bookings for their personal tracker.

Rules:
- Only report numbers that are actually in the text. Never guess or estimate a balance.
- The text may list accounts for several people. The same program for two different people is two separate accounts: match on BOTH the program and the owner, and never merge different owners.
- A business account (e.g. "AAdvantage Business", "Marriott Business") is a different account from a person's personal account in the same airline/hotel, even if that person's name appears on the business page. Never merge business and personal accounts; name business ones clearly, e.g. "AAdvantage Business – Meaningful Marketing".
- If the user writes a note in the text saying an account is shared (e.g. "shared: Brad & Ally"), set owner to the names joined with " & ", e.g. "Brad & Ally". Notes the user adds to the pasted text describe how to file it; follow them.
- Match to an existing program when it is clearly the same account (e.g. "MileagePlus" = "United MileagePlus", "Amex MR" = "American Express Membership Rewards"). Use action "update" with its programId. Otherwise use "add".
- If the balance shown equals the existing balance, still include it (it confirms the number is current).
- Pending, projected, or "points earned this trip" numbers are NOT the balance. Skip them or mention them in warnings.
- confidence: "high" when the text clearly labels the number as the current balance for that program; "medium" when labelling is a little unclear; "low" when you had to infer which program or which number.
- Never output full account numbers, only the last 4 characters.
- Bookings: list each flight itinerary, hotel stay, car rental or other reservation once. A round trip on one confirmation is ONE booking. Match an existing booking by confirmation code (use "update" with its bookingId). If the text says a booking was cancelled, set status "cancelled".
- Only put a cancelUrl if that exact https link is in the text. Only put cancelBy if a deadline is stated.
- If nothing usable is in the text, return empty lists and explain in warnings.`;

export default async function handler(req, res) {
  if (!requireLogin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text } = readJson(req);
    if (!text || !String(text).trim()) return res.status(400).json({ error: "Paste some text first." });
    if (String(text).length > 100_000) return res.status(400).json({ error: "That's a lot of text — try pasting one page at a time." });
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "No AI key found. Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) in Vercel environment variables." });
    }

    const data = await loadData();
    const existing = data.programs.map((p) => ({
      id: p.id, owner: p.owner, name: p.name, kind: p.kind, balance: p.balance, unit: p.unit, tier: p.tier,
    }));
    const existingBookings = (data.bookings || []).map((b) => ({
      id: b.id, type: b.type, provider: b.provider, title: b.title, startDate: b.startDate, confirmation: b.confirmation, owner: b.owner,
    }));
    const userContent =
      `Today is ${new Date().toISOString().slice(0, 10)}.\n\n` +
      `My existing programs:\n${JSON.stringify(existing, null, 2)}\n\n` +
      `My existing bookings:\n${JSON.stringify(existingBookings, null, 2)}\n\n` +
      `Pasted text:\n<pasted>\n${text}\n</pasted>`;

    // Uses Claude if ANTHROPIC_API_KEY is set, otherwise OpenAI.
    const result = process.env.ANTHROPIC_API_KEY
      ? await readWithClaude(userContent)
      : await readWithOpenAI(userContent);
    if (result.error) return res.status(result.status).json({ error: result.error });

    // Make sure "update" only points at programs that really exist.
    const ids = new Set(data.programs.map((p) => p.id));
    const changes = result.output.changes.map((c) =>
      c.action === "update" && !ids.has(c.programId) ? { ...c, action: "add", programId: null } : c,
    );

    const bookingIds = new Set((data.bookings || []).map((b) => b.id));
    const bookings = result.output.bookings.map((b) => ({
      ...b,
      ...(b.action === "update" && !bookingIds.has(b.bookingId) ? { action: "add", bookingId: null } : {}),
      cancelUrl: b.cancelUrl && /^https:\/\//i.test(b.cancelUrl) && text.includes(b.cancelUrl) ? b.cancelUrl : null,
    }));

    res.status(200).json({ changes, bookings, warnings: result.output.warnings });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many requests to the AI right now. Wait a minute and try again." });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: "The ANTHROPIC_API_KEY in Vercel isn't valid." });
    }
    sendError(res, err);
  }
}

// ---------- Claude (used when ANTHROPIC_API_KEY is set) ----------
async function readWithClaude(userContent) {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(Result) },
  });
  if (response.stop_reason === "refusal") {
    return { status: 422, error: "The AI couldn't read that text. Try pasting a smaller part." };
  }
  if (!response.parsed_output) {
    return { status: 502, error: "The AI reply was incomplete. Please try again." };
  }
  return { output: response.parsed_output };
}

// ---------- OpenAI (used when only OPENAI_API_KEY is set) ----------
// Same approach as webwatch_monitor.py: a direct call, with the model set by
// OPENAI_MODEL (defaults to gpt-4o-mini).
async function readWithOpenAI(userContent) {
  const { $schema, ...schema } = z.toJSONSchema(Result);
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "points_updates", strict: true, schema },
      },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) return { status: 500, error: "The OPENAI_API_KEY in Vercel isn't valid." };
  if (r.status === 429) return { status: 429, error: "Too many requests to the AI right now (or your OpenAI account is out of credit). Try again in a minute." };
  if (!r.ok) return { status: 502, error: `OpenAI error: ${body.error?.message || r.status}` };

  const message = body.choices?.[0]?.message;
  if (message?.refusal) return { status: 422, error: "The AI couldn't read that text. Try pasting a smaller part." };
  let parsed;
  try {
    parsed = Result.safeParse(JSON.parse(message?.content || ""));
  } catch {
    parsed = { success: false };
  }
  if (!parsed.success) return { status: 502, error: "The AI reply was incomplete. Please try again." };
  return { output: parsed.data };
}
