# -*- coding: utf-8 -*-
"""从 zx_idle.png 生成桌面端图标：app.png / tray.png / icon.ico"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "assets", "zx_idle.png")

def rounded_bg(size, radius_ratio=0.22):
    """深蓝圆角底 + 轻微纵向渐变"""
    grad = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(grad)
    top, bot = (26, 58, 110, 255), (10, 18, 34, 255)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(4)))
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1],
                                           radius=int(size * 4 * radius_ratio), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out

def make_app_icon(size=512):
    char = Image.open(SRC).convert("RGBA")
    char = char.crop(char.getbbox())
    # 高占 82%，底部留一点呼吸
    target_h = int(size * 0.82)
    ratio = target_h / char.height
    char = char.resize((max(1, int(char.width * ratio)), target_h), Image.LANCZOS)
    base = rounded_bg(size)
    # 底部柔光，让角色不悬空
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([size * 0.18, size * 0.78, size * 0.82, size * 0.99], fill=(120, 170, 255, 46))
    base = Image.alpha_composite(base, glow)
    x = (size - char.width) // 2
    y = int(size * 0.94) - char.height
    base.alpha_composite(char, (x, max(0, y)))
    return base

def make_tray(size=64):
    """托盘：只取头部（眼镜区域），透明底"""
    char = Image.open(SRC).convert("RGBA")
    box = char.getbbox()
    w, h = char.size
    # 头部大致在上 45%
    head = char.crop((int(w * 0.04), int(h * 0.02), int(w * 0.96), int(h * 0.46)))
    head = head.crop(head.getbbox())
    target = int(size * 0.94)
    r = target / max(head.width, head.height)
    head = head.resize((max(1, int(head.width * r)), max(1, int(head.height * r))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(head, ((size - head.width) // 2, (size - head.height) // 2))
    return out

def main():
    app = make_app_icon(512)
    app.save(os.path.join(ROOT, "assets", "app.png"))
    make_tray(64).save(os.path.join(ROOT, "assets", "tray.png"))

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    app.save(os.path.join(HERE, "icon.ico"), format="ICO", sizes=ico_sizes)
    print("[ok] assets/app.png  512x512")
    print("[ok] assets/tray.png 64x64")
    print("[ok] build/icon.ico  " + ",".join(str(s[0]) for s in ico_sizes))

if __name__ == "__main__":
    main()
