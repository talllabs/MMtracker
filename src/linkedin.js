const { chromium } = require('playwright');
const store = require('./store');

/**
 * Opens a visible Chromium window on linkedin.com/login and waits for the
 * user to log in themselves (no password is ever requested or read by the
 * app). Once LinkedIn shows a logged-in page, the session (cookies/local
 * storage) is saved to disk so future runs are automatic.
 */
async function loginInteractive(onStatus) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  onStatus && onStatus('Opening LinkedIn login page…');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  onStatus && onStatus('Please log in to LinkedIn in the browser window that opened.');

  // Wait until the user reaches a logged-in page (feed, mynetwork, etc.)
  // Poll instead of a single waitForURL so we tolerate 2FA / checkpoint pages.
  const loggedInUrlPattern = /linkedin\.com\/(feed|mynetwork|checkpoint\/challenge)/;
  const timeoutMs = 10 * 60 * 1000; // give the user up to 10 minutes
  const start = Date.now();
  let loggedIn = false;

  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    if (/linkedin\.com\/feed/.test(url)) {
      loggedIn = true;
      break;
    }
    if (page.isClosed()) break;
    await page.waitForTimeout(1000);
  }

  if (!loggedIn) {
    await browser.close();
    throw new Error('Login was not completed (timed out or window was closed).');
  }

  onStatus && onStatus('Login detected. Saving session…');
  await context.storageState({ path: store.linkedinStatePath() });
  await browser.close();
  return true;
}

function parsePostIdFromUrl(url) {
  if (!url) return null;
  const activityMatch = url.match(/activity[-:](\d+)/);
  if (activityMatch) return activityMatch[1];
  const ugcMatch = url.match(/ugcPost[-:](\d+)/);
  if (ugcMatch) return ugcMatch[1];
  const urnMatch = url.match(/urn:li:(?:activity|ugcPost):(\d+)/);
  if (urnMatch) return urnMatch[1];
  return url;
}

/**
 * Loads the given LinkedIn content-search URL in a visible browser using the
 * saved login session, and extracts each post's id, author, post date,
 * text, canonical URL, and any external links found in the post text.
 */
async function fetchSearchResults(searchUrl, onStatus) {
  if (!store.hasLinkedinSession()) {
    throw new Error('No saved LinkedIn login. Click "Log in to LinkedIn" first.');
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: store.linkedinStatePath() });
  const page = await context.newPage();

  try {
    onStatus && onStatus('Opening LinkedIn search results…');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // If we get bounced to the login page, the saved session has expired.
    await page.waitForTimeout(2000);
    if (/linkedin\.com\/(login|checkpoint)/.test(page.url())) {
      throw new Error('LinkedIn session expired. Click "Reconnect LinkedIn".');
    }

    onStatus && onStatus('Scrolling through results…');
    // Scroll a handful of times to load more results in the feed-style list.
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(1200);
    }

    const posts = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('div.reusable-search__result-container, li.reusable-search__result-container');
      cards.forEach((card) => {
        const linkEl = card.querySelector('a[href*="/feed/update/"], a[href*="/posts/"]');
        const url = linkEl ? linkEl.href.split('?')[0] : null;

        const authorEl = card.querySelector('.entity-result__title-text a, span[dir="ltr"] span[aria-hidden="true"]');
        const author = authorEl ? authorEl.textContent.trim() : null;

        const textEl = card.querySelector('.entity-result__content-summary, span.break-words');
        const text = textEl ? textEl.textContent.trim() : (card.innerText || '').trim();

        const timeEl = card.querySelector('time, span.entity-result__simple-insight-text');
        const postDate = timeEl ? timeEl.textContent.trim() : null;

        if (url || text) {
          results.push({ url, author, text, postDate });
        }
      });
      return results;
    });

    onStatus && onStatus(`Found ${posts.length} post(s) on the page.`);

    const linkRegex = /https?:\/\/[^\s)]+/g;
    const enriched = posts.map((p) => {
      const externalLinks = ((p.text || '').match(linkRegex) || []).filter(
        (l) => !l.includes('linkedin.com')
      );
      return {
        postId: parsePostIdFromUrl(p.url) || (p.text ? p.text.slice(0, 40) : Math.random().toString(36)),
        author: p.author || '',
        postDate: p.postDate || '',
        text: p.text || '',
        url: p.url || '',
        externalLinks: externalLinks.join(', ')
      };
    });

    return enriched;
  } finally {
    await browser.close();
  }
}

module.exports = { loginInteractive, fetchSearchResults, parsePostIdFromUrl };
