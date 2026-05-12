require('dotenv').config();

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ChannelType,
  PermissionFlagsBits, Events
} = require('discord.js');

const fs   = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID     = process.env.CLIENT_ID;
const VICTOR_NUMBER = process.env.VICTOR_NUMBER || '389-5192';

// Salons staff pour /blackmarket (optionnel, défini dans .env)
const BLACKMARKET_STAFF_CHANNEL = process.env.BLACKMARKET_STAFF_CHANNEL || null;
const GM_LOG_CHANNEL = '1493251717616238823';

// IDs rôles Gamemaster
const GM_ROLES = ['1493251114118680686', '1495437317945430239'];

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌  Variables manquantes : DISCORD_TOKEN, CLIENT_ID');
  process.exit(1);
}

// ── DB JSON ────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data.json');

function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const blank = { xp: {}, history: [], crews: {}, missions_custom: [], cooldowns: {}, blackmarket: [] };
      fs.writeFileSync(DB_PATH, JSON.stringify(blank, null, 2));
      return blank;
    }
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!raw.xp)              raw.xp              = {};
    if (!raw.history)         raw.history         = [];
    if (!raw.crews)           raw.crews           = {};
    if (!raw.missions_custom) raw.missions_custom = [];
    if (!raw.cooldowns)       raw.cooldowns       = {};
    if (!raw.blackmarket)     raw.blackmarket     = [];
    return raw;
  } catch {
    const blank = { xp: {}, history: [], crews: {}, missions_custom: [], cooldowns: {}, blackmarket: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(blank, null, 2));
    return blank;
  }
}

function saveDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

// XP — stocké par roleId (un compteur par groupe individuel)
function addXp(guildId, roleId, amount) {
  const db  = loadDb();
  const key = `${guildId}:${roleId}`;
  if (!db.xp[key]) db.xp[key] = 0;
  db.xp[key] += amount;
  saveDb(db);
  return db.xp[key];
}
function getXp(guildId, roleId) {
  const db = loadDb();
  return db.xp[`${guildId}:${roleId}`] || 0;
}

// Historique
function addHistory(guildId, roleId, title, diff) {
  const db = loadDb();
  db.history.push({ guildId, roleId, title, diff, date: new Date().toISOString() });
  if (db.history.length > 2000) db.history.splice(0, db.history.length - 2000);
  saveDb(db);
}

// Crews (canaux privés)
function setCrew(guildId, roleId, channelId) {
  const db = loadDb();
  if (!db.crews[guildId]) db.crews[guildId] = {};
  db.crews[guildId][roleId] = channelId;
  saveDb(db);
}
function getCrew(guildId, roleId) {
  const db = loadDb();
  return db.crews?.[guildId]?.[roleId] || null;
}
function getAllCrews(guildId) {
  const db = loadDb();
  return db.crews?.[guildId] || {};
}

// Cooldowns
const COOLDOWNS_MS = { easy: 60 * 60 * 1000, medium: 12 * 60 * 60 * 1000, hard: 48 * 60 * 60 * 1000 };

function getCooldownKey(userId, orgKey, diff) { return `${userId}:${orgKey}:${diff}`; }

function checkCooldown(userId, orgKey, diff) {
  const db  = loadDb();
  const key = getCooldownKey(userId, orgKey, diff);
  const ts  = db.cooldowns[key];
  if (!ts) return null;
  const remaining = ts + COOLDOWNS_MS[diff] - Date.now();
  return remaining > 0 ? remaining : null;
}

function setCooldown(userId, orgKey, diff) {
  const db  = loadDb();
  const key = getCooldownKey(userId, orgKey, diff);
  db.cooldowns[key] = Date.now();
  saveDb(db);
}

function formatMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h${m > 0 ? m + 'min' : ''}`;
  return `${m}min`;
}

// Missions custom (ajoutées via /addmission)
function addCustomMission(mission) {
  const db = loadDb();
  db.missions_custom.push({ ...mission, id: Date.now() });
  saveDb(db);
}
function getCustomMissions() {
  const db = loadDb();
  return db.missions_custom || [];
}

// Blackmarket log
function logBlackmarket(entry) {
  const db = loadDb();
  db.blackmarket.push({ ...entry, date: new Date().toISOString() });
  if (db.blackmarket.length > 500) db.blackmarket.splice(0, db.blackmarket.length - 500);
  saveDb(db);
}

// ── Organisations & rôles ─────────────────────────────────────────────────
const ORGS = {
  gang: {
    label: 'Gang', emoji: '🔫', color: 0xC0392B,
    roles: [
      '1493267037588553760', // Families
      '1498789948256555110', // Vagos
      '1493267005028176093', // Ballas
      '1493266934735704104', // Red Kings
      '1493266984610304040', // Southside street
      '1500847902384197764', // La zona
      '1493737032785334292', // Marabunta
      '1502806343625736203', // Pirates Somaliens
      '1502572188556071013', // Les Gitans
      '1503421619329044581', // La Honda
      '1493266934735704104', // Red Kings
    ],
    xpReward:   { easy: 100000, medium: 250000, hard: 500000 },
    cashReward: {
      easy:   '💵 100 000 $ d\'argent sale',
      medium: '💵 250 000 $ d\'argent sale + 🔋 5 chargeurs de pistolet + 5 Plans aléatoire',
      hard:   '💵 500 000 $ d\'argent sale + 🔫 1 Cal.50 + 🔋 10 chargeurs de pistolet',
    },
  },
  orga: {
    label: 'Organisation', emoji: '🪖', color: 0x27AE60,
    roles: [
      '1499133365729628241', // Milice Nyoka
      '1499850558624759948', // OTB
      '1493277866169864235', // Nueva
      '1502813535120658573', // Miller
    ],
    xpReward:   { easy: 100000, medium: 250000, hard: 500000 },
    cashReward: {
      easy:   '💵 100 000 $ d\'argent sale',
      medium: '💵 250 000 $ d\'argent sale + 🔋 5 chargeurs de pistolet + 5 Plans aléatoire',
      hard:   '💵 500 000 $ d\'argent sale + 🔫 2 Cal.50 + 🔋 10 chargeurs de pistolet',
    },
  },
  cartel: {
    label: 'Famille / Cartel / Mafia', emoji: '💼', color: 0x8E44AD,
    roles: [
      '1493267296637161552', // Merryweather
      '1493267350416523445', // Ombra
      '1502006738021515414', // Mafia Colombienne
      '1498789931085074554', // Cayo Perico
    ],
    xpReward:   { easy: 100000, medium: 250000, hard: 500000 },
    cashReward: {
      easy:   '💵 100 000 $ d\'argent sale',
      medium: '💵 250 000 $ d\'argent sale + 🔋 10 chargeurs de pistolet + 5 Plans aléatoire',
      hard:   '💵 500 000 $ d\'argent sale + 🔫 5 Cal.50 + 🔋 25 chargeurs de pistolet',
    },
  },
};

// ── Niveaux XP ─────────────────────────────────────────────────────────────
const LEVELS = [
  { label: 'Recrue',     min: 0       },
  { label: 'Associé',    min: 120000   },
  { label: 'Soldato',    min: 250000  },
  { label: 'Lieutenant', min: 550000  },
  { label: 'Capitaine',  min: 600000  },
  { label: 'Underboss',  min: 890000 },
  { label: 'Boss',       min: 1000000 },
];

// XP minimum pour débloquer les missions secrètes
const SECRET_MISSION_MIN_XP = 250000; // Soldato+

function getLevel(xp) {
  let lv = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.min) lv = l; }
  return lv;
}
function getNextLevel(xp) { return LEVELS.find(l => l.min > xp) || null; }

// ── Missions prédéfinies ───────────────────────────────────────────────────
const MISSIONS = [

  // GANG — FACILE
  { title: 'Livraison Eastside', diff: 'easy', org: ['gang'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— C'est moi.`,
    `— T'as une livraison pour moi. Appelles mon numero et récupère moi un sac. Forum Drive, côté épicerie.`,
    `— Tu le poses dans la benne derrière le bâtiment B. Personne te voit. T'en parles à personne.`,
    `— Confirme quand c'est fait.`,
  ]},
  { title: 'Coursier Strawberry', diff: 'easy', org: ['gang'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `Besoin de toi.`,
    `Récupère l'enveloppe chez Jermaine, Strawberry Ave, il t'attendras devant sa porte sur une petite chaise.`,
    `Tu la déposes au parking Davis, voiture rouge, vitre ouverte.`,
    `Touche à rien dedans.`,
  ]},
  { title: 'Dépôt discret', diff: 'easy', org: ['gang'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `Y'a un casier à la gare de LS. Devant ce tiens Jaden, Un ami à moi à côté du Numéro 14.`,
    `T'y vas, tu récupères, tu ramènes.`,
    `Prends pas ton propre véhicule.`,
  ]},
  { title: 'Récupération véhicule', diff: 'easy', org: ['gang'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `Véhicule abandonné, route de Chamberlain. Plaque : BX-7741.`,
    `Tu le ramènes au garage de Cypress sans rayure.`,
    `Clés sous le pare-soleil.`,
  ]},

  // ORGA — FACILE
  { title: 'Transit matériel', diff: 'easy', org: ['orga'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Pas de nom. Pas de question.`,
    `— Une caisse, hangar 3, aéroport de Sandy.`,
    `— Tu la charges, tu roules jusqu'au point GPS que j'envoie.`,
    `— Sirènes tu t'arrêtes pas.`,
  ]},
  { title: 'Surveillance Rockford', diff: 'easy', org: ['orga'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `Immeuble Rockford Hills, entrée principale.`,
    `Un homme en costume gris sort vers 18h.`,
    `Tu notes la plaque de sa voiture. Tu m'envoies une photo.`,
    `Pas d'intervention.`,
  ]},
  { title: 'Coursier portuaire', diff: 'easy', org: ['orga'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `Port de LS, quai 12. Demande Ruiz.`,
    `Il te donne un tube en acier. Tu l'apportes à l'entrepôt de La Mesa.`,
    `Dis que c'est de la part de Victor.`,
  ]},

  // CARTEL — FACILE
  { title: 'Livraison privée', diff: 'easy', org: ['cartel'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Une mallette.`,
    `— Motel, réception. Tu demandes la chambre au nom de Morales.`,
    `— Tu poses. Tu pars. T'as jamais été là.`,
  ]},
  { title: 'Enlèvement de fichiers', diff: 'easy', org: ['cartel'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `Cabinet d'avocats, Pillbox Hill.`,
    `Réceptionniste s'appelle Karen. Elle a ce qu'on veut.`,
    `Tu joues le livreur. Tu récupères le dossier rouge.`,
    `Simple.`,
  ]},

  // TOUS — FACILE
  { title: 'Message à transmettre', diff: 'easy', org: [], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `T'as un message à passer.`,
    `Trouve Ortiz au Vanilla Unicorn. Tu lui dis : "Le vent tourne."`,
    `Rien d'autre. Tu attends sa réponse et tu me la rapportes.`,
  ]},

  // GANG — MOYEN
  { title: 'Raid dépôt adverse', diff: 'medium', org: ['gang'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Ils ont un stock dans un entrepôt pas loin du sud.`,
    `— T'entre, tu prends ce qu'il y a dans les caisses, tu repars.`,
    `— Y'a deux gardes. À toi de voir comment tu gères.`,
    `— Mais t'arrive pas avec des éclairs et des sirènes. Discret.`,
  ]},
  { title: 'Pression recouvrement', diff: 'medium', org: ['gang'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Un certain Damien nous doit 350k depuis maintenant deux mois.`,
    `— Il traine du côté de Chamberlain Hills le soir.`,
    `— T'as pas besoin de le tuer. T'as juste besoin qu'il comprenne.`,
    `— Ramène le cash. Ou une bonne raison de faire une exception.`,
  ]},

  // ORGA — MOYEN
  { title: 'Extraction de contact', diff: 'medium', org: ['orga'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Un de nos hommes a été arrêté. Commissariat de Vespucci.`,
    `— Il sort ce soir ou il sort jamais.`,
    `— T'as deux options : tu fais pression sur quelqu'un à l'intérieur, ou tu crées une diversion.`,
    `— Je veux pas savoir comment. Je veux qu'il soit ici à 23h.`,
  ]},
  { title: 'Neutralisation surveillance', diff: 'medium', org: ['orga'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `Les caméras du bloc C au port — elles doivent tomber ce soir entre 22h et minuit.`,
    `On a une livraison qui passe. Elle peut pas être filmée.`,
    `Technique ou force brute — à toi. Mais elles tombent.`,
  ]},

  // CARTEL — MOYEN
  { title: 'Interception transfert', diff: 'medium', org: ['cartel'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Un convoi de la DEA transfère de l'argent saisi.`,
    `— L'argent nous appartient.`,
    `— Route de Paleto Bay, vers 21h. Deux véhicules banalisés.`,
    `— Tu interceptes. T'as besoin de monde. Prépare-toi.`,
  ]},
  { title: 'Élimination informateur', diff: 'medium', org: ['cartel'], secret: false, lines: [
    `[SMS entrant — ${VICTOR_NUMBER}]`,
    `On a un problème. Quelqu'un parle.`,
    `Prénom : Marco. Travaille au Bahmas près de la plage.`,
    `T'as jusqu'à demain matin.`,
    `Propre.`,
  ]},

  // TOUS — MOYEN
  { title: 'Sabotage concurrent', diff: 'medium', org: [], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Nos concurrents ont un stock à Sandy Shores.`,
    `— Je veux pas qu'il reste grand chose demain matin.`,
    `— T'as pas besoin de te battre. T'as besoin d'être malin.`,
    `— Si ça tourne mal — t'as jamais eu cet appel.`,
  ]},

  // GANG — DIFFICILE
  { title: 'Guerre de territoire', diff: 'hard', org: ['gang'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Ils ont traversé la ligne. Deux fois.`,
    `— Ce soir on répond.`,
    `— Forum Drive, côté ouest. Tout ce qui est là-bas et qui appartient pas aux nôtres — ça doit plus être là demain.`,
    `— Prends du monde. C'est pas une promenade.`,
    `⚠️ Mission critique — la mort RP est possible.`,
  ]},

  // ORGA — DIFFICILE
  { title: 'Opération Spectre', diff: 'hard', org: ['orga'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— On a une cible de haute valeur.`,
    `— Villa privée, Vinewood Hills. Accès sécurisé, gardes armés, caméras.`,
    `— T'as une fenêtre de 20 minutes entre les rondes.`,
    `— La cible sort pas vivante. Toi oui — si tu fais bien ton boulot.`,
    `⚠️ Mission critique — la mort RP est possible.`,
  ]},

  // CARTEL — DIFFICILE
  { title: 'Purge interne', diff: 'hard', org: ['cartel'], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— On a été trahis de l'intérieur.`,
    `— Trois noms. Je t'envoie les photos.`,
    `— Ils savent qu'on sait. Donc ils se méfient.`,
    `— T'as pas le droit à l'erreur. Si un seul disparaît dans la nature — c'est toi qui prends.`,
    `⚠️ Mission critique — la mort RP est possible.`,
  ]},

  // TOUS — DIFFICILE
  { title: 'Coup de force', diff: 'hard', org: [], secret: false, lines: [
    `[Appel entrant — ${VICTOR_NUMBER}]`,
    `— Écoute-moi attentivement. Je répète pas.`,
    `— Maze Bank Tower, sortie souterraine, 23h15. Blindé. Quatre gardes armés.`,
    `— Ce qui est dedans m'appartient. Ce que t'en fais après — ton problème.`,
    `— Si tu reviens pas — personne te cherchera. C'est le deal.`,
    `⚠️ Mission critique — la mort RP est possible.`,
  ]},

  // ── MISSIONS SECRÈTES (secret: true) ─────────────────────────────────────
  { title: '[ CLASSIFIED ] Protocole Omega', diff: 'hard', org: [], secret: true, lines: [
    `[Appel entrant chiffré — ${VICTOR_NUMBER}]`,
    `— Si tu reçois ça, t'as prouvé ce que tu vaux.`,
    `— Il y a une liste. Une liste de noms que personne devrait avoir.`,
    `— Elle est dans un coffre, sous-sol du Maze Bank. Niveau -3. Code : 7734.`,
    `— Tu ramènes la liste. Tu gardes aucune copie. Tu parles à personne.`,
    `— Pas même à moi après. T'as jamais eu cet appel.`,
    `🔒 Mission secrète — rang Soldato requis.`,
    `⚠️ Mort RP possible.`,
  ]},
  { title: '[ CLASSIFIED ] Le Fantôme de Paleto', diff: 'medium', org: [], secret: true, lines: [
    `[SMS chiffré — ${VICTOR_NUMBER}]`,
    `Paleto Bay. Vieille ferme à 2km au nord.`,
    `Quelqu'un s'y cache depuis 3 semaines. On veut savoir qui.`,
    `Photo. Nom. Rien d'autre.`,
    `Si tu te fais voir — la mission n'a jamais existé.`,
    `🔒 Mission secrète — rang Soldato requis.`,
  ]},
];

