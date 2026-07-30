# LinkedIn → Google Sheets Daily Sync

A small Mac app that checks a LinkedIn search once a day and adds any new
posts to a Google Sheet you choose. No Terminal required.

## Getting the app onto your Mac

You don't need to build anything yourself. Every time this project changes:

1. Go to the repository's **Actions** tab on GitHub.
2. Open the latest **Build macOS App** run (green checkmark).
3. Scroll down to **Artifacts** and download **LinkedIn-Sheets-Sync-mac** — it's a zip containing the `.dmg` installer.
4. Double-click the `.dmg`, then drag **LinkedIn Sheets Sync** into your Applications folder.
5. Double-click the app in Applications to open it. (First time only: if macOS
   says it can't verify the developer, right-click the app icon, choose
   **Open**, then confirm **Open** again.)

## First-run setup wizard

When you open the app you'll see four steps:

1. **LinkedIn search** — a default search link for "rfp tourism" (past week)
   is pre-filled. Paste a different LinkedIn search link here if you want to
   track something else, then click **Save search link**.
2. **LinkedIn login** — click **Log in to LinkedIn**. A real, visible
   Chrome-like window opens on LinkedIn's own login page. Log in there as you
   normally would — the app never sees or stores your password, only that
   you're logged in.
3. **Google Sheet** — click **Sign in with Google** (this opens your regular
   browser to Google's own sign-in page), then paste the link to the Google
   Sheet you want new posts added to and click **Save Google Sheet**. The
   sheet gets these columns automatically: LinkedIn Post ID, Date Found,
   Author, Post Date, Post Text, LinkedIn Post URL, External Links.
4. **Run it** — click **Run Now** to test it immediately, or click
   **Install Daily Check** to have it run automatically every day at 8:00 AM
   whenever your Mac is awake.

The **Status** section always shows the last run time, how many posts were
checked, how many new ones were added, and any login errors.

If LinkedIn ever logs you out (session expired), click **Reconnect LinkedIn**
and log in again the same way.

## What this app does *not* do

- It never asks for or stores your LinkedIn password.
- It does not message anyone, collect emails, or scrape personal profiles —
  it only reads public post content from the search results page you gave it.

## For developers: building locally on a Mac

```
npm install
npm start          # run the app
npm run dist        # build dist/*.dmg (must be run on macOS)
```

### One-time Google Cloud setup (only needed if you fork this and want your
own OAuth client)

1. Create a Google Cloud project, enable the **Google Sheets API**.
2. Create an OAuth **Desktop app** client ID.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as environment variables
   before building, or edit `src/googleAuth.js` directly.
