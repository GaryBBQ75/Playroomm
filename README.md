# Playroom

Plateforme multijoueur de mini-jeux entre amis, avec visio et manches qui tournent automatiquement.

**Projet : Playroom** · **Dépôt GitHub actuel : GameRoom**

## Prototype V1

- Salons privés et invitation par lien
- Trois mini-jeux : dessin, quiz, « Qui de nous ? »
- Parties et scores synchronisés
- Visio WebRTC pour petits groupes (client web)
- Application web mobile/PWA, prévue pour Docker et Coolify

## Architecture multiplateforme

Un serveur commun pour le gameplay et les scores, avec des clients spécifiques à chaque plateforme : web/PWA d'abord, puis Android, Discord Activities, Telegram Mini Apps et TikTok Mini Games selon leurs API et validations. WhatsApp permet de partager des invitations vers la version web.

## État

Le dépôt est initialisé. Le code du prototype V1 reste à importer ; ce README n'est pas un site public et aucun déploiement n'a encore été effectué.

Pour renommer le **dépôt GitHub** lui-même de `GameRoom` en `playroom`, utiliser **Settings > General > Repository name > Rename**. Les dépôts GitHub sont distincts du nom commercial de l'application.
