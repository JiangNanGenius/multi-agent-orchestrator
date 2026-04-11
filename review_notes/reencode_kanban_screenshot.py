from pathlib import Path
from PIL import Image

TARGET = Path('/home/ubuntu/multi-agent-orchestrator_public/docs/screenshots/01-kanban-main.png')

with Image.open(TARGET) as img:
    rgb = img.convert('RGB')
    rgb.save(TARGET, format='PNG', optimize=True, compress_level=9)

print(TARGET)
