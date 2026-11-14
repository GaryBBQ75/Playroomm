# GameRoom / Playroom

Prototype multi-jeux et visio entre amis, compatible web et mobile (PWA), conçu pour permettre de futurs clients Discord Activities, Telegram Mini Apps et TikTok Mini Games.

## État

Le prototype local comprend des salons privés, un serveur WebSocket, trois mini-jeux (dessin, quiz, votes), un classement et une visio WebRTC pour petits groupes. Les clients des réseaux sociaux ne sont pas encore implémentés.

Le code de la V1 et les instructions Docker/Coolify sont en cours d'importation dans ce dépôt.

## Déploiement

Le serveur est basé sur Python/aiohttp. Le Dockerfile expose le port 8080 et nécessite HTTPS pour la caméra/le microphone, ainsi que la prise en charge des WebSockets par le proxy.

Le nom du dépôt GameRoom est conservé ; le nom du produit Playroom est provisoire.
