"""Fail-closed standalone production entrypoint."""

import os
from pathlib import Path

from backend.security import SecurityMiddleware

if os.getenv('WIREUP_DEPLOYMENT') != 'production':
    raise RuntimeError('This entrypoint requires WIREUP_DEPLOYMENT=production.')

secret_file = os.getenv('WIREUP_ACCESS_TOKEN_FILE')
if secret_file:
    os.environ['WIREUP_ACCESS_TOKEN'] = Path(secret_file).read_text(encoding='utf-8').strip()

# Validate ingress settings before importing provider or hardware services.
app = SecurityMiddleware(None, production=True)

from backend.app import app as backend_app

app.app = backend_app
