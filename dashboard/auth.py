"""
看板认证模块。

使用 Python stdlib 实现：
- 密码哈希: hashlib.pbkdf2_hmac (SHA-256, 100k iterations)
- Token: HMAC-SHA256 签名的 Base64 JSON
- 配置存储: data/auth.json

当前策略：
1. 默认账号密码固定为 admin / admin。
2. 当 auth.json 不存在时，会自动重建默认认证文件。
3. 首次以默认密码登录后，必须修改密码；用户名可改可不改。
4. 认证信息静态存储在 data/auth.json，删除该文件即可恢复默认 admin/admin。
5. API 请求可通过 Cookie 或 Authorization header 携带 token。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import pathlib
import secrets
import time
from typing import Any

TOKEN_TTL = 24 * 60 * 60
PBKDF2_ITERATIONS = 100_000
DEFAULT_USERNAME = 'admin'
DEFAULT_PASSWORD = 'admin'
MIN_PASSWORD_LEN = 4

_auth_file: pathlib.Path | None = None
_secret_key: bytes | None = None


def _now_ts() -> int:
    return int(time.time())


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), salt.encode('utf-8'), PBKDF2_ITERATIONS
    ).hex()


def _new_salt() -> str:
    return secrets.token_hex(16)


def _default_config() -> dict[str, Any]:
    salt = _new_salt()
    now = _now_ts()
    return {
        'version': 2,
        'username': DEFAULT_USERNAME,
        'salt': salt,
        'password_hash': _hash_password(DEFAULT_PASSWORD, salt),
        'must_change_password': True,
        'created_at': now,
        'updated_at': now,
        'password_changed_at': None,
        'reset_source': 'default',
    }


def _atomic_write_json(path: pathlib.Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)


def init(data_dir: pathlib.Path):
    """初始化认证模块。"""
    global _auth_file, _secret_key
    _auth_file = data_dir / 'auth.json'
    _secret_key = secrets.token_bytes(32)
    ensure_auth_file()


def ensure_auth_file() -> pathlib.Path:
    """确保认证文件存在；若不存在则重建默认 admin/admin。"""
    if not _auth_file:
        raise RuntimeError('认证模块未初始化')
    if not _auth_file.exists():
        _atomic_write_json(_auth_file, _default_config())
    return _auth_file


def _load_config() -> dict[str, Any]:
    path = ensure_auth_file()
    try:
        cfg = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        cfg = _default_config()
        _atomic_write_json(path, cfg)
        return cfg

    changed = False
    if not isinstance(cfg, dict):
        cfg = _default_config()
        changed = True

    if 'username' not in cfg or not str(cfg.get('username', '')).strip():
        cfg['username'] = DEFAULT_USERNAME
        changed = True
    if 'salt' not in cfg or not cfg.get('salt'):
        cfg['salt'] = _new_salt()
        changed = True
    if 'password_hash' not in cfg or not cfg.get('password_hash'):
        cfg['password_hash'] = _hash_password(DEFAULT_PASSWORD, cfg['salt'])
        changed = True
    if 'must_change_password' not in cfg:
        cfg['must_change_password'] = True
        changed = True
    if 'version' not in cfg:
        cfg['version'] = 2
        changed = True
    if 'created_at' not in cfg:
        cfg['created_at'] = _now_ts()
        changed = True
    if 'updated_at' not in cfg:
        cfg['updated_at'] = _now_ts()
        changed = True
    if 'password_changed_at' not in cfg:
        cfg['password_changed_at'] = None
        changed = True
    if 'reset_source' not in cfg:
        cfg['reset_source'] = 'migrated'
        changed = True

    if changed:
        _atomic_write_json(path, cfg)
    return cfg


def _save_config(cfg: dict[str, Any]) -> None:
    cfg['updated_at'] = _now_ts()
    _atomic_write_json(ensure_auth_file(), cfg)


def get_config(redact: bool = True) -> dict[str, Any]:
    cfg = dict(_load_config())
    if redact:
        cfg.pop('password_hash', None)
        cfg.pop('salt', None)
    return cfg


def is_configured() -> bool:
    """兼容旧接口：默认始终为已配置。"""
    cfg = _load_config()
    return bool(cfg.get('username')) and bool(cfg.get('password_hash'))


def is_enabled() -> bool:
    """认证默认始终启用。"""
    ensure_auth_file()
    return True


def verify_password(username: str, password: str) -> bool:
    cfg = _load_config()
    stored_username = str(cfg.get('username', DEFAULT_USERNAME))
    salt = str(cfg.get('salt', ''))
    stored_hash = str(cfg.get('password_hash', ''))
    if not username or username != stored_username or not salt or not stored_hash:
        return False
    computed = _hash_password(password, salt)
    return hmac.compare_digest(computed, stored_hash)


def authenticate(username: str, password: str) -> dict[str, Any]:
    cfg = _load_config()
    if not verify_password(username, password):
        return {'ok': False, 'error': '用户名或密码错误'}
    return {
        'ok': True,
        'username': cfg.get('username', DEFAULT_USERNAME),
        'must_change_password': bool(cfg.get('must_change_password', False)),
    }


def create_token(username: str) -> str:
    """创建 JWT-like token。"""
    if not _secret_key:
        raise RuntimeError('Auth not initialized')
    payload = {
        'username': username,
        'iat': _now_ts(),
        'exp': _now_ts() + TOKEN_TTL,
        'jti': secrets.token_hex(8),
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, ensure_ascii=False).encode('utf-8')
    ).decode('utf-8').rstrip('=')
    sig = hmac.new(_secret_key, payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
    return f'{payload_b64}.{sig}'


def verify_token(token: str) -> dict[str, Any] | None:
    """验证 token 并返回 payload。"""
    if not _secret_key or not token:
        return None
    parts = token.split('.')
    if len(parts) != 2:
        return None
    payload_b64, sig = parts
    expected_sig = hmac.new(_secret_key, payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    try:
        padding = '=' * ((4 - len(payload_b64) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode((payload_b64 + padding).encode('utf-8')))
    except Exception:
        return None
    if int(payload.get('exp', 0)) < _now_ts():
        return None
    username = str(payload.get('username', ''))
    cfg = _load_config()
    if username != str(cfg.get('username', '')):
        return None
    return payload


def extract_token(headers) -> str | None:
    """从请求头中提取 token。"""
    auth_header = headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:].strip()
    cookie = headers.get('Cookie', '')
    for part in cookie.split(';'):
        part = part.strip()
        if part.startswith('agentorchestrator_token='):
            return part[len('agentorchestrator_token='):]
    return None


def get_auth_status(token: str | None = None) -> dict[str, Any]:
    cfg = get_config(redact=True)
    payload = verify_token(token) if token else None
    return {
        'enabled': True,
        'configured': True,
        'username': cfg.get('username', DEFAULT_USERNAME),
        'mustChangePassword': bool(cfg.get('must_change_password', False)),
        'authenticated': bool(payload),
        'currentUser': payload.get('username') if payload else None,
    }


def _validate_new_username(username: str) -> str | None:
    if not isinstance(username, str):
        return '用户名格式无效'
    username = username.strip()
    if not username:
        return '用户名不能为空'
    if len(username) < 2:
        return '用户名至少 2 个字符'
    if len(username) > 64:
        return '用户名不能超过 64 个字符'
    return None


def _validate_new_password(password: str, old_password: str | None = None) -> str | None:
    if not isinstance(password, str) or not password:
        return '请提供新密码'
    if len(password) < MIN_PASSWORD_LEN:
        return f'密码至少 {MIN_PASSWORD_LEN} 个字符'
    if old_password is not None and password == old_password:
        return '新密码不能与旧密码相同'
    return None


def complete_first_change(current_username: str, current_password: str, new_password: str, new_username: str | None = None) -> dict[str, Any]:
    cfg = _load_config()
    if not verify_password(current_username, current_password):
        return {'ok': False, 'error': '当前用户名或密码错误'}
    if not cfg.get('must_change_password', False):
        return {'ok': False, 'error': '当前账号无需执行首次改密'}

    err = _validate_new_password(new_password, current_password)
    if err:
        return {'ok': False, 'error': err}

    if new_username is not None and str(new_username).strip() != str(cfg.get('username', '')):
        uerr = _validate_new_username(new_username)
        if uerr:
            return {'ok': False, 'error': uerr}
        cfg['username'] = str(new_username).strip()

    salt = _new_salt()
    cfg['salt'] = salt
    cfg['password_hash'] = _hash_password(new_password, salt)
    cfg['must_change_password'] = False
    cfg['password_changed_at'] = _now_ts()
    cfg['reset_source'] = 'first-change'
    _save_config(cfg)
    return {
        'ok': True,
        'message': '首次登录信息已更新',
        'username': cfg.get('username', DEFAULT_USERNAME),
        'mustChangePassword': False,
    }


def change_password(username: str, current_password: str, new_password: str) -> dict[str, Any]:
    cfg = _load_config()
    if not verify_password(username, current_password):
        return {'ok': False, 'error': '当前密码错误'}
    err = _validate_new_password(new_password, current_password)
    if err:
        return {'ok': False, 'error': err}
    salt = _new_salt()
    cfg['salt'] = salt
    cfg['password_hash'] = _hash_password(new_password, salt)
    cfg['password_changed_at'] = _now_ts()
    _save_config(cfg)
    return {'ok': True, 'message': '密码已更新'}


def change_username(username: str, current_password: str, new_username: str) -> dict[str, Any]:
    cfg = _load_config()
    if not verify_password(username, current_password):
        return {'ok': False, 'error': '当前密码错误'}
    uerr = _validate_new_username(new_username)
    if uerr:
        return {'ok': False, 'error': uerr}
    cfg['username'] = new_username.strip()
    _save_config(cfg)
    return {'ok': True, 'message': '用户名已更新', 'username': cfg['username']}


def reset_credentials(username: str, current_password: str) -> dict[str, Any]:
    cfg = _load_config()
    if not verify_password(username, current_password):
        return {'ok': False, 'error': '当前密码错误'}
    salt = _new_salt()
    cfg['username'] = DEFAULT_USERNAME
    cfg['salt'] = salt
    cfg['password_hash'] = _hash_password(DEFAULT_PASSWORD, salt)
    cfg['must_change_password'] = True
    cfg['password_changed_at'] = None
    cfg['reset_source'] = 'manual-reset'
    _save_config(cfg)
    return {
        'ok': True,
        'message': '账号凭据已重置为默认值 admin / admin，请立即重新修改密码',
        'username': DEFAULT_USERNAME,
        'mustChangePassword': True,
    }


def setup_password(password: str) -> dict[str, Any]:
    """兼容旧接口：保留但改为重置默认账号密码的简化入口。"""
    cfg = _load_config()
    err = _validate_new_password(password)
    if err:
        return {'ok': False, 'error': err}
    salt = _new_salt()
    cfg['salt'] = salt
    cfg['password_hash'] = _hash_password(password, salt)
    cfg['must_change_password'] = False
    cfg['password_changed_at'] = _now_ts()
    cfg['reset_source'] = 'legacy-setup'
    _save_config(cfg)
    return {'ok': True, 'message': '密码已设置'}


_PUBLIC_PATHS = frozenset({
    '/healthz',
    '/api/auth/login',
    '/api/auth/status',
    '/api/auth/setup',
})

_PUBLIC_PREFIXES = (
    '/_assets/',
    '/assets/',
)


def requires_auth(path: str) -> bool:
    """判断该路径是否需要认证。"""
    if not is_enabled():
        return False
    if path in _PUBLIC_PATHS:
        return False
    for prefix in _PUBLIC_PREFIXES:
        if path.startswith(prefix):
            return False
    if path in ('', '/', '/dashboard', '/dashboard.html'):
        return False
    return True
