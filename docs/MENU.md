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
  menu's control hints are written out by hand (`src/ui/hud.ts`). (All of this changed with
  remapping, 2026-10-16: see "Remapping" below.)
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
  work for fewer players. Keyboard first. (In the end the pad came first, with the keyboard in the
  same change: "Remapping" below.)

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
| 1b | Choosers instead of dropdowns; transitions between screens | Small to medium (done) |
| 2 | Settings store and panel; the in-race menu (Resume, Restart, Settings, Quit); Sound sliders; Graphics preset and settings; analytics opt-out. In the in-race menu and the main menu. | Medium (done) |
| 3 | Keyboard remapping, with hints from the bindings; gamepad deadzone, rumble and sensitivity | Medium (done, with 5) |
| 4 | Gameplay, camera and comfort, HUD options; the panel in the lobby too | Small to medium, a setting at a time |
| 5 | Gamepad remapping | Larger (done, with 3) |

## Built (steps 1b and 2, 2026-10-01)

What's in, and where it went differently from the plan above:

- **Settings** (`src/settings.ts`, `src/ui/settings.ts`): the store, and one panel opened from the
  title's Settings button and the in-race menu's. It's one scrolling card with Sound, Graphics and
  Privacy headings, not tabs: three sections don't need them yet (tabs can come with Controls).
- **Sound:** master, music, engines and effects sliders, scaling the levels in `audio.ts`. M and N
  still work on top.
