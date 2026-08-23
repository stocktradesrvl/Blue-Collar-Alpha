"""One-off: capture App Store screenshots (iPhone 6.5" = 1242x2688) from the real
preview app UI, logged in as the seeded premium account, and zip them.
Run: python3 scripts/appstore_shots.py
"""
import os, time, zipfile
from playwright.sync_api import sync_playwright

BASE = "https://strategy-tracker-16.preview.emergentagent.com"
EMAIL = "stocktradesrvl@gmail.com"
PW = "TradeAdmin123"
OUT = "/app/backend/static/appstore"
os.makedirs(OUT, exist_ok=True)

DISMISS = ["Got it", "Let's Trade", "Maybe later", "Continue", "Close"]


def wait_root(page):
    for _ in range(40):
        try:
            t = page.evaluate("() => { const r=document.querySelector('#root'); return r? r.innerText: ''; }")
            if t and len(t.strip()) > 0:
                break
        except Exception:
            pass
        time.sleep(1)
    time.sleep(3)


def shot(page, name):
    path = os.path.join(OUT, name)
    page.screenshot(path=path, full_page=False, type="png")
    print("captured", name)


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 414, "height": 896}, device_scale_factor=3)
        page = ctx.new_page()
        page.goto(BASE)
        wait_root(page)

        # Login
        page.get_by_test_id("login-email").fill(EMAIL)
        page.get_by_test_id("login-password").fill(PW)
        page.get_by_test_id("login-submit").click()
        time.sleep(6)

        # Market Sentiment appears in the post-login modal queue: capture it, then clear modals.
        got_sentiment = False
        for _ in range(6):
            try:
                if not got_sentiment and page.get_by_text("Market Sentiment", exact=False).first.is_visible(timeout=1500):
                    time.sleep(1)
                    shot(page, "05_market_sentiment.png"); results["sentiment"] = True; got_sentiment = True
                    continue
            except Exception:
                pass
            clicked = False
            for label in DISMISS:
                try:
                    page.get_by_text(label, exact=True).first.click(timeout=1200)
                    time.sleep(1); clicked = True; break
                except Exception:
                    continue
            if not clicked:
                break

        # Dashboard (modals cleared)
        time.sleep(2)
        try:
            shot(page, "01_dashboard.png"); results["dashboard"] = True
        except Exception as e:
            print("dashboard err", e)

        # Tab navigation helper
        def tab(label, fname, key, settle=3):
            try:
                page.get_by_text(label, exact=True).first.click(timeout=6000)
                time.sleep(settle)
                shot(page, fname); results[key] = True
            except Exception as e:
                print(f"{key} err", e)

        tab("Journal", "02_journal.png", "journal")
        tab("Coach", "03_coach.png", "coach", settle=4)
        tab("Strategy", "04_strategy.png", "strategy")

        ctx.close(); browser.close()

    # Zip everything captured
    zpath = os.path.join(OUT, "blue-collar-alpha-appstore-6.5.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(os.listdir(OUT)):
            if f.endswith(".png"):
                z.write(os.path.join(OUT, f), f)
    print("ZIP:", zpath, "results:", results)


if __name__ == "__main__":
    main()
