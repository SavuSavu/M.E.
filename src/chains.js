// Follow connected edges only where endpoint tangents agree within an angle.
export function tangentChain(edges, seed, angle = 20) {
  const selected = new Set([seed]);
  const limit = Math.cos(angle * Math.PI / 180);
  const length = p => Math.hypot(...p);
  const endpoints = e => {
    const p = e.points;
    if (p.length < 6) return [];
    const start = p.slice(0, 3), next = p.slice(3, 6), end = p.slice(-3), prev = p.slice(-6, -3);
    return [[start, next.map((v, k) => v - start[k])], [end, prev.map((v, k) => v - end[k])]];
  };
  const all = edges.map(endpoints);
  const values = edges.flatMap(e => e.points);
  const scale = values.reduce((m, v) => Math.max(m, Math.abs(v)), 1);
  const tolerance = Math.max(1e-4, scale * 1e-6);
  const queue = [seed];
  while (queue.length) {
    const i = queue.shift();
    for (let j = 0; j < edges.length; j++) {
      if (selected.has(j)) continue;
      if (all[i].some(([p, t]) => all[j].some(([q, u]) => {
        const dot = t.reduce((s, v, k) => s + v * u[k], 0) / (length(t) * length(u));
        return Math.hypot(...p.map((v, k) => v - q[k])) <= tolerance && dot < -limit;
      }))) { selected.add(j); queue.push(j); }
    }
  }
  return [...selected];
}