- **Graphics:** Quality (Low, Medium, High; Custom once a setting under it changes, and back to a
  preset's name if they match it again), Resolution (50% to 100%), Post effects, Outlines, Show
  FPS. No particles setting yet: the particle count isn't a knob in the renderer. `&post=0` and
  `&ink=0` in the URL still turn those off whatever the setting.
- **Privacy:** Analytics on or off, only in builds that send any (a PostHog key). Off applies at
  once (the sink checks before every send); the old `racecar.telemetry` opt-out is carried over.
- **The in-race menu:** the "☰ Menu" button (it used to quit) and Esc open it. From the top: the
  title, what's going on (online: the race goes on), How to play (the gameplay tips, no keys), then
  the buttons stacked at the bottom like the lobby's: Resume, Restart (offline), Settings, Controls,
  and Back to lobby or Quit. Esc or B closes Settings or Controls first, then the menu.
- **Controls** (`src/ui/controls.ts`): what each key and pad button does, read-only, from the
  in-race menu. Remapping (step 3) goes here. The HUD's per-device key strip (`hud.keys`, with pad
  glyphs once a pad's used) isn't shown anywhere now; step 3 can build the list from the bindings
  instead.
- **Choosers** (`src/ui/chooser.ts`): every dropdown in the menus (the lobby's options, the seats,
  Who can join). The left part of one goes back, the rest on; left and right step it, and sliders,
  when focused. The map chooser is cycling only for now (the thumbnail grid is still open).
- **Transitions:** menu screens fade and slide (forward from the right, back from the left), with
  nothing pressable while one leaves; overlays (the menu, Settings, results) pop in; every page
  load (a race, the menu after one) fades through the dark (`src/ui/fade.ts`), with the crossed
  flags pulsing in the middle (in `index.html`, so it's up from the first paint) until the page has
  drawn twice, for 0.7 s at least and 5 s at most; an offline race waits behind it. The browser's
  reduced-motion setting makes them short fades. The "Reduce motion" setting itself comes with
  step 4.

## The UI polish (v1.2, 2026-10-15)

The menus rebuilt to the "Racecar — UI Polish" designs: one system for the title, Multiplayer,
the lobby, the in-race menu and Settings. Built smallest parts first:

- **The kit** (`src/ui/kit.ts`, `src/ui/kit.css`): the designs' tokens (Ink, Night, Sun, Hot, Ice,
  Cream, Muted; Bungee and Chakra Petch; the hard pink shadow on one main action a screen; the
  −8° lean on titles and menu actions) and the parts every screen is made of: buttons, the
  leaning menu actions (the focused one fills and opens to say what it does), keycaps and pad
  buttons, tags, plates, switches, segmented choices, sliders, fields, panels, tabs, rated stats.
  Sized for 1080p and scaled to the window (1rem is 10px at 1080p). `kit.html` (dev only) shows
  every part; P there swaps the hints to the pad's.
- **Hints follow the device used last** (`Input.onDevice`, `body.pad`): keycaps, or the pad's
  buttons, drawn both ways and switched in CSS, so nothing redraws when you pick up the pad. The
  device is kept for the tab (`sessionStorage`), so a race (a page load) starts on the hints the
  menu had.
- **The pad in menus:** a held d-pad or stick repeats (380 ms, then every 95); Q and E (the
  bumpers, over Settings) switch tabs; R (the pad's Y) is a screen's extra, Refresh in the lobby
  list. Esc backs out of a text field too. The pointer over a menu action or a row focuses it, so
  what's lit follows the mouse as it does the pad.
- **Screens** (`src/ui/menu.ts`, `src/ui/menu.css`):
  - Title: Quick race (now a random car as well as a random map), Single player (your lobby),
    Multiplayer, Time trial, Free drive; your plate top right with Edit and the cog; the two
    fullest online lobbies bottom right.
  - Multiplayer (new; Create lobby's own screen is gone into it): the online lobbies with search,
    track, Hide full and an order by column, Quick join (the fullest open lobby between races),
    Create lobby (name, who can join, seats, bots fill the empty ones) and Join with code (a
    code, an invite link or a short link).
  - The lobby: drivers left (open seats quiet: their arrows show on the one you're on), your car
    in a frame in the middle over the scene (dimmed round it), its card under it, the track and
    its options right with the ready count over Start race.
  - In-race menu: the menu left under where you are in the race (lap, place, time, points), the
    six tips right, each with its key.
  - Settings and Controls: one sheet with two tabs; Controls is keyboard and pad side by side.
  - Not in the designs, made in their style (2026-10-16): the results (`ui/race.ts`; the place
    big and leaning top left, Race again and the way back beside it, the table under them with
    you ringed in sun, the online vote as leaning buttons), the first race's keys card
    (`ui/keys.ts`; the keyboard drawn, or the pad's buttons when the pad was used last) and the
    Credits, Privacy and Terms pages (`ui/pages.ts`; a sheet over the sunset, Back and the title
    over a body that scrolls, with the arrows and the d-pad too).
- **Coming and going:** a screen's pieces come in from their own side one after another, and go
  together, quickly; the backdrop under them changes as they swap (the title's softened race, the
  list's night). Back to a screen, focus is where you left it. Between pages (into a race and out)
  slanted bands sweep across (sun, pink, the dark) and off again once the next page has drawn.
  Reduced motion makes all of it short fades.

Where it went differently from the designs:

- **No ping per lobby, and no "drivers online"** in the list: the rooms don't report either. The
  header counts the drivers in the lobbies listed instead. The listing now carries the host's plate
  and the rules (an older host's listing still lists, without them).
- **Fill open seats with bots** is a lobby option (`fill`, on by default; off, open seats start
  empty), set by the host in the lobby or at Create.
- **Seats** at Create closes the seats past the number picked (the host can open them again).
- **Resume** says it's back to the race as you left it: there's no countdown on resume (the design
  had one).
- **Handling**, not "Grip", on the car card: it's turn and grip together.
- **The lobby list's count** is the drivers over the seats not closed (1/4 when Create closed four),
  and Hide full and Quick join go by those seats too (`seatsIn`).
- **A player's seat** has the car and the ping under the name: the host's Kick and Make host need
  the row's width (the name was cut to "R…"). Armed, the confirm takes the status tag's place.
- **The car card's numbers** sit by their bars, not by the names: "Handling" and a 10 don't fit
  side by side as the design's "Grip 9" did.

## Remapping (steps 3 and 5, 2026-10-16)

The controller's buttons and the keyboard's keys, set on the Controls tab, the controller first.
The owner's call on conflicts: **swap**.

- **The bindings** (`src/input/bindings.ts`, pure): two per action, a primary and an alternate, for
  the keys (Accelerate, Brake, Steer left and right, Drift, Boost, Reset, Look back, Horn) and the
  pad (the same, less steering: the left stick always steers). The defaults are the controls as
  they were, both slots (WASD and the arrows; the pad's RB and X for drift). A pad binding is a
  button (its analog value, so a trigger read as a button still eases the throttle) or an axis
  pushed one way from where it rests (a trigger some pads report as an axis, resting at -1; the
  right stick, from the middle).
- **Kept in the settings** (`controls` in `src/settings.ts`): the bindings, and the pad's deadzone
  (0 to 30%, 12% as before), rumble and steering sensitivity (the stick's curve, 1.4 as before).
  What's stored is checked as it's read: a system key, a reserved button or one bound twice is none;
  an action missing altogether is its default (a setting from before remapping is all defaults).
- **What can't be taken:** Esc, the F-keys, the dev and sound keys (` M N − +), Tab and the
  modifiers; the pad's Start, Select and guide button, and the left stick. The menus' keys and
  buttons aren't bindings at all (MENU_KEYS and the pad's d-pad, A, B, Y, the bumpers and Start in
  `input.ts`), so a binding on one of them (Boost on Y, say) drives in a race and leaves the menus
  as they are: nothing can lock you out of a menu.
- **Setting one:** A (or Enter, or a click) on a cell listens for the next press, with the prompt
  big in the sheet's foot ("Press a button for Boost"). A key or button that can't be taken says
  why and it listens on. B pressed and let go, or Esc, cancels; B held for 0.6 s is the binding, so
  B can be set from the pad too. While it listens nothing else happens with a press (no pause, no
  menu move). X (Delete or Backspace on the keyboard) clears the focused one. One another action
  has swaps: it gets what this slot had, which may be none, and the foot says so ("Boost is on Y.
  Reset to road moved to A.", or "... has no button now"), the cell it moved to ringed for a moment.
- **Reset** for each device, at the end of its section: the controller's resets its options too.
- **Hints from the bindings:** the menus' driving hints (`hint('drift')` and the others) are the
  bindings, and redraw in place when they change (`setDriveBinds`, `[data-bind]`), so the pause
  menu's tips (drawn once) follow. The keys card draws its keys from them (the accelerate key where
  W was, and so on), and its pad rows and notes too. The Controls tab is the table itself.
- **Layout:** the controller left, the keyboard right, each with its fixed keys and buttons (Menu,
  Felt wrong?, the sound keys) under it. It fits the sheet at 16:9 without scrolling; on a small or
  square window it's one column, the controller first, scrolling.

Where it went differently from the plan above:

- **Steering on the pad isn't rebindable:** it's the left stick, always (its row says so). The
  sensitivity setting is the stick's curve.
- **Pause stays on Esc and Start:** they're the menus', so they're fixed, not a bindable action.
- **Key names are the US layout's** (the key's place, `KeyboardEvent.code`): on AZERTY the key
  shown as Q types A.

## Open questions

- **Remapping conflicts:** swap the two bindings, or refuse and say which action has the key?
  **Swap** (the owner, 2026-10-16): above.
- **Touch controls:** anything to set (button size, layout, left-handed)?
- **Graphics default:** pick a preset from the device (screen size, a quick frame-time check on
  the first race), or always start on High?
- **Map chooser:** cycling only, or cycling plus a grid of map thumbnails?
- **Settings in the URL** for testing (`?quality=low`), or `localStorage` only?
