import pathlib
import tempfile
import sys

PROJECT_ROOT = pathlib.Path('/home/ubuntu/multi-agent-orchestrator_public')
DASHBOARD_DIR = PROJECT_ROOT / 'dashboard'
if str(DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(DASHBOARD_DIR))

import auth


def main():
    with tempfile.TemporaryDirectory() as tmp:
        data_dir = pathlib.Path(tmp)
        auth.init(data_dir)
        cfg = auth.get_config(redact=False)
        assert cfg['username'] == 'admin', cfg
        assert auth.verify_password('admin', 'admin') is True
        status = auth.get_auth_status(None)
        assert status['mustChangePassword'] is True
        assert pathlib.Path(status['authFile']).exists()

        result = auth.complete_first_change('admin', 'admin', 'newpass123', 'rootadmin')
        assert result['ok'] is True, result
        assert result['username'] == 'rootadmin', result
        assert result['mustChangePassword'] is False, result
        assert auth.verify_password('rootadmin', 'newpass123') is True
        assert auth.verify_password('admin', 'admin') is False

        auth_file = data_dir / 'auth.json'
        auth_file.unlink()
        auth.ensure_auth_file()
        cfg2 = auth.get_config(redact=False)
        assert cfg2['username'] == 'admin', cfg2
        assert auth.verify_password('admin', 'admin') is True
        print('auth_smoke_test: ok')


if __name__ == '__main__':
    main()
