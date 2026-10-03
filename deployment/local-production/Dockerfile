# syntax=docker/dockerfile:1.7
FROM node:22.15.0-bookworm-slim AS web-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY vendor/velxio/frontend/src ./vendor/velxio/frontend/src
RUN npm run build

FROM caddy:2.10.0-alpine AS ingress
COPY deployment/local-production/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /build/dist /srv
COPY vendor/velxio/LICENSE /srv/licenses/velxio-AGPL-3.0.txt
COPY vendor/velxio/COMMERCIAL_LICENSE.md /srv/licenses/velxio-commercial.txt
COPY vendor/VELXIO_PROVENANCE.md /srv/licenses/velxio-provenance.txt

FROM python:3.11.12-slim-bookworm AS backend
ARG ARDUINO_CLI_VERSION=1.2.2
ARG ARDUINO_CLI_SHA256
ARG ARDUINO_AVR_CORE_VERSION=1.8.6
ARG INSTALL_EXTENDED_CORES=false
ARG RP2040_CORE_VERSION=4.5.2
ARG ESP32_CORE_VERSION=3.2.0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/home/wireup \
    ARDUINO_CLI_PATH=/usr/local/bin/arduino-cli ARDUINO_BUILD_CACHE_PATH=/tmp/arduino-cache
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 wireup
# This reference build supports linux/amd64; verify the upstream archive digest before building.
RUN test "$(dpkg --print-architecture)" = amd64 \
    && test -n "$ARDUINO_CLI_SHA256" \
    && curl -fsSL "https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" -o /tmp/arduino-cli.tar.gz \
    && python -c "import hashlib,os; from pathlib import Path; actual=hashlib.sha256(Path('/tmp/arduino-cli.tar.gz').read_bytes()).hexdigest(); assert actual == os.environ['ARDUINO_CLI_SHA256'], 'Arduino CLI digest mismatch'" \
    && tar -xzf /tmp/arduino-cli.tar.gz -C /usr/local/bin arduino-cli \
    && rm /tmp/arduino-cli.tar.gz
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY --chown=wireup:wireup backend /app/backend
COPY --chown=wireup:wireup deployment/local-production/entrypoint.py /app/production_entrypoint.py
COPY vendor/velxio/LICENSE /app/licenses/velxio-AGPL-3.0.txt
COPY vendor/velxio/COMMERCIAL_LICENSE.md /app/licenses/velxio-commercial.txt
USER wireup
RUN arduino-cli config init \
    && arduino-cli core update-index \
    && arduino-cli core install "arduino:avr@${ARDUINO_AVR_CORE_VERSION}" \
    && if [ "$INSTALL_EXTENDED_CORES" = true ]; then \
        arduino-cli config add board_manager.additional_urls https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json; \
        arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json; \
        arduino-cli core update-index && arduino-cli core install "rp2040:rp2040@${RP2040_CORE_VERSION}" "esp32:esp32@${ESP32_CORE_VERSION}"; \
    elif [ "$INSTALL_EXTENDED_CORES" != false ]; then exit 1; fi \
    && mkdir -p /app/backend/data/hardware
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "production_entrypoint:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers", "--no-access-log", "--ws-max-size", "256000", "--limit-concurrency", "64", "--timeout-keep-alive", "5"]
