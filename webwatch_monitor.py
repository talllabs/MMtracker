"""
WebWatch RFP Monitor
====================
Monitors tourism/procurement sites for changes and sends alerts to Base44.

What it does:
- Reads your watchlist (CSV)
- Checks each site for updates
- Compares with previous data (using cleaned text, not raw HTML)
- When content changes, optionally asks an LLM whether the change is a
  meaningful new RFP/tender opportunity (vs. a date stamp, ad rotation, etc.)
- Sends the changed content (not just the URL) to the Base44 webhook when
  the change is meaningful
- Records every detected change - with a summary of what changed - to a
  results CSV
- Keeps a log of all checks

NEW TO CODING? Here's what each part means:
- import: brings in pre-built tools we need
- def: creates a reusable function
- try/except: handles errors gracefully
- requests: talks to websites
- json: formats data to send
"""

import csv
import re
import requests
import json
import hashlib
import difflib
from datetime import datetime
from pathlib import Path
import os

# ============================================================================
# CONFIGURATION - Change these to match your setup
# ============================================================================

REPO_ROOT = Path(__file__).resolve().parent

WATCHLIST_FILE = os.getenv("WEBWATCH_WATCHLIST_FILE", str(REPO_ROOT / "webwatch-watchlist.csv"))
CACHE_FILE = os.getenv("WEBWATCH_CACHE_FILE", str(REPO_ROOT / "webwatch_cache.json"))  # Stores previous site snapshots
LOG_FILE = os.getenv("WEBWATCH_LOG_FILE", str(REPO_ROOT / "webwatch_log.txt"))
RESULTS_FILE = os.getenv("WEBWATCH_RESULTS_FILE", str(REPO_ROOT / "webwatch_results.csv"))  # Detected changes, one row per run

# YOUR BASE44 WEBHOOK URL
# Defaults to the permanent Super RFP Hunter endpoint below. Override via the
# BASE44_WEBHOOK_URL GitHub Secret (Settings > Secrets > Actions) or environment
# variable if it ever needs to change. Set the env var to an empty string to
# disable the webhook and only log results to RESULTS_FILE.
BASE44_WEBHOOK_URL = os.getenv(
    "BASE44_WEBHOOK_URL",
    "https://super-rfp-hunter-565f90d3.base44.app/functions/receiveRfpLead",
)

# Optional: an Anthropic API key (GitHub Secret ANTHROPIC_API_KEY) lets the
# monitor ask an LLM whether a detected change is a *meaningful* new RFP/
# tender opportunity - vs. noise like a date stamp, ad rotation, or footer
# text - before sending the webhook. Without a key, every detected change is
# treated as meaningful (old behavior).
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

# How much content to check (in characters).
# Smaller = faster, but might miss subtle changes
# Larger = catches everything but slower
CONTENT_SAMPLE_SIZE = 4000


# ============================================================================
# HELPER FUNCTIONS - These do the actual work
# ============================================================================

def log_message(message):
    """
    Writes a message to the log file so you can see what happened.

    Args:
        message (str): The text to log
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] {message}\n"

    print(log_entry.strip())  # Print to screen too

    with open(LOG_FILE, "a") as f:
        f.write(log_entry)


def strip_html(html):
    """
    Reduces raw HTML down to visible-ish text, so hashing/diffing isn't
    tripped up by markup-only changes (a changed class name, an extra
    <div>, a script tag update) that aren't real content changes.

    Args:
        html (str): Raw HTML

    Returns:
        str: Cleaned, whitespace-collapsed text
    """
    text = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def fetch_site_content(url):
    """
    Goes to a website and grabs the text content.

    Why we need this: We need to see what's on the page to detect changes.

    Args:
        url (str): The website address to check

    Returns:
        str: The cleaned text content, or None if something went wrong
    """
    try:
        # timeout=10 means "wait max 10 seconds, then give up"
        response = requests.get(
            url,
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0 (compatible; WebWatchMonitor/1.0)"},
        )

        # Check if the request was successful (200 = success)
        if response.status_code == 200:
            # Return only first CONTENT_SAMPLE_SIZE characters of cleaned text
            return strip_html(response.text)[:CONTENT_SAMPLE_SIZE]
        else:
            log_message(f"warning: {url} returned status {response.status_code}")
            return None

    except requests.exceptions.Timeout:
        log_message(f"timeout: {url} took too long to respond")
        return None
    except requests.exceptions.ConnectionError:
        log_message(f"connection error: could not connect to {url}")
        return None
    except Exception as e:
        log_message(f"error fetching {url}: {str(e)}")
        return None


def create_content_hash(content):
    """
    Creates a unique fingerprint of content using SHA256.

    Why: Instead of storing huge amounts of text, we store a small "fingerprint".
    If the fingerprint changes, the content changed.

    Args:
        content (str): The text to fingerprint

    Returns:
        str: A 64-character hash
    """
    if content is None:
        return None
    return hashlib.sha256(content.encode()).hexdigest()


def build_diff(old_text, new_text, max_chars=1500):
    """
    Builds a short, human-readable unified diff between the old and new
    page content, so both the webhook and the dashboard can show what
    actually changed instead of just "content changed".

    Args:
        old_text (str): Previously seen content
        new_text (str): Newly fetched content
        max_chars (int): Truncate the diff to this many characters

    Returns:
        str: A unified diff (truncated)
    """
    old_lines = [old_text[i:i + 120] for i in range(0, len(old_text), 120)]
    new_lines = [new_text[i:i + 120] for i in range(0, len(new_text), 120)]
    diff = "\n".join(
        difflib.unified_diff(old_lines, new_lines, lineterm="", n=1)
    )
    if len(diff) > max_chars:
        diff = diff[:max_chars] + "... (truncated)"
    return diff


def classify_change(site_name, old_text, new_text):
    """
    Asks an LLM (if ANTHROPIC_API_KEY is configured) whether a detected
    change represents a meaningful new RFP/tender opportunity being posted,
    as opposed to noise (a date stamp, ad rotation, unrelated footer text).

    Without an API key, every change is treated as meaningful (the old,
    always-notify behavior).

    Args:
        site_name (str): Name of the site
        old_text (str): Previously seen content
        new_text (str): Newly fetched content

    Returns:
        tuple: (meaningful: bool, summary: str)
    """
    if not ANTHROPIC_API_KEY:
        return True, "LLM classification not configured - content changed, review manually."

    prompt = f"""You are monitoring "{site_name}" for new RFP / tender / procurement opportunities.
