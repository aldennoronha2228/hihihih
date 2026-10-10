import asyncio
from backend.native_esp32 import NativeESP32, Session


def test_actual_guest_panic_is_reported_and_process_stopped():
    async def run():
        class Process:
            returncode = None
            def terminate(self): self.returncode = -15
            async def wait(self): return self.returncode
        runtime = NativeESP32()
        session = Session('project','esp32-devkit-v1','artifact',1,1)
        session.process = Process()
        stream = asyncio.StreamReader()
        stream.feed_data(b'Guru Meditation Error: Cache error\n')
        stream.feed_eof()
        await runtime._drain(session, stream, 'serial')
        assert session.status == 'error'
        assert 'panicked' in session.error
        assert session.process.returncode is not None
        assert b'Guru Meditation' in session.serial
    asyncio.run(run())
