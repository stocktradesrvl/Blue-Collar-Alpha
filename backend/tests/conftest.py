import os, io, base64, pytest, requests
from PIL import Image, ImageDraw, ImageFont
import random

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://strategy-tracker-16.preview.emergentagent.com').rstrip('/')

TEST_EMAIL = "trader@test.com"
TEST_PASSWORD = "Test1234"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _make_chart_image_b64():
    """Create a synthetic candlestick-like chart PNG with real visual features."""
    W, H = 640, 400
    img = Image.new("RGB", (W, H), (18, 22, 30))
    d = ImageDraw.Draw(img)
    # grid
    for x in range(0, W, 40):
        d.line([(x, 30), (x, H - 30)], fill=(40, 45, 55))
    for y in range(30, H - 30, 40):
        d.line([(40, y), (W - 20, y)], fill=(40, 45, 55))
    # simulated candles
    random.seed(7)
    price = 150.0
    x = 60
    for _ in range(40):
        o = price
        c = price + random.uniform(-2, 2.2)
        hi = max(o, c) + random.uniform(0.2, 1.5)
        lo = min(o, c) - random.uniform(0.2, 1.5)
        color = (46, 204, 113) if c >= o else (231, 76, 60)
        # wick
        d.line([(x + 5, 350 - (hi - 140) * 6), (x + 5, 350 - (lo - 140) * 6)], fill=color, width=1)
        # body
        y1 = 350 - (max(o, c) - 140) * 6
        y2 = 350 - (min(o, c) - 140) * 6
        d.rectangle([(x + 2, y1), (x + 8, y2)], fill=color)
        price = c
        x += 12
    # labels
    d.text((10, 5), "AAPL  1m  LONG  Entry 150.20  Exit 152.85  Qty 100  PnL +$265", fill=(230, 230, 230))
    d.text((10, H - 20), "10:32 AM  Opening Range Breakout", fill=(180, 180, 180))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="session")
def chart_image_b64():
    return _make_chart_image_b64()


@pytest.fixture(scope="session")
def auth_token(api, base_url):
    # try login, if 401 register
    r = api.post(f"{base_url}/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code != 200:
        r = api.post(f"{base_url}/api/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        if r.status_code == 400:
            # already exists but wrong pw - try login again w/ default
            r = api.post(f"{base_url}/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"auth failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"]


@pytest.fixture
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
