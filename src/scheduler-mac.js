const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');

const LABEL = 'com.meaningfulmarketing.linkedinsheetssync.dailycheck';

function plistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function logsDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Installs a launchd LaunchAgent that runs this app once a day at 8:00 AM
 * with a hidden "--run-daily" flag. launchd fires this automatically as
 * long as the Mac is awake (and will run it soon after wake if the Mac was
 * asleep at 8:00 AM).
 */
function install() {
  const appPath = app.getPath('exe');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${appPath}</string>
    <string>--run-daily</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${logsDir()}/daily-check.log</string>
  <key>StandardErrorPath</key>
  <string>${logsDir()}/daily-check.err.log</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.writeFileSync(plistPath(), plist, 'utf8');

  return new Promise((resolve, reject) => {
    execFile('launchctl', ['load', '-w', plistPath()], (err, stdout, stderr) => {
      // launchctl exits non-zero if it's already loaded; treat that as OK.
      resolve({ stdout, stderr });
    });
  });
}

function uninstall() {
  return new Promise((resolve) => {
    execFile('launchctl', ['unload', plistPath()], () => {
      try {
        fs.unlinkSync(plistPath());
      } catch (e) {
        /* ignore */
      }
      resolve();
    });
  });
}

function isInstalled() {
  return fs.existsSync(plistPath());
}

module.exports = { install, uninstall, isInstalled, plistPath, LABEL };
