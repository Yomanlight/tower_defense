# Tower Defense Multijoueur

Un Tower Defense co-op 2 joueurs en ligne.
Frontend statique (Netlify) + Backend Node.js/Socket.io (Railway).

---

## Architecture

```
Tower_Defense_Kel/
├── jeu.html              ← jeu solo original (inchangé)
├── backend/              → déployer sur Railway
│   ├── server.js         (Express + Socket.io + auth JWT)
│   ├── gameRoom.js       (logique de jeu serveur-autoritaire)
│   ├── gameConfig.js     (tours, ennemis, vagues)
│   ├── package.json
│   └── Procfile
└── frontend/             → déployer sur Netlify
    ├── index.html        (login + lobby + amis)
    ├── game.html         (page de jeu Canvas)
    ├── css/style.css
    └── js/
        ├── config.js     ← MODIFIER l'URL Railway ici
        ├── auth.js
        ├── lobby.js
        ├── friends.js
        └── game.js
```

---

## Déploiement Backend (Railway)

1. **Pousser le code sur GitHub** (dossier `backend/` inclus)

2. **Créer un projet Railway** sur [railway.app](https://railway.app)
   - New Project → Deploy from GitHub repo
   - Sélectionner votre repo

3. Railway détecte le `Procfile` et lance `node server.js`

4. **Copier l'URL** fournie par Railway (ex: `https://tower-defense-xxx.railway.app`)

5. **Variables d'environnement** (optionnel mais recommandé) :
   - `JWT_SECRET` = une chaîne aléatoire sécurisée
   - `PORT` = Railway le gère automatiquement

---

## Déploiement Frontend (Netlify)

1. **Modifier `frontend/js/config.js`** :
   ```js
   CONFIG.SERVER_URL = 'https://tower-defense-xxx.railway.app';
   ```

2. Aller sur [netlify.com](https://netlify.com) → **Add new site → Deploy manually**

3. **Drag & drop** le dossier `frontend/` sur la zone de déploiement

4. Le jeu est accessible sur `https://xxx.netlify.app`

---

## Test local

### Prérequis
- Node.js >= 18

### Lancer le backend
```bash
cd backend
npm install
node server.js
# → Server running on port 3000
```

### Ouvrir le frontend
Ouvrir `frontend/index.html` dans un navigateur.
`config.js` utilise `http://localhost:3000` automatiquement en local.

### Scénario de test
1. Créer deux comptes (onglets/navigateurs différents)
2. Compte 1 : Créer une partie
3. Compte 2 : Rejoindre via le code affiché
4. Compte 1 (hôte) : Cliquer "Lancer la partie"
5. Placer des tours (Joueur 1 = lignes 0-9, Joueur 2 = lignes 10-19)
6. Cliquer "Lancer vague" pour démarrer la vague
7. Tester le système d'amis : ajouter via le pseudo exact, accepter, inviter

---

## Règles du jeu

### Carte
- Grille 20×20 (800×800px)
- Chemin en S : `(1,0)→(1,3)→(18,3)→(18,7)→(1,7)→(1,11)→(18,11)→(18,15)→(1,15)→sortie`
- Joueur 1 : zone lignes 0-9 (bleu)
- Joueur 2 : zone lignes 10-19 (rouge)
- Solo : peut placer partout

### Tours
| Tour   | Coût | Dégâts | Vitesse | Portée | Spécial         |
|--------|------|--------|---------|--------|-----------------|
| Archer | 75   | 1      | 0.8s    | 120px  | —               |
| Canon  | 150  | 5      | 2.5s    | 110px  | Splash AOE      |
| Mage   | 200  | 3      | 1.5s    | 130px  | Zone totale     |
| Sniper | 250  | 8      | 3.0s    | 200px  | —               |
| Givre  | 125  | 1      | 1.2s    | 100px  | Ralentit -50%   |

Vendre une tour : **clic droit** → remboursement 60%

### Ennemis
| Ennemi | HP  | Vitesse | Armure | Récompense |
|--------|-----|---------|--------|------------|
| Normal | 3   | 80px/s  | 0      | 10💰       |
| Rapide | 2   | 160px/s | 0      | 8💰        |
| Tank   | 15  | 55px/s  | 0      | 20💰       |
| Blindé | 8   | 70px/s  | 2      | 15💰       |
| Boss   | 100 | 40px/s  | 3      | 100💰      |

### Vagues
- 20 vagues progressives
- Vague 10 : 1 Boss
- Vague 15 : 2 Boss
- Vague 20 : 3 Boss (finale)
- Vies partagées (20 au départ), or individuel

---

## Notes techniques

- Authentification JWT (24h), données utilisateurs en `backend/data/users.json`
- Logique de jeu serveur-autoritaire (50ms tick rate)
- Socket.io pour la synchronisation temps réel
- Canvas 800×800px responsive (scale CSS)
- Particules à la mort des ennemis
