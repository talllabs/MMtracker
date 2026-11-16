const { google } = require('googleapis');
const googleAuth = require('./googleAuth');

const HEADER = ['LinkedIn Post ID', 'Date Found', 'Author', 'Post Date', 'Post Text', 'LinkedIn Post URL', 'External Links'];

function extractSheetId(urlOrId) {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId.trim();
}

async function getSheetsClient() {
  const auth = googleAuth.loadSavedClient();
  if (!auth) throw new Error('Google account not connected. Click "Connect Google Sheet" first.');
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeader(sheets, sheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'A1:G1' });
  const row = (res.data.values && res.data.values[0]) || [];
  if (row.join('|') !== HEADER.join('|')) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'A1:G1',
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] }
    });
  }
}

async function getExistingIds(sheets, sheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'A2:F' });
  const rows = res.data.values || [];
  const ids = new Set();
  rows.forEach((r) => {
    if (r[0]) ids.add(r[0]);
    if (r[5]) ids.add(r[5]); // also dedupe by URL, in case IDs vary
  });
  return ids;
}

async function appendPosts(sheetUrlOrId, posts, dateFoundIso) {
  const sheetId = extractSheetId(sheetUrlOrId);
  const sheets = await getSheetsClient();
  await ensureHeader(sheets, sheetId);
  const existingIds = await getExistingIds(sheets, sheetId);

  const newRows = [];
  for (const p of posts) {
    const key = p.postId || p.url;
    if (!key) continue;
    if (existingIds.has(key) || (p.url && existingIds.has(p.url))) continue;
    existingIds.add(key);
    if (p.url) existingIds.add(p.url);
    newRows.push([p.postId, dateFoundIso, p.author, p.postDate, p.text, p.url, p.externalLinks]);
  }

  if (newRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: newRows }
    });
  }

  return { checked: posts.length, added: newRows.length };
}

module.exports = { extractSheetId, appendPosts };
