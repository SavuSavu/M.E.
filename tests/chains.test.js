import { it, expect } from 'vitest';
import { tangentChain } from '../src/chains.js';
it('follows a tangent curve but stops at a sharp corner and at disconnected curves', () => {
  const edges = [
    {points:[0,0,0, 1,0,0]}, {points:[1,0,0, 2,0.05,0]},
    {points:[2,0.05,0, 2,1,0]}, {points:[9,0,0, 10,0,0]}
  ];
  expect(tangentChain(edges, 0)).toEqual([0,1]);
});
it('finds a reversed tangent segment', () => {
  const edges = [{points:[0,0,0, 1,0,0]}, {points:[2,0,0, 1,0,0]}];
  expect(tangentChain(edges, 0)).toEqual([0,1]);
});
