# Playroom

Plateforme de mini-jeux entre amis, avec salons privés, visio et manches qui tournent automatiquement.

## État actuel

- ✅ Interface du prototype importée dans [preview/index.html](./preview/index.html).
- ✅ Code du prototype complet disponible dans l'archive de la conversation ChatGPT.
- ⏳ Le serveur Python WebSocket, les tests, les assets PWA et le Dockerfile restent à importer dans ce dépôt.
- ⏳ Pas encore de version publique jouable ni de déploiement Coolify.

**Attention :** `preview/index.html` dépend du serveur multijoueur, donc ouvrir simplement ce fichier ne suffit pas à faire fonctionner des parties entre amis.

## Objectif

Déploiement web/Android (PWA) initial, architecture de synchronisation indépendante des plateformes, futures intégrations Discord Activities, Telegram Mini Apps et TikTok Mini Games selon leurs API respectives.

## Hébergement

Une fois les sources complètes importées : build Docker sur Coolify, proxy HTTPS avec WebSocket, caméras et micros autorisés dans le navigateur.
