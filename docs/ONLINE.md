# Online: lobbies, hosts, parties and players

How racecar's online play is put together (milestone 3), and how it lines up with Xbox Live's
multiplayer, which was the model for most of it. The decisions and what changed while building
are in [SPEC.md](./SPEC.md) "Changed while building"; this is the map.

## The pieces

| File | What it does |
|---|---|
| `src/lobby/lobby.ts` | The lobby itself and its rules: seats, options, who can join, `apply(lobby, actor, action)`. Pure. |
| `src/lobby/wire.ts` | Checks everything that comes from another player's page: actions, listings, the lobby in a room's state, pings. Pure. |
| `src/lobby/relay.ts` | `RelayBackend`: a lobby as a GameRelay room. Joining, leaving, applying actions on the SDK's host, the room list. |
| `src/lobby/party.ts` | `LobbyParty`: each lobby is also a party, for P2P. Joining it, and never staying in it after the lobby. |
| `src/lobby/presence.ts` | `Presence`: each player's ping, who's away, and how you reach them (P2P, Relay, Server). |
| `src/lobby/backend.ts` | `LobbyBackend`, the local lobby (`LocalBackend`, in this browser), and `Lobbies`, which puts both behind one. |
| `src/ui/menu.ts` | The screens: the title's list, Create lobby, the lobby, the plate editor. |
| `src/net/cars.ts` | In the race: each player's car as an entity, everyone else's as a remote car. |
| `src/net/join.ts` | The race page's join: it stays in the lobby's room, sends your car once in, and starts the race from here if that takes over 8 s. |
| `src/lobby/warn.ts` | `warned`: an online failure the lobby carries on through, said in the console. |
| `src/net/rivals.ts` | In the race: the AIs, driven by the SDK's host and sent to everyone as `rival` entities. |
| `src/net/stepper.ts` | Who steps the race: frames until it's in its room, then the relay's tick (it goes on in a hidden tab). |
| `src/net/traffic.ts` | Traffic hits: whoever wrecks a traffic car claims it (`room.claim`), and everyone wrecks it from the winner's time. |
| `src/net/contact.ts` | Bumps between screens' cars (once each, a contact both saw within ±150 ms not twice), and takedown credit from the victim's screen. |

## A lobby's life

1. **Create.** The host leaves any room and party they're in, makes a room (public only if the
   lobby is Public), then a party, and writes the lobby to the room's state.
2. **Join.** Opening a lobby (the list, or an invite link) joins its room. Your page then asks the
   host for a seat (`join`) if `canJoin` says you may: between races, a seat open, not Private.
   Otherwise you watch, and sit down when you can. You also join its party.
3. **In the lobby.** Every change is an action sent to the SDK's host, which applies it with
   `apply` and writes the result. Everyone sees it through the room's `state` event.
4. **Start.** The lobby's host starts it: every seated player is marked `racing`, and the lights
   go green at `startAt` on the server's clock, six seconds on. Each page loads the race, joins the
   room again (the SDK resumes the same player) and sends its car (net/cars.ts). The SDK's host
   drives the AIs and sends them too (net/rivals.ts).
5. **Back.** Each player's lobby screen says they're back (`racing: false`). The host reopens the
   lobby (`end`), which un-readies everyone else for the next one.
6. **Leave.** Leave, a kick or the room closing takes you out of the room and its party. The last
   one out unlists the room; the server closes it two minutes later.

