import { writeFile } from 'node:fs/promises'
const symbols = {
  'source-dc-voltage': '<path d="M28 30v12m-6-6h12m8 8h12"/>',
  'source-dc-current': '<path d="M22 32h20m-7-6 7 6-7 6"/>',
  'source-sine-voltage': '<path d="M16 32c5-16 11-16 16 0s11 16 16 0"/>',
  'source-ac-voltage': '<path d="M16 32c5-16 11-16 16 0s11 16 16 0"/>',
  'source-pulse-voltage': '<path d="M16 39h9V25h14v14h9"/>',
  'source-pwl-voltage': '<path d="m16 41 10-19 11 16 11-14"/>',
  ground: '<path d="M32 8v24M14 32h36M20 40h24M26 48h12"/>',
}
for (const [id, symbol] of Object.entries(symbols)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#151515"/><g fill="none" stroke="#c4b5fd" stroke-width="2" stroke-linejoin="round">${id === 'ground' ? '' : '<path d="M2 32h10m40 0h10"/><circle cx="32" cy="32" r="20"/>'}${symbol}</g></svg>`
  await writeFile(`public/component-svgs/${id}.svg`, svg)
}
