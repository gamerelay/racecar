// License plates (PLAN phase 3): your name is a plate. Up to seven characters, A–Z, 0–9 and
// single spaces, uppercase, with a small blocklist. It's on your car (front and rear), in lobbies
// and in the results. Each AI class has a plate with some character, so a rival keeps theirs
// from race to race. Pure: no DOM (the local store is passed in).

import type { KeyValue } from './backend';

export const PLATE_MAX = 7;

/** A class's AI plate: the rival that drives it, named for the car. */
export const AI_PLATES: Readonly<Record<string, string>> = {
  coupe: 'VANTA 1',
  muscle: 'BRUTE',
  hatch: 'ZIPZAP',
  van: 'HAULR 2',
  sedan: 'CRUZN',
  rally: 'MUD LRK',
  bus: 'RT 88',
  police: 'PD 911',
};

/**
 * Words a plate can't spell, checked with spaces removed and look-alike digits read as letters
 * (0 O, 1 I, 3 E, 4 A, 5 S, 7 T, 8 B). Short ones, and ones inside ordinary words, only count
 * as the whole plate, so PASS, GRAPE and SPICY stay fine. Small on purpose: it catches the
 * obvious, not everything.
 */
const BLOCK_ANYWHERE = ['FUCK', 'SHIT', 'CUNT', 'COCK', 'DICK', 'PUSSY', 'NIGG', 'FAGG', 'SLUT', 'WHORE', 'NAZI', 'HITLER', 'PENIS', 'VAGINA', 'TWAT', 'BITCH', 'PORN', 'DILDO', 'SPERM', 'KIKE', 'CHINK', 'RETARD', 'TRANNY', 'BLOWJOB', 'HANDJOB', 'JIZZ', 'NUTSAC'];
// Slurs and crude words only: words people use for themselves (GAY, JEW) are never on it.
const BLOCK_WHOLE = ['ASS', 'FAG', 'KKK', 'CUM', 'FUK', 'FUC', 'SEX', 'TIT', 'TITS', 'HOE', 'NIG', 'FCK', 'STFU', 'ASSES', 'ANAL', 'ANUS', 'BOOB', 'BOOBS', 'RAPE', 'RAPES', 'SPIC', 'SPICS', 'WANK', 'WANKER'];
const LOOKALIKE: Record<string, string> = { '0': 'O', '1': 'I', '3': 'E', '4': 'A', '5': 'S', '7': 'T', '8': 'B' };

/** What a typed name becomes as a plate: uppercase, A–Z 0–9 and single spaces, trimmed, at most seven. */
export function cleanPlate(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/ +/g, ' ')
    .trimStart()
    .slice(0, PLATE_MAX)
    .trimEnd();
}

/** Why `plate` can't be used, or null if it can. Expects a cleaned plate. */
export function plateProblem(plate: string): string | null {
  if (!plate) return 'Type a plate: letters and numbers, up to seven.';
  if (plate !== cleanPlate(plate)) return 'Letters, numbers and single spaces only, up to seven.';
  const bare = plate.replace(/ /g, '');
  const read = bare.replace(/[0-9]/g, (d) => LOOKALIKE[d] ?? d);
  for (const s of [bare, read]) {
    if (BLOCK_WHOLE.includes(s) || BLOCK_ANYWHERE.some((w) => s.includes(w))) return "That plate won't pass inspection. Try another.";
  }
  return null;
}

/** An AI's plate for its class (a stock one for a class without its own). */
export function aiPlate(cls: string): string {
  return AI_PLATES[cls] ?? `RC ${cls.slice(0, 3).toUpperCase()}`;
}

const KEY = 'racecar.plate';

/** A fresh plate for someone who hasn't set one: RC and four digits, like a rental. */
export function randomPlate(rand: () => number = Math.random): string {
  return `RC ${String(Math.floor(rand() * 9000) + 1000)}`;
}

/**
 * Your plate: the one you saved, or a fresh one (saved, so it stays yours). A stored plate that no
 * longer passes (the rules got stricter) is replaced too. Storage that throws gives a fresh plate
 * each load.
 */
export function loadPlate(store: KeyValue | null, rand?: () => number): string {
  try {
    const saved = store?.getItem(KEY);
    if (saved && !plateProblem(saved)) return saved;
  } catch {
    // Unreadable: a fresh one below.
  }
  const plate = randomPlate(rand);
  savePlate(store, plate);
  return plate;
}

/** Saves `plate` if it passes; returns why not otherwise. */
export function savePlate(store: KeyValue | null, plate: string): string | null {
  const problem = plateProblem(plate);
  if (problem) return problem;
  try {
    store?.setItem(KEY, plate);
  } catch {
    // Memory only: it lasts until the page reloads.
  }
  return null;
}