Joining, creating and leaving run one at a time, in order (the SDK has one room at a time, and its
leave doesn't name a room). A join the menu gives up on (too slow, or Esc) leaves when it lands;
the race page never gives up on its lobby's room.

## In the race

Each screen moves and wrecks only its own cars (yours, and the AIs on the SDK's host). What they
share:

- **The race's clock.** Green is at `startAt` on the server's clock, and each screen's race time
  follows the server's from then (`syncClock`, net/cars.ts): traffic, weather, hazards and
  smashables are functions of it, so they're the same everywhere.
- **Traffic hits** (net/traffic.ts). A hit happens only where the hitting car is driven, so that
  screen claims the traffic car, and the winner says when: every screen wrecks it from then.
- **Bumps** (net/contact.ts). Your car touching another screen's: you push yours, and tell its
  owner, who pushes theirs unless their sim saw the same contact within 150 ms.
- **Wrecks and credit.** The victim's screen decides a wreck (its car, its call) and tells the
  attacker's owner, whose screen gives its car the takedown.
- **Messages are checked:** a bump only from the owner of the car that made it, a takedown only
  from the victim's owner, a traffic hit only for a car there is at about now.

## Two hosts

- **The SDK's host** holds the room's write role. It moves by itself (a reload, a dropped
  connection: GameRelay gives it to the longest-present player still connected). Whoever holds it
  applies everyone's actions, tidies seats whose players have left, and keeps the listing up to
  date. It does that whenever the role arrives (`host_changed`), not only when someone leaves.
- **The lobby's host** (`lobby.host`) is the player who sets the seats and options and starts. It
  only changes when they leave (the next seated player gets it), or when everyone has left (the
  next one to sit down gets it).

`apply` checks the lobby's host, so it never matters who holds the SDK's role.

In the race, the SDK's host also drives the AIs (`rival` host entities), so every screen has the
same bots. The AI keeps no memory but its car's pose, so when the role moves the next host drives
them on from where they are. Until the host's rivals show up, each screen drives them itself.

## Players

- **Who you are:** GameRelay's player id, the same through a page load in one tab (so a reload,
  or the race page, keeps your seat). Two tabs are two players.
- **Your name** is your plate (`localStorage`), and you can change it from your seat.
- **Your car:** random when you first sit down; the turntable changes it.
- **Status:** Ready or Not ready (the host is always ready), Racing while you're still in the
  last race, and Away while your connection's been gone four seconds or more (the server holds
  your seat through its grace).
- **Ping:** each lobby page measures its own every three seconds and tells the room.

## Who can join

| Setting | Listed | Joinable | Value |
|---|---|---|---|
| Public | yes | anyone | `public` |
| Invite only | no | anyone with the link | `invite` (an older build's `private`) |
| Private | no | nobody new; those in keep their seats | `locked` |

Your own lobby (Private on Create lobby) is local: you and bots, in this browser, never listed.
Only Public rooms are listed, by two checks: the room is unlisted (`setAccess`, tried again if it
fails), and the listing itself says who can join, so the list drops one that isn't Public.

## P2P

GameRelay only connects party members directly over the internet, so each lobby is a party too
(see party.ts for why it must never outlive the lobby). It shows players each other's public IP;
that was chosen on purpose, and is to be revisited (an opt-in) before the repo goes public.

## Next to Xbox Live

Xbox Live's multiplayer (the Multiplayer Session Directory, and the Multiplayer Manager on top of
it) solved most of this first. What we took, and what's left:

| Xbox Live | racecar | |
|---|---|---|
| **Lobby and game sessions are separate**: friends stay together in the lobby session while each match is a game session. | One room for both: the lobby lives through many races, and the race page joins it again. | Same effect, simpler. |
| **Joinability**: joinable by anyone, by friends, invite only, closed, or closed while a game is in progress. | Public, Invite only, Private; joining mid-race means watching, and sitting down after it. | Taken. |
| **Member states and timeouts**: reserved, inactive, ready, active, each removed after its own timeout. | Ready / Not ready, Racing, Away; a seat is freed when the server's grace for a dropped player runs out. | Taken. |
| **Session empty timeout**: an empty session goes away. | The last one out unlists the room; the list skips rooms nobody's in. | Taken. |
| **Host migration**, to the best host candidate. | The SDK's role moves by itself and re-tidies (`host_changed`); the lobby's host passes to the next seated player. | Taken, without picking by ping. |
| **NAT type** (Open, Moderate, Strict) on the network screen. | The connection button: P2P, Relay or Server. | Taken. |
| **QoS**: latency measured per player, shown as bars. | A ping per player, coloured at 50, 75 and 100 ms. | Taken. |
| **Party and game are separate**, and following your party into a game is a choice. | The party is only the key to P2P, and leaves with the lobby. | A workaround: see the asks below. |
| **Seat reservations for invites**: an invitee's seat is held for them for a while. | Not yet: an invite link can find the lobby full. | Next. |
| **Rich presence** ("In ACE's lobby, Downtown"). | Not yet. | Later. |
| **Peer connections never show players' addresses** (secure device associations). | P2P shows public IPs. | An opt-in before going public. |
| **Host-owned world objects** carried over in host migration. | The AIs are host entities: the next host drives them on. | Taken. |
| **The host reports the results** (arbitration). | Each screen has its own results. | On HANDOFF's list. |

## Asks for GameRelay

- **Direct connections between a room's players**, with no party. A party exists to move friends
  between rooms; using it only to unlock P2P means racecar has to keep it from ever doing that.
- **Whether a direct channel is across one network or over the internet**, and the relay's region
  for a relayed one, so the connection button can say LAN, P2P or the region.
- **Seat reservations** for invite links (a seat held for a player for N seconds).
