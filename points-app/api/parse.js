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
  name: z.string().describe("Program name, e.g. 'United MileagePlus', 'Marriott Bonvoy', 'Chase Ultimate Rewards'"),
  kind: z.enum(["airline", "hotel", "card", "other"]),
  balance: z.number().nullable().describe("Points/miles balance as a plain number, null if not stated"),
  unit: z.string().describe("'miles' or 'points' (or what the program calls them)"),
  tier: z.string().nullable().describe("Elite status / tier if stated"),
  expires: z.string().nullable().describe("Expiration date or rule if stated, as written"),
  memberLast4: z.string().nullable().describe("Last 4 characters of the member/account number if visible. Never more than 4."),
  asOf: z.string().nullable().describe("Date the balance was true if the text states one (YYYY-MM-DD), else null"),
  evidence: z.string().describe("Short exact quote from the pasted text that shows this number"),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().describe("One short sentence explaining the change, for a non-technical reader"),
});

const Result = z.object({
  changes: z.array(Change),
  warnings: z.array(z.string()).describe("Anything ambiguous the user should double-check"),
});

const SYSTEM = `You read raw text a person copied from airline, hotel and credit card websites, apps, emails or statements, and turn it into balance updates for their personal points tracker.

Rules:
- Only report numbers that are actually in the text. Never guess or estimate a balance.
- Match to an existing program when it is clearly the same account (e.g. "MileagePlus" = "United MileagePlus", "Amex MR" = "American Express Membership Rewards"). Use action "update" with its programId. Otherwise use "add".
- If the balance shown equals the existing balance, still include it (it confirms the number is current).
- Pending, projected, or "points earned this trip" numbers are NOT the balance. Skip them or mention them in warnings.
- confidence: "high" when the text clearly labels the number as the current balance for that program; "medium" when labelling is a little unclear; "low" when you had to infer which program or which number.
- Never output full account numbers, only the last 4 characters.
- If nothing usable is in the text, return an empty changes list and explain in warnings.`;

export default async function handler(req, res) {
  if (!requireLogin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text } = readJson(req);
    if (!text || !String(text).trim()) return res.status(400).json({ error: "Paste some text first." });
    if (String(text).length > 100_000) return res.status(400).json({ error: "That's a lot of text — try pasting one page at a time." });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel environment variables." });
    }

    const data = await loadData();
    const existing = data.programs.map((p) => ({
      id: p.id, name: p.name, kind: p.kind, balance: p.balance, unit: p.unit, tier: p.tier,
    }));

    const client = new Anthropic();
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `Today is ${new Date().toISOString().slice(0, 10)}.\n\n` +
            `My existing programs:\n${JSON.stringify(existing, null, 2)}\n\n` +
            `Pasted text:\n<pasted>\n${text}\n</pasted>`,
        },
      ],
      output_config: { format: zodOutputFormat(Result) },
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "The AI couldn't read that text. Try pasting a smaller part." });
    }
    if (!response.parsed_output) {
      return res.status(502).json({ error: "The AI reply was incomplete. Please try again." });
    }

    // Make sure "update" only points at programs that really exist.
    const ids = new Set(data.programs.map((p) => p.id));
    const changes = response.parsed_output.changes.map((c) =>
      c.action === "update" && !ids.has(c.programId) ? { ...c, action: "add", programId: null } : c,
    );

    res.status(200).json({ changes, warnings: response.parsed_output.warnings });
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
