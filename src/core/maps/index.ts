// Every map's overrides (core/track/overrides.ts), by id: a layout's `overrides` name them. Each
// map's own are in core/maps/<map>/overrides.ts; add its module here. Ids are unique across maps.
// (In core, not src/maps as CALDERA first had it: core imports nothing outside core.)

import type { OverrideCode } from '../track/overrides';

export const OVERRIDES: Readonly<Record<string, OverrideCode>> = {};
