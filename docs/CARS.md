# Cars

How the greybox cars are designed and built, why they're built that way, and what we learned
getting them to read cleanly. Code lives in `src/render/skins/greybox/car/`; the garage viewer
is `cars.html` (`src/viewer/cars.ts`). SPEC "Car art" has the short version of the decisions.

## The brief

An arcade racer with Burnout 3 mechanics and a cel-shaded look. The first cars were boxes, and
the PoC image set the target: chunky, readable silhouettes, black ink lines, flat toon shading and
loud paint. The job was to add detail **without** losing that look: more shape and more parts,
still flat colours and hard lines, never realistic.

The rules we held to:

- **Read at a glance from the chase camera.** Most of the time the camera sees a car from behind and
  slightly above, at speed. So the tail matters most: each class has its own rear signature (the
  coupe's light bar and wing, the muscle car's quad pipes and round tails, the hatch's vertical
  lamps, the van's slab back).
- **Code, not meshes.** Every car is generated from a small design record. There are no model files
  to import, tweaking a car means editing numbers and reloading, and a new car is a new record.
- **Rendering only.** The sim knows a car as a collider and some stats. Nothing on this page
  changes handling, collisions or the network. Wrecks are cosmetic and local.
- **Cheap.** About 30 draws for a racer, with static parts merged per material. Traffic is
  instanced.

## Pipeline

```
designs.ts (CarDesign)  ──►  build.ts buildCar()  ──►  CarVisual { root, update, wreck, repair, dispose }
                                  │
                   paint.ts  ◄────┤  toon paint: finish + livery in the shader
                   ink.ts    ◄────┤  marks meshes with part ids for the car ink pass
                   wreck.ts  ◄────┘  crumple, flying parts, shards
traffic.ts: the same design flattened into instanced parts, for race traffic
```

### 1. The design record (`designs.ts`)

A `CarDesign` is mostly a **side profile** in metres, in the car's frame (+z is the nose, y is up):

- `body`: the top line of the body, from the front bottom over to the rear bottom. The builder adds
  the sill and cuts the arches.
- `cabin`: the greenhouse, a closed outline sitting on the belt line. `cabinBase` and `cabinRoof`
  set its width at the belt and at the roof, so it leans in.
- `noseTaper` and `tailTaper`: the pinch in plan view toward each end.
- `wheel`: radius, width, and the z of each axle.

After that come **detail switches**:
- head, tail and exhaust styles
- wing, roof spoiler, hood scoop, diffuser, roof rack
- door cut positions, B-pillar
- mirrors, mud flaps, light pod, light bar, push bar
- cargo box, dual rear tyres, grille
- the livery

Each is a small optional field, so a design only states what makes it different.

Current designs:

| id | role | character |
|---|---|---|
| coupe (Vanta) | player | low wedge, fastback, light-bar tail, wing |
| muscle | player | long hood with a scoop, ducktail, round tails, quad pipes |
| hatch | player | tall and short, upright hatch, roof spoiler, vertical lamps |
| van | player / traffic | painted slab with glass set in, roof rack, corner lamps |
| sedan (Cruiser) | player / traffic | three boxes, upright glass, trunk step, the one you smash into |
| bus (Route 88) | player / traffic | 10.4 m painted box, side glass strip, destination sign, AC unit |
| rally (Mudlark) | player | jacked-up hatch, chunky tyres, flaps, scoop, light pod, number livery |
| compact | traffic | short round nose, domed roof, big friendly round lamps |
| truck | traffic | cab, a real gap, then a separate cargo box with twin rear tyres |
| police | garage only | sedan shell, black-and-white livery, flashing light bar, push bar |

### 2. Building the shape (`build.ts`)

- **Extrude the profile.** The outline becomes a `Shape` and is extruded across the car's width
  with a chamfered bevel, so every edge catches a highlight and inks. The axis remap
  `(a, b, c) → (d/2 − c, b, a)` puts it in the car frame while keeping the winding. It's a rotation,
  so the faces don't flip.
- **Arches.** Cut into the sill line over each wheel. `archGap` sets how much air there is over
  the tyre: the rally car's bigger gap is what makes it read as raised.
- **Taper.** The nose and tail pinch in plan view. The flanks are long sliver triangles running
  nose to tail, and a pinch folds them. So flank triangles get the normal of the tapered surface
  they stand for, set by hand, not flat normals (see Lessons).
- **Lids.** Up-facing triangles over the hood and deck are split into their own hinged pieces (over
  a dark engine bay), so they can spring open in a wreck. Designs without a deck (the bus) turn
  this off with `lids: false`.
- **Greenhouse.** A second extrusion, narrowed toward the roof.
  - The **roof is chosen by position**: the run of outline points along the top. Everything else on
    a glass cabin is glass.
  - Painted cabins (van, bus) are the other way round: paint with glass panes set into the sides and
    back.
- **Details** are boxes, cylinders and discs placed on the surfaces the builder can query: `topY(z)`,
  the nose and tail surface at height y, the cabin side at height y, and the screen at height y.
  They include:
  - lamps, grille, intake, plates, pipes, diffuser fins
  - wipers, door handles, mirrors, bus mirror arms
  - the destination sign, light bar and pod, mud flaps
- **One detail language.** Every car's front is built the same way: lamps, a slatted grille between
  them, a lower intake and a plate. Every car has handles, wipers and the same rim. Variety comes from
  proportions and signature parts, not from each car inventing its own kind of lamp.
- **Merge.** Static parts go into buckets (`paint`, `trim`, `metal`, `glass`, `lamp`, …) and each
  bucket is merged into one mesh (`mergeGeometries`, non-indexed, flat normals). Unlit parts that
  never change colour (lens surrounds, lamps, plates, signs) share one vertex-coloured mesh. Parts
  that can come off (hood, trunk, wing, mirrors, plate, lip, pod, light bar, push bar, wheels) are
  their own small groups with a pivot.

`buildCar` takes only `{ id, size }`, so traffic and garage-only designs build without a player class.

### 3. Paint (`paint.ts`)

`carPaint(paint, livery)` is the skin's three-step toon ramp (`MeshToonMaterial`), patched in
`onBeforeCompile` with two additions.

**Finish:**

| finish | how it reads |
|---|---|
| matte | nothing added |
| gloss | a small hard highlight |
| metallic | a wide tinted highlight |
| pearl | a hue shift at grazing angles |
| chrome | a banded sky/horizon/ground reflection |

Every one is a `step()`, never a smooth gradient, which is what keeps it cel.

**Livery**, painted from object-space position and normal, so the body needs no UVs:

| livery | what it paints |
|---|---|
| stripes | twin stripes |
| flash | a raked side flash |
| band | a band at a height set per design |
| rally | blocks, a hood stripe, and a seven-segment door number 1–9 picked from the paint id |
| police | forced black-and-white panels |

When a paint has no second colour, the band uses a contrasting shade.

**Glass** uses the same idea as chrome, darker and tinted blue: dark ground below the reflected
horizon, sky bands above, a hot streak on the horizon, a lift at grazing angles and short diagonal
glints. It's one shared material on every car. A wreck swaps it for `crackedGlass`.

### 4. Car ink (`ink.ts`, `post.ts`)

The world's outline comes from depth: the post pass inks where depth jumps or kinks. That draws
silhouettes, but a window, a lamp or a panel gap on a flat surface has no depth change, so it never
inks. The cars get a second pass:

- Each marked mesh has a **part id** (`INK.paint`, `glass`, `head`, `hood`, `wheel`, …).
- For the pass, marked meshes swap to a flat shader that writes the view-space normal and the id,
  into an RGBA8 target with its own depth texture.
- The post pass trusts that target only where its depth matches the scene's depth, so hidden car
  parts can't ink through walls. It inks where **the id changes** (part and panel boundaries) or
  **the normal turns sharply** (creases).
- **Seams** (`SEAM = 255`) are ink-only strips that exist only in this pass. Door cuts, bumper lines,
  the roll-up door slats: lines with no geometry of their own.
- Car lines fade from 28 m to 80 m. Meshes beyond 90 m aren't drawn in the pass at all. Instanced
  meshes (debris, traffic) are exempt from that cull because their origin isn't where they are.

### 5. Wrecks (`wreck.ts`)

A wreck is Burnout's payoff, so it has to show on the car. It's all cosmetic, and the sim still just
says "wrecked":

- **Crumple:** vertices near the impact move in along the hit, down a little, with a stable hash
  jitter so it reads as crushed metal. A second lighter dent on the roof or a flank stands in for the
  tumble. The radius and reach scale with length (`max(1, hl / 2.5)`), so the bus dents like a bus.
- **Lids** spring open on a damped spring, or tear off.
- **Parts fly:** weak parts near the hit detach. They're moved into the world with `scene.attach`,
  fly ballistically and bounce. Wheels keep more of their bounce.
- **Glass** cracks (a material swap). Instanced **shards** of glass and paint spray from the impact.
- **Lamps** near the hit go dark. Glows that ride on a part (the pod, the light bar) leave with it.
- The renderer infers the hit direction from the Wreck event: toward the other car, or the nose for
  walls. `repair()` on Respawn restores positions, normals, materials and parents.

### 6. Traffic (`traffic.ts`)

Race traffic reuses the same designs. `trafficModel(kind)` builds the design once, then merges it per
material and ink id into instanced meshes. The body is tinted per instance, and a band keeps its
second colour. Racing liveries, beams and underglow stay on the racers. That's about 11–15 instanced
draws per kind, 59 for all five kinds. The city's parked and ambient cars keep the cheaper one-draw
models from the same file.

## The garage (`cars.html`)

A dev tool: every car on a stretch of road under the game's sky, with the game's post pass, so car
art can be worked on without driving. State lives in the URL (`cls`, `paint`, `view`, `ink`, `carink`,
`still`, …), so a view can be shared.

- **Views:** chase, orbit, rear34, side, front34, top.
- **Keys:**
  - 1–7 player classes, 8 compact, 9 truck, `-` police, 0 lineup, T traffic lineup.
  - P paint, V view, M palette.
  - O ink, K car ink, F post.
  - W wreck, R repair, B brake, Space boost, ←/→ steer, S road.

## How the work was done

The cars were built in four passes on 2026-09-30, each reviewed in the garage by screenshots before
moving on:

1. **Detailed cars** (PR #3): profile extrusion, paint finishes and liveries, the car ink pass,
   visible wrecks. The coupe, muscle, hatch and van were redone from boxes.
2. **Variety** (PR #5, landed via #6): sedan, bus and rally. The builder was generalised for bus
   scale. Traffic started drawing designed cars.
3. **Fleet** (PR #8, landed via #12): compact, truck and police. Cargo boxes, grilles, dual tyres,
   the light bar.
4. **Polish** (PR #11, landed via #12): one detail language across all ten cars, clean ink, glass
   windscreens and reflective glass everywhere, rounder compact, fewer draws.

The method each time:

- **Shoot first.** Screenshot every car from chase, side and front34, plus the lineups, in a couple of
  paints. Write a punch list from the pictures, not from the code. Fix, re-shoot the same angles and
  compare side by side.
- **Prove "unchanged" instead of assuming it.** When a pass shouldn't change existing cars, hash every
  mesh's geometry, transforms, ink ids, layers and material colours for every class × paint before
  and after. The hashes have to match.
- **Count draws** per car and for traffic before and after, and keep them flat or lower.
- **Check wrecks on everything.** W then R on every car. Nothing should float, clip or be left behind.

## Lessons (things that looked fine in code and wrong on screen)

- **Dashed lines along the belt.** Flank triangles are long slivers, nose to tail. Taper folds them,
  and flat normals on the folds made the toon ramp and the ink crease pass break into dashes. The fix
  is per-vertex normals of the true tapered surface on flank faces. Long flat-sided vehicles (sedan,
  bus, truck) also keep taper small.
- **Classifying by normal lies on raked glass.** The roof was "faces up enough", which made the
  coupe's windscreen (25° off flat) and fastback (18°) paint, with the stripes running over them.
  Deciding by position (the run of top outline points) fixed it.
- **Two surfaces meeting need to meet exactly.** A painted cabin tucked slightly inside the body
  showed a sliver of chamfer that inked as a dotted line. Overlapping, the two z-fought into specks.
  Flush fixed both.
- **Cut lids on a crease, not beside one.** A hood cut at the top of the chamfer inked as a broken
  line seen side-on. Moved onto the flank crease, it hides in a line that inks anyway.
- **Grey isn't neutral under a pink key light.** Rims came out rosy at dusk. The metal is now a touch
  blue.
- **Big flat panels catch the whole highlight at once.** A hard `step()` highlight on a flat face
  lights the entire face. Slightly bent highlight normals and the glints on glass break it up.
- **Scale assumptions hide everywhere.** The bus broke the hood/trunk split (negative-depth engine
  bay), the dent radius and the part-flight reach. All of these now scale with the design, or can be
  switched off per design.
- **Tiny geometry inks as noise.** Rims built from small parts turned into a scatter of ink marks at
  distance. One flat disc coloured per vertex (spokes, lip, hub) reads better and is cheaper.
- **Hidden browser tabs don't animate.** `requestAnimationFrame` stops in a background tab, and keyboard
  events from automation may not reach the page. For screenshots, drive the frame loop from a timer
  in a throwaway page, and dispatch keys from JS.

## Adding a car

1. **Write the design.** Add a `CarDesign` to `DESIGNS` in `designs.ts`, starting from the nearest
   existing one (`...sedan` works; see police). Get the profile right first: `body`, `sill`, `cabin`,
   `wheel`. Then add details.
2. **Add it to the garage.** Put it on a key in `src/viewer/cars.ts` and check it in chase, side,
   front34 and the lineup. Check ink with K on and off, and wreck with W then R.
3. **Hook it into the game, if it's for play or traffic.**
   - **Player or AI class:** a class JSON in `content/cars/` plus `CLASSES`, and the lap report
     (`bun tools/lap-report.ts --cars`) to balance it.
   - **Traffic:** the design id matching the traffic kind id is enough. `trafficModel` looks it up.
4. **Build only what the design needs.** If it needs a new part, add an optional field to `CarDesign`
   and build it in `build.ts` only when the field is set, so the other cars don't change. Give it an
   ink id if it's a distinct part. If it can come off in a wreck, make it a detachable piece.
5. **Run the checks.** `bun test`, `bunx tsc --noEmit` and `bunx vite build`.

## Known rough edges

- The van shows a faint dotted line where the hood meets the windscreen, in the front34 view.
- The sedan and police car have no belt line now (the old one was part of the dash artefact). They're
  clean but plain from the side.
- A dented car recomputes its normals, so broken belt lines can come back until repair.
- The compact's nose is flat face-on. The bus's rear and flanks are plain. The truck's plate is small
  at chase distance.
- The police car ignores paint: it's always black and white.
- Chase-distance flicker has only been checked in the garage, not in a live race.
