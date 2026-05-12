# 🔫 RP Mission Bot — FiveM / GTA RP

Bot Discord générateur de missions RP alimenté par Claude (Anthropic AI).  
Supporte : Gang, Motorcycle Club, Cartel, Mafia, Corporation.

---

## ✨ Fonctionnalités

| Commande | Description |
|---|---|
| `/mission [organisation]` | Génère une mission RP détaillée (lore, PNJ, lieu, étapes, risques) |
| `/reputation` | Affiche ta réputation et ton rang par organisation |
| `/historique` | Tes 10 dernières missions |

**Système de réputation :**
- Chaque `/mission` rapporte des XP selon l'organisation
- Cliquer ✅ "Mission accomplie" donne +50 XP bonus
- 7 rangs : Recrue → Associé → Soldato → Lieutenant → Capitaine → Underboss → Boss
- Les missions générées s'adaptent automatiquement à ton rang

---

## 🛠️ Installation

### Prérequis
- Node.js 18+
- Un bot Discord créé sur le [Developer Portal](https://discord.com/developers/applications)
- Une clé API Anthropic sur [console.anthropic.com](https://console.anthropic.com)

### 1. Créer le bot Discord

1. Va sur https://discord.com/developers/applications
2. Clique **New Application** → donne un nom
3. Onglet **Bot** → clique **Add Bot** → copie le **Token**
4. Onglet **General Information** → copie l'**Application ID**
5. Onglet **OAuth2 > URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Bot Permissions : `Send Messages`, `Embed Links`, `Use Slash Commands`
6. Copie l'URL générée → invite le bot sur ton serveur

### 2. Installer le projet

```bash
# Clone ou copie les fichiers dans un dossier
cd rp-mission-bot

# Installe les dépendances
npm install

# Configure les variables d'environnement
cp .env.example .env
# Édite .env avec tes vraies valeurs
```

### 3. Configurer le .env

```env
DISCORD_TOKEN=ton_token_discord
CLIENT_ID=ton_application_id
ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Lancer le bot

```bash
# Production
npm start

# Développement (redémarre auto à chaque modification)
npm run dev
```

Au premier démarrage, les slash commands sont automatiquement enregistrées (peut prendre 1 à 5 minutes avant d'apparaître sur Discord).

---

## 📁 Structure du projet

```
rp-mission-bot/
├── index.js          ← Code principal du bot
├── package.json
├── .env.example      ← Template de config
├── .env              ← Tes secrets (ne pas versionner !)
└── reputation.db     ← BDD SQLite générée automatiquement
```

---

## ⚙️ Personnalisation

### Ajouter une organisation

Dans `index.js`, dans l'objet `ORGS` :

```js
corpo: { label: 'Corporation', emoji: '💼', color: 0x2980B9, xp: 110 },
// Ajoute ici :
fbi:   { label: 'Agence Fédérale', emoji: '🕵️', color: 0x1ABC9C, xp: 200 },
```

### Modifier les rangs

```js
const RANKS = [
  { label: 'Recrue',    min: 0    },
  { label: 'Associé',   min: 300  },
  // ...
];
```

### Modifier le prompt Claude

Le prompt est dans la fonction `generateMission()`. Tu peux y préciser l'ambiance de ton serveur, des lieux spécifiques, des noms de gangs, etc.

---

## 🚀 Hébergement (optionnel)

Pour garder le bot en ligne 24/7 :

- **Railway** (gratuit) : relie ton repo GitHub, ajoute les variables d'environnement
- **VPS OVH/Hetzner** : `npm start` dans un `screen` ou via `pm2`
- **Fly.io** : déploiement Docker

---

## 📝 Exemple de mission générée

> **🔫 Le Dernier Transport**
>
> *"Écoute-moi bien. Un convoi de Los Santos Customs passe ce soir par l'autoroute 1. À bord : des pièces modifiées qui valent une fortune sur le marché noir. T'as une heure."*
>
> 📍 **Lieu :** Autoroute 1, sortie Paleto Bay  
> ⚠️ **Danger :** Élevé  
> 🎭 **Contact :** Hector Vega — Intermédiaire | *Nerveux, calculateur*
>
> **Étapes :**
> 1. Récupère le plan du convoi auprès de Hector au Porto del Sol
> 2. Intercepte le camion avant la sortie de Sandy Shores
> 3. Élimine ou sème les gardes du corps
> 4. Livre la marchandise au garage de Benny's à 23h
>
> **Risques :** Patrouilles LSPD renforcées · Tireurs d'élite sur le toit du camion  
> 💰 **Récompense :** 45 000 $ + introduction au réseau de Hector
