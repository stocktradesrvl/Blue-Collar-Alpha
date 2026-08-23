"""Capture 3 iPad 12.9"/13" App Store screenshots (2048x2732) from the real app UI."""
import os, time
from playwright.sync_api import sync_playwright

BASE = "https://strategy-tracker-16.preview.emergentagent.com"
EMAIL, PW = "stocktradesrvl@gmail.com", "TradeAdmin123"
OUT = "/app/backend/static/appstore-ipad"
os.makedirs(OUT, exist_ok=True)
DISMISS = ["Got it", "Let's Trade", "Maybe later", "Continue", "Close"]


def wait_root(page):
    for _ in range(40):
        try:
            t = page.evaluate("() => { const r=document.querySelector('#root'); return r? r.innerText: ''; }")
            if t and t.strip():
                break
        except Exception:
            pass
        time.sleep(1)
    time.sleep(3)


def main():
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 1024, "height": 1366}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(BASE)
        wait_root(page)
        page.get_by_test_id("login-email").fill(EMAIL)
        page.get_by_test_id("login-password").fill(PW)
        page.get_by_test_id("login-submit").click()
        time.sleep(6)
        for _ in range(6):
            hit = False
            for lbl in DISMISS:
                try:
                    page.get_by_text(lbl, exact=True).first.click(timeout=1200); time.sleep(1); hit = True; break
                except Exception:
                    continue
            if not hit:
                break
        time.sleep(2)

        def cap(name):
            page.screenshot(path=os.path.join(OUT, name), full_page=False, type="png"); res[name] = True; print("captured", name)

        cap("ipad_01_dashboard.png")
        try:
            page.get_by_text("Journal", exact=True).first.click(timeout=6000); time.sleep(3); cap("ipad_02_journal.png")
        except Exception as e:
            print("journal err", e)
        try:
            page.get_by_text("Coach", exact=True).first.click(timeout=6000); time.sleep(4); cap("ipad_03_coach.png")
        except Exception as e:
            print("coach err", e)
        ctx.close(); b.close()
    print("results", res)


if __name__ == "__main__":
    main()
