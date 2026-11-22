// Catalogue des jeux. Pour ajouter un jeu : créer un module avec la même interface
// (create, tick, input/action, snapshot, results, bot) et l'ajouter ici.
import sumo from './sumo.js';
import potato from './potato.js';
import brawl from './brawl.js';
import clash from './clash.js';
import defense from './defense.js';
import chase from './chase.js';

// Tous les jeux disponibles dans le code.
export const ALL_GAMES = [sumo, potato, brawl, clash, defense, chase];
export const GAMES = Object.fromEntries(ALL_GAMES.map(g => [g.id, g]));

// Jeux proposés aux joueurs pour l'instant. Pour réactiver les autres, les remettre ici.
const ACTIVE = ['chase'];
export const GAME_LIST = ALL_GAMES.filter(g => ACTIVE.includes(g.id));

export function catalog() {
  return GAME_LIST.map(g => ({
    id: g.id, name: g.name, emoji: g.emoji, tagline: g.tagline, duration: g.duration,
    family: g.family, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
    controls: g.controls, howto: g.howto,
  }));
}
