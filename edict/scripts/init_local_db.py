from pathlib import Path
import sys
import asyncio

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db import init_db  # noqa: E402
from app.models.task import Task  # noqa: F401,E402


async def main() -> None:
    await init_db()
    print("DB_INIT_OK")


if __name__ == "__main__":
    asyncio.run(main())
