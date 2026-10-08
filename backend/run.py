import asyncio
import logging
import os
from pathlib import Path
import re
import sys

import uvicorn
from dotenv import load_dotenv


class RuntimeTokenFilter(logging.Filter):
    def filter(self, record):
        record.msg = re.sub(r'([?&]token=)[^&\s"]+', r'\1[REDACTED]', record.getMessage())
        record.args = ()
        return True


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    # WebSocket connection messages use uvicorn.error, not uvicorn.access.
    logging.getLogger('uvicorn.error').addFilter(RuntimeTokenFilter())
    windows = sys.platform == 'win32'
    if windows:
        # ProactorEventLoop is required on Windows to launch compiler subprocesses.
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    # Windows: disable reload (Watchfiles uses a Selector loop internally) and
    # pass loop='none' so uvicorn inherits the ProactorEventLoop set above.
    uvicorn.run('backend.app:app', host='127.0.0.1', port=int(os.getenv('BACKEND_PORT', '8000')),
                loop='none' if windows else 'auto', reload=not windows,
                reload_dirs=None if windows else ['backend'], access_log=False)


if __name__ == '__main__':
    main()
