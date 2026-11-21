# Playroom

Le QG de jeux de ta bande de potes : des jeux d'action en temps réel, courts et chaotiques, directement dans le navigateur du téléphone. Pas d'inscription, juste un pseudo.

## Le principe

- **Un crew permanent** : tu crées l'espace de ta bande une fois, tu partages le lien (`/c/CODE`) et tout le monde y revient à chaque soirée.
- **Le vote** : à la fin de chaque partie, l'app propose 3 jeux tirés au hasard (plus "Rejouer"). Tout le monde vote en 15 secondes. En cas d'égalité, une roue tranche.
- **La saison** : chaque partie rapporte des points (3, 2, 1 pour le podium, ou victoire d'équipe). Le classement et l'historique sont gardés.
- **Les bots** : l'hôte peut ajouter des bots pour compléter une partie ou tester seul.
- **Réactions** : 😂 🔥 😱 👏 😈 💀 en direct pendant les parties.

## Les jeux

| Jeu | Famille | Durée | Joueurs |
| --- | --- | --- | --- |
| 🚗 Sumo tamponneuses | Chaos | 2 min | 2 à 8 |
| 💣 Patate chaude | Chaos | 1 à 2 min | 2 à 8 |
| 🥊 Bagarre | Chaos | 3 min | 2 à 8 |
| 🏰 Mini Clash | Stratégie (équipes) | 3 min | 2 à 8 |
| 🛡️ Défense coop | Défense | 8 à 10 min | 1 à 8 |

Commandes : joystick flottant et boutons d'action pour les jeux d'arène, cartes à toucher pour Mini Clash et Défense. Au clavier sur ordinateur : flèches ou ZQSD, Espace, Maj.

## Mode solo

- Dans l'app : bouton **Essayer seul contre des bots** sur l'accueil, ou l'adresse `/solo`. Le moteur tourne dans le navigateur, sans serveur.
- Page autonome d'essai : `npm run build:solo` génère `dist/playroom-solo.html`, un seul fichier à ouvrir n'importe où.

## Lancer en local

```bash
npm install
npm start          # http://localhost:8080
npm test           # fait jouer chaque jeu par des bots jusqu'au bout
```

Pour tester à plusieurs sur le même Wi-Fi, ouvre `http://IP-DE-TON-PC:8080` sur les téléphones.

## Tester en ligne en 2 minutes (Render, gratuit)

[![Déployer sur Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/GaryBBQ75/Playroomm)

Le bouton crée le service à partir de `render.yaml`. Version gratuite : le serveur s'endort après 15 min sans visite (premier chargement d'environ 30 s) et les crews sont remis à zéro à chaque redémarrage. Parfait pour tester, Coolify pour la vraie version.

## Déployer sur Coolify

1. Nouvelle ressource **Docker Compose** depuis ce dépôt, fichier `compose.yaml`.
2. Attribuer le domaine au service `playroom`, port interne `8080`. Le proxy de Coolify gère les WebSockets (`/ws`).
3. Le volume `playroom-data` garde les crews et la saison (`/data/crews.json`).
4. Vérifier `https://TON-DOMAINE/healthz` → `{"status":"ok"}`.

Une seule instance : les parties en cours vivent en mémoire.

## Architecture

```
server/
  index.js         HTTP + WebSocket
  crew.js          crew, vote, roue, boucle de jeu (60 Hz), saison
  store.js         sauvegarde JSON
  games/
    arena.js       physique partagée des jeux d'arène
    sumo.js  potato.js  brawl.js  clash.js  defense.js
public/
  index.html  style.css  app.js
  lib/input.js     joystick et boutons
  lib/fx.js        particules, sons synthétisés, dessin des persos
  games/           rendu canvas de chaque jeu
```

Le serveur fait tourner le jeu et envoie 20 images par seconde. Le téléphone interpole entre deux images pour rester fluide.

### Ajouter un jeu

1. Créer `server/games/monjeu.js` qui exporte `{ id, name, emoji, tagline, duration, family, minPlayers, maxPlayers, controls, howto, create(players) }`. L'objet créé fournit `tick(dt)`, `input()` ou `action()`, `snapshot()`, `results()`, `bot()` et `over`.
2. L'ajouter dans `server/games/index.js`.
3. Créer son rendu dans `public/games/` et l'ajouter dans `RENDERERS` de `public/app.js`.

Il apparaît automatiquement dans le vote.
