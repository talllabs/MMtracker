const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_SEARCH_URL =
  'https://www.linkedin.com/search/results/content/?keywords=rfp%20tourism&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D&datePosted=%5B%22past-week%22%5D';

function userDataDir() {
  return app.getPath('userData');
}

function configPath() {
  return path.join(userDataDir(), 'config.json');
}

function linkedinStatePath() {
  return path.join(userDataDir(), 'linkedin-state.json');
}

function googleTokenPath() {
  return path.join(userDataDir(), 'google-token.json');
}

function logPath() {
  return path.join(userDataDir(), 'run-log.json');
}

const DEFAULT_CONFIG = {
  searchUrl: DEFAULT_SEARCH_URL,
  sheetUrl: '',
  sheetId: '',
  dailyCheckInstalled: false,
  lastRun: null // { at, checked, added, error }
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getConfig() {
  return { ...DEFAULT_CONFIG, ...readJson(configPath(), {}) };
}

function saveConfig(partial) {
  const merged = { ...getConfig(), ...partial };
  writeJson(configPath(), merged);
  return merged;
}

function hasLinkedinSession() {
  return fs.existsSync(linkedinStatePath());
}

function hasGoogleToken() {
  return fs.existsSync(googleTokenPath());
}

function clearLinkedinSession() {
  try {
    fs.unlinkSync(linkedinStatePath());
  } catch (e) {
    /* ignore */
  }
}

module.exports = {
  DEFAULT_SEARCH_URL,
  userDataDir,
  configPath,
  linkedinStatePath,
  googleTokenPath,
  logPath,
  getConfig,
  saveConfig,
  hasLinkedinSession,
  hasGoogleToken,
  clearLinkedinSession,
  readJson,
  writeJson
};
