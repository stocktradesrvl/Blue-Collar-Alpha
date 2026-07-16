from PIL import Image

src = Image.open("bca_logo_src.png").convert("RGB")  # 1408x768

# --- Emblem (gear + arrow "A") crop ---
emblem = src.crop((515, 100, 900, 465))  # tight emblem, excludes title text
# make it a true square by padding to max dim with sampled bg
w, h = emblem.size
side = max(w, h)
bg = emblem.getpixel((4, 4))  # near-white corner of the logo bg
sq = Image.new("RGB", (side, side), bg)
sq.paste(emblem, ((side - w) // 2, (side - h) // 2))
emblem = sq

# Sampled light background color from the source corner (for canvases)
LIGHT = src.getpixel((8, 8))
print("LIGHT bg", LIGHT)

def canvas(size, fill, mark, scale):
    c = Image.new("RGB", (size, size), fill)
    m = mark.resize((int(size * scale), int(size * scale)), Image.LANCZOS)
    c.paste(m, ((size - m.width) // 2, (size - m.height) // 2))
    return c

# 1) App icon (square, full-bleed on light bg)
canvas(1024, LIGHT, emblem, 0.86).save("icon.png")

# 2) Android adaptive foreground (transparent, emblem padded into safe zone)
af = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
em_rgba = emblem.convert("RGBA").resize((620, 620), Image.LANCZOS)
af.paste(em_rgba, ((1024 - 620) // 2, (1024 - 620) // 2))
af.save("adaptive-icon.png")

# 3) Splash lockup (emblem + name + subtitle) on light bg
lockup = src.crop((370, 92, 1045, 690))  # 675x598 vertical lockup
splash = Image.new("RGB", (1200, 1200), LIGHT)
lw, lh = lockup.size
scale = min(1000 / lw, 1000 / lh)
lk = lockup.resize((int(lw * scale), int(lh * scale)), Image.LANCZOS)
splash.paste(lk, ((1200 - lk.width) // 2, (1200 - lk.height) // 2))
splash.save("splash-image.png")

# 4) Favicon
canvas(128, LIGHT, emblem, 0.9).save("favicon.png")

# 5) In-app logo mark (emblem square, for login/register)
emblem.resize((320, 320), Image.LANCZOS).save("logo-mark.png")

print("done", "#%02X%02X%02X" % LIGHT)
