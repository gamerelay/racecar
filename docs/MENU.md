# The menu and settings

A plan for a real in-game menu and the settings behind it: sound, graphics, controls (with
remapping), gameplay, comfort, HUD and privacy, and two fixes to the menus as they are: the
dropdowns and the jumps between screens. **It's an outline, not a spec.** Details will
change while building; note those changes in [SPEC.md](./SPEC.md) under "Changed while building",
as usual.

Started 2026-10-01, after playtest feedback: the engines are too loud and the music too quiet,
and there's no way for a player to change either.

## Where things stand

- **Sound:** engines, effects and music each go through their own gain node in
  `src/audio/audio.ts`, but at fixed levels (engines 0.55, effects 0.9, master 0.8, the
  soundtrack 0.8). The player has only M (mute everything) and N (music on or off), remembered on
  the device.
- **The in-race "✕ Menu" button** (`#quit`, `main.ts`) quits straight to the main menu. Esc opens
  the pause menu (`#pause`, `main.ts`): Resume, Restart (offline), and Back to lobby or Main menu.
  Online, the race goes on behind it and your car coasts.
- **Graphics:** the renderer takes `post`, `outline` and `pixelRatio` options
  (`src/render/renderer.ts`), with nothing in the UI. Antialiasing is set when the renderer is
  made (it's off when the post pass is on), so switching post on or off needs a new renderer.
- **Controls:** the keyboard is one fixed table (`KEYS` in `src/input/input.ts`); gamepads use the
  standard mapping. `deadZone` and `rumbleOn` exist on `Input` but nothing sets them. The pause
  menu's control hints are written out by hand (`src/ui/hud.ts`).
- **Privacy:** SPEC promises a PostHog opt-out "in settings"; there isn't one yet.
- **Dropdowns:** the lobby's options (map, laps, weather, time, mayhem, traffic) are native
  `<select>`s from one helper (`sel` in `src/ui/menu.ts`). The closed box is styled
  (`.card select` in `hud.css`), but the list that opens is the browser's own, which doesn't
  match the game and can't be styled.
- **Screen changes:** a menu screen replaces the last one at once (`show` in `menu.ts` rewrites
  the menu's HTML), so moving between screens jumps.

## The plan

### One settings store, one Settings panel

- **A settings store** (`src/settings.ts`): every setting in one versioned object in
  `localStorage`, read once at startup and saved on change, with defaults for anything missing or
  unreadable (private windows, cleared storage). Each part of the game (audio, renderer, input,
  HUD, telemetry) reads its settings from it and is told when they change, so a change applies at
  once.
- **A Settings panel** (`src/ui/settings.ts`): sections as tabs (Sound, Graphics, Controls,
  Gameplay, HUD, Privacy), reachable by keyboard, gamepad and touch like the other menus. The same
  panel opens from:
  - **the in-race menu**: the "✕ Menu" button opens the menu instead of quitting, and Quit
    becomes a button in it (so a misclick no longer ends your race);
  - **the main menu**;
  - **the lobby**.
- Settings are per device and never go over the network: nothing here touches online play or
  GameRelay.

### The in-race menu

Esc, Start or the "✕ Menu" button:

- **Resume**
- **Restart** (offline only, as now)
- **Settings**: the panel, over the race (online, the race goes on behind it, as the pause menu
  does today)
- **Quit**: back to the lobby, or the main menu

### Choosers instead of dropdowns

Replace the `<select>`s with a chooser that cycles: `‹ Paradise ›`, styled like the rest of the
game.

- Click or tap the value (or the arrow on that side) to go to the next or previous one; left and
  right (A/D, the d-pad, the bumpers) do the same when it has focus, which fits how the menus
  already move.
- It wraps around, and shows where it is when there are many values (`3 / 8` under the laps, or
  dots).
- For long lists (maps), a press could open a styled grid to pick from (the map thumbnails
  `thumb.ts` already draws), with cycling still there for quick changes.
- One component (`src/ui/chooser.ts`) used by the lobby's options and the Settings panel, so both
  look the same. `readOptions` reads its value as it reads a `<select>`'s now.
- Disabled (a guest's view of the host's options, Time on a map without sunset) looks it, and
  can't be cycled.
- The editor's `<select>` is a dev tool and can stay.

### Transitions between screens

- **Menu screens:** the old one fades out (about 120 ms), the new one fades in (about 160 ms),
  with a small slide in the direction you're going (into a lobby, back out to the title).
  Focus moves once the new one is in, so a held key doesn't press something mid-fade.
- **Into and out of a race:** a short fade through black between the menu and the countdown, and
  between the results and the next screen. The race's own camera move can carry the rest.
- **Overlays** (the in-race menu, Settings, results): fade and scale in slightly over the race.
- Lists that refresh in place (the lobby browser every few seconds) don't fade: only a change of
  screen does.
- **Reduce motion** (see Camera and comfort), and the browser's `prefers-reduced-motion`, turn the
  slides off and shorten the fades to a quick cross-fade.

### Sound

| Setting | Notes |
| --- | --- |
| Master volume | Replaces M's all-or-nothing (M stays as a quick mute) |
| Music | Replaces N's on/off (N stays as a quick toggle) |
| Engines | Yours and everyone else's |
| Effects | Crashes, boosts, chimes, horns |

**First, the mix itself** (done, 2026-10-01): engines down from 0.55 to 0.35 and the music bus up
from 0.5 to 0.8, about 8 dB between them (`ENGINES_LEVEL` in `audio.ts`, `MUSIC_LEVEL` in
`model.ts`). The sliders will scale these.

### Graphics

- **Quality preset:** Low, Medium, High, mapping to resolution (`pixelRatio`), the post pass, ink
  outlines and particles. Custom once a single setting is changed.
- **The settings one by one**, under the preset: resolution scale, post effects, outlines,
  particles.
- **Show FPS.**
- Post effects on or off applies from the next race (it needs a new renderer, see above); the
  rest apply at once.

### Controls

- **Keyboard remapping:**
  - Each action (steer left and right, throttle, brake, boost, drift, reset, look back, horn,
    pause) gets two keys: a primary and an alternative, like WASD and the arrows today.
  - "Press a key" to set one, Esc to cancel. A key that's already in use says what it's on, and
    swaps or asks.
  - Reset to defaults.
  - System keys (Esc, F-keys, the dev keys) aren't remappable.
  - The control hints in the pause menu and HUD are built from the bindings, not written out.
- **Gamepad:** deadzone, rumble on or off (both exist in `Input`, with no UI), and steering
  sensitivity.
- **Gamepad remapping: later.** Triggers can be axes or buttons, and pads differ, so it's more
  work for fewer players. Keyboard first.

### Gameplay

- **Drift assist:** full, light or off (SPEC already says this belongs in settings).
- **Speed units:** km/h or mph.
- **Steering sensitivity** (keyboard ease-in, and the stick's curve).

### Camera and comfort

- **Screen shake** on or off.
- **Field of view.**
- **Reduce motion:** tones down shake, flashes and boost blur, and the menus' transitions. An
  accessibility need in a racer.

### HUD

- **Names over cars** (online; already on HANDOFF's list).
- **Minimap**, **race timer and splits**: on or off.

### Privacy and profile

- **Analytics opt-out** (PostHog). Promised in SPEC: before a public launch.
- **Player name.** Car and paint stay in the garage.

## Order

| Step | What | Effort |
| --- | --- | --- |
| 1 | Fix the mix (engines down, music up) | Very small (done) |
| 1b | Choosers instead of dropdowns; transitions between screens | Small to medium |
| 2 | Settings store and panel; the in-race menu (Resume, Restart, Settings, Quit); Sound sliders; Graphics preset and settings; analytics opt-out. In the in-race menu and the main menu. | Medium |
| 3 | Keyboard remapping, with hints from the bindings; gamepad deadzone, rumble and sensitivity | Medium |
| 4 | Gameplay, camera and comfort, HUD options; the panel in the lobby too | Small to medium, a setting at a time |
| 5 | Gamepad remapping | Larger |

## Open questions

- **Remapping conflicts:** swap the two bindings, or refuse and say which action has the key?
- **Touch controls:** anything to set (button size, layout, left-handed)?
- **Graphics default:** pick a preset from the device (screen size, a quick frame-time check on
  the first race), or always start on High?
- **Map chooser:** cycling only, or cycling plus a grid of map thumbnails?
- **Settings in the URL** for testing (`?quality=low`), or `localStorage` only?
