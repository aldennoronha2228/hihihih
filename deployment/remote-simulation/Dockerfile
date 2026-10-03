# Build from repository root. Native QEMU is not supplied by Velxio's .so image.
FROM ubuntu:24.04 AS qemu-build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential python3 python3-venv python3-pip \
    meson ninja-build pkg-config libglib2.0-dev libpixman-1-dev libslirp-dev \
    libfdt-dev libgcrypt20-dev libzstd-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
# espressif/qemu esp-develop-9.2.2-20260417, peeled commit.
RUN git clone https://github.com/espressif/qemu.git /opt/qemu-source \
    && cd /opt/qemu-source \
    && git checkout --detach 40edccac415693c5130f91c01d84176ae6008566 \
    && git submodule update --init --recursive
WORKDIR /opt/qemu-source
RUN ./configure --prefix=/opt/qemu --target-list=xtensa-softmmu,riscv32-softmmu \
    --disable-werror --disable-docs --disable-gtk --disable-sdl --disable-vnc \
    --disable-tools --enable-slirp \
    && ninja -C build -j2 && ninja -C build install \
    && rm -rf build .git

# Keep the matching full distro, installed ROM/data tree, and corresponding source.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/upstream/backend:/opt/gateway \
    QEMU_ESP32_BINARY=/opt/qemu/bin/qemu-system-xtensa \
    QEMU_RISCV32_BINARY=/opt/qemu/bin/qemu-system-riscv32
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 python3-venv libglib2.0-0t64 libpixman-1-0 \
    libslirp0 libfdt1 libgcrypt20 libzstd1 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home emulator
COPY --from=qemu-build /opt/qemu /opt/qemu
COPY --from=qemu-build /opt/qemu-source /opt/qemu-source
COPY vendor/velxio/backend/app/__init__.py /opt/upstream/backend/app/__init__.py
COPY vendor/velxio/backend/app/services/__init__.py /opt/upstream/backend/app/services/__init__.py
COPY vendor/velxio/backend/app/services/esp_qemu_manager.py vendor/velxio/backend/app/services/wifi_status_parser.py /opt/upstream/backend/app/services/
COPY vendor/velxio/LICENSE vendor/velxio/COMMERCIAL_LICENSE.md vendor/VELXIO_PROVENANCE.md /opt/upstream/
COPY deployment/remote-simulation/requirements.txt /opt/gateway/requirements.txt
COPY deployment/remote-simulation/upstream.sha256 /opt/upstream/upstream.sha256
RUN cd /opt/upstream && sha256sum -c upstream.sha256
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /opt/gateway/requirements.txt \
    && ldd /opt/qemu/bin/qemu-system-xtensa | tee /tmp/xtensa-deps \
    && ldd /opt/qemu/bin/qemu-system-riscv32 | tee /tmp/riscv-deps \
    && ! grep -q 'not found' /tmp/xtensa-deps /tmp/riscv-deps
COPY deployment/remote-simulation/server.py /opt/gateway/server.py
COPY deployment/remote-simulation/README.md /opt/gateway/README.md
WORKDIR /opt/gateway
USER 10001:10001
EXPOSE 8080
CMD ["/opt/venv/bin/uvicorn", "server:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--limit-concurrency", "16", "--timeout-keep-alive", "5", "--no-access-log"]
