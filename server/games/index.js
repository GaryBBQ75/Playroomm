// Catalogue des jeux. Pour ajouter un jeu : créer un module avec la même interface
// (create, tick, input/action, snapshot, results, bot) et l'ajouter ici.
import sumo from './sumo.js';
import potato from './potato.js';
import brawl from './brawl.js';
import clash from './clash.js';
import defense from './defense.js';

export const GAME_LIST = [sumo, potato, brawl, clash, defense];
export const GAMES = Object.fromEntries(GAME_LIST.map(g => [g.id, g]));

export function catalog() {
  return GAME_LIST.map(g => ({
    id: g.id, name: g.name, emoji: g.emoji, tagline: g.tagline, duration: g.duration,
    family: g.family, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
    controls: g.controls, howto: g.howto,
  }));
}
