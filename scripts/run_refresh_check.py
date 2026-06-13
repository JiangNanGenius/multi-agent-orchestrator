import py_compile
import subprocess
import pathlib
import os
import sys

base = pathlib.Path(os.environ.get('AGENTORCHESTRATOR_HOME', pathlib.Path(__file__).resolve().parents[1])).expanduser()
script = base / 'scripts' / 'refresh_live_data.py'
py_compile.compile(str(script), doraise=True)
result = subprocess.run([sys.executable, str(script)], cwd=str(base), capture_output=True, text=True)
print('returncode=', result.returncode)
print('stdout=')
print(result.stdout)
print('stderr=')
print(result.stderr)
