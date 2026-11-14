# Playroom — principe non négociable : mobile-first

Playroom est avant tout une plateforme de jeux entre amis sur **smartphone**. Le desktop est pris en charge, mais jamais au détriment de l'usage mobile.

## Règles UX pour Playroom et les jeux importés

- **Jeu prioritaire à l'écran** : un jeu doit occuper la quasi-totalité du viewport mobile. Les avatars, scores, options et visio restent secondaires (bande compacte, tiroir ou superposition).
- **Plein écran** : fournir un contrôle utilisateur pour demander Fullscreen API lorsque disponible. Une PWA installée Android peut se lancer en fullscreen, sans bloquer l'interface si l'API est refusée; afficher une alternative.
- **Portrait d'abord** : adapter les jeux en 360–430 px de largeur, puis supporter paysage, tablette et desktop. Ne pas imposer le paysage sauf nécessité réelle et clairement annoncée.
- **Navigation tactile** : cibles interactives d'au moins 44 × 44 CSS px (48 recommandés), retours visuels immédiats, pas d'action uniquement au hover, gestes multitouch lorsque pertinents.
- **Gestes système Android/iOS** : ne pas placer d'interaction de précision sur les bords; utiliser des marges avec `env(safe-area-inset-*)` et conserver de l'espace pour les gestes système.
- **Taille et scrolling** : utiliser `100dvh` et `viewport-fit=cover`; éviter le scrolling de toute la page pendant le jeu. Laisser défiler le panneau de jeu si contenu long ou clavier ouvert.
- **Clavier virtuel** : garder l'entrée textuelle et le bouton de réponse visibles au focus; supporter Enter/Submit lorsqu'approprié.
- **Dessin** : canvas à la taille de l'espace disponible, `touch-action:none` seulement sur la zone de dessin, Pointer Events, capture du pointeur, pinceaux activables au doigt.
- **Visio et audio** : autorisations explicites et facultatives, contrôle micro/caméra accessible, ne jamais sacrifier le jeu à un grand panneau vidéo.
- **Scores** : score de soirée commun géré par Playroom; classement accessible sans quitter le jeu.
- **Performance** : images optimisées, animations légères, éviter les téléchargements lourds, tester réseaux mobiles et appareils Android modestes.

## Critères d'acceptation

1. Deux téléphones peuvent ouvrir le même salon en HTTPS, lancer chaque jeu et changer de jeu en conservant leurs scores.
2. La page du jeu reste dans le viewport sans scroll global; le contenu interne reste atteignable.
3. Test manuel sur formats 360 × 740, 390 × 844, 430 × 932 et paysage 844 × 390.
4. Le bouton plein écran fonctionne sur navigateur compatible, et son échec ne bloque jamais la partie.
5. Une option de retour au salon est accessible sans risque de toucher accidentellement le geste système.
6. Un jeu fourni par la communauté doit respecter ces critères **avant** son apparition au catalogue officiel.

Ce document est un cahier de contraintes pour la V1 et les futures intégrations communautaires.