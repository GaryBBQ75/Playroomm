# Playroom — jeux entre amis en visio

Prototype de plateforme de mini-jeux qui s'enchaînent automatiquement : dessin, quiz, votes entre amis. Jusqu'à 8 joueurs par salon, parties privées, lien d'invitation, classement commun et caméra/micro optionnels.

## Démarrer en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Ouvrir `http://localhost:8080` dans deux fenêtres, créer un salon puis inviter un second joueur. Sous Windows, activer l'environnement avec `.venv\\Scripts\\activate`.

## Tests

```bash
python -m unittest discover -s tests -v
```

Les tests couvrent deux joueurs, le dessin, le quiz, les votes et le score final. Un workflow GitHub Actions lance les tests et un build Docker sur chaque push.

## Coolify / Docker

1. Dans Coolify, ajouter le dépôt GitHub `GaryBBQ75/Playroomm` comme ressource **Application**.
2. Sélectionner la branche `main`, le mode de build **Dockerfile**, le chemin `./Dockerfile` et le port interne **8080**.
3. Définir un domaine HTTPS et activer les WebSockets dans le reverse proxy.
4. Variables facultatives : `PORT=8080`, `MAX_PLAYERS=8`, `ROUND_TIME=45`, `ALLOWED_ORIGIN=https://votre-domaine`.
5. Déployer puis tester avec deux téléphones sur des réseaux différents. La caméra et le micro nécessitent HTTPS. Une configuration TURN sera probablement nécessaire pour une visio fiable à travers certains réseaux mobiles/NAT.

**Important :** le code est dans ce dépôt, mais aucun site public n'est encore déployé depuis cette conversation. Le serveur conserve les salons en mémoire : pour cette V1, lancer **un seul processus/réplicat**. Persistance, Redis, modération et protections de production restent à ajouter.

## Structure

- `server.py` : moteur de jeu temps réel, API des salons, WebSocket, signalisation WebRTC
- `public/index.html` : interface responsive complète, CSS/JS intégrés
- `public/assets/icon.svg`, `public/manifest.webmanifest`, `public/sw.js` : PWA
- `tests/test_game.py` : tests automatisés à deux joueurs
- `Dockerfile` : packaging pour Coolify
- `preview/index.html` : copie autonome de l'interface, non jouable sans serveur

## Architecture cross-platform

La logique des jeux et les scores sont hébergés sur un serveur WebSocket commun. Les intégrations futures seront des clients spécifiques : Android/PWA, Discord Activities, Telegram Mini Apps et TikTok Mini Games. WhatsApp pourra partager des liens d'invitation. Le fait que ces clients puissent rejoindre les mêmes salons est un **objectif d'architecture**, pas une intégration déjà disponible. La visio au sein de TikTok dépendra des capacités et autorisations de la plateforme.

**Nom du produit : Playroom** · Dépôt actuel : `Playroomm`.
