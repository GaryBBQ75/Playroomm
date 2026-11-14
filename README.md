# Playroom — jeux entre amis en direct

Plateforme mobile-first de jeux multijoueurs (dessin plein écran, quiz, blind test musical, votes et Mix Party). Un salon privé partagé par lien, un classement commun, du WebSocket temps réel, et une visio WebRTC optionnelle. **L'inscription n'est jamais obligatoire pour jouer** : les amis peuvent rejoindre avec un pseudo.

## Déployer sur OVH avec Coolify et PostgreSQL

Le dépôt inclut `compose.yaml` pour une instance Playroom et PostgreSQL 17 avec un volume persistant, sans exposition publique du port PostgreSQL.

1. Sur **Coolify**, créer une ressource **Docker Compose** depuis `GaryBBQ75/Playroomm`, branche `main`, fichier `compose.yaml`. Le serveur de jeu doit rester à **une seule instance** pour cette V1, car les salons actifs sont en mémoire.
2. Dans les variables d'environnement de Coolify (ne pas enregistrer les secrets dans GitHub), définir :
   - `POSTGRES_PASSWORD` : mot de passe aléatoire fort (48 caractères hexadécimaux pour éviter les caractères spéciaux dans l'URL PostgreSQL).
   - `APP_ORIGIN=https://VOTRE-DOMAINE` (sans slash final).
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` : voir la section OAuth ci-dessous ; ces trois paramètres peuvent être ajoutés après le premier déploiement.
3. Attribuer le domaine HTTPS **au service playroom** sur son port interne `8080`. Activer le passage des connexions **WebSocket** sur le proxy ; ne pas exposer PostgreSQL.
4. Déployer, puis ouvrir `https://VOTRE-DOMAINE/readyz` : réponse attendue `{"status":"ok"}`. Tester création de salon et invitations depuis deux téléphones sur deux réseaux distincts.
5. Sauvegarder périodiquement la base PostgreSQL. Les scores de fin de partie sont persistants ; les salons en cours ne le sont pas encore.

Le formulaire `/api/me` fonctionne même si Google n'est pas configuré : il retourne `user: null` et `loginEnabled: false`. Les invités peuvent continuer à jouer.

### Activer la connexion Google

1. Dans la [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configurer l'écran de consentement OAuth ; ajouter des testeurs si l'application est encore en mode test.
2. Créer un **Client OAuth 2.0 de type Application Web**.
3. Dans ses **URI de redirection autorisées**, ajouter exactement `https://VOTRE-DOMAINE/auth/google/callback`.
4. Dans les variables Coolify, renseigner :
   - `GOOGLE_CLIENT_ID` : Client ID du projet Google.
   - `GOOGLE_CLIENT_SECRET` : secret du client (ne jamais le committer).
   - `GOOGLE_REDIRECT_URI=https://VOTRE-DOMAINE/auth/google/callback`.
   - `APP_ORIGIN=https://VOTRE-DOMAINE`.
5. Redéployer. L'interface affiche « Se connecter » quand OAuth est opérationnel. Seuls `openid email profile` sont demandés. Le compte utilise une session HttpOnly/Secure/SameSite=Lax dont l'empreinte est enregistrée en base.

Le compte Google est facultatif : il ajoute un profil persistant et permet de retrouver ses scores de parties terminées via `GET /api/me/history`. La déconnexion passe par `POST /auth/logout`.

## Déploiement via GitHub Actions (après configuration initiale Coolify)

Un workflow manuel [Deploy Playroom to Coolify](https://github.com/GaryBBQ75/Playroomm/actions/workflows/deploy-coolify.yml) permet de lancer et de vérifier un déploiement, **une fois la ressource Docker Compose créée sur Coolify**.

Dans **GitHub → Settings → Environments**, créer un environnement `production` et lui ajouter les secrets :
- `COOLIFY_URL` : URL HTTPS de l'installation Coolify, sans `/api/v1`
- `COOLIFY_API_TOKEN` : token Coolify avec permission limitée `deploy`
- `COOLIFY_RESOURCE_UUID` : UUID de la ressource Playroom (Docker Compose) dans Coolify

Ajouter aussi la variable d'environnement GitHub `PLAYROOM_PUBLIC_URL` avec l'URL HTTPS publique et définitive du jeu. Elle servira à valider `/readyz` après déploiement.

Le workflow se lance depuis **Actions → Deploy Playroom to Coolify → Run workflow**. Les identifiants PostgreSQL et Google OAuth sont configurés **dans les variables d'environnement Coolify de la ressource**, pas dans GitHub. Les secrets ne doivent jamais être envoyés dans un ticket ou un chat.

## Démarrer en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Sans `DATABASE_URL`, le mode local utilise des invités sans historique. Sur Coolify, `DATABASE_URL` est fourni automatiquement depuis PostgreSQL dans `compose.yaml` et la base est obligatoire. Pour exécuter les tests d'intégration, définir `DATABASE_URL` vers une base dédiée.

```bash
python -m unittest discover -s tests -v
```

La CI GitHub Actions lance PostgreSQL 17, exécute les tests du jeu et de l'authentification, puis construit l'image Docker.

## Organisation

- `server.py` : règles des jeux, salons et WebSockets.
- `auth.py` : OAuth Google (PKCE), cookies de session et historique.
- `schema.sql` : schéma PostgreSQL.
- `compose.yaml` : services Playroom et PostgreSQL pour Coolify.
- `public/index.html` : interface mobile-first et web.
- `public/manifest.webmanifest` : installation PWA.
- `tests/` : multijoueur et intégration SQL.

## Jeux et expérience mobile

- **Dessin** : objets faciles à dessiner, plateau tactile occupant la majorité de l'écran, clavier AZERTY facultatif qui évite l'ouverture du clavier Android, indices progressifs sur le nombre de lettres, initiale et touches grisées en fin de manche.
- **Quiz** : réponses tactiles larges et rythme accéléré.
- **Qui de nous ?** : votes entre amis.
- **Blind test** : mélodies de compositions du domaine public, interprétées par synthèse Web Audio directement dans le navigateur (aucun enregistrement commercial ni API musicale tierce). La lecture commence sur un geste explicite de l'utilisateur, notamment sur Android et iOS.
- **Mix Party** : alternance automatique des quatre jeux avec transitions animées, résultats courts, récompenses de points et classement partagé.

L'identité globale reste Playroom, mais chaque mini-jeu possède son propre thème dans `public/assets/games.css` et son interface dynamique. Le clavier intégré est repliable pour laisser l'espace nécessaire au dessin ; sur ordinateur, le clavier physique fonctionne toujours.

Pour un futur blind test de chansons populaires, **obtenir des droits d'utilisation sur les enregistrements et leurs compositions** avant de diffuser des extraits, même courts.

## Limites de la première version

- Salons, connexions et scores en cours sont en mémoire : **un seul réplicat** tant qu'il n'y a pas Redis ou une autre synchronisation partagée. Les scores sont sauvegardés quand une partie se termine.
- WebRTC P2P fonctionne au mieux en petits groupes ; un serveur TURN est nécessaire pour fiabiliser la visio sur les réseaux mobiles.
- Catalogue de jeux communautaires, import de jeux générés par IA, dons et jeux différés ne sont pas encore développés.
- **Le dépôt n'est pas à lui seul une URL publique jouable** : un déploiement HTTPS sur Coolify doit être effectué et vérifié.

Code et tests : [GitHub Playroomm](https://github.com/GaryBBQ75/Playroomm).
