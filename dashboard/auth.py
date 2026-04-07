"""三省六部 · 简易 JWT 认证模块（零外部依赖）。

使用 Python stdlib 实现：
- 密码哈希: hashlib.pbkdf2_hmac (SHA-256, 100k iterations)
- Token: HMAC-SHA256 签名的 Base64 JSON
- 配置存储: data/auth.json

用法:
  首次运行时通过 /api/auth/setup 设置密码
  后续通过 /api/auth/login 获取 token
  API 请求通过 Cookie 或 Authorization header 携带 token
"""

import base64
import hashlib
import hmac
import json
import os
import pathlib
import secrets
import time

# Token 有效期 24 小时
TOKEN_TTL = 24 * 60 * 60

# auth.json 存储路径（由外部在 server.py 初始化时设置）
_auth_file: pathlib.Path | None = None
_secret_key: bytes | None = None


def init(data_dir: pathlib.Path):
    """初始化认证模块。"""
    global _auth_file, _secret_key
    _auth_file = data_dir / 'auth.json'
    # 每次启动生成新的签名密钥（重启后旧 token 失效，这是安全特性）
    _secret_key = secrets.token_bytes(32)


def is_configured() -> bool:
    """是否已设置密码。"""
    if not _auth_file or not _auth_file.exists():
        return False
    try:
        cfg = json.loads(_auth_file.read_text(encoding='utf-8'))
        return bool(cfg.get('password_hash'))
    except Exception:
        return False


def is_enabled() -> bool:
    """认证是否启用。仅当 auth.json 存在且配置了密码时启用。"""
    return is_configured()


def setup_password(password: str) -> dict:
    """首次设置密码。如已设置则拒绝。"""
    if not _auth_file:
        return {'ok': False, 'error': '认证模块未初始化'}
    if is_configured():
        return {'ok': False, 'error': '密码已设置，如需重置请删除 data/auth.json'}
    if len(password) < 4:
        return {'ok': False, 'error': '密码至少 4 个字符'}

    salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), salt.encode('utf-8'), 100_000
    ).hex()

    cfg = {'password_hash': pw_hash, 'salt': salt}
    _auth_file.write_text(json.dumps(cfg, indent=2), encoding='utf-8')
    return {'ok': True, 'message': '密码已设置'}


def verify_password(password: str) -> bool:
    """校验密码。"""
    if not _auth_file or not _auth_file.exists():
        return False
    try:
        cfg = json.loads(_auth_file.read_text(encoding='utf-8'))
    except Exception:
        return False
    salt = cfg.get('salt', '')
    stored_hash = cfg.get('password_hash', '')
    if not salt or not stored_hash:
        return False
    computed = hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), salt.encode('utf-8'), 100_000
    ).hex()
    return hmac.compare_digest(computed, stored_hash)


def create_token() -> str:
    """创建 JWT-like token。"""
    if not _secret_key:
        raise RuntimeError('Auth not initialized')
    payload = {
        'iat': int(time.time()),
        'exp': int(time.time()) + TOKEN_TTL,
        'jti': secrets.token_hex(8),
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).decode().rstrip('=')
    sig = hmac.new(_secret_key, payload_b64.encode(), hashlib.sha256).hexdigest()
    return f'{payload_b64}.{sig}'


def verify_token(token: str) -> bool:
    """验证 token 签名和有效期。"""
    if not _secret_key or not token:
        return False
    parts = token.split('.')
    if len(parts) != 2:
        return False
    payload_b64, sig = parts
    expected_sig = hmac.new(_secret_key, payload_b64.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return False
    # 解码 payload 检查过期
    try:
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:
        return False
    if payload.get('exp', 0) < time.time():
        return False
    return True


def extract_token(headers) -> str | None:
    """从请求头中提取 token (Authorization header 或 Cookie)。"""
    # Authorization: Bearer <token>
    auth_header = headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:].strip()
    # Cookie: edict_token=<token>
    cookie = headers.get('Cookie', '')
    for part in cookie.split(';'):
        part = part.strip()
        if part.startswith('edict_token='):
            return part[len('edict_token='):]
    return None


# 不需要认证的路径白名单
_PUBLIC_PATHS = frozenset({
    '/healthz',
    '/api/auth/login',
    '/api/auth/setup',
    '/api/auth/status',
})

# 公开的路径前缀（静态资源）
_PUBLIC_PREFIXES = ('/_assets/', '/assets/')


def requires_auth(path: str) -> bool:
    """判断该路径是否需要认证。"""
    if not is_enabled():
        return False
    # 静态页面和资源不拦截
    if path in _PUBLIC_PATHS:
        return False
    for prefix in _PUBLIC_PREFIXES:
        if path.startswith(prefix):
            return False
    # dashboard 首页不拦截（前端自己处理重定向到登录）
    if path in ('', '/', '/dashboard', '/dashboard.html'):
        return False
    return True