// ── Helpers ────────────────────────────────────────────────────────────────
const DIFF_META = {
  easy:   { label: '🟢 Facile',    color: 0x2ECC71, warn: '' },
  medium: { label: '🟡 Moyen',     color: 0xF39C12, warn: '' },
  hard:   { label: '🔴 Difficile', color: 0xC0392B, warn: '⚠️ **ATTENTION — La mort RP est possible.**\nAssure-toi que toutes les parties sont au courant.' },
};

function allMissions() {
  const custom = getCustomMissions();
  return [...MISSIONS, ...custom];
}

function getMissionsFor(orgKey, diff, includeSecret = false) {
  return allMissions().filter(m =>
    m.diff === diff &&
    (m.org.length === 0 || m.org.includes(orgKey)) &&
    (includeSecret ? true : !m.secret)
  );
}

function getSecretMissions(orgKey) {
  return allMissions().filter(m =>
    m.secret && (m.org.length === 0 || m.org.includes(orgKey))
  );
}

const lastPick = new Map();
function pickRandom(arr, lastIdx) {
  if (arr.length === 0) return null;
  if (arr.length === 1) return { item: arr[0], idx: 0 };
  let idx;
  do { idx = Math.floor(Math.random() * arr.length); } while (idx === lastIdx);
  return { item: arr[idx], idx };
}

