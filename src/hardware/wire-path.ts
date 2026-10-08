export type WirePoint = { x: number; y: number }

export function roundedOrthogonalPath(points: WirePoint[], radius = 12): string {
  const vertices = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  if (!vertices.length) return ''
  let path = `M ${vertices[0].x} ${vertices[0].y}`
  for (let index = 1; index < vertices.length - 1; index++) {
    const previous = vertices[index - 1]
    const corner = vertices[index]
    const next = vertices[index + 1]
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y)
    const bend = Math.min(Math.max(0, radius), incoming / 2, outgoing / 2)
    const orthogonal = (previous.x === corner.x && corner.y === next.y) || (previous.y === corner.y && corner.x === next.x)
    if (!bend || !orthogonal) {
      path += ` L ${corner.x} ${corner.y}`
      continue
    }
    const entry = { x: corner.x + (previous.x - corner.x) * bend / incoming, y: corner.y + (previous.y - corner.y) * bend / incoming }
    const exit = { x: corner.x + (next.x - corner.x) * bend / outgoing, y: corner.y + (next.y - corner.y) * bend / outgoing }
    path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`
  }
  const end = vertices[vertices.length - 1]
  return vertices.length > 1 ? `${path} L ${end.x} ${end.y}` : path
}

export function roundedWirePath(start: WirePoint, end: WirePoint, radius = 12): string {
  const middleX = (start.x + end.x) / 2
  return roundedOrthogonalPath([start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end], radius)
}
