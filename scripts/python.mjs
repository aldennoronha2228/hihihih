import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const python = resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
if (!existsSync(python)) {
  console.error('Python environment missing. Create .venv and install backend/requirements.txt first; see README.md.')
  process.exit(1)
}
const child = spawn(python, process.argv.slice(2), { stdio: 'inherit', shell: false })
child.on('error', error => { console.error(error.message); process.exit(1) })
child.on('exit', code => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
