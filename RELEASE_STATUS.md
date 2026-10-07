# WireUp release status

This application has improved local reliability but is **not certified ready for public multi-user production**.

## Verified local changes
- Canonical project persistence, board/pin validation, atomic additive wiring with one undo/revision transaction, limited rail/LED topology checks.
- LangGraph tools `wire_circuit` and `validate_circuit`, alongside original project/firmware tools and analyzed Velxio example references.
- Hardware request deadlines/cancellation, nonoverlapping project polling, metadata retry, root error recovery, per-conversation project requirements.
- API middleware body limits, request admission, headers and fail-closed production token settings.
- Build passes; lint has existing React optimization warnings, not errors.
- Backend regression baseline: 493 passed (22 real-runtime/compiler tests excluded from this particular run). Dedicated security and wiring tests also executed.

## Simulation capabilities
- Uno/Nano/Mega/Pico use genuine browser CPU emulators. Pico and Pico W external-GPIO/UART0/button execution have now passed actual compiled-firmware browser tests; Pico W CYW43 radio and onboard LED remain unsupported. Existing real compilation/run checks establish selected local paths, not every peripheral.
- ESP32-C3 uses the genuine vendor RiscVCore adapter experimentally. Actual Arduino firmware execution failed at PC 0x514c26 after 2,666,667 cycles; it is not certified browser-supported and normal Run stays unavailable.
- ESP32/S3/C3 remote server package exists under deployment/remote-simulation and local session integration under backend/remote_projects.py. No server URL/token is configured; Docker image/TLS/QEMU firmware execution is unverified. Do not advertise successful remote simulation before deploying and smoke-testing it.
- Linux Pi3/4/5 and full WiFi/Bluetooth/CYW43 support remain unavailable. Not all upstream Velxio board features exist in this adapter.

## Public deployment blockers
- Shared-token reference auth is not per-user identity/project authorization. Browser credential/session and WebSocket ticket integration is not complete.
- Native compiler must move to disposable isolated workers without provider credentials or project filesystem access before accepting untrusted/public firmware.
- File locks/runtime sessions are process-local; keep single worker until transactional shared state and runtime coordination are implemented.
- Container builds, runtime capabilities and deployed HTTPS are not verified in this Windows environment without Docker.
- Review and rotate previously disclosed provider credentials. No secrets belong in deployment artifacts.
- AGPL source availability/attribution obligations must be met, or appropriate commercial licenses obtained.

Use deployment/local-production as a reference preparation package, not a declaration that these blockers are resolved.
