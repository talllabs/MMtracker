// Vercel serverless function that triggers the WebWatch monitor GitHub Actions
// workflow on demand, so the dashboard can offer a "Run Check Now" button
// instead of waiting for the daily schedule.
//
// Uses the same GITHUB_TOKEN as api/watchlist.js, but that token additionally
// needs the "Actions: Read and write" permission (in addition to "Contents:
// Read and write") for this dispatch call to succeed.

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPO = "talllabs/MMtracker";
const DEFAULT_BRANCH = "main";
const WORKFLOW_FILE = "webwatch-monitor.yml";

function checkPassword(req) {
  const expected = process.env.WEBWATCH_PASSWORD || "beta";
  const provided = req.headers["x-webwatch-password"] || (req.body && req.body.password) || "";
  return provided === expected;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!checkPassword(req)) {
    res.status(401).json({ error: "Incorrect password." });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;

  if (!token) {
    res.status(500).json({
      error: "GITHUB_TOKEN is not configured on the server. Add it in Vercel project settings to enable this.",
    });
    return;
  }

  try {
    const dispatchRes = await fetch(
      `${GITHUB_API}/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: branch }),
      }
    );

    if (dispatchRes.status === 204) {
      res.status(200).json({
        ok: true,
        message: "Check started. It usually takes about 20-30 seconds to finish.",
        actionsUrl: `https://github.com/${repo}/actions/workflows/${WORKFLOW_FILE}`,
      });
      return;
    }

    const data = await dispatchRes.json().catch(() => ({}));
    res.status(dispatchRes.status).json({
      error:
        data.message ||
        `GitHub API returned ${dispatchRes.status}. The token may be missing "Actions: Read and write" permission.`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
