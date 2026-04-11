import py_compile
import subprocess
import pathlib

base = pathlib.Path('/home/ubuntu/agentorchestrator_review_20260407')
script = base / 'scripts' / 'refresh_live_data.py'
py_compile.compile(str(script), doraise=True)
result = subprocess.run(['python3', str(script)], cwd=str(base), capture_output=True, text=True)
print('returncode=', result.returncode)
print('stdout=')
print(result.stdout)
print('stderr=')
print(result.stderr)
