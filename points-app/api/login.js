import { checkPassword, sessionCookie, clearCookie, isLoggedIn, readJson, sendError } from "./_lib.js";

// GET    /api/login  → { loggedIn: true/false }
// POST   /api/login  { password }  → sets the session cookie
// DELETE /api/login  → logs out
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({ loggedIn: isLoggedIn(req) });
    }
    if (req.method === "DELETE") {
      res.setHeader("Set-Cookie", clearCookie());
      return res.status(200).json({ ok: true });
    }
    if (req.method === "POST") {
      const { password } = readJson(req);
      if (!password || !checkPassword(password)) {
        // Small pause makes guessing passwords slow.
        await new Promise((r) => setTimeout(r, 800));
        return res.status(401).json({ error: "Wrong password" });
      }
      res.setHeader("Set-Cookie", sessionCookie());
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    sendError(res, err);
  }
}