function isGM(member) {
  return GM_ROLES.some(r => member.roles.cache.has(r));
}

function getOrgKeyForMember(member) {
  for (const [key, org] of Object.entries(ORGS)) {
    if (org.roles.some(r => member.roles.cache.has(r))) return key;
  }
  return null;
}

// Retourne { roleId, roleName } du groupe réel du joueur
function getGroupForMember(member) {
  for (const org of Object.values(ORGS)) {
    for (const roleId of org.roles) {
      if (member.roles.cache.has(roleId)) {
        const role = member.guild.roles.cache.get(roleId);
        return { roleId, roleName: role?.name || roleId };
      }
    }
  }
  return null;
}

function getRoleOrgKey(roleId) {
  for (const [key, org] of Object.entries(ORGS)) {
    if (org.roles.includes(roleId)) return key;
  }
  return null;
}

function buildMissionEmbed(mission, org, orgKey, diff, groupName) {
  const meta      = DIFF_META[diff];
  const lines     = mission.lines.map(l => l.replace(/\$\{VICTOR_NUMBER\}/g, VICTOR_NUMBER));
  const diffLabel = diff === 'easy' ? 'FACILE' : diff === 'medium' ? 'MOYEN' : 'DIFFICILE';
  const cdHours   = diff === 'easy' ? 1 : diff === 'medium' ? 12 : 48;
  const displayGroup = groupName || org.label;

  // Parse cash et bonus depuis cashReward (ex: "💵 100 000 $ d'argent sale + 🔋 5 chargeurs de pistolet")
  const rewardFull = org.cashReward[diff];
  let cashPart  = rewardFull;
  let bonusPart = '';
  const plusIdx = rewardFull.indexOf('+');
  if (plusIdx !== -1) {
    cashPart  = rewardFull.slice(0, plusIdx).trim();
    bonusPart = rewardFull.slice(plusIdx + 1).trim();
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${diffLabel}   ${org.emoji} ${displayGroup}` })
    .setTitle(mission.title)
    .setDescription(lines.join('\n'))
    .setColor(meta.color)
    .addFields(
      { name: 'XP',   value: `+${org.xpReward[diff].toLocaleString()}`,  inline: true },
      { name: 'CASH', value: cashPart,                                     inline: true },
      ...(bonusPart ? [{ name: 'BONUS', value: bonusPart, inline: true }] : []),
    )
    .setFooter({ text: `Appel reçu · Ne pas rappeler · CD ${cdHours}h` })
    .setTimestamp();
  if (meta.warn) embed.addFields({ name: '\u200B', value: meta.warn });
  return embed;
}

// ── Client ─────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── Slash commands ─────────────────────────────────────────────────────────
async function registerCommands() {
  const commands = [

    // /mission
    new SlashCommandBuilder()
      .setName('mission')
      .setDescription('Recevoir un ordre de mission'),

    // /xp
    new SlashCommandBuilder()
      .setName('xp')
      .setDescription('Voir le tableau XP des organisations'),

    // /listmission
    new SlashCommandBuilder()
      .setName('listmission')
      .setDescription('Voir toutes les missions disponibles')
      .addStringOption(o => o.setName('difficulte').setDescription('Filtrer par difficulté').setRequired(false)
        .addChoices(
          { name: '🟢 Facile',    value: 'easy'   },
          { name: '🟡 Moyen',     value: 'medium' },
          { name: '🔴 Difficile', value: 'hard'   },
          { name: '🔒 Secrètes',  value: 'secret' },
        ))
      .addStringOption(o => o.setName('organisation').setDescription('Filtrer par organisation').setRequired(false)
        .addChoices(
          { name: 'Gang',           value: 'gang'   },
          { name: 'Organisation',   value: 'orga'   },
          { name: 'Famille/Cartel', value: 'cartel' },
        )),

    // /addcrew (GM)
    new SlashCommandBuilder()
      .setName('addcrew')
      .setDescription('[GM] Enregistrer le canal privé d\'un groupe')
      .addRoleOption(o => o.setName('groupe').setDescription('Rôle du groupe').setRequired(true))
      .addChannelOption(o => o.setName('canal').setDescription('Canal privé du groupe').setRequired(true)),

    // /addmission (GM)
    new SlashCommandBuilder()
      .setName('addmission')
      .setDescription('[GM] Ajouter une mission personnalisée')
      .addStringOption(o => o.setName('titre').setDescription('Titre de la mission').setRequired(true))
      .addStringOption(o => o.setName('difficulte').setDescription('Difficulté').setRequired(true)
        .addChoices(
          { name: '🟢 Facile',    value: 'easy'   },
          { name: '🟡 Moyen',     value: 'medium' },
          { name: '🔴 Difficile', value: 'hard'   },
        ))
      .addStringOption(o => o.setName('texte').setDescription('Corps du message (sépare les lignes avec | )').setRequired(true))
      .addStringOption(o => o.setName('organisation').setDescription('Organisation ciblée (laisser vide = toutes)').setRequired(false)
        .addChoices(
          { name: 'Gang',           value: 'gang'   },
          { name: 'Organisation',   value: 'orga'   },
          { name: 'Famille/Cartel', value: 'cartel' },
          { name: 'Toutes',         value: 'all'    },
        ))
      .addBooleanOption(o => o.setName('secrete').setDescription('Mission secrète (rang Soldato requis) ?').setRequired(false)),

    // /easteregg (GM)
    new SlashCommandBuilder()
      .setName('easteregg')
      .setDescription('[GM] Envoyer une mission secrète dans les canaux privés des groupes mentionnés')
      .addStringOption(o => o.setName('roles').setDescription('Mentionner les rôles des groupes (@Groupe1 @Groupe2...)').setRequired(true))
      .addStringOption(o => o.setName('mission').setDescription('Titre de la mission secrète (optionnel — aléatoire si vide)').setRequired(false)),

    // /blackmarket (GM)
    new SlashCommandBuilder()
      .setName('blackmarket')
      .setDescription('[GM] Envoyer un message de Victor Graves dans le canal privé d\'un groupe')
      .addRoleOption(o => o.setName('groupe').setDescription('Rôle du groupe destinataire').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Contenu du message').setRequired(true)),

  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅  Commandes enregistrées');
}

client.once('ready', async () => {
  console.log(`✅  Connecté : ${client.user.tag}`);
  await registerCommands();
});

// ── Interactions ───────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  const { user, guildId, member } = interaction;

  // ══════════════════════════════════════════════════════
  //  /xp
  // ══════════════════════════════════════════════════════
  if (interaction.isChatInputCommand() && interaction.commandName === 'xp') {
    const allEntries = [];

    for (const [orgKey, org] of Object.entries(ORGS)) {
      for (const roleId of org.roles) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) continue;
        const xp   = getXp(guildId, roleId);
        const lv   = getLevel(xp);
        const next = getNextLevel(xp);
        allEntries.push({ roleId, roleName: role.name, org, xp, lv, next });
      }
    }

    // Trier par XP décroissant
    allEntries.sort((a, b) => b.xp - a.xp);

    const maxXp   = allEntries[0]?.xp || 1;
    const BAR_LEN = 20;

    const fields = allEntries.map((e, i) => {
      const filled   = Math.round((e.xp / Math.max(maxXp, 1)) * BAR_LEN);
      const bar      = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
      const medal    = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      const nextInfo = e.next ? ` → ${e.next.label}` : ' 🏆 Max';
      return {
        name: `${medal}  ${e.org.emoji} ${e.roleName}`,
        value: `**${e.lv.label}**  ·  ${e.xp.toLocaleString()} XP\n\`${bar}\`${nextInfo}`,
        inline: false,
      };
    });

    const activeCount = allEntries.filter(e => e.xp > 0).length;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Classement des crews')
          .setDescription('XP cumulé · saison en cours\n_ _')
          .setColor(0x5865F2)
          .addFields(fields)
          .setFooter({ text: `${activeCount} crews actifs · mis à jour en temps réel` })
          .setTimestamp(),
      ],
    });
  }

  // ══════════════════════════════════════════════════════
  //  /listmission
  // ══════════════════════════════════════════════════════
  if (interaction.isChatInputCommand() && interaction.commandName === 'listmission') {
    const filterDiff = interaction.options.getString('difficulte') || null;
    const filterOrg  = interaction.options.getString('organisation') || null;

    let pool = allMissions();

    // Filtres
    if (filterDiff === 'secret') {
      pool = pool.filter(m => m.secret);
    } else {
      if (filterDiff) pool = pool.filter(m => m.diff === filterDiff && !m.secret);
      else            pool = pool.filter(m => !m.secret);
      if (filterOrg)  pool = pool.filter(m => m.org.length === 0 || m.org.includes(filterOrg));
    }

    if (!pool.length) {
      return interaction.reply({ content: '❌ Aucune mission trouvée avec ces filtres.', ephemeral: true });
    }

    const diffIcon = { easy: '🟢', medium: '🟡', hard: '🔴' };
    const orgLabel = { gang: '🔫 Gang', orga: '🪖 Orga', cartel: '💼 Cartel' };

    // Grouper par difficulté
    const groups = {};
    for (const m of pool) {
      const key = m.secret ? 'secret' : m.diff;
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }

    const embeds = [];
    const ORDER  = ['easy', 'medium', 'hard', 'secret'];

    for (const key of ORDER) {
      if (!groups[key]) continue;
      const label = key === 'secret' ? '🔒 Missions secrètes' : `${diffIcon[key]} ${DIFF_META[key].label}`;
      const lines = groups[key].map((m, i) => {
        const orgs = m.org.length ? m.org.map(o => orgLabel[o]).join(', ') : 'Toutes';
        const src  = m.id ? '*(custom)*' : '';
        return `**${i + 1}.** ${m.title} ${src}\n↳ ${orgs}`;
      });

      // Discord : max 4096 chars par embed, on pagine si besoin
      const chunks = [];
      let current  = '';
      for (const line of lines) {
        if ((current + '\n\n' + line).length > 3800) { chunks.push(current); current = line; }
        else current = current ? current + '\n\n' + line : line;
      }
      if (current) chunks.push(current);

      chunks.forEach((chunk, idx) => {
        embeds.push(
          new EmbedBuilder()
            .setTitle(idx === 0 ? `📋 ${label} (${groups[key].length})` : `📋 ${label} (suite)`)
            .setDescription(chunk)
            .setColor(key === 'secret' ? 0x8E44AD : DIFF_META[key]?.color || 0x2C3E50)
        );
      });
    }

    // Discord limite à 10 embeds par message
    const firstBatch = embeds.slice(0, 10);
    await interaction.reply({ embeds: firstBatch, ephemeral: true });

    // Si plus de 10, envoyer en followUp
    if (embeds.length > 10) {
      await interaction.followUp({ embeds: embeds.slice(10, 20), ephemeral: true });
    }
    return;
  }
  if (interaction.isChatInputCommand() && interaction.commandName === 'addcrew') {
    if (!isGM(member)) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });

    const role    = interaction.options.getRole('groupe');
    const channel = interaction.options.getChannel('canal');

    setCrew(guildId, role.id, channel.id);

    return interaction.reply({
      content: `✅ Canal privé enregistré.\n🔗 Groupe **${role.name}** → ${channel}`,
      ephemeral: true,
    });
  }

  // ══════════════════════════════════════════════════════
  //  /addmission (GM)
  // ══════════════════════════════════════════════════════
  if (interaction.isChatInputCommand() && interaction.commandName === 'addmission') {
    if (!isGM(member)) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });

    const titre   = interaction.options.getString('titre');
    const diff    = interaction.options.getString('difficulte');
    const orgOpt  = interaction.options.getString('organisation') || 'all';
    const texte   = interaction.options.getString('texte');
    const secret  = interaction.options.getBoolean('secrete') || false;

    const orgArr  = orgOpt === 'all' ? [] : [orgOpt];
    const lines   = texte.split('|').map(l => l.trim()).filter(Boolean);

    addCustomMission({ title: titre, diff, org: orgArr, secret, lines });

    const preview = lines.slice(0, 3).join('\n') + (lines.length > 3 ? '\n...' : '');
    const embed = new EmbedBuilder()
      .setTitle(`✅ Mission ajoutée : ${titre}`)
      .setColor(0x2ECC71)
      .addFields(
        { name: 'Difficulté',     value: DIFF_META[diff].label,                        inline: true },
        { name: 'Organisation',   value: orgOpt === 'all' ? 'Toutes' : orgOpt,          inline: true },
        { name: 'Secrète',        value: secret ? '🔒 Oui' : 'Non',                    inline: true },
        { name: 'Aperçu',         value: `\`\`\`${preview}\`\`\``,                     inline: false },
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ══════════════════════════════════════════════════════
  //  /easteregg (GM)
  // ══════════════════════════════════════════════════════
  if (interaction.isChatInputCommand() && interaction.commandName === 'easteregg') {
    if (!isGM(member)) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const rolesStr    = interaction.options.getString('roles');
    const missionOpt  = interaction.options.getString('mission');
    const roleMatches = rolesStr.match(/<@&(\d+)>/g) || [];

    if (!roleMatches.length) {
      return interaction.editReply('❌ Aucun rôle mentionné. Utilise le format @Rôle.');
    }

    const results = [];

    for (const mention of roleMatches) {
      const roleId  = mention.replace(/<@&|>/g, '');
      const orgKey  = getRoleOrgKey(roleId);
      const channelId = getCrew(guildId, roleId);

      if (!channelId) {
        results.push(`⚠️ <@&${roleId}> — aucun canal configuré (utilise /addcrew)`);
        continue;
      }

      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        results.push(`❌ <@&${roleId}> — canal introuvable`);
        continue;
      }

      // Chercher la mission secrète demandée ou en prendre une aléatoire
      let mission;
      if (missionOpt) {
        mission = allMissions().find(m => m.secret && m.title.toLowerCase().includes(missionOpt.toLowerCase()));
      }
      if (!mission) {
        const pool   = getSecretMissions(orgKey || 'gang');
        const picked = pickRandom(pool, null);
        mission      = picked?.item;
      }

      if (!mission) {
        results.push(`❌ <@&${roleId}> — aucune mission secrète disponible`);
        continue;
      }

      const org   = ORGS[orgKey] || ORGS.gang;
      const embed = new EmbedBuilder()
        .setTitle(`🔒 ${mission.title}`)
        .setDescription(mission.lines.map(l => l.replace(/\$\{VICTOR_NUMBER\}/g, VICTOR_NUMBER)).join('\n\n'))
        .setColor(0x8E44AD)
        .setFooter({ text: 'Message chiffré · Détruire après lecture' })
        .setTimestamp();

      await channel.send({ content: `<@&${roleId}>`, embeds: [embed] });
      results.push(`✅ Mission secrète envoyée à <@&${roleId}> dans ${channel}`);
    }

    return interaction.editReply(results.join('\n'));
  }

  // ══════════════════════════════════════════════════════
  //  /blackmarket (GM) — message Victor Graves vers groupe
  // ══════════════════════════════════════════════════════
  if (interaction.isChatInputCommand() && interaction.commandName === 'blackmarket') {
    if (!isGM(member)) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });

    const role      = interaction.options.getRole('groupe');
    const message   = interaction.options.getString('message');
    const channelId = getCrew(guildId, role.id);

    if (!channelId) {
      return interaction.reply({ content: `❌ Aucun canal configuré pour **${role.name}**. Utilise /addcrew d'abord.`, ephemeral: true });
    }

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return interaction.reply({ content: '❌ Canal introuvable.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'Victor Graves' })
      .setDescription(`*[SMS entrant — ${VICTOR_NUMBER}]*\n\n${message}`)
      .setColor(0x1a1a1a)
      .setFooter({ text: 'Black Market · Communication privée' })
      .setTimestamp();

    await channel.send({ content: `<@&${role.id}>`, embeds: [embed] });

    logBlackmarket({ guildId, roleId: role.id, roleName: role.name, message, gmId: user.id });

    return interaction.reply({
      content: `✅ Message envoyé à **${role.name}** dans ${channel}.`,
      ephemeral: true,
    });
  }

  // ══════════════════════════════════════════════════════
  //  /mission — étape 1 : menu difficulté
  // ══════════════════════════════════════════════════════
  if (interaction.isChatInputCommand() && interaction.commandName === 'mission') {
    const orgKey = getOrgKeyForMember(member);
    if (!orgKey) {
      return interaction.reply({ content: '❌ Tu ne fais partie d\'aucune organisation reconnue.', ephemeral: true });
    }

    const group = getGroupForMember(member);
    const org   = ORGS[orgKey];
    const xp    = group ? getXp(guildId, group.roleId) : 0;
    const lv    = getLevel(xp);

    const secretUnlocked = xp >= SECRET_MISSION_MIN_XP;

    const options = [
      { label: '🟢 Facile — Livraison & contact',   value: 'easy',   description: `+15 000 XP · 50K$ sale · CD 1h` },
      { label: '🟡 Moyen — Mission complexe',        value: 'medium', description: `+45 000 XP · 100K$ + armement · CD 12h` },
      { label: '🔴 Difficile — Opération critique',  value: 'hard',   description: `+100 000 XP · 300K$ + Cal.50 · CD 48h · ⚠️ Mort RP` },
    ];

    if (secretUnlocked) {
      options.push({ label: '🔒 Mission secrète', value: 'secret', description: `Débloqué (rang ${lv.label}) · Missions exclusives` });
    }

    const groupLabel = group ? group.roleName : org.label;

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`diff:${orgKey}`)
        .setPlaceholder('Choisir une difficulté…')
        .addOptions(options)
    );

    return interaction.reply({
      content: `${org.emoji} **${groupLabel}** · Rang : **${lv.label}** · ${xp.toLocaleString()} XP\nChoisissez le niveau :`,
      components: [row],
      ephemeral: true,
    });
  }

  // ══════════════════════════════════════════════════════
  //  Select menu — difficulté
  // ══════════════════════════════════════════════════════
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('diff:')) {
    const orgKey = interaction.customId.split(':')[1];
    const diff   = interaction.values[0];
    const org    = ORGS[orgKey];

    const group   = getGroupForMember(member);
    const roleId  = group?.roleId || orgKey;
    const groupName = group?.roleName || org.label;

    // Missions secrètes
    if (diff === 'secret') {
      const xp = group ? getXp(guildId, roleId) : 0;
      if (xp < SECRET_MISSION_MIN_XP) {
        return interaction.update({ content: '❌ Rang insuffisant pour les missions secrètes.', components: [] });
      }

      const pool   = getSecretMissions(orgKey);
      const picked = pickRandom(pool, lastPick.get(`${user.id}:secret`));
      if (!picked) return interaction.update({ content: '❌ Aucune mission secrète disponible.', components: [] });

      lastPick.set(`${user.id}:secret`, picked.idx);
      await interaction.deferUpdate();
      await new Promise(r => setTimeout(r, 900));

      const mission = picked.item;
      const embed = new EmbedBuilder()
        .setTitle(`🔒 ${mission.title}`)
        .setDescription(mission.lines.map(l => l.replace(/\$\{VICTOR_NUMBER\}/g, VICTOR_NUMBER)).join('\n\n'))
        .setColor(0x8E44AD)
        .setFooter({ text: 'Message chiffré · Détruire après lecture' })
        .setTimestamp();

      return interaction.editReply({ content: '\u200B', embeds: [embed], components: [] });
    }

    // Vérif cooldown
    const remaining = checkCooldown(user.id, roleId, diff);
    if (remaining) {
      return interaction.update({
        content: `⏳ Tu dois attendre encore **${formatMs(remaining)}** avant de recevoir une nouvelle mission de ce niveau.`,
        components: [],
      });
    }

    const pool = getMissionsFor(orgKey, diff);
    if (!pool.length) return interaction.update({ content: '❌ Aucune mission disponible.', components: [] });

    const pickKey = `${user.id}:${roleId}:${diff}`;
    const picked  = pickRandom(pool, lastPick.get(pickKey));
    lastPick.set(pickKey, picked.idx);

    setCooldown(user.id, roleId, diff);

    await interaction.deferUpdate();
    await new Promise(r => setTimeout(r, 800 + Math.random() * 500));

    const embed  = buildMissionEmbed(picked.item, org, orgKey, diff, groupName);
    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`done:${orgKey}:${roleId}:${diff}`).setLabel('✅ Mission accomplie').setStyle(ButtonStyle.Success),
    );

    return interaction.editReply({ content: '\u200B', embeds: [embed], components: [btnRow] });
  }

  // ══════════════════════════════════════════════════════
  //  Bouton — Signaler mission terminée → notif GM
  // ══════════════════════════════════════════════════════
  if (interaction.isButton() && interaction.customId.startsWith('done:')) {
    const parts   = interaction.customId.split(':');
    const orgKey  = parts[1];
    const roleId  = parts[2];
    const diff    = parts[3];
    const org         = ORGS[orgKey];
    const missionTitle = interaction.message.embeds[0]?.title || '?';

    // Répondre au joueur : numéro à appeler
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📞 Contactez Victor Graves')
          .setDescription(`Votre mission est terminée ?\nAppellez ce numéro pour le confirmer :\n\n# ${VICTOR_NUMBER}\n\n*Un Gamemaster validera votre mission sous peu.*`)
          .setColor(0xF39C12)
          .setFooter({ text: 'Ne raccrochez pas avant confirmation.' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });

    // Notif dans le salon GM
    const gmChannel = await interaction.guild.channels.fetch(GM_LOG_CHANNEL).catch(() => null);
    if (!gmChannel) return;

    const pendingId = `validate:${user.id}:${orgKey}:${diff}:${Date.now()}`;

    // Rang actuel du joueur dans ce groupe
    const playerXp   = getXp(guildId, roleId);
    const playerRank = getLevel(playerXp);

    // Nom du groupe réel
    const groupRole   = interaction.guild.roles.cache.get(roleId);
    const groupName   = groupRole?.name || org.label;

    // Parse cash/bonus
    const rewardFull2 = org.cashReward[diff];
    let cashPart2  = rewardFull2;
    let bonusPart2 = '';
    const plusIdx2 = rewardFull2.indexOf('+');
    if (plusIdx2 !== -1) {
      cashPart2  = rewardFull2.slice(0, plusIdx2).trim();
      bonusPart2 = rewardFull2.slice(plusIdx2 + 1).trim();
    }

    const cdHoursGm = diff === 'easy' ? 1 : diff === 'medium' ? 12 : 48;

    const gmEmbed = new EmbedBuilder()
      .setAuthor({ name: `${user.username}  ·  ${groupName}  ·  ${playerRank.label}  ·  ${playerXp.toLocaleString()} XP` })
      .setTitle(`VALIDATION  ·  ${DIFF_META[diff].label}  ·  CD ${cdHoursGm}h`)
      .setDescription(
        `**Timeline :** Mission reçue ✅  →  Terminée ✅  →  **Validation GM ⏳**  →  Récompense ⬜\n\n` +
        `**Mission · ${missionTitle.toUpperCase()}**`
      )
      .setColor(0xF39C12)
      .addFields(
        { name: 'XP GAIN',  value: `+${org.xpReward[diff].toLocaleString()}`,      inline: true },
        { name: 'CASH',     value: cashPart2,                                        inline: true },
        ...(bonusPart2 ? [{ name: 'BONUS', value: bonusPart2, inline: true }] : []),
      )
      .setFooter({ text: `Salon GM · Mission RP  ·  Rang actuel : ${playerRank.label}` })
      .setTimestamp();

    const gmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gm_ok:${user.id}:${orgKey}:${roleId}:${diff}`)
        .setLabel('Valider')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`gm_fail:${user.id}:${orgKey}:${roleId}:${diff}`)
        .setLabel('Refuser')
        .setStyle(ButtonStyle.Danger),
    );

    await gmChannel.send({ embeds: [gmEmbed], components: [gmRow] });
    return;
  }

  // ══════════════════════════════════════════════════════
  //  Bouton GM — Valider ou refuser une mission
  // ══════════════════════════════════════════════════════
  if (interaction.isButton() && (interaction.customId.startsWith('gm_ok:') || interaction.customId.startsWith('gm_fail:'))) {
    if (!isGM(member)) return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });

    const parts    = interaction.customId.split(':');
    const action   = parts[0];
    const targetId = parts[1];
    const orgKey   = parts[2];
    const roleId   = parts[3];
    const diff     = parts[4];
    const org      = ORGS[orgKey];

    const validated = action === 'gm_ok';

    // Mettre à jour le message GM (désactiver les boutons)
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('disabled_ok')
        .setLabel(validated ? '✅ Validé par ' + member.displayName : '✅ Valider')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('disabled_fail')
        .setLabel(!validated ? '❌ Refusé par ' + member.displayName : '❌ Refuser')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
    );

    await interaction.update({ components: [disabledRow] });

    // Trouver le canal privé du groupe pour répondre
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    let replyChannel   = null;

    if (targetMember) {
      // Chercher le canal privé du groupe via ses rôles
      for (const [, org2] of Object.entries(ORGS)) {
        for (const roleId of org2.roles) {
          if (targetMember.roles.cache.has(roleId)) {
            const chId = getCrew(guildId, roleId);
            if (chId) { replyChannel = await interaction.guild.channels.fetch(chId).catch(() => null); break; }
          }
        }
        if (replyChannel) break;
      }
    }

    if (validated) {
      // Ajouter XP au groupe (par roleId)
      const newXp = addXp(guildId, roleId, org.xpReward[diff]);
      const lv    = getLevel(newXp);
      const next  = getNextLevel(newXp);
      addHistory(guildId, roleId, '(validé par GM)', diff);

      const xpGained    = org.xpReward[diff];
      const xpRemaining = next ? (next.min - newXp).toLocaleString() : null;
      const progBar     = next
        ? `${newXp.toLocaleString()} / ${next.min.toLocaleString()} XP  ·  ${xpRemaining} XP restants → ${next.label}`
        : '🏆 Rang maximum atteint';

      const groupRoleName = interaction.guild.roles.cache.get(roleId)?.name || org.label;

      // Parse cash/bonus pour le message succès
      const rewardSucc = org.cashReward[diff];
      let cashSucc     = rewardSucc;
      let bonusSucc    = '';
      const plusSucc   = rewardSucc.indexOf('+');
      if (plusSucc !== -1) {
        cashSucc  = rewardSucc.slice(0, plusSucc).trim();
        bonusSucc = rewardSucc.slice(plusSucc + 1).trim();
      }

      const successEmbed = new EmbedBuilder()
        .setAuthor({ name: `MISSION VALIDÉE  ·  Validé par ${member.displayName}` })
        .setDescription(`T'as fait le boulot. Bien joué.\nLa récompense sera livrée dans les prochaines heures.\nFais pas de bruit.`)
        .setColor(0x2ECC71)
        .addFields(
          { name: 'XP gagné',    value: `+${xpGained.toLocaleString()}`,      inline: true },
          { name: 'Cash RP',     value: cashSucc,                               inline: true },
          { name: 'Rang actuel', value: lv.label,                               inline: true },
          ...(bonusSucc ? [{ name: 'Bonus', value: bonusSucc, inline: true }] : []),
        )
        .setFooter({ text: `${org.emoji} ${groupRoleName} · Mission RP  ·  ${progBar}` })
        .setTimestamp();

      if (replyChannel) {
        await replyChannel.send({ content: `<@${targetId}>`, embeds: [successEmbed] });
      } else {
        // DM de secours
        const target = await client.users.fetch(targetId).catch(() => null);
        if (target) await target.send({ embeds: [successEmbed] }).catch(() => {});
      }

    } else {
      const cdMs      = COOLDOWNS_MS[diff];
      const cdHoursF  = diff === 'easy' ? 1 : diff === 'medium' ? 12 : 48;
      // Retrouver le titre de mission depuis le message GM
      const failMissionTitle = interaction.message.embeds[0]?.description?.match(/\*\*Mission · (.+)\*\*/)?.[1] || '?';

      const failEmbed = new EmbedBuilder()
        .setAuthor({ name: `MISSION ÉCHOUÉE  ·  Refusé par ${member.displayName}` })
        .setDescription(`T'as merdé.\nJ'attends pas d'explications. Tu recommences quand t'es prêt.\nMais la prochaine fois — fais-le bien.`)
        .setColor(0xC0392B)
        .addFields(
          { name: 'XP gagné',          value: `0`,                      inline: true },
          { name: 'Mission',            value: failMissionTitle,          inline: true },
          { name: 'Cooldown restant',   value: `${cdHoursF}h`,           inline: true },
        )
        .setFooter({ text: `${org.emoji} ${org.label} · Mission RP  ·  Échec` })
        .setTimestamp();

      if (replyChannel) {
        await replyChannel.send({ content: `<@${targetId}>`, embeds: [failEmbed] });
      } else {
        const target = await client.users.fetch(targetId).catch(() => null);
        if (target) await target.send({ embeds: [failEmbed] }).catch(() => {});
      }
    }
    return;
  }
});

