// A sea wall (GroundDef.features, Coastal's waterfront; docs/COASTAL.md, "The sea wall"): off one
// side of the main road over a stretch, the ground drops sheer just past the road's verge (a quay's
// edge, SEAWALL_LEDGE) to the floor under the sea, so the water comes right up to the wall, then eases back to the ground's own
// (the coast's sea bed) further out. The wall itself is the layout's (its walls), drawn by the skin
// down into the water (render/skins/greybox/rails.ts).

import type { SeawallDef } from '../../content';
import { smoothstep as smooth } from '../../math';
import type { BakedSpline } from '../bake';
import type { Feature } from '.';

/** Its ends fade in over this many meters (short: the drop shouldn't run on past the wall). */
export const SEAWALL_FADE = 6;
/**
 * The quay's edge past the verge (m): the ground keeps its height this far out and drops past it,
 * so no grid cell touching the shoulder slopes down (a car on the shoulder would dip into it; the
 * ground's cells are 2.5 m, their diagonal 3.5). The skin draws a stone ledge over it, from the
 * parapet out to the sea face.
 */
export const SEAWALL_LEDGE = 3.75;
/**
 * Where the skin draws the sea face, past the verge (m): a metre past where the ground drops, since a
 * grid cell across the drop slopes out from behind it (with a floor 10 m under a road 3 m up, at
 * most 3/13 of a cell's 3.5 m diagonal, 0.8 m, is over the sea), so the face hides it.
 */
export const SEAWALL_FACE = SEAWALL_LEDGE + 1;
/** Past the ledge, the floor this far out (m), then easing back to the ground's own by REACH. */
const HOLD = 4;
const REACH = 40;

export function seawallFeature(w: SeawallDef, main: BakedSpline): Feature {
  // Per main-road sample, its side times how far in from its ends.
  const at = new Float32Array(main.n);
  const len = (((w.s[1] - w.s[0]) % main.length) + main.length) % main.length;
  const side = w.side === 'left' ? -1 : 1;
  for (let d = 0; d <= len; d += main.step) {
    const i = Math.round((((w.s[0] + d) % main.length) + main.length) % main.length / main.step) % main.n;
    at[i] = side * smooth(0, SEAWALL_FADE, Math.min(d, len - d));
  }
  return {
    kind: 'seawall',
    def: w,
    shape(p, y) {
      const i = ((Math.round(p.s / main.step) % main.n) + main.n) % main.n;
      const k = at[i];
      // On its side, past the ledge (on the road, its shoulder and the ledge, the ground's own).
      const ledge = p.edge + SEAWALL_LEDGE;
      if (k * p.lat <= 0 || p.d <= ledge) return y;
      const pull = Math.abs(k) * (1 - smooth(ledge + HOLD, p.edge + REACH, p.d));
      return y + (Math.min(y, w.floor) - y) * pull;
    },
  };
}