The page content changed. Compare the OLD and NEW text below and decide:
Does this change represent a genuinely NEW RFP, tender, bid opportunity, or
procurement notice being added (or a meaningful update to one)? Ignore
changes that are just date stamps, "last updated" timestamps, ad rotation,
cookie banners, unrelated navigation/footer text, or cosmetic differences.

Respond with ONLY a JSON object, no other text, in this exact shape:
{{"meaningful": true or false, "summary": "one or two sentence plain-English summary of what specifically changed, focused on any new opportunity"}}

OLD TEXT:
{old_text[:2000]}

NEW TEXT:
{new_text[:2000]}"""

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        text = "".join(block.get("text", "") for block in data.get("content", []))

        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            log_message(f"warning: LLM response for {site_name} wasn't valid JSON, treating as meaningful")
            return True, "LLM response could not be parsed - content changed, review manually."

        parsed = json.loads(match.group(0))
        return bool(parsed.get("meaningful", True)), str(parsed.get("summary", "")).strip()

    except Exception as e:
        log_message(f"warning: LLM classification failed for {site_name}: {str(e)} - treating as meaningful")
        return True, f"LLM classification failed ({str(e)}) - content changed, review manually."


def load_cache():
    """
    Reads the cache file (what we saw last time).

    Returns:
        dict: {"url": {"hash": "...", "content": "..."}}
    """
    if Path(CACHE_FILE).exists():
        with open(CACHE_FILE, "r") as f:
            data = json.load(f)
        # Migrate from the old format ({"url": "hash"}) transparently
        migrated = {}
        for url, value in data.items():
            if isinstance(value, str):
                migrated[url] = {"hash": value, "content": ""}
            else:
                migrated[url] = value
        return migrated
    return {}  # Empty dict if no cache yet


def save_cache(cache):
    """
    Saves the current snapshots to cache file for next time.

    Args:
        cache (dict): The data to save
    """
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def send_webhook(site_name, url, summary, diff, old_hash, new_hash):
    """
    Sends a webhook to Base44 alerting about the change - including the
    actual changed content (a diff and an LLM summary), not just the URL.

    This is how your super agent gets notified!
    If BASE44_WEBHOOK_URL isn't set, this is skipped (results still go to RESULTS_FILE).

    Args:
        site_name (str): Name of the site that changed
        url (str): The URL that changed
        summary (str): Plain-English summary of what changed
        diff (str): Unified diff of the old vs. new content
        old_hash (str): Previous content hash
        new_hash (str): New content hash
    """
    if not BASE44_WEBHOOK_URL:
        return

    payload = {
        "event": "rfp_site_changed",
        "timestamp": datetime.now().isoformat(),
        "site_name": site_name,
        "url": url,
        "summary": summary,
        "diff": diff,
        "old_hash": old_hash,
        "new_hash": new_hash,
        "action": "Check for new RFP opportunities",
    }

    try:
        response = requests.post(BASE44_WEBHOOK_URL, json=payload, timeout=10)

        if response.status_code in [200, 201, 202]:
            log_message(f"webhook sent to Base44 for {site_name}")
        else:
            log_message(f"warning: webhook failed, Base44 returned {response.status_code}")

    except Exception as e:
        log_message(f"error: could not send webhook: {str(e)}")


def record_results(changes_found):
    """
    Appends detected changes to the results CSV so you can review them
    without relying on the webhook.

    Args:
        changes_found (list): List of dicts with name/url/summary/etc.
    """
    file_exists = Path(RESULTS_FILE).exists()
    fieldnames = [
        "timestamp", "name", "url", "meaningful", "summary", "diff", "old_hash", "new_hash",
    ]
    with open(RESULTS_FILE, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        for change in changes_found:
            writer.writerow({
                "timestamp": datetime.now().isoformat(),
                "name": change["name"],
                "url": change["url"],
                "meaningful": "yes" if change["meaningful"] else "no",
                "summary": change["summary"],
                "diff": change["diff"],
                "old_hash": change["old_hash"],
                "new_hash": change["new_hash"],
            })


def read_watchlist():
    """
    Reads your CSV file with all the sites to monitor.

    Returns:
        list: A list of dicts like [{"name": "Site Name", "url": "https://..."}, ...]
    """
    sites = []
    try:
        with open(WATCHLIST_FILE, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                sites.append(row)
        log_message(f"loaded {len(sites)} sites from watchlist")
        return sites
    except Exception as e:
        log_message(f"error: could not read watchlist: {str(e)}")
        return []


# ============================================================================
# MAIN MONITOR FUNCTION
# ============================================================================

def run_monitor():
    """
    The main function that does everything. This is what we call to start.
    """
    log_message("=" * 60)
    log_message("WebWatch Monitor Starting")
    log_message("=" * 60)

    # Check if webhook is configured
    if not BASE44_WEBHOOK_URL:
        log_message("BASE44_WEBHOOK_URL not set - skipping webhook, results will go to " + RESULTS_FILE)
    if not ANTHROPIC_API_KEY:
        log_message("ANTHROPIC_API_KEY not set - every content change will be treated as meaningful")

    # Step 1: Load what we saw last time
    cache = load_cache()
    log_message(f"previous snapshots: {len(cache)} sites cached")

    # Step 2: Read the watchlist
    sites = read_watchlist()
    if not sites:
        log_message("no sites to monitor!")
        return
    log_message(f"watchlist total: {len(sites)} sites")

    # Step 3: Check each site
    changes_found = []
    updated_cache = {}
    checked_count = 0
    skipped_count = 0

    for site in sites:
        site_name = site.get("name", "Unknown")
        url = site.get("url", "").strip()

        if not url:
            log_message(f"skipping {site_name} (no URL)")
            continue

        log_message(f"checking {site_name}...")

        # Fetch the content
        content = fetch_site_content(url)

        if content is None:
            skipped_count += 1
            log_message(f"skipping {site_name} (unreachable)")
            continue

        checked_count += 1

        # Create a fingerprint of the content
        current_hash = create_content_hash(content)
        previous_entry = cache.get(url) or {}
        previous_hash = previous_entry.get("hash")
        previous_content = previous_entry.get("content", "")

        # Store this snapshot for next time
        updated_cache[url] = {"hash": current_hash, "content": content}

        # Did it change?
        if previous_hash is None:
            log_message(f"{site_name}: first time monitoring")
        elif current_hash != previous_hash:
            diff = build_diff(previous_content, content)
            meaningful, summary = classify_change(site_name, previous_content, content)

            if meaningful:
                log_message(f"CHANGE DETECTED (meaningful): {site_name} - {summary}")
            else:
                log_message(f"CHANGE DETECTED (not meaningful, skipping webhook): {site_name} - {summary}")

            changes_found.append({
                "name": site_name,
                "url": url,
                "old_hash": previous_hash,
                "new_hash": current_hash,
                "meaningful": meaningful,
                "summary": summary,
                "diff": diff,
            })

            if meaningful:
                send_webhook(site_name, url, summary, diff, previous_hash, current_hash)
        else:
            log_message(f"{site_name}: no change")

    # Step 4: Save the cache for next run
    save_cache(updated_cache)

    # Step 5: Record results to CSV
    record_results(changes_found)

    # Step 6: Summary
    meaningful_count = sum(1 for c in changes_found if c["meaningful"])
    log_message("=" * 60)
    log_message(
        f"monitor complete. watchlist={len(sites)} checked={checked_count} "
        f"skipped={skipped_count} changes={len(changes_found)} "
        f"meaningful={meaningful_count}"
    )
    log_message("=" * 60)


# ============================================================================
# RUN IT!
# ============================================================================

if __name__ == "__main__":
    """
    This means "only run the code below if we're running this file directly"
    (not if someone imports this file into another program)
    """
    run_monitor()
