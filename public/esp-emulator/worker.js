// Adapted from esp-emulator v0.48.0 www/worker.js (Apache-2.0; see pkg/LICENSE).
// WireUp: embedded-ROM boot, C3/S3 only, bounded batches, no network bridge.

let wasm = null;
let emulator = null;
let running = false;
const BATCH_SIZE = 50000;
const SNAPSHOT_INTERVAL_MS = 150;
let lastSnapshot = 0;

function fail(error) {
    running = false;
    postMessage({ type: 'error', message: String(error?.message ?? error) });
}

self.onerror = (message) => fail(`Worker error: ${message}`);
self.onunhandledrejection = (event) => fail(`Worker promise rejected: ${event.reason}`);

async function initWasm() {
    try {
        const { default: init, WasmEmulator } = await import('/esp-emulator/pkg/esp_emu.js');
        await init();
        wasm = { WasmEmulator };
        postMessage({ type: 'ready' });
    } catch (error) {
        fail(`Failed to init WASM: ${error}`);
    }
}

function machineInfo() {
    return {
        pc: emulator.pc(),
        isXtensa: emulator.is_xtensa(),
        numHarts: emulator.num_harts(),
        cyclesPerUs: emulator.cycles_per_us(),
    };
}

function handleLoad(msg) {
    if (!wasm) throw new Error('WASM is not ready.');
    if (msg.chip !== 'esp32c3' && msg.chip !== 'esp32s3') throw new Error('Only ESP32-C3 and ESP32-S3 are supported.');
    running = false;
    emulator?.free();
    emulator = new wasm.WasmEmulator(msg.chip);
    if (!emulator.has_default_rom()) throw new Error(`No embedded ROM for ${msg.chip}.`);
    emulator.load_default_rom();
    emulator.set_boot_from_rom(true);
    if (msg.network?.ssid) emulator.set_wifi_config(msg.network.ssid, msg.network.password || '');
    emulator.load_firmware(new Uint8Array(msg.firmware));
    postMessage({ type: 'loaded', chip: msg.chip, ...machineInfo() });
    sendSnapshot(true);
}

self.onmessage = async ({ data: msg }) => {
    try {
        switch (msg.type) {
            case 'init':
                if (!wasm) await initWasm();
                break;
            case 'load':
                handleLoad(msg);
                break;
            case 'start':
                if (!emulator) throw new Error('Firmware is not loaded.');
                if (!running) {
                    running = true;
                    runLoop();
                }
                break;
            case 'uart_input':
                if (!emulator) throw new Error('Firmware is not loaded.');
                emulator.uart_input(new Uint8Array(msg.data));
                break;
            case 'gpio_input':
                if (!emulator) throw new Error('Firmware is not loaded.');
                emulator.gpio_set_input(msg.pin, !!msg.high);
                break;
            default:
                throw new Error(`Unsupported worker command: ${msg.type}`);
        }
    } catch (error) {
        fail(error);
    }
};

function runLoop() {
    if (!running || !emulator) return;
    try {
        const startTime = performance.now();
        let allOutput = '';
        let nextDelay = 0;
        while (running) {
            allOutput += emulator.run_batch(BATCH_SIZE);
            if (emulator.needs_restart()) {
                if (allOutput) postMessage({ type: 'uart_output', data: allOutput });
                allOutput = '';
                emulator.restart();
                postMessage({ type: 'uart_output', data: '\r\n' });
                postMessage({ type: 'restarted', ...machineInfo() });
                sendSnapshot(true);
                break;
            }
            // Discard guest TX; this integration never opens a network bridge.
            emulator.wifi_tx_drain();
            const drift = emulator.throttle_delay_ms(performance.now());
            if (drift > 0) {
                nextDelay = drift;
                break;
            }
            if (performance.now() - startTime > 12) break;
        }
        if (allOutput) postMessage({ type: 'uart_output', data: allOutput });
        postMessage({ type: 'status', cycles: emulator.cycles(), ...machineInfo() });
        sendSnapshot(false);
        if (running) setTimeout(runLoop, nextDelay);
    } catch (error) {
        fail(error);
    }
}

function sendSnapshot(force) {
    if (!emulator) return;
    const now = performance.now();
    if (!force && now - lastSnapshot < SNAPSHOT_INTERVAL_MS) return;
    lastSnapshot = now;
    postMessage({
        type: 'snapshot',
        // v0.48.0: [out_lo, out_hi, enable_lo, enable_hi]; no input/pull readback.
        gpio: Array.from(emulator.gpio_state()),
        cycles: emulator.cycles(),
        cyclesPerUs: emulator.cycles_per_us(),
    });
}
