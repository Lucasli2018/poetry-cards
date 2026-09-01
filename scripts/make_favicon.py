"""生成 favicon.ico（多尺寸 PNG-in-ICO）+ apple-touch-icon-180.png。

设计：朱砂红圆角矩形背景 + 米色「诗」字（楷体 fallback 到 serif）。
纯标准库（struct + zlib）实现 PNG/ICO 编码，零外部依赖。
"""
import struct, zlib, os, sys

# 设计参数
BG = (168, 50, 30)        # 朱砂红 #a8321e
FG = (255, 247, 230)      # 米黄 #fff7e6
RADIUS_RATIO = 0.14       # 圆角半径占尺寸比
TEXT = '诗'

# ── 简易位图字体（用于 ICO 16/32/48，无字体文件时也能输出「诗」字形） ──
# 用一个 7x9 像素的笔画点阵粗略模拟「诗」字（足够小图标辨识）
GLYPH = [
    '..X....',
    '..X....',
    '..X....',
    'XXXXXXX',
    '..X....',
    '..X....',
    '..X..X.',
    '.XX.XX.',
    'X..X..X',
]

def render_png(size):
    """生成 size×size 的 PNG bytes（RGBA, 8bit），朱砂红圆角矩形 + 「诗」字。"""
    w = h = size
    pixels = bytearray()
    r = max(1, int(size * RADIUS_RATIO))

    # 字形尺寸：以 size 的 50% 为基准，按比例缩放点阵
    glyph_scale = max(1, size // 14)  # 14 -> scale 1; 32 -> 2; 180 -> 12
    glyph_w = 7 * glyph_scale
    glyph_h = 9 * glyph_scale
    gx0 = (w - glyph_w) // 2
    gy0 = (h - glyph_h) // 2 - max(1, size // 24)  # 视觉居中略上

    # 抗锯齿：在圆形/笔画边缘用 2x 抖动
    ss = 2
    W, H = w * ss, h * ss
    R = r * ss
    px = bytearray()
    for y in range(H):
        for x in range(W):
            # 圆角矩形测试
            cx = min(max(x, R), W - 1 - R)
            cy = min(max(y, R), H - 1 - R)
            inside_rect = (R <= x <= W - 1 - R) or (R <= y <= H - 1 - R)
            dx, dy = x - cx, y - cy
            inside = inside_rect or (dx * dx + dy * dy <= R * R)
            if not inside:
                px += b'\x00\x00\x00\x00'
                continue
            # 字形测试
            gx = (x - gx0 * ss) // glyph_scale
            gy = (y - gy0 * ss) // glyph_scale
            in_glyph = False
            if 0 <= gx < 7 and 0 <= gy < 9 and gy < len(GLYPH) and gx < len(GLYPH[gy]):
                in_glyph = GLYPH[gy][gx] == 'X'
            if in_glyph:
                px += bytes(FG) + b'\xff'
            else:
                px += bytes(BG) + b'\xff'
    # 2x downsample（box filter）
    out = bytearray()
    for y in range(h):
        for x in range(w):
            r0 = g0 = b0 = a0 = 0
            cnt = 0
            for dy in range(ss):
                for dx in range(ss):
                    i = ((y * ss + dy) * W + (x * ss + dx)) * 4
                    r0 += px[i]; g0 += px[i + 1]; b0 += px[i + 2]; a0 += px[i + 3]
                    cnt += 1
            out += bytes((r0 // cnt, g0 // cnt, b0 // cnt, a0 // cnt))

    # PNG 编码
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter: None
        raw += out[y * stride:(y + 1) * stride]
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', compressed)
           + chunk(b'IEND', b''))
    return png


def build_ico(sizes, png_bytes_list):
    """把若干 PNG bytes 打包成单个 ICO 文件（PNG-in-ICO，Vista+ 支持）。"""
    n = len(sizes)
    header = struct.pack('<HHH', 0, 1, n)
    # 目录条目：每个 16 字节
    offset = 6 + 16 * n
    entries = b''
    payloads = b''
    for size, png in zip(sizes, png_bytes_list):
        if size >= 256:
            w_b, h_b = 0, 0  # 0 表示 256
        else:
            w_b, h_b = size, size
        entries += struct.pack('<BBBBHHII', w_b, h_b, 0, 0, 1, 32,
                               len(png), offset)
        payloads += png
        offset += len(png)
    return header + entries + payloads


def main():
    # 默认输出到 assets/icons/（与项目结构保持一致）
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join('assets', 'icons')
    os.makedirs(out_dir, exist_ok=True)

    # favicon.ico 多尺寸
    ico_sizes = [16, 32, 48]
    ico_pngs = [render_png(s) for s in ico_sizes]
    ico = build_ico(ico_sizes, ico_pngs)
    ico_path = os.path.join(out_dir, 'favicon.ico')
    with open(ico_path, 'wb') as f:
        f.write(ico)
    print(f'wrote {ico_path}  ({len(ico)} bytes, sizes={ico_sizes})')

    # apple-touch-icon 180x180 PNG
    png180 = render_png(180)
    png_path = os.path.join(out_dir, 'apple-touch-icon.png')
    with open(png_path, 'wb') as f:
        f.write(png180)
    print(f'wrote {png_path}  ({len(png180)} bytes, 180x180)')

    # 备用 favicon-32.png（部分老浏览器只认 PNG favicon）
    png32 = render_png(32)
    png32_path = os.path.join(out_dir, 'favicon-32.png')
    with open(png32_path, 'wb') as f:
        f.write(png32)
    print(f'wrote {png32_path}  ({len(png32)} bytes, 32x32)')

    # PWA 标准尺寸（manifest.webmanifest 需要真实 PNG，data URI 兼容性差）
    for s in (192, 512):
        data = render_png(s)
        p = os.path.join(out_dir, f'icon-{s}.png')
        with open(p, 'wb') as f:
            f.write(data)
        print(f'wrote {p}  ({len(data)} bytes, {s}x{s})')


if __name__ == '__main__':
    main()