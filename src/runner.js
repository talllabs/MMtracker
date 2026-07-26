const store = require('./store');
const linkedin = require('./linkedin');
const sheets = require('./sheets');

/**
 * Runs one full check: fetch LinkedIn search results with the saved login,
 * and append any posts not already present in the connected Google Sheet.
 * Used by both the "Run Now" button and the daily launchd trigger.
 */
async function runOnce(onStatus) {
  const config = store.getConfig();
  const startedAt = new Date().toISOString();

  if (!config.searchUrl) throw new Error('No LinkedIn search URL configured.');
  if (!config.sheetUrl) throw new Error('No Google Sheet connected.');

  const posts = await linkedin.fetchSearchResults(config.searchUrl, onStatus);
  onStatus && onStatus(`Checking ${posts.length} post(s) against the Google Sheet…`);
  const { checked, added } = await sheets.appendPosts(config.sheetUrl, posts, startedAt);

  const result = { at: startedAt, checked, added, error: null };
  store.saveConfig({ lastRun: result });
  return result;
}

async function runOnceSafe(onStatus) {
  try {
    return await runOnce(onStatus);
  } catch (err) {
    const result = { at: new Date().toISOString(), checked: 0, added: 0, error: err.message };
    store.saveConfig({ lastRun: result });
    throw err;
  }
}

module.exports = { runOnce, runOnceSafe };
