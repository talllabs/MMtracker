"""
WebWatch RFP Monitor
====================
Monitors tourism/procurement sites for changes and sends alerts to Base44.

What it does:
- Reads your watchlist (CSV)
- Checks each site for updates
- Compares with previous data
- Sends webhook to Base44 when changes detected
- Keeps a log of all checks

NEW TO CODING? Here's what each part means:
- import: brings in pre-built tools we need
- def: creates a reusable function
- try/except: handles errors gracefully
- requests: talks to websites
- json: formats data to send
"""

import csv
import requests
import json
import hashlib
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

# YOUR BASE44 WEBHOOK URL - Read from GitHub Secrets (or environment variable)
# On GitHub: Settings > Secrets > Actions > Add BASE44_WEBHOOK_URL
# Locally: set it manually or use environment variable
BASE44_WEBHOOK_URL = os.getenv("BASE44_WEBHOOK_URL", "https://your-base44-webhook-url-here.com/webhook")

# How much content to check (in characters).
# Smaller = faster, but might miss subtle changes
# Larger = catches everything but slower
CONTENT_SAMPLE_SIZE = 2000


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


def fetch_site_content(url):
    """
    Goes to a website and grabs the text content.

    Why we need this: We need to see what's on the page to detect changes.

    Args:
        url (str): The website address to check

    Returns:
        str: The text content, or None if something went wrong
    """
    try:
        # timeout=10 means "wait max 10 seconds, then give up"
        response = requests.get(url, timeout=10)

        # Check if the request was successful (200 = success)
        if response.status_code == 200:
            # Return only first CONTENT_SAMPLE_SIZE characters
            return response.text[:CONTENT_SAMPLE_SIZE]
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


def load_cache():
    """
    Reads the cache file (what we saw last time).

    Returns:
        dict: A dictionary like {"url": "hash", "url2": "hash2"}
    """
    if Path(CACHE_FILE).exists():
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    return {}  # Empty dict if no cache yet


def save_cache(cache):
    """
    Saves the current snapshots to cache file for next time.

    Args:
        cache (dict): The data to save
    """
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def send_webhook(site_name, url, change_details):
    """
    Sends a webhook to Base44 alerting about the change.

    This is how your super agent gets notified!

    Args:
        site_name (str): Name of the site that changed
        url (str): The URL that changed
        change_details (str): Description of what changed
    """
    payload = {
        "event": "rfp_site_changed",
        "timestamp": datetime.now().isoformat(),
        "site_name": site_name,
        "url": url,
        "details": change_details,
        "action": "Check for new RFP opportunities"
    }

    try:
        response = requests.post(BASE44_WEBHOOK_URL, json=payload, timeout=10)

        if response.status_code in [200, 201, 202]:
            log_message(f"webhook sent to Base44 for {site_name}")
        else:
            log_message(f"warning: webhook failed, Base44 returned {response.status_code}")

    except Exception as e:
        log_message(f"error: could not send webhook: {str(e)}")


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
    if BASE44_WEBHOOK_URL == "https://your-base44-webhook-url-here.com/webhook":
        log_message("WARNING: Base44 webhook URL not configured!")
        log_message("   Set BASE44_WEBHOOK_URL environment variable or GitHub secret")

    # Step 1: Load what we saw last time
    cache = load_cache()
    log_message(f"previous snapshots: {len(cache)} sites cached")

    # Step 2: Read the watchlist
    sites = read_watchlist()
    if not sites:
        log_message("no sites to monitor!")
        return

    # Step 3: Check each site
    changes_found = []
    updated_cache = {}

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
            log_message(f"skipping {site_name} (unreachable)")
            continue

        # Create a fingerprint of the content
        current_hash = create_content_hash(content)
        previous_hash = cache.get(url)

        # Store this snapshot for next time
        updated_cache[url] = current_hash

        # Did it change?
        if previous_hash is None:
            log_message(f"{site_name}: first time monitoring")
        elif current_hash != previous_hash:
            log_message(f"CHANGE DETECTED: {site_name}!")
            changes_found.append({
                "name": site_name,
                "url": url,
                "old_hash": previous_hash,
                "new_hash": current_hash
            })
            # Send webhook immediately
            send_webhook(site_name, url, "Content has changed - check for new opportunities")
        else:
            log_message(f"{site_name}: no change")

    # Step 4: Save the cache for next run
    save_cache(updated_cache)

    # Step 5: Summary
    log_message("=" * 60)
    log_message(f"monitor complete. {len(changes_found)} change(s) detected.")
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
