"""Backend tests for App Store zip download and legal routes.

Verifies:
- Reliable delivery of the appstore zip via the /api/static mount and the /api/appstore fallback route (no intermittent 503).
- Range request support on the static zip URL.
- Downloaded zip is a valid archive containing the 5 expected PNGs.
- Legal routes (/api/legal/privacy, /api/legal/terms) return 200 (regression).
"""
import io
import os
import zipfile

import pytest
import requests

# Use EXTERNAL preview URL as required. Do NOT default; missing env should fail fast.
BASE_URL = "https://strategy-tracker-16.preview.emergentagent.com"

STATIC_ZIP_URL = f"{BASE_URL}/api/static/appstore/blue-collar-alpha-appstore-6.5.zip"
FALLBACK_ZIP_URL = f"{BASE_URL}/api/appstore/screenshots.zip"
EXPECTED_SIZE = 4518276
EXPECTED_PNGS = {
    "01_dashboard.png",
    "02_journal.png",
    "03_coach.png",
    "04_strategy.png",
    "05_market_sentiment.png",
}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    return s


# --- Reliability: static zip URL (hit multiple times, no intermittent 503) ---
class TestStaticZipReliability:
    def test_static_zip_multiple_hits(self, session):
        results = []
        for i in range(5):
            r = session.get(STATIC_ZIP_URL, timeout=60)
            results.append((i, r.status_code, len(r.content), r.headers.get("Content-Type", "")))
        # All should be 200
        for i, status, size, ctype in results:
            assert status == 200, f"Attempt {i}: got {status} (expected 200). All results: {results}"
            assert size == EXPECTED_SIZE, f"Attempt {i}: size {size} != expected {EXPECTED_SIZE}"
            assert "zip" in ctype.lower() or "octet-stream" in ctype.lower(), (
                f"Attempt {i}: unexpected Content-Type {ctype}"
            )

    def test_static_zip_content_length_header(self, session):
        r = session.head(STATIC_ZIP_URL, timeout=30, allow_redirects=True)
        # HEAD may be supported by StaticFiles
        assert r.status_code in (200, 405), f"HEAD returned {r.status_code}"
        if r.status_code == 200:
            cl = r.headers.get("Content-Length")
            assert cl is not None and int(cl) == EXPECTED_SIZE, f"Content-Length {cl}"


# --- Range request support ---
class TestRangeRequest:
    def test_range_request_returns_206_or_200(self, session):
        headers = {"Range": "bytes=0-1023"}
        r = session.get(STATIC_ZIP_URL, headers=headers, timeout=30)
        assert r.status_code in (200, 206), f"Range request returned {r.status_code}"
        assert r.status_code != 503, "Got 503 on Range request"
        if r.status_code == 206:
            assert len(r.content) == 1024, f"Partial content size {len(r.content)} != 1024"
            cr = r.headers.get("Content-Range", "")
            assert "bytes 0-1023" in cr, f"Content-Range header: {cr}"


# --- Fallback /api/appstore/screenshots.zip route ---
class TestFallbackRoute:
    def test_fallback_zip_returns_200(self, session):
        r = session.get(FALLBACK_ZIP_URL, timeout=60)
        assert r.status_code == 200, f"Fallback returned {r.status_code}"
        assert len(r.content) == EXPECTED_SIZE, f"Fallback size {len(r.content)} != expected"
        ctype = r.headers.get("Content-Type", "").lower()
        assert "zip" in ctype or "octet-stream" in ctype, f"Content-Type {ctype}"


# --- Validate zip contents ---
class TestZipValidity:
    def test_zip_is_valid_and_contains_expected_pngs(self, session):
        r = session.get(STATIC_ZIP_URL, timeout=60)
        assert r.status_code == 200
        buf = io.BytesIO(r.content)
        assert zipfile.is_zipfile(buf), "Downloaded file is not a valid zip"
        buf.seek(0)
        with zipfile.ZipFile(buf) as zf:
            # Bad file check
            bad = zf.testzip()
            assert bad is None, f"Corrupt entry in zip: {bad}"
            names = [os.path.basename(n) for n in zf.namelist() if n.lower().endswith(".png")]
            names_set = set(names)
            missing = EXPECTED_PNGS - names_set
            assert not missing, f"Missing PNGs in zip: {missing}. Got names: {zf.namelist()}"
            assert len(names) == 5, f"Expected exactly 5 PNGs, got {len(names)}: {names}"


# --- Regression: legal routes ---
class TestLegalRoutes:
    def test_privacy_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/legal/privacy", timeout=30)
        assert r.status_code == 200, f"privacy status {r.status_code}"
        assert len(r.text) > 0

    def test_terms_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/legal/terms", timeout=30)
        assert r.status_code == 200, f"terms status {r.status_code}"
        assert len(r.text) > 0
