const $ = (id) => document.getElementById(id);

function setDot(el, ok) {
  el.classList.toggle('ok', !!ok);
}

function logLine(text) {
  const box = $('liveStatus');
  box.textContent += (box.textContent ? '\n' : '') + text;
  box.scrollTop = box.scrollHeight;
}

async function refresh() {
  const state = await window.api.getState();
  $('searchUrl').value = state.config.searchUrl || '';
  $('sheetUrl').value = state.config.sheetUrl || '';

  setDot($('linkedin-dot'), state.hasLinkedin);
  $('linkedin-status').textContent = state.hasLinkedin ? 'Connected' : 'Not connected';

  setDot($('google-dot'), state.hasGoogle);
  $('google-status').textContent = state.hasGoogle ? 'Connected' : 'Not connected';

  $('daily-status').textContent = state.dailyCheckInstalled
    ? 'Daily Check is installed — runs every day at 8:00 AM while your Mac is awake.'
    : 'Daily Check is not installed yet.';

  const lastRun = state.config.lastRun;
  $('lastRunAt').textContent = lastRun ? new Date(lastRun.at).toLocaleString() : 'never';
  $('lastRunChecked').textContent = lastRun ? lastRun.checked : '–';
  $('lastRunAdded').textContent = lastRun ? lastRun.added : '–';
  $('lastRunError').textContent = lastRun && lastRun.error ? lastRun.error : 'none';
}

function busy(button, isBusy, busyLabel) {
  button.disabled = isBusy;
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
  } else {
    button.textContent = button.dataset.label || button.textContent;
  }
}

window.api.onStatus((message) => logLine(message));

$('saveSearchUrl').addEventListener('click', async () => {
  await window.api.saveSearchUrl($('searchUrl').value.trim());
  logLine('Saved LinkedIn search link.');
  refresh();
});

$('saveSheetUrl').addEventListener('click', async () => {
  await window.api.saveSheetUrl($('sheetUrl').value.trim());
  logLine('Saved Google Sheet.');
  refresh();
});

$('linkedinLogin').addEventListener('click', async () => {
  const btn = $('linkedinLogin');
  busy(btn, true, 'Waiting for login…');
  try {
    await window.api.linkedinLogin();
    logLine('LinkedIn connected.');
  } catch (e) {
    logLine('LinkedIn login error: ' + e.message);
  }
  busy(btn, false);
  refresh();
});

$('linkedinReconnect').addEventListener('click', async () => {
  const btn = $('linkedinReconnect');
  busy(btn, true, 'Waiting for login…');
  try {
    await window.api.linkedinReconnect();
    logLine('LinkedIn reconnected.');
  } catch (e) {
    logLine('LinkedIn reconnect error: ' + e.message);
  }
  busy(btn, false);
  refresh();
});

$('googleConnect').addEventListener('click', async () => {
  const btn = $('googleConnect');
  busy(btn, true, 'Waiting for sign-in…');
  try {
    await window.api.googleConnect();
    logLine('Google account connected.');
  } catch (e) {
    logLine('Google sign-in error: ' + e.message);
  }
  busy(btn, false);
  refresh();
});

$('runNow').addEventListener('click', async () => {
  const btn = $('runNow');
  busy(btn, true, 'Running…');
  logLine('--- Run started ---');
  try {
    const result = await window.api.runNow();
    logLine(`Done. Checked ${result.checked}, added ${result.added}.`);
  } catch (e) {
    logLine('Run failed: ' + e.message);
  }
  busy(btn, false);
  refresh();
});

$('installDaily').addEventListener('click', async () => {
  await window.api.installDailyCheck();
  logLine('Daily Check installed for 8:00 AM.');
  refresh();
});

$('uninstallDaily').addEventListener('click', async () => {
  await window.api.uninstallDailyCheck();
  logLine('Daily Check turned off.');
  refresh();
});

refresh();
