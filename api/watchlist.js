// Vercel serverless function backing the WebWatch "URLs to watch" database.
//
// Persists the watchlist to webwatch-watchlist.csv in this repo via the
// GitHub Contents API, so entries survive redeploys and are never lost.
//
// Required Vercel project env vars:
//   GITHUB_TOKEN   - a GitHub PAT (or fine-grained token) with "contents: write"
//                     on this repo
//   GITHUB_REPO    - "owner/repo", e.g. "talllabs/MMtracker" (optional, this is the default)
//   GITHUB_BRANCH  - branch to commit to (optional, defaults to "main")
//   WEBWATCH_PASSWORD - shared password gate for write access (optional, defaults to "beta")

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPO = "talllabs/MMtracker";
const DEFAULT_BRANCH = "main";
const WATCHLIST_PATH = "webwatch-watchlist.csv";

// RFC4180-ish CSV parser: handles quoted fields with embedded commas,
// quotes ("") and newlines. Naive split(',') corrupts any row where a URL
// (e.g. a query string) contains a comma inside quotes.
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const entries = [];
  for (const [name, url] of rows.slice(1)) {
    if (url && url.trim()) {
      entries.push({ name: (name || "").trim(), url: url.trim() });
    }
  }
  return entries;
}

function toCsv(rows) {
  const header = "name,url";
  const body = rows.map((r) => `${csvEscape(r.name)},${csvEscape(r.url)}`).join("\n");
  return `${header}\n${body}\n`;
}

function csvEscape(value) {
  const v = String(value ?? "");
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

async function githubRequest(path, token, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `GitHub API error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getWatchlistFile(repo, branch, token) {
  try {
    const data = await githubRequest(
      `/repos/${repo}/contents/${WATCHLIST_PATH}?ref=${encodeURIComponent(branch)}`,
      token
    );
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { rows: parseCsv(content), sha: data.sha };
  } catch (e) {
    if (e.status === 404) return { rows: [], sha: undefined };
    throw e;
  }
}

async function putWatchlistFile(repo, branch, token, rows, sha, message) {
  const content = Buffer.from(toCsv(rows), "utf-8").toString("base64");
  await githubRequest(`/repos/${repo}/contents/${WATCHLIST_PATH}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content,
      branch,
      sha,
      committer: { name: "WebWatch Dashboard", email: "webwatch@users.noreply.github.com" },
    }),
  });
}

function checkPassword(req) {
  const expected = process.env.WEBWATCH_PASSWORD || "beta";
  const provided = req.headers["x-webwatch-password"] || (req.body && req.body.password) || "";
  return provided === expected;
}

module.exports = async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;

  if (req.method === "GET") {
    if (!token) {
      res.status(200).json({ rows: [], warning: "GITHUB_TOKEN not configured on the server yet." });
      return;
    }
    try {
      const { rows } = await getWatchlistFile(repo, branch, token);
      res.status(200).json({ rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (req.method === "POST") {
    if (!checkPassword(req)) {
      res.status(401).json({ error: "Incorrect password." });
      return;
    }
    if (!token) {
      res.status(500).json({
        error: "GITHUB_TOKEN is not configured on the server. Add it in Vercel project settings to enable saving.",
      });
      return;
    }

    const incoming = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const cleanIncoming = incoming
      .map((e) => ({ name: String(e.name || "").trim(), url: String(e.url || "").trim() }))
      .filter((e) => e.url);

    if (cleanIncoming.length === 0) {
      res.status(400).json({ error: "No valid entries provided (each needs at least a url)." });
      return;
    }

    try {
      const { rows: existing, sha } = await getWatchlistFile(repo, branch, token);
      const byUrl = new Map(existing.map((r) => [r.url, r]));
      let added = 0;
      let updated = 0;
      for (const entry of cleanIncoming) {
        if (byUrl.has(entry.url)) {
          if (entry.name && byUrl.get(entry.url).name !== entry.name) {
            byUrl.set(entry.url, entry);
            updated += 1;
          }
        } else {
          byUrl.set(entry.url, entry);
          added += 1;
        }
      }
      const merged = Array.from(byUrl.values());
      await putWatchlistFile(
        repo,
        branch,
        token,
        merged,
        sha,
        `Update WebWatch watchlist via dashboard (+${added} new, ${updated} updated)`
      );
      res.status(200).json({ rows: merged, added, updated, total: merged.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
