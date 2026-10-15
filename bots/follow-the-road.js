// A racecar bot that follows the road: steer toward the road ahead, ease off in tight turns.
(view, memory) => {
  const g = view.game;
  if (!g) return {};
  const turn = g.angleToNext;
  const tight = Math.abs(turn) > 0.35;
  if (g.lap !== memory.lap) { memory.lap = g.lap; log('lap', g.lap, 'rank', g.rank); }
  return {
    steer: Math.max(-1, Math.min(1, turn * 2.5 - g.lateral / Math.max(4, g.halfWidth) * 0.3)),
    throttle: g.phase === 'countdown' ? 0 : tight && g.speed > 25 ? 0.4 : 1,
    brake: tight && g.speed > 35 ? 0.5 : 0,
  };
}
