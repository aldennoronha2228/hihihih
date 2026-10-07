# LangChain feature audit

This audit covers the running `Downloads/simply` app, not the separate earlier `wireup` checkout. Credentials were not printed or committed. Controlled-response tests and live-provider tests are distinguished below.

## Confirmed fixes

- Plan operation names now use actual executable tool enums; prose cannot authorize changes.
- Full AIMessage streaming fallbacks are handled alongside chunks; truncated model output does not execute partial tools.
- Let AI choose resolves a canonical board through the validated plan; other targets remain blocked.
- Compile-only and emergency-stop paths no longer force unrelated mutation/question steps.
- Structured wiring failure details reach the model rather than a generic error.
- Groq/NVIDIA output limits are configurable, default 4096, bounded to 8192; ten MCQs previously exceeded the 1024 budget.
- A rate-limited model call can retry once when the provider reports a short retry delay, only before response content/tool execution. Quota errors without a usable delay remain explicit.
- Bedrock auth mode consistently respects explicit process settings; credential presence is not verified model access.
- Question cards reset when a different questionnaire arrives. Let AI choose is displayed as the fourth option without retaining extra options beyond four.
- Existing browser regressions were updated from retired native model selectors to the actual accessible picker and current send/stop labels.

## Verification evidence

- Deterministic backend suite: **583 passed, 22 deselected**. These exclusions are separate compiler/runtime integration cases, not removed functionality.
- Compiler error/timeout/cancellation/Pico artifact boundary checks: **6 passed** on isolated execution.
- Full non-C3 browser inventory: **90 passed, 3 failed** on the first completed audit run. The final targeted rerun passed all seven mobile cases, including the three earlier failures, after correcting hidden-panel expectations and API wait timing. This is not described as a clean full-suite pass.
- TypeScript build passes. Production Vite build passes with existing chunk-size and upstream eval warnings. Oxlint reports 22 warnings, zero errors.
- Actual live Azure end-to-end: ten generated MCQs, AI-choice answers, Uno + real LED + 220-ohm resistor, three wires, actual sketch, successful arduino-cli artifact, visible final guide, no second confirmation. Separate Chrome check started/stopped that actual model-generated firmware and opened its synchronized schematic.
- Actual Groq and Azure plain chat replies received. Groq live build hit its 8000-token/minute limit; a successful Azure build does not prove Groq reliability.
- Actual NVIDIA request timed out after its configured 20 seconds. Bedrock zai.glm-5 returned authorization failure. Settings presence is not readiness.

## Remaining limitations

- Heavy ESP32-C3 firmware-runtime tests are experimental and not certified. The normal app must not claim these boards simulate successfully.
- A model can still select poor assumptions; topology checks are limited and are not physical safety certification.
- Requirements are not yet fully versioned per materially different follow-up request. Rebuilding different hardware should start a new setup until this contract is formalized.
- No physical board upload was tested. Linux Pi applications are editable source/instructions without Arduino compilation or browser simulation.
- All currently configured providers are not verified working agents. Use a tested provider and address its actual quota/authentication/model-access issue.
