const { google } = require('googleapis');
const http = require('http');
const { URL } = require('url');
const store = require('./store');

// A Google Cloud OAuth "Desktop app" client. This client id/secret is not a
// server secret in the traditional sense — Google's desktop-app OAuth flow
// treats it as public and requires the user to consent on Google's own
// sign-in page every time; no password is ever seen by this app.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_SECRET';
const REDIRECT_PORT = 43117;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function loadSavedClient() {
  const token = store.readJson(store.googleTokenPath(), null);
  if (!token) return null;
  const client = getOAuthClient();
  client.setCredentials(token);
  client.on('tokens', (tokens) => {
    const merged = { ...token, ...tokens };
    store.writeJson(store.googleTokenPath(), merged);
  });
  return client;
}

/**
 * Opens the user's default browser to Google's sign-in/consent screen and
 * waits for the redirect on a local loopback server, then stores the
 * resulting tokens on disk.
 */
async function signInInteractive(shellOpenExternal, onStatus) {
  const client = getOAuthClient();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

  onStatus && onStatus('Opening Google sign-in in your browser…');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const err = url.searchParams.get('error');
      const c = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>You can close this window and return to the app.</h2></body></html>');
      server.close();
      if (err) reject(new Error(`Google sign-in failed: ${err}`));
      else resolve(c);
    });
    server.listen(REDIRECT_PORT, () => {
      shellOpenExternal(authUrl);
    });
    server.on('error', reject);
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  store.writeJson(store.googleTokenPath(), tokens);
  onStatus && onStatus('Google account connected.');
  return true;
}

module.exports = { getOAuthClient, loadSavedClient, signInInteractive };
