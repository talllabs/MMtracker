# Points Wallet

A private, phone-friendly tracker for your airline miles, hotel points and credit card points.

- **Paste anything.** Copy text from an airline, hotel or card account page, app, email or statement and paste it in. The AI finds the balances and shows you what it found. Nothing is saved until you tap **Apply**.
- **You can always see how accurate it is.** Every balance has a colored label:
  - 🟢 **Up to date**: updated in the last 7 days
  - 🟠 **Getting old**: 8–30 days
  - 🔴 **Out of date**: more than 30 days
  - The top of the screen tells you how many are current and which one is oldest.
  - Paste updates also show how sure the AI was ("Confident", "Probably right", "Double-check") and the exact words it read the number from.
- **Easy edits.** Tap any card to change it, or tap **✓ Balance is still correct** to mark it as checked today.
- **Password protected.** Nothing loads until you enter your password.

This folder is completely separate from the rest of the MMtracker repo.

---

## One-time setup in Vercel (about 10 minutes)

### 1. Create a new Vercel project for this folder
1. Go to vercel.com → **Add New… → Project**.
2. Pick the **MMtracker** GitHub repo.
3. Next to **Root Directory**, click **Edit** and choose **`points-app`**. This keeps it separate from your other site.
4. Leave Framework Preset as **Other**. Click **Deploy**. (It will deploy, but it won't work until you finish steps 2–4.)

### 2. Add a database
1. In the new project, open the **Storage** tab.
2. Choose **Upstash for Redis** (free tier is plenty) → **Create** → connect it to this project.
3. That adds the database settings for you automatically. You don't need to copy anything.

### 3. Add your settings (Settings → Environment Variables)

| Name | Value |
|---|---|
| `APP_PASSWORD` | The password you want to use to unlock the app |
| `ANTHROPIC_API_KEY` | Your Claude API key from console.anthropic.com (this powers the "read my pasted text" feature) |

To change your password later, edit `APP_PASSWORD` and redeploy. Every device gets logged out when you do.

### 4. Redeploy
**Deployments** tab → the **⋯** menu on the latest one → **Redeploy**. Then open the site and log in.

**Tip:** On your iPhone, open the site in Safari → Share → **Add to Home Screen**. It then works like an app.

---

## Privacy notes
- The app only stores the **last 4** characters of account numbers.
- Pasted text is sent to the Claude API to be read, and is not stored. Only the balances you approve are saved.
- Please don't paste passwords or full card numbers.

## Ideas for later (auto-updating)
- **Email forwarding:** many programs email monthly statements. A forwarding address could feed those emails straight into the same "read this text" step.
- **AwardWallet:** a service that already logs into many loyalty programs. Its API could fill this app in automatically.