// ══════════════════════════════════════════════════════
//  /blackmarket — relais depuis salon staff (messages)
// ══════════════════════════════════════════════════════
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!BLACKMARKET_STAFF_CHANNEL) return;
  if (message.channelId !== BLACKMARKET_STAFF_CHANNEL) return;

  const member = message.member;
  if (!isGM(member)) return;

  // Format : @Rôle message...
  const roleMatch = message.content.match(/<@&(\d+)>\s+(.+)/s);
  if (!roleMatch) return;

  const [, roleId, text] = roleMatch;
  const channelId = getCrew(message.guildId, roleId);

  if (!channelId) {
    return message.reply(`❌ Aucun canal configuré pour <@&${roleId}>. Utilise /addcrew.`);
  }

  const channel = await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return message.reply('❌ Canal introuvable.');

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Victor Graves' })
    .setDescription(`*[SMS entrant — ${VICTOR_NUMBER}]*\n\n${text}`)
    .setColor(0x1a1a1a)
    .setFooter({ text: 'Black Market · Communication privée' })
    .setTimestamp();

  await channel.send({ content: `<@&${roleId}>`, embeds: [embed] });
  await message.react('✅');

  logBlackmarket({ guildId: message.guildId, roleId, message: text, gmId: message.author.id });
});

// ── Handlers erreur ─────────────────────────────────────────────────────────
client.on('error', err => console.error('❌ Discord error:', err.message));
process.on('unhandledRejection', err => console.error('❌ Unhandled rejection:', err?.message || err));
process.on('uncaughtException',  err => console.error('❌ Uncaught exception:', err?.message || err));

client.login(DISCORD_TOKEN);
