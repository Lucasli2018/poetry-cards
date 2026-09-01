#!/usr/bin/env python3
# =============================================================
# 古韵抽卡 · 零依赖本地静态服务器
#
# 为什么不用 `python -m http.server`？
#   Windows 上 Python 的 http.server 常把 .js 当成
#   application/octet-stream（注册表缺 .js 映射），浏览器会拒绝
#   加载 ES Module 脚本（"Failed to load module script"），
#   导致页面空白。本脚本显式补全关键 MIME，跨平台都能用。
#
# 为什么不用 `npx http-server`？
#   需要联网拉取包，离线 / 受限网络环境会失败。
#
# 用法（在项目根目录执行）：
#   python scripts/serve.py            # 默认 8080 端口
#   python scripts/serve.py 9000       # 自定义端口
#   py scripts/serve.py                # Windows 应用商店版 Python 用 py
# =============================================================

import http.server
import mimetypes
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

# 显式补全关键 MIME（Windows 注册表常缺这些映射）
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('image/svg+xml', '.svg')
mimetypes.add_type('image/x-icon', '.ico')

# 无论从哪个目录启动，都固定以「项目根」作为站点根目录
# （本脚本位于 <根>/scripts/，所以取上级目录）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

handler = http.server.SimpleHTTPRequestHandler
print(f'古韵抽卡 · 本地预览已启动： http://localhost:{PORT}')
print('按 Ctrl+C 停止')
try:
    http.server.test(HandlerClass=handler, port=PORT)
except KeyboardInterrupt:
    print('\n已停止')
