// Shared helpers for the API routes.
// Files that start with "_" inside /api are NOT turned into routes by Vercel.

import crypto from "node:crypto";

// ---------- Password / session ----------

const COOKIE = "pts_session";
const SESSION_DAYS = 30;

function password() {
  const p = process.env.APP_PASSWORD;
  if (!p) throw new Error("APP_PASSWORD is not set in Vercel environment variables.");
  return p;
}

// The cookie is "<expiry>.<signature>". The signature is made with your
// password, so changing APP_PASSWORD in Vercel logs every device out.
function sign(expiry) {
  return crypto.createHmac("sha256", password()).update(`points-session:${expiry}`).digest("hex");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkPassword(attempt) {
  // Hash both sides first so the comparison takes the same time for any length.
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
  return safeEqual(h(attempt), h(password()));
}

export function sessionCookie() {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const value = `${expiry}.${sign(expiry)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function isLoggedIn(req) {
  const raw = req.headers.cookie || "";
  const match = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return false;
  const [expiry, sig] = match.slice(COOKIE.length + 1).split(".");
  if (!expiry || !sig || Number(expiry) < Date.now()) return false;
  return safeEqual(sig, sign(expiry));
}

// Use at the top of every protected route. Returns true if the request may continue.
export function requireLogin(req, res) {
  if (isLoggedIn(req)) return true;
  res.status(401).json({ error: "Not logged in" });
  return false;
}

// ---------- Storage (Upstash Redis via its REST API) ----------
// Add the "Upstash for Redis" integration in Vercel → Storage. It creates these
// environment variables for you automatically.

const DATA_KEY = "points-app:data:v1";

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Database not connected. In Vercel, open Storage and add Upstash for Redis to this project.");
  }
  return { url, token };
}

async function redis(command) {
  const { url, token } = redisConfig();
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await r.json();
  if (!r.ok || body.error) throw new Error(`Database error: ${body.error || r.status}`);
  return body.result;
}

export function emptyData() {
  return { programs: [], activity: [], updatedAt: null };
}

export async function loadData() {
  const raw = await redis(["GET", DATA_KEY]);
  if (!raw) return emptyData();
  return { ...emptyData(), ...JSON.parse(raw) };
}

export async function saveData(data) {
  await redis(["SET", DATA_KEY, JSON.stringify(data)]);
}

// ---------- Misc ----------

export function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  return {};
}

export function sendError(res, err) {
  console.error(err);
  res.status(500).json({ error: err.message || "Something went wrong" });
}
