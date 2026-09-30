'use strict';
(() => {
// ===========================================================================
//  ZOMBIE PHEE DIP — idle necromancer game (Incremancer-style)
// ===========================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const mini = $('mini');
const mctx = mini.getContext('2d');

// world size — grows with level (see worldSize)
let WW = 480, WH = 270;

// ---------- helpers --------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  if (!isFinite(n)) return '∞';
  if (n < 1000) return n < 10 && n % 1 ? (Math.floor(n * 10) / 10).toString() : Math.floor(n).toString();
  let i = -1;
  while (n >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + UNITS[i];
}
function fmtTime(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} ชม. ${m} นาที`;
  if (m) return `${m} นาที ${sec} วิ`;
  return `${sec} วิ`;
}

// ---------- save state -----------------------------------------------------
const SAVE_KEY = 'zombieRise.save.v1';
function defaults() {
  return {
    v: 3, level: 1, maxLevel: 1,
    blood: 0, brains: 0, bones: 0,
    up: {},
    spells: { frenzy: 0, plague: 0, raise: 0 },
    settings: { autoNext: true, sound: true, vol: 70, vvol: 55, mvol: 40, music: true, speed: 1, buyMode: 1, autoCast: true, roofs: 'auto', strain: 'basic' },
    stats: { kills: 0, raised: 0, placed: 0, zdead: 0, cleared: 0, play: 0, bloodTotal: 0, doors: 0, giants: 0, bosses: 0,
      bestLevel: 1, spitKills: 0, bombDoors: 0, blasts: 0, maxUndead: 0, prestiges: 0, cured: 0 },
    avg: { blood: 0, brains: 0, bones: 0 },
    prestige: { souls: 0, total: 0, up: {} },
    routes: {}, // level → district chosen on the route map
    ach: {},
    tutorial: true,
    t: Date.now(),
  };
}
let S = defaults();
let resetting = false;

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    applySave(JSON.parse(raw));
    return true;
  } catch (e) { return false; }
}
function applySave(d) {
  const def = defaults();
  S = Object.assign(def, d);
  S.up = Object.assign({}, d.up || {});
  S.spells = Object.assign(defaults().spells, d.spells || {});
  S.settings = Object.assign(defaults().settings, d.settings || {});
  S.stats = Object.assign(defaults().stats, d.stats || {});
  S.avg = Object.assign(defaults().avg, d.avg || {});
  S.prestige = Object.assign(defaults().prestige, d.prestige || {});
  S.prestige.up = Object.assign({}, (d.prestige && d.prestige.up) || {});
  S.ach = Object.assign({}, d.ach || {});
  S.routes = Object.assign({}, d.routes || {});
  S.stats.bestLevel = Math.max(S.stats.bestLevel, S.maxLevel);
}
function save() {
  if (resetting) return;
  S.t = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage full / blocked */ }
}

// ---------- stat formulas --------------------------------------------------
const U = (id) => S.up[id] || 0;
const P = (id) => S.prestige.up[id] || 0; // permanent (prestige) upgrades
const achCount = () => Object.keys(S.ach).length;
// global multiplier on blood / brains / bones income
const gainMult = () => (1 + 0.25 * P('pGain')) * (1 + 0.05 * S.prestige.total) * (1 + 0.02 * achCount());
// milestone: core power upgrades double every 10 levels, so they keep pace with
// the exponential growth of human HP / gun damage (additive-only upgrades hit a wall ~L25)
const MS = (l) => Math.pow(2, Math.floor(l / 10));
const pZ = () => Math.pow(1.2, P('pZombie'));
const F = {
  zDmg: (l = U('bite')) => 10 * (1 + 0.25 * l) * MS(l) * pZ(),
  zHp: (l = U('flesh')) => 50 * (1 + 0.2 * l) * MS(l) * pZ(),
  zSpd: (l = U('legs')) => 11 * (1 + 0.06 * l),
  decay: (l = U('decay')) => 0.024 * Math.pow(0.92, l), // fraction of max HP lost per second
  bloodMult: (l = U('harvest')) => 1 + 0.25 * l,
  eMax: (l = U('energyMax')) => Math.round((30 + 10 * l) * (1 + 0.15 * P('pEnergy'))),
  eRegen: (l = U('energyRegen')) => 2 * (1 + 0.2 * l) * (1 + 0.15 * P('pEnergy')),
  zCost: (l = U('thrift')) => 10 * Math.pow(0.94, l),
  infectT: (l = U('infect')) => 3 * Math.pow(0.88, l),
  brainMult: (l = U('brainGain')) => 1 + 0.25 * l,
  skelN: (l = U('graveyard')) => l + 2 * P('pSkel'),
  skelHp: (l = U('skelPower')) => 70 * (1 + 0.3 * l) * MS(l),
  skelDmg: (l = U('skelPower')) => 9 * (1 + 0.3 * l) * MS(l),
  skelRespawn: (l = U('crypt')) => 20 * Math.pow(0.88, l),
  boneMult: (l = U('boneGain')) => 1 + 0.25 * l,
  bloodCap: (l = U('bloodCap')) => 300 * Math.pow(1.8, l) * (1 + 0.5 * P('pCap')),
  brainsCap: (l = U('brainsCap')) => 60 * Math.pow(1.8, l) * (1 + 0.5 * P('pCap')),
  bonesCap: (l = U('bonesCap')) => 60 * Math.pow(1.8, l) * (1 + 0.5 * P('pCap')),
};
const cap = (cur) => (cur === 'souls' ? Infinity : F[cur + 'Cap']());
const have = (cur) => (cur === 'souls' ? S.prestige.souls : S[cur]);
const spend = (cur, n) => { if (cur === 'souls') S.prestige.souls -= n; else S[cur] -= n; };

// ---------- zombie strains -------------------------------------------------
// level 0 = locked; each level past 1 makes the strain stronger
const STRAINS = {
  basic: { name: 'ธรรมดา', icon: 'zombie', key: 'z', cost: 1, sprite: 'zombie' },
  spit: { name: 'ถ่มกรด', icon: 'spit', key: 'x', cost: 1.3, sprite: 'spitter' },
  bomb: { name: 'บึ้มพลีชีพ', icon: 'bomb', key: 'c', cost: 2.5, sprite: 'bomber' },
  tank: { name: 'ถังเลือด', icon: 'tank', key: 'v', cost: 2.5, sprite: 'tank' },
};
function strainMul(s) {
  const l = Math.max(1, U(s)) - 1;
  switch (s) {
    case 'spit': return { hp: 0.7 * (1 + 0.2 * l), dmg: 1.0 * (1 + 0.2 * l), spd: 1 };
    case 'bomb': return { hp: 0.6, dmg: 4 * (1 + 0.25 * l), spd: 1.25 };
    case 'tank': return { hp: 4 * (1 + 0.25 * l), dmg: 0.8, spd: 0.7 };
    case 'dog': return { hp: 0.6, dmg: 0.7, spd: 1.7 }; // risen from a dead dog: fast and fragile
    default: return { hp: 1, dmg: 1, spd: 1 };
  }
}
const strainUnlocked = (s) => s === 'basic' || U(s) > 0;
const strainCost = (s) => F.zCost() * STRAINS[s].cost;
// level scaling
const LV = {
  count: (L) => Math.min(340, Math.round(16 + L * 4.5)),
  hp: (L) => 20 * Math.pow(1.12, L - 1),
  gunDmg: (L) => 4 * Math.pow(1.1, L - 1),
  police: (L) => (L < 3 ? 0 : Math.min(0.24, 0.06 + (L - 3) * 0.02)),
  brute: (L) => (L < 4 ? 0 : Math.min(0.1, 0.04 + (L - 4) * 0.008)),
  swat: (L) => (L < 6 ? 0 : Math.min(0.1, 0.03 + (L - 6) * 0.008)),
  soldier: (L) => (L < 8 ? 0 : Math.min(0.18, 0.04 + (L - 8) * 0.012)),
  dog: (L) => (L < 4 ? 0 : Math.min(0.08, 0.03 + (L - 4) * 0.003)),
  blood: (L) => 2 * Math.pow(1.17, L - 1),
  brain: (L) => 0.25 * Math.pow(1.14, L - 1),
  bone: (L) => 0.6 * Math.pow(1.13, L - 1),
  clearBrains: (L) => (3 + L) * Math.pow(1.14, L - 1),
  clearBones: (L) => (2 + L * 0.5) * Math.pow(1.13, L - 1),
  doorHp: (L) => 20 * Math.pow(1.12, L - 1) * 4,
};
// map grows every 5 levels: 480x270 → up to 3x (1440x810)
function worldSize(L) {
  const k = 1 + Math.min(2, Math.floor((L - 1) / 5) * 0.25);
  return { w: Math.round(480 * k), h: Math.round(270 * k), k };
}
// per-kind human stats
const KIND = {
  civ: { hp: 1, reward: 1, spd: 6, sprite: 'human' },
  police: { hp: 2.5, reward: 2, spd: 7, sprite: 'armed', range: 55, rate: 1.1, dmg: 1, sight: 100 },
  swat: { hp: 3.5, reward: 3, spd: 7.5, sprite: 'swat', range: 70, rate: 1.7, dmg: 1.2, sight: 110, armor: 0.55, burst: 3 },
  soldier: { hp: 4, reward: 3, spd: 7, sprite: 'armed', range: 75, rate: 0.7, dmg: 2, sight: 110 },
  brute: { hp: 6, reward: 4, spd: 7, sprite: 'brute', dmg: 3, sight: 70 },
  guard: { hp: 7, reward: 5, spd: 7, sprite: 'guard', dmg: 3.5, sight: 70 }, // mansion bodyguard in a suit
  dog: { hp: 1.5, reward: 1, spd: 9, sprite: 'dog', range: 5, rate: 0.7, dmg: 1, sight: 70 },
  boss: { hp: 1, reward: 40, spd: 5, sprite: 'boss', sight: 130 },
};
const isMelee = (k) => k === 'brute' || k === 'guard';
// ---------- weather ------------------------------------------------------------
const WEATHER = {
  clear: { name: 'อากาศดี', icon: 'clear', desc: 'ไม่มีผลพิเศษ' },
  hot: { name: 'ร้อนจัด 42°C', icon: 'sun', desc: 'แดดเผาซอมบี้นอกบ้าน เสีย 0.8% ของ HP ทุกวินาที' },
  cold: { name: 'หนาวผิดฤดู 14°C', icon: 'snow', desc: 'ซอมบี้ตัวแข็ง เดินช้าลง 35%' },
  flood: { name: 'น้ำท่วมกรุง', icon: 'flood', desc: 'กระแสน้ำพัดคนและซอมบี้ไปมา เดินไม่คงที่' },
};
function rollWeather(L) {
  if (L <= 2) return 'clear';
  const x = Math.random();
  return x < 0.4 ? 'clear' : x < 0.6 ? 'hot' : x < 0.8 ? 'cold' : 'flood';
}
// every 10th level: one random boss. hp = multiple of a civilian's hp at that level
const BOSSES = {
  gunner: { name: 'จ่าปืนกลเหล็ก', desc: 'กราดยิงปืนกลเป็นชุดยาว แล้วหยุดรีโหลด', hp: 55, spd: 5,
    pal: { h: '#3a3f2a', c: '#4b5530', b: '#2a2f1a', p: '#2f3520', g: '#2a2a2a' } },
  flamer: { name: 'พลพ่นไฟ', desc: 'พ่นไฟเผาซอมบี้ระยะใกล้ ซอมบี้ติดไฟจะไหม้ต่อเนื่อง', hp: 60, spd: 6,
    pal: { h: '#9a9a8a', c: '#8a6a2a', b: '#c03020', p: '#5a4a2a', g: '#c8c8c8' } },
  priest: { name: 'บาทหลวงไล่ผี', desc: 'ออร่าศักดิ์สิทธิ์เผาอันเดดรอบตัว และปล่อยแสงระเบิดเป็นระยะ', hp: 45, spd: 5,
    pal: { h: '#e8e0d0', c: '#1a1a1a', b: '#f0f0f0', p: '#1a1a1a', g: '#e0c040' } },
  doctor: { name: 'ดร.วัคซีน', desc: 'ขว้างวัคซีนรักษาซอมบี้ให้กลับเป็นมนุษย์! ชอบรักษาระยะห่าง', hp: 40, spd: 8,
    pal: { h: '#d8d8d8', c: '#f4f4f4', b: '#3a8fd0', p: '#3a3a5a', g: '#7fe0ff' } },
  wrestler: { name: 'แชมป์มวยปล้ำ', desc: 'พุ่งชนและกระแทกพื้น ซอมบี้กระเด็นเป็นแถบ', hp: 75, spd: 8,
    pal: { h: '#c02020', c: '#d09060', b: '#f0c830', p: '#c02020', g: '' } },
  commander: { name: 'ผู้บัญชาการ', desc: 'เรียกหน่วย SWAT มาเสริมกำลังเป็นระยะ', hp: 45, spd: 6,
    pal: { h: '#5a1a1a', c: '#2f4f2f', b: '#f0d040', p: '#2a3a2a', g: '#2a2a2a' } },
};
const isBossLevel = (L) => L % 10 === 0;

// ---------- route map: after clearing a new level, pick which district to invade next ----
// count/armed/soldiers/dogs scale the population · blood/brains/bones/all scale rewards
const ROUTES = {
  normal: { name: 'ย่านทั่วไป', icon: 'house', desc: 'ไม่มีผลพิเศษ' },
  market: { name: 'ตลาดนัดกลางเมือง', icon: 'tent', desc: 'คนเยอะ x1.6 · เลือด x1.2', count: 1.6, blood: 1.2, from: 3 },
  rich: { name: 'หมู่บ้านไฮโซ', icon: 'crown', desc: 'คฤหาสน์ +2 หลัง · บอดี้การ์ดเพียบ · เลือด x1.5', mansions: 2, blood: 1.5, from: 4 },
  police: { name: 'ใกล้สถานีตำรวจ', icon: 'badge', desc: 'ตำรวจ/SWAT x2.5 · สมอง x2 · กระดูก x2', armed: 2.5, brains: 2, bones: 2, from: 5 },
  slum: { name: 'ชุมชนแออัด', icon: 'house', desc: 'ประตูผุ (HP x0.4) · ไม่มีคนถือปืน · คน x1.3 · เลือด x0.8', doorHp: 0.4, armed: 0, count: 1.3, blood: 0.8, from: 3 },
  temple: { name: 'งานวัดประจำปี', icon: 'temple', desc: 'คน x1.3 · หมาวัดเยอะ x3 · สมอง x1.5', count: 1.3, dogs: 3, brains: 1.5, from: 5 },
  army: { name: 'ค่ายทหาร', icon: 'helmet', desc: 'ทหารเยอะ x3 · กระดูก x3 · เลือด x1.3', soldiers: 3, bones: 3, blood: 1.3, from: 9 },
  river: { name: 'ริมเจ้าพระยา', icon: 'flood', desc: 'น้ำท่วมแน่นอน · รางวัลทั้งหมด x1.5', weather: 'flood', all: 1.5, from: 4 },
  quiet: { name: 'ชานเมืองเงียบสงบ', icon: 'quiet', desc: 'คนน้อย x0.6 · ไม่มีคนถือปืน · สมองตอนผ่านด่าน x2', count: 0.6, armed: 0, clear: 2, from: 3 },
};
const routeOf = (L) => ROUTES[S.routes[L]] || ROUTES.normal;
function rollRoutes(L) {
  const ids = Object.keys(ROUTES).filter((k) => k !== 'normal' && L >= ROUTES[k].from);
  const out = [];
  while (out.length < 3 && ids.length) out.push(ids.splice(Math.floor(Math.random() * ids.length), 1)[0]);
  return out;
}
// reward multiplier of the current district
const routeMul = (cur) => (G && G.route ? (G.route[cur] || 1) * (G.route.all || 1) : 1);

// ---------- random events mid-level --------------------------------------------
const EVENTS = {
  festival: { name: 'เทศกาลลอยกระทง', icon: 'lantern', desc: 'พลุแตกกลางเมือง! ผู้คนออกจากบ้านมาดูพลุ', dur: 20 },
  bloodmoon: { name: 'จันทร์สีเลือด', icon: 'moon', desc: 'ทุกการฆ่าได้เลือด x3', dur: 20 },
  concert: { name: 'คอนเสิร์ตหมอลำซิ่ง', icon: 'note', desc: 'ฝูงชนมาเต้นรวมกันกลางลาน — บุฟเฟต์ของซอมบี้!', dur: 30 },
  blackout: { name: 'ไฟดับทั้งเมือง', icon: 'bulb', desc: 'มนุษย์มองเห็นซอมบี้ได้แค่ระยะใกล้ในความมืด', dur: 20 },
  army: { name: 'ด่านตรวจทหาร', icon: 'helmet', desc: 'รถทหารนำกำลังเสริมมา · ทหารชุดนี้ให้รางวัล x3', dur: 6, from: 8 },
  airdrop: { name: 'เสบียงตกจากฟ้า', icon: 'crate', desc: 'ให้ซอมบี้ไปถึงกล่องก่อนคนถือปืน! (สมอง + กระดูก + พลังงานเต็ม)', dur: 30 },
};
const evOn = (k) => !!(G && G.ev && G.ev.k === k);

// ---------- upgrades -------------------------------------------------------
const UPG = [
  // เลือด
  { id: 'bloodCap', cur: 'blood', name: 'ถังเก็บเลือด', desc: 'เพิ่มความจุเลือดสูงสุด x1.8', base: 180, g: 1.8, show: (l) => `ความจุ ${fmt(F.bloodCap(l))}` },
  { id: 'bite', cur: 'blood', name: 'เขี้ยวอาบพิษ', desc: 'ซอมบี้กัดแรงขึ้น +25% · ทุก 10 เลเวลดาเมจ x2 (ทุบประตูแรงขึ้นด้วย)', base: 12, g: 1.22, show: (l) => `ดาเมจ ${fmt(F.zDmg(l))}` },
  { id: 'flesh', cur: 'blood', name: 'เนื้อหนังเหนียวหนึบ', desc: 'พลังชีวิตซอมบี้ +20% · ทุก 10 เลเวล HP x2', base: 18, g: 1.22, show: (l) => `HP ${fmt(F.zHp(l))}` },
  { id: 'legs', cur: 'blood', name: 'ขาวิ่งมาราธอน', desc: 'ซอมบี้เคลื่อนที่เร็วขึ้น +6%', base: 30, g: 1.6, max: 20, show: (l) => `ความเร็ว ${100 + 6 * l}%` },
  { id: 'decay', cur: 'blood', name: 'น้ำยาดองศพ', desc: 'ซอมบี้เน่าเปื่อยช้าลง อยู่ได้นานขึ้น (เน่าเป็น % ของ HP)', base: 45, g: 1.5, max: 25, show: (l) => `เน่า ${(F.decay(l) * 100).toFixed(2)}% HP/วิ` },
  { id: 'harvest', cur: 'blood', name: 'สูบเลือดสด', desc: 'ได้เลือดจากเหยื่อมากขึ้น +25%', base: 35, g: 1.3, show: (l) => `เลือด x${F.bloodMult(l).toFixed(2)}` },
  // สมอง
  { id: 'brainsCap', cur: 'brains', name: 'โถดองสมอง', desc: 'เพิ่มความจุสมองสูงสุด x1.8', base: 36, g: 1.8, show: (l) => `ความจุ ${fmt(F.brainsCap(l))}` },
  { id: 'energyMax', cur: 'brains', name: 'ขุมพลังมืด', desc: 'พลังงานสูงสุด +10', base: 4, g: 1.45, show: (l) => `พลังงาน ${F.eMax(l)}` },
  { id: 'energyRegen', cur: 'brains', name: 'สมาธิแห่งความตาย', desc: 'พลังงานฟื้นฟูเร็วขึ้น +20%', base: 4, g: 1.45, show: (l) => `${F.eRegen(l).toFixed(1)}/วิ` },
  { id: 'thrift', cur: 'brains', name: 'พิธีกรรมประหยัด', desc: 'ใช้พลังงานวางซอมบี้น้อยลง −6%', base: 10, g: 1.75, max: 15, show: (l) => `ใช้ ${F.zCost(l).toFixed(1)} พลังงาน` },
  { id: 'infect', cur: 'brains', name: 'ไวรัสกลายพันธุ์', desc: 'ศพลุกขึ้นเป็นซอมบี้เร็วขึ้น', base: 8, g: 1.7, max: 15, show: (l) => `ลุกใน ${F.infectT(l).toFixed(2)} วิ` },
  { id: 'brainGain', cur: 'brains', name: 'ปัญญาอันดำมืด', desc: 'ได้สมองมากขึ้น +25%', base: 12, g: 1.45, show: (l) => `สมอง x${F.brainMult(l).toFixed(2)}` },
  { id: 'auto', cur: 'brains', name: 'เจตจำนงแห่งความตาย', desc: 'วางซอมบี้ใกล้มนุษย์ให้อัตโนมัติเมื่อพลังงานเต็ม (โหมดไอเดิล)', base: 25, g: 1, max: 1, show: (l) => (l ? 'ทำงานอยู่' : 'ยังไม่มี') },
  { id: 'autoCast', cur: 'brains', name: 'คัมภีร์ต้องห้าม', desc: 'ร่ายเวทมนตร์ที่ปลดล็อกแล้วให้อัตโนมัติเมื่อพร้อม', base: 300, g: 1, max: 1, show: (l) => (l ? 'ทำงานอยู่' : 'ยังไม่มี') },
  // กระดูก
  { id: 'bonesCap', cur: 'bones', name: 'โกดังกระดูก', desc: 'เพิ่มความจุกระดูกสูงสุด x1.8', base: 36, g: 1.8, show: (l) => `ความจุ ${fmt(F.bonesCap(l))}` },
  { id: 'graveyard', cur: 'bones', name: 'ขยายสุสาน', desc: 'โครงกระดูกนักรบ +1 ตัว ลุกจากสุสานทุกด่าน ไม่เน่า และฟื้นคืนเองได้', base: 8, g: 1.6, max: 30, show: (l) => `${l} ตัว` },
  { id: 'skelPower', cur: 'bones', name: 'กระดูกเหล็กกล้า', desc: 'HP และดาเมจโครงกระดูก +30% · ทุก 10 เลเวล x2', base: 12, g: 1.2, show: (l) => `HP ${fmt(F.skelHp(l))} · ดาเมจ ${fmt(F.skelDmg(l))}` },
  { id: 'crypt', cur: 'bones', name: 'พิธีปลุกวิญญาณ', desc: 'โครงกระดูกฟื้นคืนชีพเร็วขึ้น', base: 15, g: 1.6, max: 15, show: (l) => `ฟื้นใน ${F.skelRespawn(l).toFixed(1)} วิ` },
  { id: 'boneGain', cur: 'bones', name: 'นักสะสมกระดูก', desc: 'ได้กระดูกมากขึ้น +25%', base: 10, g: 1.4, show: (l) => `กระดูก x${F.boneMult(l).toFixed(2)}` },
  // สายพันธุ์ซอมบี้ (level 1 = unlock)
  { id: 'spit', tab: 'strains', cur: 'brains', icon: 'spit', name: 'ซอมบี้ถ่มกรด', desc: 'ยิงกรดใส่มนุษย์จากระยะไกล 40 · กรดกระเซ็นโดนคนข้างๆ และทำให้เดินช้าลง 45% · เหยื่อที่ตายเพราะกรดลุกเป็นซอมบี้ · ใช้พลังงาน x1.3', base: 60, g: 1.7, max: 25,
    show: (l) => (l ? `HP ${fmt(F.zHp() * 0.7 * (1 + 0.2 * (l - 1)))} · กรด ${fmt(F.zDmg() * (1 + 0.2 * (l - 1)))}` : 'ยังไม่ปลดล็อก') },
  { id: 'bomb', tab: 'strains', cur: 'brains', icon: 'bomb', name: 'ซอมบี้บึ้มพลีชีพ', desc: 'ซอมบี้อ้วนพองหนอง วิ่งไปหาประตูที่มีคนหลบหรือกลุ่มคน แล้วบวมเป่งจนแตกระเบิด พังประตูได้ในทีเดียว (โดนยิงตายก็ระเบิด) · ใช้พลังงาน x2.5', base: 90, g: 1.7, max: 25,
    show: (l) => (l ? `แรงระเบิด ${fmt(F.zDmg() * 4 * (1 + 0.25 * (l - 1)))}` : 'ยังไม่ปลดล็อก') },
  { id: 'tank', tab: 'strains', cur: 'bones', icon: 'tank', name: 'ซอมบี้ถังเลือด', desc: 'อ้วนเลือดหนา เดินช้า คนถือปืนจะหันมายิงตัวนี้ก่อน (ล่อเป้า) · ใช้พลังงาน x2.5', base: 40, g: 1.7, max: 25,
    show: (l) => (l ? `HP ${fmt(F.zHp() * 4 * (1 + 0.25 * (l - 1)))}` : 'ยังไม่ปลดล็อก') },
];
// permanent upgrades bought with soul essence (kept through prestige)
const PUP = [
  { id: 'pGain', store: 'prestige', cur: 'souls', name: 'พลังวิญญาณ', desc: 'เลือด สมอง กระดูก ที่ได้ +25%', base: 1, g: 1.6, show: (l) => `x${(1 + 0.25 * l).toFixed(2)}` },
  { id: 'pZombie', store: 'prestige', cur: 'souls', name: 'ต้นแบบอมตะ', desc: 'HP และดาเมจซอมบี้ทุกสายพันธุ์ x1.2 (คูณทบต้นทุกเลเวล)', base: 1, g: 1.6, show: (l) => `x${fmt(Math.pow(1.2, l))}` },
  { id: 'pEnergy', store: 'prestige', cur: 'souls', name: 'พลังงานต้นกำเนิด', desc: 'พลังงานสูงสุดและการฟื้นฟู +15%', base: 1, g: 1.6, show: (l) => `x${(1 + 0.15 * l).toFixed(2)}` },
  { id: 'pCap', store: 'prestige', cur: 'souls', name: 'คลังนิรันดร์', desc: 'ความจุเลือด สมอง กระดูก +50%', base: 2, g: 1.7, show: (l) => `x${(1 + 0.5 * l).toFixed(1)}` },
  { id: 'pSkel', store: 'prestige', cur: 'souls', name: 'สุสานโบราณ', desc: 'โครงกระดูกฟรี +2 ตัวทุกด่าน', base: 2, g: 1.7, max: 10, show: (l) => `+${2 * l} ตัว` },
  { id: 'pStart', store: 'prestige', cur: 'souls', name: 'ความทรงจำแห่งความตาย', desc: 'หลังเกิดใหม่เริ่มที่ด่านสูงขึ้น +3 (ไม่เกินครึ่งของด่านที่ไปถึง)', base: 3, g: 1.8, max: 10, show: (l) => `เริ่มด่าน ${1 + 3 * l}` },
  { id: 'pKeep', store: 'prestige', cur: 'souls', name: 'เจตจำนงนิรันดร์', desc: 'เก็บ "วางอัตโนมัติ" และ "ร่ายเวทอัตโนมัติ" ไว้หลังเกิดใหม่', base: 5, g: 1, max: 1, show: (l) => (l ? 'ทำงานอยู่' : 'ยังไม่มี') },
  { id: 'pSouls', store: 'prestige', cur: 'souls', name: 'เก็บเกี่ยววิญญาณ', desc: 'ได้แก่นวิญญาณจากการเกิดใหม่ +20%', base: 4, g: 2, max: 20, show: (l) => `x${(1 + 0.2 * l).toFixed(1)}` },
];
const SPELLS = [
  // frenzy's cooldown only starts ticking once the rage wears off, so it can never be permanent
  { id: 'frenzy', store: 'spells', cur: 'brains', icon: 'frenzy', key: '1', name: 'คลั่งเลือด', desc: 'ซอมบี้ทุกตัวเร็วขึ้นและกัดถี่ขึ้น x1.6 · คูลดาวน์เริ่มนับหลังหมดฤทธิ์', base: 15, g: 1.9, max: 15,
    cd: (l) => 50 * Math.pow(0.95, l - 1), dur: (l) => 5 + l,
    show: (l) => `นาน ${5 + Math.max(1, l)} วิ · คูลดาวน์ ${Math.round(50 * Math.pow(0.95, Math.max(1, l) - 1))} วิ` },
  { id: 'plague', store: 'spells', cur: 'brains', icon: 'plague', key: '2', name: 'หมอกโรคระบาด', desc: 'คลิกเลือกจุดบนแผนที่ มนุษย์ในรัศมีติดเชื้อทันที (คนที่หลบอยู่ในบ้านไม่ติด)', base: 40, g: 1.9, max: 15,
    cd: (l) => 70 * Math.pow(0.93, l - 1), rad: (l) => 16 + 3 * l,
    show: (l) => `รัศมี ${16 + 3 * Math.max(1, l)} · คูลดาวน์ ${Math.round(70 * Math.pow(0.93, Math.max(1, l) - 1))} วิ` },
  { id: 'raise', store: 'spells', cur: 'brains', icon: 'raise', key: '3', name: 'ปลุกฝูงศพ', desc: 'เรียกซอมบี้ฟรีขึ้นจากใต้ดินรอบๆ มนุษย์', base: 80, g: 1.9, max: 15,
    cd: (l) => 80 * Math.pow(0.93, l - 1), n: (l) => 2 + 2 * l,
    show: (l) => `${2 + 2 * Math.max(1, l)} ตัว · คูลดาวน์ ${Math.round(80 * Math.pow(0.93, Math.max(1, l) - 1))} วิ` },
];
const DEF = {};
for (const d of [...UPG, ...SPELLS, ...PUP]) DEF[d.id] = d;
const SPELL = {};
for (const s of SPELLS) SPELL[s.id] = s;
const tabOf = (d) => d.tab || (d.store === 'spells' ? 'spells' : d.store === 'prestige' ? 'prestige' : d.cur);
const unlockType = (d) => d.store === 'spells' || d.tab === 'strains';

const lvlOf = (d) => (d.store === 'spells' ? S.spells[d.id] : d.store === 'prestige' ? P(d.id) : U(d.id)) || 0;
const setLvl = (d, l) => { if (d.store === 'spells') S.spells[d.id] = l; else if (d.store === 'prestige') S.prestige.up[d.id] = l; else S.up[d.id] = l; };
const costAt = (d, l) => d.base * Math.pow(d.g, l);
function buyPlan(d) {
  const l = lvlOf(d);
  const room = d.max ? d.max - l : Infinity;
  if (room <= 0) return { n: 0, cost: 0, maxed: true };
  const mode = S.settings.buyMode, money = have(d.cur);
  if (mode === 'max') {
    let n = 0, c = 0;
    while (n < room && n < 500) {
      const nc = costAt(d, l + n);
      if (c + nc > money) break;
      c += nc; n++;
    }
    if (n === 0) return { n: 1, cost: costAt(d, l) };
    return { n, cost: c };
  }
  const n = Math.min(mode, room);
  let c = 0;
  for (let i = 0; i < n; i++) c += costAt(d, l + i);
  return { n, cost: c };
}

// ---------- palettes -------------------------------------------------------
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const HAIR = ['#2b1b0e', '#5a3825', '#d8b24c', '#1a1a1a', '#8a4b2a', '#b8b8b8', '#b0402b'];
const SHIRT = ['#d94c4c', '#4c7bd9', '#e0c341', '#6bbf59', '#b25fc9', '#e08a3c', '#e6e6e6', '#3cb6b0', '#f28cb1'];
const PANTS = ['#2e3a59', '#3b3b3b', '#5b4632', '#1f4f7a', '#6b6b6b'];
const ZSKIN = ['#7fa35a', '#6d9150', '#93b36b', '#7a9a74'];
const RAGS = ['#6b5a4a', '#4a5a6b', '#5a4a5a', '#7a6a3a', '#5c3a3a', '#48524a'];
function palFor(kind) {
  const s = pick(SKIN);
  switch (kind) {
    case 'police': return { h: '#1c2a5c', s, c: '#2f4fa8', b: '#ffd84a', p: '#1c2a5c' };
    case 'swat': return { h: '#15171d', s, c: '#23283a', b: '#3b4458', p: '#1a1d26' };
    case 'soldier': return { h: '#4b5a2a', s, c: '#5d6b33', b: '#424d25', p: '#3f4a24' };
    case 'brute': { const c = pick(['#f2f2f2', '#d94c4c', '#1e1e1e', '#f0c830']); return { h: pick(HAIR), s: pick(['#e0ac69', '#c68642', '#b8743a']), c, b: c, p: pick(['#2e3a59', '#3b3b3b', '#7a1f1f']) }; }
    case 'guard': return { h: '#141414', s: pick(['#e0ac69', '#c68642', '#b8743a']), c: '#18181e', b: '#18181e', p: '#141418' };
    case 'rich': { const c = pick(['#8a2a6a', '#d4a020', '#f4f0e8', '#2a2a6a', '#b01830']); return { h: pick(['#1a1a1a', '#d8b24c', '#b8b8b8']), s, c, b: '#f0d040', p: pick(['#1a1a1a', '#f4f0e8']) }; }
    case 'dog': { const c = pick(['#8a5a2a', '#2a2a2a', '#e8e0d0', '#d8a040', '#b87a3a']); return { h: c, s: c, c, b: shade(c, 40), p: c }; }
    default: { const c = pick(SHIRT); return { h: pick(HAIR), s, c, b: c, p: pick(PANTS) }; }
  }
}
function zombiePal() { const c = pick(RAGS); return { h: shade(pick(HAIR), -20), s: pick(ZSKIN), c, b: shade(c, -15), p: pick(PANTS) }; }

// ---------- map themes: Bangkok districts (cycle every 10 levels) ------------
const THEMES = [
  { name: 'สุขุมวิท', grass: ['#4f8a3a', '#57943f', '#488034'], speck: ['#f0e060', '#ff8ab0', '#ffffff'],
    road: '#56575d', walk: '#b0aca4', line: '#f0c430', dirt: '#4a3a2a',
    styles: { shop: 4, condo: 3, house: 2, seven: 1 }, bts: true, wires: true, grave: 'thai',
    walls: ['#e8dcc4', '#d4e4dc', '#f0d8c8', '#dcd4e8', '#f4e4b0', '#c8dce8', '#f4c8b8'],
    roofs: ['#b8502a', '#8a3a2a', '#3f5b7d', '#5a6a4a'], tree: ['#2f7a2a', '#3d8c33', '#4ca040'], trunk: '#5a3a20' },
  { name: 'เยาวราช', grass: ['#5a7a3a', '#62843f', '#527034'], speck: ['#f0c030', '#e03030', '#ffffff'],
    road: '#4c4c52', walk: '#a09488', line: '#f0c430', dirt: '#3e3024',
    styles: { shop: 8, house: 1, temple: 1, seven: 1 }, lanterns: true, neon: true, wires: true, grave: 'chinese', shrine: true,
    walls: ['#c83a2a', '#e8c860', '#e8dcc8', '#b8302a', '#f0e0c0', '#d8a040', '#a8d0c0'],
    roofs: ['#9a2a1a', '#6a3a2a', '#8a6a3a'], tree: ['#2f6a2a', '#3a7a33'], trunk: '#4a3020' },
  { name: 'เกาะรัตนโกสินทร์', grass: ['#5a943f', '#62a044', '#528a3a'], speck: ['#fff4b0', '#ffffff', '#f0a0c0'],
    road: '#5c5a58', walk: '#c8c0b0', line: '#f0c430', dirt: '#5a4a34',
    styles: { temple: 3, house: 3, shop: 2, seven: 1 }, palm: true, grave: 'thai',
    walls: ['#f4efe4', '#e8dcc0', '#f0e4c8', '#d8c8a8', '#e4e8d8'],
    roofs: ['#c8502a', '#b8402a', '#2a6a4a'], tree: ['#2a7a2a', '#3a8a30', '#48a03c'], trunk: '#6a4a28' },
  { name: 'สีลมยามค่ำคืน', grass: ['#243a2c', '#284030', '#203426'], speck: ['#3a5a44', '#f0e060', '#ff5ab0'],
    road: '#2a2a32', walk: '#4c4c56', line: '#b09a30', dirt: '#1e1814', night: true,
    styles: { condo: 4, shop: 4, house: 1, seven: 1 }, bts: true, neon: true, wires: true, grave: 'thai',
    walls: ['#4a4458', '#3e4a5a', '#5a4a48', '#44505a', '#504058'], roofs: ['#2a2030', '#1e2a38', '#302420'],
    tree: ['#1a3322', '#20402a'], trunk: '#20160e' },
  { name: 'ริมคลองฝั่งธน', grass: ['#3f7a34', '#468438', '#39702f'], speck: ['#f0e060', '#ffffff', '#c0e070'],
    road: '#6a625a', walk: '#a89a84', line: '#e0c040', dirt: '#4a3a28',
    styles: { wood: 5, house: 2, temple: 1, seven: 1 }, palm: true, canal: true, grave: 'thai',
    walls: ['#e8dcc4', '#d8c8a8', '#c8d8c0'], roofs: ['#9aa0a4', '#8a9094', '#b85a2a'], tree: ['#2a6a26', '#357a2e', '#42902f'], trunk: '#5a3a20' },
];
const themeOf = (L) => THEMES[Math.floor((L - 1) / 10) % THEMES.length];
const FLOORS = ['#8a6a48', '#a07c52', '#7a5a3e', '#b0a090', '#9a8a70', '#6e5a4a'];
const RUGS = ['#8a2a2a', '#2a4a7a', '#3a6a3a', '#7a5a2a', '#5a2a6a'];
// building footprint ranges per style: [minW, maxW, minH, maxH]
const BSIZE = { house: [26, 40, 24, 32], wood: [26, 40, 24, 30], shop: [34, 58, 28, 34], condo: [36, 50, 32, 40], temple: [44, 58, 34, 42], seven: [26, 32, 26, 28] };

// ---------- map generation -------------------------------------------------
// A building is a walled room: back wall (top, 6px face), 2px side walls,
// 2px front wall with a door gap. The floor inside is walkable. The roof +
// facade live on a separate layer that fades out to show the interior.
// Overhead things (BTS viaduct, electric wires, lanterns) go on a 'top' layer
// drawn above everybody.
let MAP = null;
function genMap(L, RT = ROUTES.normal) {
  const ws = worldSize(L);
  WW = ws.w; WH = ws.h;
  const r = mulberry32(L * 7919 + 1301);
  const R = (a, b) => a + r() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const RP = (a) => a[Math.floor(r() * a.length)];
  const th = themeOf(L);
  const bg = Pix.mk(WW, WH), g = bg.getContext('2d');
  const roof = Pix.mk(WW, WH), rg = roof.getContext('2d');
  const top = Pix.mk(WW, WH), tg = top.getContext('2d');
  let hasTop = false;
  const rect = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  // ---- ground: grass noise written straight into a pixel buffer (one upload instead of ~100k draw calls) ----
  {
    const rgb = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const base = rgb(th.grass[0]), gc = th.grass.map(rgb), sc = th.speck.map(rgb);
    const specks = (140 * ws.k * ws.k) / (WW * WH);
    const img = g.createImageData(WW, WH), d = img.data;
    for (let i = 0, j = 0; i < WW * WH; i++, j += 4) {
      const x = r();
      const c = x < 0.13 ? gc[(x * 997) % gc.length | 0] : x < 0.13 + specks ? sc[(x * 7919) % sc.length | 0] : base;
      d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  if (th.canal) { // khlong along the top edge (a strip nobody can walk on anyway)
    rect(g, '#3a6e78', 0, 0, WW, 10);
    for (let i = 0; i < WW * 0.6; i++) rect(g, RP(['#4a8490', '#2e5e68', '#5a98a4']), RI(0, WW - 1), RI(1, 8), RI(1, 3), 1);
    rect(g, '#6a5236', 0, 10, WW, 2);
    for (let x = RI(0, 8); x < WW; x += RI(10, 18)) rect(g, '#4a3624', x, 8, 1, 4);
    for (let i = 0; i < Math.max(1, Math.round(WW / 160)); i++) { // long-tail boats
      const bx = RI(10, WW - 30);
      rect(g, '#5a3a1e', bx, 3, 16, 3); rect(g, '#7a5230', bx + 1, 3, 14, 1); rect(g, '#c83a2a', bx + 13, 2, 3, 1); rect(g, '#e8c040', bx + 3, 4, 1, 1);
    }
  }

  // ---- roads ----
  const RW = 12, HW = RW / 2;
  const nx = Math.round(WW / 140) + RI(0, 1), ny = Math.max(2, Math.round(WH / 115));
  const xs = [], ys = [];
  for (let i = 0; i < nx; i++) xs.push(Math.round(((i + 1) * WW) / (nx + 1) + R(-14, 14)));
  for (let i = 0; i < ny; i++) ys.push(Math.round(((i + 1) * WH) / (ny + 1) + R(-10, 10)));
  for (const y of ys) rect(g, th.walk, 0, y - HW - 2, WW, RW + 4);
  for (const x of xs) rect(g, th.walk, x - HW - 2, 0, RW + 4, WH);
  // sidewalk tiles
  g.fillStyle = shade(th.walk, -14);
  for (const y of ys) for (let x = 0; x < WW; x += 4) { g.fillRect(x, y - HW - 2, 1, 2); g.fillRect(x + 2, y + HW, 1, 2); }
  for (const y of ys) rect(g, th.road, 0, y - HW, WW, RW);
  for (const x of xs) rect(g, th.road, x - HW, 0, RW, WH);
  for (let i = 0; i < WW * WH * 0.004; i++) { // asphalt texture
    const x = RI(0, WW - 1), y = RI(0, WH - 1);
    if (ys.some((v) => Math.abs(v - y) < HW) || xs.some((v) => Math.abs(v - x) < HW)) rect(g, shade(th.road, RP([-10, 10])), x, y, 1, 1);
  }
  g.fillStyle = th.line;
  for (const y of ys) for (let x = 0; x < WW; x += 8) if (!xs.some((v) => Math.abs(v - x - 2) < HW + 9)) g.fillRect(x, y, 4, 1);
  for (const x of xs) for (let y = 0; y < WH; y += 8) if (!ys.some((v) => Math.abs(v - y - 2) < HW + 9)) g.fillRect(x, y, 1, 4);
  // zebra crossings beside every junction
  g.fillStyle = '#e4e4e0';
  for (const x of xs) for (const y of ys) {
    for (let yy = y - HW + 1; yy < y + HW; yy += 2) { g.fillRect(x - HW - 7, yy, 4, 1); g.fillRect(x + HW + 3, yy, 4, 1); }
    for (let xx = x - HW + 1; xx < x + HW; xx += 2) { g.fillRect(xx, y - HW - 7, 1, 4); g.fillRect(xx, y + HW + 3, 1, 4); }
  }

  // ---- BTS skytrain viaduct over the middle horizontal road ----
  let bts = null;
  if (th.bts) {
    const by = ys[Math.floor((ys.length - 1) / 2)], bt = by - 17;
    rect(g, 'rgba(0,0,0,.2)', 0, by - 3, WW, 7); // shade under the viaduct
    for (let x = 22; x < WW; x += 44) {
      if (xs.some((v) => Math.abs(v - x) < HW + 5)) continue;
      rect(g, '#6a6c70', x - 2, by - 1, 5, 2);
      rect(tg, '#8a8c90', x - 1, bt + 9, 3, by - bt - 8); rect(tg, '#a8aaae', x - 1, bt + 9, 1, by - bt - 8);
    }
    rect(tg, '#b8babe', 0, bt, WW, 5); rect(tg, '#d8dade', 0, bt, WW, 1);
    rect(tg, '#8a8c92', 0, bt + 5, WW, 3); rect(tg, '#62646a', 0, bt + 8, WW, 1);
    rect(tg, '#5a5c62', 0, bt + 1, WW, 1); rect(tg, '#5a5c62', 0, bt + 3, WW, 1);
    for (let x = 0; x < WW; x += 6) rect(tg, '#9a9ca0', x, bt + 5, 1, 3);
    bts = { y: bt };
    hasTop = true;
  }

  // ---- parked vehicles: pink / green-yellow taxis, tuk-tuks, city buses ----
  const vehicle = (x, y) => {
    const t = r();
    rect(g, 'rgba(0,0,0,.3)', x + 1, y + 1, t < 0.15 ? 23 : 12, 5);
    if (t < 0.15) { // BMTA bus
      rect(g, '#c83030', x, y - 1, 23, 5); rect(g, '#f0e4c8', x, y - 1, 23, 2);
      for (let i = 2; i < 21; i += 3) rect(g, '#2a3a4a', x + i, y, 2, 1);
      rect(g, '#111', x + 3, y + 4, 3, 1); rect(g, '#111', x + 17, y + 4, 3, 1);
    } else if (t < 0.45) { // tuk-tuk
      const c = RP(['#1a5ab0', '#2a9a4a', '#d03030']);
      rect(g, shade(c, -40), x + 1, y - 1, 6, 2); rect(g, c, x, y + 1, 8, 3); rect(g, '#e8c040', x + 6, y + 1, 2, 1);
      rect(g, '#111', x + 1, y + 4, 2, 1); rect(g, '#111', x + 6, y + 4, 1, 1);
    } else { // taxi
      const pink = r() < 0.55;
      rect(g, pink ? '#ff5aa0' : '#2aa84a', x, y, 11, 4);
      if (!pink) rect(g, '#f0d020', x, y + 2, 11, 2);
      rect(g, '#223344', x + 3, y + 1, 5, 2); rect(g, '#ffffff', x + 4, y, 3, 1);
      rect(g, '#111', x + 1, y + 4, 2, 1); rect(g, '#111', x + 8, y + 4, 2, 1);
    }
  };
  for (const y of ys) {
    const n = RI(1, 3) * Math.ceil(ws.k);
    for (let k = 0; k < n; k++) {
      const x = RI(10, WW - 26);
      if (xs.some((v) => Math.abs(v - x - 8) < HW + 16)) continue;
      vehicle(x, r() < 0.5 ? y - HW + 1 : y + 1);
    }
  }

  // ---- city blocks ----
  const bxs = [0, ...xs, WW], bys = [0, ...ys, WH];
  const blocks = [];
  for (let i = 0; i < bxs.length - 1; i++) {
    for (let j = 0; j < bys.length - 1; j++) {
      const x0 = i === 0 ? 0 : bxs[i] + HW + 3, x1 = i === bxs.length - 2 ? WW : bxs[i + 1] - HW - 3;
      const y0 = j === 0 ? (th.canal ? 12 : 0) : bys[j] + HW + 3, y1 = j === bys.length - 2 ? WH : bys[j + 1] - HW - 3;
      blocks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, i, j, edgeL: i === 0, edgeR: i === bxs.length - 2, edgeT: j === 0, edgeB: j === bys.length - 2 });
    }
  }
  const over = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
  const topPad = (bk) => bk.y + (bk.edgeT ? 22 : 8);
  const botPad = (bk) => bk.y + bk.h - (bk.edgeB ? 12 : 8);
  const used = new Set(), reserved = [], bld = [], parks = [];

  // mansions: a whole block becomes a walled estate (from level 3)
  const nMansion = L >= 3 ? (ws.k >= 1.5 ? 2 : 1) + (RT.mansions || 0) : 0;
  const mCands = blocks.filter((bk) => bk.w >= 70 && botPad(bk) - topPad(bk) >= 42);
  for (let i = 0; i < nMansion && mCands.length; i++) {
    const bk = mCands.splice(Math.floor(r() * mCands.length), 1)[0];
    const mw = Math.min(RI(58, 70), bk.w - 14), mh = Math.min(RI(38, 46), botPad(bk) - topPad(bk) - 12);
    if (mh < 30) continue;
    bld.push({ x: bk.x + Math.round((bk.w - mw) / 2), y: topPad(bk), w: mw, h: mh, style: 'mansion', estate: bk });
    used.add(bk);
  }

  // graveyard: a new spot every level
  const GW = 46, GH = 30;
  let grave;
  const gCands = blocks.filter((bk) => !used.has(bk) && bk.w >= GW + 18 && botPad(bk) - topPad(bk) >= GH + 14);
  if (gCands.length) {
    const bk = RP(gCands), y0 = topPad(bk) + 2, y1 = botPad(bk) - GH - 10;
    grave = { x: bk.x + RI(9, bk.w - GW - 9), y: RI(y0, Math.max(y0, y1)), w: GW, h: GH };
  } else grave = { x: 8, y: 18, w: Math.min(GW, xs[0] - HW - 16), h: Math.min(GH, ys[0] - HW - 28) };
  reserved.push({ x: grave.x - 4, y: grave.y - 6, w: grave.w + 8, h: grave.h + 14 });

  // regular buildings, style picked by the district's mix
  const lim = { seven: ws.k >= 1.5 ? 2 : 1, temple: th.styles.temple >= 3 ? 2 + Math.floor(ws.k) : 1 };
  const count = {};
  const pickStyle = () => {
    const opts = Object.entries(th.styles).filter(([s]) => !(lim[s] && (count[s] || 0) >= lim[s]));
    let x = r() * opts.reduce((a, [, w]) => a + w, 0);
    for (const [s, w] of opts) if ((x -= w) < 0) return s;
    return 'house';
  };
  for (const bk of blocks) {
    if (used.has(bk)) continue;
    if (r() < 0.14) { parks.push(bk); continue; }
    let cnt = 0;
    for (let t = 0; t < 28 && cnt < 3; t++) {
      const style = t > 16 ? 'house' : pickStyle();
      const [w0, w1, h0, h1] = BSIZE[style];
      const bw = RI(w0, w1), bh = RI(h0, h1);
      const minX = bk.x + (bk.edgeL ? 10 : 6), maxX = bk.x + bk.w - bw - (bk.edgeR ? 10 : 6);
      const minY = topPad(bk) - (bk.edgeT ? 0 : 1), maxY = botPad(bk) - bh;
      if (maxX < minX || maxY < minY) continue;
      const rc = { x: RI(minX, maxX), y: RI(minY, maxY), w: bw, h: bh, style };
      if (bld.some((b) => over(b, rc, 11)) || reserved.some((b) => over(b, rc, 4))) continue;
      bld.push(rc); cnt++;
      count[style] = (count[style] || 0) + 1;
    }
  }

  const onRoad = (x, y) => xs.some((v) => Math.abs(v - x) < HW + 5) || ys.some((v) => Math.abs(v - y) < HW + 5);
  const doorZone = (b) => ({ x: b.x + b.w / 2 - 8, y: b.y + b.h, w: 16, h: 13 });
  const clearSpot = (box, m = 1) => !bld.some((b) => over(b, box, m) || over(doorZone(b), box, 0)) && !reserved.some((b) => over(b, box, 0));

  // ---- mansion estates: striped lawn, hedges, fountain, pool, car ----
  for (const b of bld) {
    if (b.style !== 'mansion') continue;
    const e = b.estate, ex = e.x + 3, ey = Math.max(e.y + 3, 13), ew = e.w - 6, eh = e.y + e.h - 3 - ey;
    for (let x = ex; x < ex + ew; x += 4) rect(g, (x / 4) % 2 ? '#4f9a3c' : '#5aa844', x, ey, 2, eh);
    const gateX = b.x + Math.floor(b.w / 2) - 7;
    const hedge = (x, y, w, h) => { rect(g, '#1f4a1a', x, y + 1, w, h); rect(g, '#2f6a26', x, y, w, h); rect(g, '#3f8a30', x, y, w, 1); };
    hedge(ex, ey, ew, 2); hedge(ex, ey, 2, eh); hedge(ex + ew - 2, ey, 2, eh);
    hedge(ex, ey + eh - 2, gateX - ex, 2); hedge(gateX + 14, ey + eh - 2, ex + ew - gateX - 14, 2);
    rect(g, '#d8b040', gateX - 1, ey + eh - 4, 2, 4); rect(g, '#d8b040', gateX + 13, ey + eh - 4, 2, 4); // gate posts
    rect(g, '#c8bca4', gateX + 3, b.y + b.h + 1, 8, ey + eh - (b.y + b.h + 1)); // driveway
    const fy = b.y + b.h + 5, fx = b.x + 8;
    if (fy + 8 < ey + eh - 3) { // fountain
      rect(g, '#bab4a8', fx - 4, fy, 9, 6); rect(g, '#5ab0e0', fx - 3, fy + 1, 7, 4); rect(g, '#d8f0ff', fx, fy + 1, 1, 3); rect(g, '#ffffff', fx - 1, fy + 2, 3, 1);
    }
    const px0 = b.x + b.w - 20, py0 = b.y + b.h + 4;
    if (py0 + 8 < ey + eh - 3 && px0 > gateX + 16) { // pool
      rect(g, '#f0f0ea', px0 - 1, py0 - 1, 16, 9); rect(g, '#3aa0e0', px0, py0, 14, 7);
      for (let i = 0; i < 6; i++) rect(g, '#9ad8ff', px0 + RI(1, 12), py0 + RI(1, 5), 2, 1);
    }
    for (const lx of [ex + 6, ex + ew - 7]) { rect(g, '#2a2a2a', lx, ey + eh - 10, 1, 5); rect(g, '#ffe890', lx - 1, ey + eh - 11, 3, 1); }
    reserved.push({ x: ex, y: ey, w: ew, h: eh }); // keep trees and carts out of the estate
  }

  // ---- graveyard (style follows the district) ----
  {
    const gr = grave, st = th.grave;
    rect(g, th.dirt, gr.x, gr.y, gr.w, gr.h);
    for (let i = 0; i < gr.w * gr.h * 0.25; i++) rect(g, r() < 0.5 ? shade(th.dirt, 12) : shade(th.dirt, -12), gr.x + RI(0, gr.w - 1), gr.y + RI(0, gr.h - 1), 1, 1);
    const wallC = st === 'chinese' ? '#8a3a2a' : '#e8e2d6', wallD = st === 'chinese' ? '#5a2218' : '#b8b0a0';
    rect(g, wallD, gr.x - 2, gr.y - 3, gr.w + 4, 3); rect(g, wallC, gr.x - 2, gr.y - 4, gr.w + 4, 2);
    rect(g, wallD, gr.x - 2, gr.y - 3, 2, gr.h + 6); rect(g, wallD, gr.x + gr.w, gr.y - 3, 2, gr.h + 6);
    rect(g, wallC, gr.x - 2, gr.y + gr.h, gr.w + 4, 2);
    rect(g, th.dirt, gr.x + ((gr.w / 2) | 0) - 4, gr.y + gr.h - 1, 8, 4); // gate
    rect(g, '#d8b040', gr.x + ((gr.w / 2) | 0) - 5, gr.y + gr.h - 1, 1, 3); rect(g, '#d8b040', gr.x + ((gr.w / 2) | 0) + 4, gr.y + gr.h - 1, 1, 3);
    const meru = st === 'thai';
    if (meru) { // small crematorium (เมรุ) with a chimney
      const mx = gr.x + gr.w - 13, my = gr.y + 3;
      rect(g, 'rgba(0,0,0,.25)', mx + 1, my + 9, 11, 2);
      rect(g, '#f2eee4', mx, my + 3, 10, 7); rect(g, '#c8502a', mx - 1, my + 1, 12, 3); rect(g, '#2a6a3a', mx - 1, my + 3, 12, 1);
      rect(g, '#e0b030', mx + 4, my - 1, 2, 2); rect(g, '#5a4a3a', mx + 3, my + 6, 4, 4);
      rect(g, '#8a8a8a', mx + 8, my - 5, 2, 6); rect(g, '#5a5a5a', mx + 8, my - 5, 2, 1);
    }
    for (let yy = gr.y + 3; yy < gr.y + gr.h - 9; yy += 11) {
      for (let xx = gr.x + 4; xx < gr.x + gr.w - (meru ? 18 : 6); xx += 9) {
        rect(g, shade(th.dirt, -22), xx - 1, yy + 6, 7, 3);
        if (st === 'chinese') { // horseshoe mound tomb
          rect(g, '#8e8e86', xx - 1, yy + 1, 7, 5); rect(g, '#a8a89e', xx, yy + 1, 5, 1); rect(g, shade(th.dirt, 8), xx + 1, yy + 3, 3, 3);
          rect(g, '#5a5a54', xx + 2, yy + 2, 1, 3); rect(g, '#c03020', xx + 2, yy + 2, 1, 1);
        } else if (st === 'thai') { // little white chedi
          rect(g, '#f0ece4', xx, yy + 4, 5, 2); rect(g, '#f0ece4', xx + 1, yy + 2, 3, 2); rect(g, '#f0ece4', xx + 2, yy, 1, 2);
          rect(g, '#c8c0b0', xx + 4, yy + 4, 1, 2); rect(g, '#e0b030', xx + 2, yy - 1, 1, 1); rect(g, '#f0a020', xx + 1, yy + 5, 1, 1);
        } else {
          rect(g, '#8e8e96', xx, yy + 1, 5, 6); rect(g, '#8e8e96', xx + 1, yy, 3, 1); rect(g, '#5e5e66', xx + 4, yy + 1, 1, 6);
        }
      }
    }
  }

  // ---- trees: rain trees, palms, bananas ----
  const tree = (x, y) => {
    const kind = th.palm ? (r() < 0.5 ? 'palm' : 'rain') : r() < 0.72 ? 'rain' : 'banana';
    rect(g, 'rgba(0,0,0,.22)', x - 3, y, 7, 2);
    if (kind === 'palm') {
      for (let i = 0; i < 9; i++) rect(g, i % 3 ? th.trunk : shade(th.trunk, 25), x + (i < 4 ? 0 : 1), y - i, 1, 1);
      const c = RP(th.tree), fx = x + 1, fy = y - 9;
      for (const [dx, dy] of [[-1, 0], [-2, 0], [-3, 1], [-4, 2], [1, 0], [2, 0], [3, 1], [4, 2], [0, -1], [-1, -2], [1, -2], [-2, 1], [2, 1]]) rect(g, c, fx + dx, fy + dy, 1, 1);
      rect(g, shade(c, 35), fx - 1, fy, 1, 1); rect(g, '#8a6a20', fx, fy + 1, 1, 1);
    } else if (kind === 'banana') {
      rect(g, '#6a8a3a', x, y - 4, 1, 5);
      const c = '#4aa03a';
      rect(g, c, x - 4, y - 7, 4, 2); rect(g, c, x + 1, y - 8, 4, 2); rect(g, shade(c, 25), x - 1, y - 10, 3, 3); rect(g, shade(c, -20), x - 4, y - 6, 1, 1);
    } else {
      rect(g, th.trunk, x, y - 3, 1, 4);
      const c = RP(th.tree);
      rect(g, shade(c, -28), x - 5, y - 9, 11, 6); rect(g, shade(c, -28), x - 3, y - 11, 7, 9);
      rect(g, c, x - 4, y - 10, 9, 5); rect(g, c, x - 2, y - 11, 5, 1);
      rect(g, shade(c, 32), x - 2, y - 10, 3, 1); rect(g, shade(c, 18), x + 1, y - 8, 2, 1);
    }
  };
  const tryTree = (x, y) => {
    if (y < 14 || onRoad(x, y)) return;
    if (clearSpot({ x: x - 5, y: y - 12, w: 11, h: 14 })) tree(x, y);
  };
  const nTrees = Math.round(RI(14, 26) * ws.k * ws.k);
  for (let i = 0; i < nTrees; i++) tryTree(RI(6, WW - 6), RI(16, WH - 3));
  for (const p of parks) for (let i = 0; i < 8; i++) tryTree(RI(p.x + 5, p.x + p.w - 5), RI(p.y + 14, p.y + p.h - 3));

  // ---- street food carts on the sidewalks ----
  for (const y of ys) {
    const n = RI(1, 2) * Math.ceil(ws.k);
    for (let k = 0; k < n; k++) {
      const x = RI(12, WW - 12), cy = y - HW - 1;
      if (xs.some((v) => Math.abs(v - x) < HW + 9) || !clearSpot({ x: x - 5, y: cy - 12, w: 11, h: 13 }, 0)) continue;
      rect(g, 'rgba(0,0,0,.25)', x - 3, cy, 8, 1);
      rect(g, '#c8ccd4', x - 3, cy - 3, 7, 3); rect(g, '#9aa0aa', x - 3, cy - 1, 7, 1); rect(g, '#bfe4f4', x - 2, cy - 3, 3, 1);
      rect(g, '#6a6a6a', x, cy - 8, 1, 5);
      const uc = RP(['#d83030', '#2a70d0', '#f0a020', '#30a050']);
      rect(g, uc, x - 4, cy - 10, 9, 2); rect(g, shade(uc, 40), x - 2, cy - 11, 5, 1); rect(g, '#ffffff', x - 2, cy - 10, 1, 2); rect(g, '#ffffff', x + 2, cy - 10, 1, 2);
      rect(g, '#d02020', x + 5, cy - 1, 1, 1); rect(g, '#2050c0', x - 5, cy - 1, 1, 1);
    }
  }

  // ---- overhead: tangled electric wires / Yaowarat lanterns ----
  if (th.wires) {
    for (const y of ys) {
      if (bts && Math.abs(y - (bts.y + 17)) < 2) continue;
      const py = y + HW + 3, poles = [];
      for (let x = RI(6, 20); x < WW; x += RI(32, 40)) if (!xs.some((v) => Math.abs(v - x) < HW + 3)) poles.push(x);
      for (let i = 0; i < poles.length - 1; i++) {
        const x0 = poles[i], x1 = poles[i + 1];
        for (let w = 0; w < 2; w++) { // two thin sagging cables per span
          const sag = 2.5 + w * 2.5 + r() * 1.5;
          tg.fillStyle = w ? 'rgba(20,20,28,.4)' : 'rgba(20,20,28,.55)';
          for (let x = x0 + 1; x < x1; x++) { const t = (x - x0) / (x1 - x0); tg.fillRect(x, Math.round(py - 12 + w + sag * 4 * t * (1 - t)), 1, 1); }
        }
      }
      for (const x of poles) {
        rect(tg, '#6a6a6e', x, py - 13, 1, 13); rect(tg, '#8a8a8e', x, py - 13, 1, 1);
        rect(tg, '#5a5a5e', x - 2, py - 12, 5, 1);
        rect(tg, 'rgba(20,20,26,.8)', x - 1, py - 11, 3, 1); // little wire knot
        rect(g, 'rgba(0,0,0,.25)', x, py, 2, 1);
      }
    }
    hasTop = true;
  }
  if (th.lanterns) {
    for (const y of ys) for (let x = RI(10, 30); x < WW; x += RI(40, 60)) {
      if (xs.some((v) => Math.abs(v - x) < HW + 4)) continue;
      rect(tg, 'rgba(40,20,10,.7)', x, y - HW - 9, 1, RW + 6);
      for (let yy = y - HW - 8; yy <= y + HW - 4; yy += 3) { rect(tg, '#d02020', x - 1, yy, 3, 2); rect(tg, '#ffd040', x, yy - 1, 1, 1); }
    }
    hasTop = true;
  }

  // ---- buildings ----
  bld.sort((a, b) => a.y - b.y);
  const lit = () => r() < (th.night ? 0.7 : 0.15);
  const spiritHouse = (x, y) => { // ศาลพระภูมิ
    rect(g, 'rgba(0,0,0,.2)', x - 2, y, 5, 1);
    rect(g, '#e8e0d0', x, y - 4, 1, 4); rect(g, '#d8b040', x - 2, y - 5, 5, 1);
    rect(g, '#f4ecd8', x - 1, y - 8, 3, 3); rect(g, '#c83a2a', x - 2, y - 9, 5, 1); rect(g, '#e0b030', x, y - 10, 1, 1);
    rect(g, '#f08020', x - 2, y - 5, 1, 1); rect(g, '#f08020', x + 2, y - 5, 1, 1);
  };
  for (const b of bld) {
    const st = b.style, doorX = b.x + Math.floor(b.w / 2) - 2;
    const fy = b.y + 7, fh = b.h - 9, ix0 = b.x + 3, ix1 = b.x + b.w - 3;
    let wall = RP(th.walls);
    if (st === 'temple') wall = '#f4efe4';
    if (st === 'mansion') wall = '#f2e8d4';
    if (st === 'seven') wall = '#f6f6f6';
    if (st === 'wood') wall = RP(['#8a5a32', '#7a4a2a', '#9a6a3a']);

    // ---------- interior (ground layer) ----------
    rect(g, 'rgba(0,0,0,.28)', b.x + 3, b.y + 3, b.w, b.h);
    rect(g, shade(wall, -75), b.x, b.y, b.w, b.h); // wall tops
    rect(g, shade(wall, -12), b.x + 2, b.y + 1, b.w - 4, 6); // back wall face
    rect(g, shade(wall, -45), b.x + 2, b.y + 6, b.w - 4, 1);
    const floor = (c1, c2, kind) => {
      rect(g, c1, b.x + 2, fy, b.w - 4, fh);
      if (kind === 'check') { g.fillStyle = c2; for (let yy = fy; yy < fy + fh; yy += 2) for (let xx = b.x + 2 + ((yy - fy) / 2) % 2 * 2; xx < b.x + b.w - 2; xx += 4) g.fillRect(xx, yy, 2, 2); }
      else if (kind === 'plank') { g.fillStyle = c2; for (let yy = fy + 2; yy < fy + fh; yy += 3) g.fillRect(b.x + 2, yy, b.w - 4, 1); for (let yy = fy; yy < fy + fh; yy += 3) g.fillRect(b.x + 2 + RI(2, b.w - 8), yy, 1, 2); }
      else if (kind === 'grid') { g.fillStyle = c2; for (let yy = fy; yy < fy + fh; yy += 4) g.fillRect(b.x + 2, yy, b.w - 4, 1); for (let xx = b.x + 2; xx < b.x + b.w - 2; xx += 4) g.fillRect(xx, fy, 1, fh); }
    };
    const backWindows = (glass) => { for (let wx = b.x + 5; wx <= b.x + b.w - 8; wx += 9) { rect(g, shade(wall, -55), wx - 1, b.y + 1, 5, 4); rect(g, glass, wx, b.y + 2, 3, 2); } };
    const shelf = (x, y, w) => { rect(g, '#5a5a62', x, y, w, 3); for (let i = 0; i < w; i++) rect(g, RP(['#e04040', '#f0c030', '#40a0e0', '#50c060', '#ffffff', '#f08030']), x + i, y + (i % 2), 1, 1); };
    const nightGlass = th.night ? '#1a2238' : '#9cc4e4';
    if (st === 'temple') {
      floor('#9a1a1a', '#7a1010', 'plank');
      rect(g, '#e0b030', b.x + 2, fy, b.w - 4, 1);
      const cx = b.x + (b.w >> 1);
      rect(g, '#b08018', cx - 5, fy + 5, 11, 2); // altar
      const gold = '#f0c030', gd = '#b08a18'; // seated Buddha
      rect(g, gold, cx - 1, fy - 1, 3, 1); rect(g, gold, cx - 2, fy, 5, 2); rect(g, gold, cx - 3, fy + 2, 7, 3); rect(g, gd, cx - 3, fy + 4, 7, 1); rect(g, '#fff4b0', cx, fy - 2, 1, 1);
      for (const dx of [-7, 6]) { rect(g, '#f0f0e0', cx + dx, fy + 6, 1, 2); rect(g, '#ffb020', cx + dx, fy + 5, 1, 1); }
      for (let px = b.x + 6; px < b.x + b.w - 6; px += 10) { rect(g, '#6a0a0a', px, fy + 10, 2, 2); if (fy + 16 < b.y + b.h - 3) rect(g, '#6a0a0a', px, fy + 16, 2, 2); }
      backWindows('#e0b030');
    } else if (st === 'seven') {
      floor('#eeeeec', '#d8d8d4', 'grid');
      rect(g, '#3a80c0', ix0, fy, b.w - 6, 3); rect(g, '#bfe4ff', ix0, fy, b.w - 6, 1); // drinks fridge
      for (let yy = fy + 5; yy < b.y + b.h - 7; yy += 5) shelf(ix0 + 2, yy, b.w - 12);
      rect(g, '#1a8a4a', ix1 - 6, b.y + b.h - 8, 5, 3); rect(g, '#f07a1a', ix1 - 6, b.y + b.h - 8, 5, 1); // counter
    } else if (st === 'shop') {
      floor('#d8cfbf', '#bdb3a2', 'check');
      shelf(ix0, fy, b.w - 6);
      if (fh > 12) shelf(ix0 + 2, fy + 6, Math.min(12, b.w - 12));
      rect(g, '#7a4a2a', ix1 - 8, b.y + b.h - 8, 6, 3); rect(g, '#9a6a3a', ix1 - 8, b.y + b.h - 8, 6, 1); // counter
      rect(g, '#e8e8f0', ix1 - 3, fy + 4, 3, 5); rect(g, '#3a80c0', ix1 - 3, fy + 5, 3, 1); // fridge
      backWindows(nightGlass);
    } else if (st === 'condo') {
      floor('#5a6478', '#4e586a', 'grid');
      for (let yy = fy + 1; yy < b.y + b.h - 6; yy += 7) for (let xx = ix0 + 1; xx < ix1 - 6; xx += 9) { // office desks
        rect(g, '#c8b89a', xx, yy, 6, 3); rect(g, '#1a1a22', xx + 1, yy, 3, 1); rect(g, '#3ab0f0', xx + 2, yy, 1, 1); rect(g, '#2a2a30', xx + 2, yy + 3, 2, 1);
      }
      rect(g, '#bfe4ff', ix1 - 2, fy, 2, 4);
      backWindows(nightGlass);
    } else if (st === 'mansion') {
      floor('#e4dccc', '#c8bfae', 'check');
      const cx = b.x + (b.w >> 1);
      rect(g, '#8a1a1a', cx - 3, fy, 7, fh); rect(g, '#d8b040', cx - 3, fy, 1, fh); rect(g, '#d8b040', cx + 3, fy, 1, fh); // red carpet
      rect(g, '#6a4a2a', cx - 6, fy, 13, 3); rect(g, '#8a6a4a', cx - 6, fy, 13, 1); // grand stair landing
      const chY = fy + (fh >> 1) - 2; // chandelier
      rect(g, '#d8b040', cx - 3, chY, 7, 1); rect(g, '#d8b040', cx - 2, chY - 1, 5, 3); rect(g, '#fff4b0', cx - 1, chY, 3, 1);
      rect(g, '#1a1a1a', ix0 + 1, fy + 2, 7, 5); rect(g, '#f0f0f0', ix0 + 1, fy + 6, 7, 1); // grand piano
      rect(g, '#a02030', ix1 - 10, fy + 3, 9, 3); rect(g, '#c03040', ix1 - 10, fy + 3, 9, 1); rect(g, '#6a4a2a', ix1 - 8, fy + 7, 5, 2); // sofa + table
      for (let wx = b.x + 6; wx <= b.x + b.w - 9; wx += 12) { rect(g, '#d8b040', wx - 1, b.y + 1, 6, 4); rect(g, RP(['#3a5a8a', '#8a3a3a', '#3a7a4a', '#7a6a3a']), wx, b.y + 2, 4, 2); } // paintings
      for (const px of [ix0, ix1 - 2]) { rect(g, '#2e7a2a', px, b.y + b.h - 6, 2, 2); rect(g, '#d8b040', px, b.y + b.h - 4, 2, 1); }
    } else { // house / wood
      const fl = st === 'wood' ? '#9a7048' : RP(FLOORS);
      floor(fl, shade(fl, -18), 'plank');
      backWindows(nightGlass);
      if (b.w >= 30) { rect(g, '#5a3a22', ix0, fy, 7, 10); rect(g, '#f0ece0', ix0 + 1, fy, 5, 3); rect(g, RP(RUGS), ix0 + 1, fy + 3, 5, 6); }
      rect(g, 'rgba(0,0,0,.25)', ix1 - 7, fy + 5, 6, 1); rect(g, '#7a4a2a', ix1 - 8, fy + 1, 6, 4); rect(g, '#9a6a3a', ix1 - 8, fy + 1, 6, 1);
      rect(g, '#5a3a22', ix1 - 10, fy + 2, 1, 2); rect(g, '#5a3a22', ix1 - 1, fy + 2, 1, 2);
      if (fh >= 14) { const rc = RP(RUGS), rw = Math.min(14, b.w - 16), rx = b.x + ((b.w - rw) >> 1); rect(g, rc, rx, fy + fh - 9, rw, 5); rect(g, shade(rc, 40), rx + 1, fy + fh - 8, rw - 2, 1); rect(g, shade(rc, 40), rx + 1, fy + fh - 6, rw - 2, 1); }
      rect(g, '#2e6a2a', ix1 - 2, fy + fh - 4, 2, 2); rect(g, '#6a4a2a', ix1 - 2, fy + fh - 2, 2, 1);
    }
    rect(g, '#3a2a1a', doorX + 1, b.y + b.h - 2, 4, 2); // threshold
    rect(g, th.walk, doorX, b.y + b.h, 6, 1); // doorstep

    // ---------- exterior (roof layer) ----------
    const outline = () => { rg.fillStyle = 'rgba(0,0,0,.45)'; rg.fillRect(b.x - 1, b.y - 1, b.w + 2, 1); rg.fillRect(b.x - 1, b.y, 1, b.h); rg.fillRect(b.x + b.w, b.y, 1, b.h); };
    const doorFrame = (col) => rect(rg, col, doorX, b.y + b.h - 7, 6, 7);
    if (st === 'shop') { // Thai shophouse row
      const rh = Math.round(b.h * 0.38);
      rect(rg, '#8c8a86', b.x, b.y, b.w, rh); rect(rg, '#a4a29c', b.x, b.y, b.w, 1); rect(rg, '#6c6a66', b.x, b.y + rh - 1, b.w, 1);
      for (let i = 0; i < b.w * rh * 0.05; i++) rect(rg, '#7c7a76', b.x + RI(0, b.w - 1), b.y + RI(1, rh - 2), 1, 1);
      const units = Math.max(2, Math.round(b.w / 11)), uw = b.w / units;
      for (let i = 1; i < units; i++) rect(rg, '#74726e', Math.round(b.x + i * uw), b.y + 1, 1, rh - 2);
      const tx = b.x + RI(2, b.w - 8); // water tank + dish
      rect(rg, '#4a7ab0', tx, b.y + 2, 5, 4); rect(rg, '#7aaade', tx, b.y + 2, 5, 1); rect(rg, '#2a4a70', tx + 1, b.y + 6, 1, 1); rect(rg, '#2a4a70', tx + 3, b.y + 6, 1, 1);
      if (r() < 0.6) { const dx = b.x + RI(2, b.w - 5); rect(rg, '#d8d8d8', dx, b.y + rh - 4, 3, 2); rect(rg, '#8a8a8a', dx + 1, b.y + rh - 2, 1, 1); }
      const fh2 = b.h - rh, upH = Math.floor(fh2 * 0.42), sy = b.y + rh + upH;
      for (let i = 0; i < units; i++) {
        const ux = Math.round(b.x + i * uw), w = Math.round(b.x + (i + 1) * uw) - ux, col = RP(th.walls);
        rect(rg, col, ux, b.y + rh, w, fh2); rect(rg, shade(col, -35), ux, b.y + rh, 1, fh2);
        rect(rg, shade(col, -60), ux + 2, b.y + rh + 1, w - 4, upH - 1);
        rect(rg, lit() ? '#f7e07a' : '#3a5068', ux + 3, b.y + rh + 2, w - 6, upH - 3);
        for (let k = ux + 4; k < ux + w - 3; k += 2) rect(rg, shade(col, -70), k, b.y + rh + 2, 1, upH - 3); // window grille
        if (r() < 0.55) { rect(rg, '#e4e4e4', ux + w - 5, sy - 3, 4, 3); rect(rg, '#8a8a8a', ux + w - 4, sy - 2, 1, 1); } // AC unit
        const sc = th.neon && r() < 0.5 ? RP(['#ff3aa0', '#3af0ff', '#f0ff3a', '#ff5a3a']) : RP(['#d83030', '#2a60c0', '#f0c020', '#2a9a4a', '#f07020', '#ffffff']);
        rect(rg, sc, ux + 1, sy, w - 2, 3);
        rg.fillStyle = sc === '#ffffff' || sc === '#f0c020' || sc === '#f0ff3a' ? '#b02020' : '#ffffff';
        for (let k = ux + 2; k < ux + w - 2; k++) if (r() < 0.55) rg.fillRect(k, sy + 1, 1, 1); // sign lettering
        const gy = sy + 3, gh = b.y + b.h - gy - 1;
        if (Math.abs(ux + w / 2 - (doorX + 3)) < w / 2 + 1) rect(rg, '#2a2420', ux + 1, gy, w - 2, gh);
        else if (r() < 0.5) { rect(rg, '#9aa0a8', ux + 1, gy, w - 2, gh); for (let k = gy + 1; k < gy + gh; k += 2) rect(rg, '#7a8088', ux + 1, k, w - 2, 1); }
        else { rect(rg, '#2a2420', ux + 1, gy, w - 2, gh); for (let k = 0; k < w; k++) if (r() < 0.6) rect(rg, RP(['#e04040', '#f0c030', '#40a0e0', '#50c060', '#ffffff']), ux + 1 + RI(0, w - 3), gy + RI(1, Math.max(1, gh - 1)), 1, 1); }
        if (th.neon && r() < 0.35) { const nc = RP(['#ff3aa0', '#3af0ff', '#f0ff3a']); rect(rg, nc, ux + w - 2, b.y + rh + 1, 2, upH + 1); rect(rg, '#ffffff', ux + w - 2, b.y + rh + 2, 1, 1); } // vertical neon sign
      }
      rect(rg, 'rgba(0,0,0,.35)', b.x, b.y + b.h - 1, b.w, 1);
    } else if (st === 'condo') {
      const rh = Math.max(8, Math.round(b.h * 0.34));
      rect(rg, '#7a7c82', b.x, b.y, b.w, rh); rect(rg, '#9a9ca2', b.x, b.y, b.w, 1); rect(rg, '#5a5c62', b.x, b.y + rh - 1, b.w, 1);
      for (let i = 0; i < 3; i++) { const ax = b.x + RI(2, b.w - 6); rect(rg, '#b8bcc4', ax, b.y + RI(2, rh - 5), 4, 3); }
      if (b.w >= 44) { const hx = b.x + b.w - 12, hy = b.y + 1; rect(rg, '#5a5c62', hx, hy, 9, rh - 3); rect(rg, '#f0d030', hx + 1, hy + 1, 7, 1); rect(rg, '#f0f0f0', hx + 3, hy + 2, 1, 3); rect(rg, '#f0f0f0', hx + 5, hy + 2, 1, 3); rect(rg, '#f0f0f0', hx + 3, hy + 3, 3, 1); }
      const glass = th.night ? '#1e2a3a' : '#4a78a0';
      rect(rg, '#c8d0d8', b.x, b.y + rh, b.w, b.h - rh);
      for (let yy = b.y + rh + 1; yy < b.y + b.h - 6; yy += 3) for (let xx = b.x + 1; xx < b.x + b.w - 2; xx += 4) {
        rect(rg, th.night && r() < 0.55 ? '#f7e07a' : glass, xx, yy, 3, 2);
        if (!th.night && r() < 0.18) rect(rg, '#a8d4f4', xx, yy, 1, 1);
      }
      rect(rg, '#2a3440', b.x, b.y + b.h - 7, b.w, 1); rect(rg, '#8ac0e0', b.x + 1, b.y + b.h - 6, b.w - 2, 5);
      rect(rg, 'rgba(0,0,0,.35)', b.x, b.y + b.h - 1, b.w, 1);
    } else if (st === 'seven') { // 7-Eleven
      const rh = Math.round(b.h * 0.4);
      rect(rg, '#b4b4b4', b.x, b.y, b.w, rh); rect(rg, '#cacaca', b.x, b.y, b.w, 1); rect(rg, '#9a9a9a', b.x + 3, b.y + 3, 5, 3); rect(rg, '#9a9a9a', b.x + b.w - 8, b.y + 2, 4, 3);
      rect(rg, '#f6f6f6', b.x, b.y + rh, b.w, b.h - rh);
      rect(rg, '#f07a1a', b.x, b.y + rh, b.w, 2); rect(rg, '#12884a', b.x, b.y + rh + 2, b.w, 1); rect(rg, '#d0201a', b.x, b.y + rh + 3, b.w, 1);
      const lx = b.x + 2, ly = b.y + rh + 5; // logo
      rect(rg, '#12884a', lx, ly, 6, 6); rect(rg, '#ffffff', lx + 1, ly + 1, 4, 4); rect(rg, '#f07a1a', lx + 1, ly + 1, 3, 1); rect(rg, '#d0201a', lx + 3, ly + 2, 1, 3);
      rect(rg, '#bfe6f6', lx + 8, ly, b.w - 12, b.h - rh - 7);
      for (let i = 0; i < b.w; i++) if (r() < 0.5) rect(rg, RP(['#e04040', '#f0c030', '#40a0e0', '#50c060']), lx + 9 + RI(0, b.w - 15), ly + RI(1, Math.max(1, b.h - rh - 9)), 1, 1);
      rect(rg, '#d8d8d8', b.x, b.y + b.h - 2, b.w, 2);
    } else if (st === 'temple') { // Thai temple / Chinese shrine
      const rh = Math.round(b.h * 0.6), shrine = th.shrine;
      const edge = shrine ? '#2a7a4a' : '#1f6a3a', c1 = shrine ? '#b01818' : '#c8401a', c2 = shrine ? '#d02a2a' : '#e0602a', gold = '#e8b830';
      for (let i = 0; i < 3; i++) {
        const ix = b.x + i * 4, iy = b.y + i * 3, iw = b.w - i * 8, ih = rh - i * 4;
        if (iw < 8 || ih < 4) break;
        rect(rg, edge, ix, iy, iw, ih); rect(rg, i % 2 ? c2 : c1, ix + 1, iy + 1, iw - 2, ih - 2);
        rg.fillStyle = shade(i % 2 ? c2 : c1, -18); for (let xx = ix + 2; xx < ix + iw - 2; xx += 2) rg.fillRect(xx, iy + 1, 1, ih - 2);
        rect(rg, gold, ix, iy + ih - 1, iw, 1);
        rect(rg, gold, ix, iy - 1, 1, 2); rect(rg, gold, ix + iw - 1, iy - 1, 1, 2); rect(rg, gold, ix - 1, iy - 2, 1, 1); rect(rg, gold, ix + iw, iy - 2, 1, 1); // chofa finials
      }
      rect(rg, gold, b.x + 12, b.y + 7, b.w - 24, 1); // ridge
      if (shrine) for (let xx = b.x + 14; xx < b.x + b.w - 14; xx += 4) rect(rg, gold, xx, b.y + 6, 2, 1);
      rect(rg, wall, b.x, b.y + rh, b.w, b.h - rh);
      for (let xx = b.x + 1; xx < b.x + b.w - 1; xx += 6) { rect(rg, shrine ? '#b01818' : '#a0201a', xx, b.y + rh, 2, b.h - rh - 1); rect(rg, gold, xx, b.y + rh, 2, 1); }
      for (let xx = b.x + 4; xx < b.x + b.w - 5; xx += 6) { if (Math.abs(xx - doorX) < 6) continue; rect(rg, gold, xx, b.y + rh + 3, 3, 4); rect(rg, '#6a1010', xx + 1, b.y + rh + 4, 1, 2); }
      if (shrine) for (let xx = b.x + 3; xx < b.x + b.w - 3; xx += 7) { rect(rg, '#e02020', xx, b.y + rh + 1, 2, 2); rect(rg, '#ffd040', xx, b.y + rh + 1, 2, 1); }
      rect(rg, gold, doorX - 2, b.y + b.h - 9, 10, 9); doorFrame('#6a1010');
      rect(g, '#f0ece4', doorX - 3, b.y + b.h, 12, 2); // white steps
    } else if (st === 'mansion') {
      const rh = Math.round(b.h * 0.46);
      rect(rg, '#3c4250', b.x, b.y, b.w, rh);
      rg.fillStyle = '#343a46'; for (let yy = b.y + 2; yy < b.y + rh; yy += 2) rg.fillRect(b.x, yy, b.w, 1);
      rect(rg, '#5a6272', b.x + 4, b.y + (rh >> 1) - 1, b.w - 8, 1); // ridge
      rect(rg, '#5a6272', b.x, b.y, b.w, 1); rect(rg, '#d8b040', b.x, b.y + rh - 1, b.w, 1);
      for (let xx = b.x + 8; xx < b.x + b.w - 10; xx += 14) { rect(rg, '#f2e8d4', xx, b.y + rh - 7, 6, 6); rect(rg, '#3c4250', xx - 1, b.y + rh - 8, 8, 1); rect(rg, lit() ? '#f7e07a' : '#2b3a4f', xx + 2, b.y + rh - 5, 2, 3); } // dormers
      rect(rg, wall, b.x, b.y + rh, b.w, b.h - rh);
      for (let xx = b.x + 2; xx < b.x + b.w - 2; xx += 8) { rect(rg, '#ffffff', xx, b.y + rh, 2, b.h - rh - 1); rect(rg, '#c8bca4', xx + 2, b.y + rh, 1, b.h - rh - 1); }
      for (let xx = b.x + 5; xx < b.x + b.w - 6; xx += 8) { // arched windows
        if (Math.abs(xx - doorX) < 7) continue;
        const wy = b.y + rh + 3, gl = lit() ? '#f7e07a' : '#2b3a5a';
        rect(rg, '#8a7a5a', xx - 1, wy - 1, 5, 7); rect(rg, gl, xx, wy + 1, 3, 5); rect(rg, gl, xx + 1, wy, 1, 1);
      }
      rect(rg, '#e8dcc4', doorX - 4, b.y + b.h - 11, 14, 2); for (let xx = doorX - 4; xx < doorX + 10; xx += 2) rect(rg, '#ffffff', xx, b.y + b.h - 12, 1, 1); // balcony
      rect(rg, '#ffffff', doorX - 2, b.y + b.h - 8, 10, 8); rect(rg, '#d8b040', doorX + 2, b.y + b.h - 9, 2, 1); doorFrame('#2a1a10');
      rect(g, '#f0ece4', doorX - 4, b.y + b.h, 14, 2);
    } else { // house / wooden stilt house
      const rh = Math.max(8, Math.round(b.h * (st === 'wood' ? 0.5 : 0.55)));
      if (st === 'wood') { // corrugated tin roof
        const rf = '#9aa0a4';
        rect(rg, rf, b.x, b.y, b.w, rh);
        rg.fillStyle = shade(rf, -18); for (let xx = b.x + 1; xx < b.x + b.w; xx += 2) rg.fillRect(xx, b.y, 1, rh);
        for (let i = 0; i < b.w * 0.3; i++) rect(rg, RP(['#a0603a', '#8a5030']), b.x + RI(0, b.w - 2), b.y + RI(0, rh - 2), RI(1, 2), 1);
        rect(rg, shade(rf, 30), b.x, b.y + (rh >> 1), b.w, 1); rect(rg, shade(rf, -45), b.x, b.y + rh - 1, b.w, 1);
      } else {
        const rf = RP(th.roofs);
        rect(rg, rf, b.x, b.y, b.w, rh);
        rg.fillStyle = shade(rf, -22); for (let yy = b.y + 3; yy < b.y + rh; yy += 3) rg.fillRect(b.x, yy, b.w, 1);
        rect(rg, shade(rf, 28), b.x, b.y, b.w, 1); rect(rg, shade(rf, -50), b.x, b.y + rh - 1, b.w, 1);
      }
      rect(rg, wall, b.x, b.y + rh, b.w, b.h - rh);
      if (st === 'wood') { rg.fillStyle = shade(wall, -22); for (let yy = b.y + rh + 1; yy < b.y + b.h; yy += 2) rg.fillRect(b.x, yy, b.w, 1); }
      rect(rg, shade(wall, -32), b.x, b.y + b.h - 1, b.w, 1); rect(rg, shade(wall, -32), b.x + b.w - 1, b.y + rh, 1, b.h - rh);
      const wy = b.y + rh + 3;
      if (b.h - rh >= 9) {
        for (let wx = b.x + 3; wx <= b.x + b.w - 6; wx += 7) {
          if (Math.abs(wx - doorX) < 6) continue;
          if (st === 'wood') { rect(rg, '#2a1a10', wx, wy, 3, 3); rect(rg, shade(wall, 30), wx - 1, wy, 1, 3); rect(rg, shade(wall, 30), wx + 3, wy, 1, 3); continue; }
          rect(rg, shade(wall, -55), wx - 1, wy - 1, 5, 5); rect(rg, lit() ? '#f7e07a' : '#2b3a4f', wx, wy, 3, 3);
        }
      }
      doorFrame(shade(wall, -60));
    }
    outline();
    // spirit house in front of some homes and shops
    if ((st === 'house' || st === 'wood' || st === 'shop') && r() < 0.45) {
      const sx = r() < 0.5 ? b.x - 3 : b.x + b.w + 3, sy2 = b.y + b.h + 3;
      if (!onRoad(sx, sy2) && clearSpot({ x: sx - 3, y: sy2 - 10, w: 6, h: 10 }, 0) && !bld.some((o) => o !== b && over(o, { x: sx - 3, y: sy2 - 10, w: 6, h: 10 }, 1))) spiritHouse(sx, sy2);
    }

    const hp = LV.doorHp(L) * (0.8 + r() * 0.4) * (st === 'mansion' ? 3 : st === 'temple' ? 1.5 : 1) * (RT.doorHp || 1);
    const wood = st === 'mansion' ? '#3a2418' : st === 'seven' ? '#7ab8d0' : st === 'condo' ? '#5a7a90' : st === 'temple' ? '#8a5a1a' : RP(['#6b4226', '#5a3a22', '#7a4a2a', '#4a5a6a', '#6a2a2a']);
    b.door = {
      b, dx: doorX, x: doorX + 3, y: b.y + b.h + 3, iy: b.y + b.h - 5, cy: b.y + b.h - 1,
      closed: st === 'mansion' ? true : r() < 0.6, broken: false, hp, maxHp: hp, anim: 0, flash: 0, wood,
    };
    b.rich = st === 'mansion';
    b.roofA = 1; b.nIn = 0; b.nUndead = 0;
  }

  // spatial grid of buildings (16px cells) for fast collision tests
  const C = 16, cols = Math.ceil(WW / C) + 1, rows = Math.ceil(WH / C) + 1;
  const grid = new Array(cols * rows);
  for (const b of bld) {
    for (let cy = Math.floor((b.y - 2) / C); cy <= Math.floor((b.y + b.h + 2) / C); cy++) {
      for (let cx = Math.floor((b.x - 2) / C); cx <= Math.floor((b.x + b.w + 2) / C); cx++) {
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        (grid[cy * cols + cx] ||= []).push(b);
      }
    }
  }

  MAP = {
    bg, g, roof, top: hasTop ? top : null, bts, b: bld, doors: bld.map((b) => b.door), grave, th, w: WW, h: WH, xs, ys, grid, cols,
    mansions: bld.filter((b) => b.style === 'mansion'),
  };
}

const cellAt = (x, y) => MAP.grid[((y / 16) | 0) * MAP.cols + ((x / 16) | 0)];
function blocked(x, y) {
  if (x < 3 || x > WW - 3 || y < 11 || y > WH - 2) return true;
  const cell = cellAt(x, y);
  if (!cell) return false;
  for (let i = 0; i < cell.length; i++) {
    const b = cell[i];
    if (x <= b.x - 1 || x >= b.x + b.w + 1 || y <= b.y - 1 || y >= b.y + b.h + 1) continue;
    if (x > b.x + 2 && x < b.x + b.w - 2 && y > b.y + 6 && y < b.y + b.h - 2) return false; // floor
    const d = b.door;
    if (x > d.dx + 1 && x < d.dx + 5 && y > b.y + b.h - 4 && (d.broken || !d.closed)) return false; // door gap
    return true;
  }
  return false;
}
function spaceOf(x, y) {
  const cell = cellAt(x, y);
  if (!cell) return null;
  for (let i = 0; i < cell.length; i++) {
    const b = cell[i];
    if (x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 5 && y < b.y + b.h - 1) return b;
  }
  return null;
}
const freeOutside = (x, y) => !blocked(x, y) && !spaceOf(x, y);
const inGrave = (x, y) => { const g = MAP.grave; return x > g.x - 4 && x < g.x + g.w + 4 && y > g.y - 6 && y < g.y + g.h + 6; };
function randomFree(avoidGrave) {
  for (let i = 0; i < 300; i++) {
    const x = rand(5, WW - 5), y = rand(14, WH - 3);
    if (freeOutside(x, y) && !(avoidGrave && inGrave(x, y))) return { x, y };
  }
  return { x: WW / 2, y: WH / 2 };
}
const interiorPoint = (b) => ({ x: rand(b.x + 4, b.x + b.w - 4), y: rand(b.y + 8, b.y + b.h - 4), space: b });
// random walk target that stays in the same space (outside, or inside the same house)
function randomPointIn(e, rad) {
  if (e.space) return interiorPoint(e.space);
  for (let i = 0; i < 20; i++) {
    const nx = e.x + rand(-rad, rad), ny = e.y + rand(-rad, rad);
    if (freeOutside(nx, ny)) return { x: nx, y: ny, space: null };
  }
  return Object.assign(randomFree(false), { space: null });
}
function findFree(x, y) {
  if (freeOutside(x, y)) return { x, y };
  for (let r = 2; r <= 12; r += 2) {
    for (let a = 0; a < 8; a++) {
      const nx = x + Math.cos((a / 8) * Math.PI * 2) * r, ny = y + Math.sin((a / 8) * Math.PI * 2) * r;
      if (freeOutside(nx, ny)) return { x: nx, y: ny };
    }
  }
  return null;
}

// ---------- camera ---------------------------------------------------------
const cam = { x: 0, y: 0, s: 1 };
let CW = 960, CH = 540, DPR = 1;
const minScale = () => Math.min(CW / WW, CH / WH) * 0.85;
const maxScale = () => CW / 90;
const camT = () => ({ tx: Math.round(-cam.x * cam.s), ty: Math.round(-cam.y * cam.s) });
const PAD = 40; // camera may scroll a little past the edges so HUD never hides a corner
function clampCam() {
  cam.s = clamp(cam.s, minScale(), maxScale());
  const vw = CW / cam.s, vh = CH / cam.s;
  cam.x = vw >= WW + PAD * 2 ? (WW - vw) / 2 : clamp(cam.x, -PAD, WW - vw + PAD);
  cam.y = vh >= WH + PAD * 2 ? (WH - vh) / 2 : clamp(cam.y, -PAD, WH - vh + PAD);
}
function zoomAt(sx, sy, f) {
  const wx = cam.x + sx / cam.s, wy = cam.y + sy / cam.s;
  cam.s *= f;
  clampCam();
  cam.x = wx - sx / cam.s; cam.y = wy - sy / cam.s;
  clampCam();
}
function centerOn(wx, wy) { cam.x = wx - CW / cam.s / 2; cam.y = wy - CH / cam.s / 2; clampCam(); }
function resetCam() {
  cam.s = Math.max(Math.min(CW / WW, CH / WH), CW / 480);
  centerOn(WW / 2, WH / 2);
}
function resize() {
  const r = canvas.getBoundingClientRect();
  if (r.width < 10) return;
  const cx = cam.x + CW / cam.s / 2, cy = cam.y + CH / cam.s / 2, rel = cam.s / (CW / 480);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  CW = Math.round(r.width * DPR); CH = Math.round(r.height * DPR);
  canvas.width = CW; canvas.height = CH;
  ctx.imageSmoothingEnabled = false;
  if (MAP) { cam.s = (CW / 480) * rel; centerOn(cx, cy); }
}
function inView(x, y, m = 12) {
  return x > cam.x - m && x < cam.x + CW / cam.s + m && y > cam.y - m && y < cam.y + CH / cam.s + m + 16;
}
function screenToWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const sx = ((clientX - r.left) * CW) / r.width, sy = ((clientY - r.top) * CH) / r.height;
  const { tx, ty } = camT();
  return { x: (sx - tx) / cam.s, y: (sy - ty) / cam.s, sx, sy };
}

// ---------- level runtime --------------------------------------------------
let G = null;
const CD = { frenzy: 0, plague: 0, raise: 0 };
let targeting = null;
const mouse = { x: 0, y: 0, inside: false, down: false, hold: 0 };

function newLevel(L) {
  const R = routeOf(L);
  genMap(L, R);
  G = {
    L, humans: [], undead: [], parts: [], floats: [], tracers: [], clouds: [], vans: [], nades: [], booms: [], spits: [],
    energy: F.eMax(), frenzyT: 0, cleared: false, clearT: 0, skelQ: [], time: 0, total: 0, total0: 0, vanCount: 0, groanT: 3,
    shake: 0, boss: null, stuckT: 1, route: R, ev: null, evT: rand(22, 38), evN: 0, fw: [], choices: null,
    weather: R.weather || rollWeather(L), cur: { x: 0, y: 0 }, curA: Math.random() * 6.28, sky: [], thunderT: rand(8, 16), flashT: 0,
    train: null, trainT: rand(3, 10),
  };
  // specials are sized from the base population; a district's crowd modifier only adds / removes civilians
  const n0 = LV.count(L), n = Math.min(420, Math.round(n0 * (R.count || 1)));
  const armed = R.armed == null ? 1 : R.armed;
  const counts = { soldier: Math.round(n0 * LV.soldier(L) * armed * (R.soldiers || 1)), swat: Math.round(n0 * LV.swat(L) * armed), police: Math.round(n0 * LV.police(L) * armed),
    brute: Math.round(n0 * LV.brute(L)), dog: Math.round(n0 * LV.dog(L) * (R.dogs || 1)) };
  let nk = 0;
  for (const k in counts) nk += counts[k];
  if (nk > n * 0.75) for (const k in counts) counts[k] = Math.floor((counts[k] * n * 0.75) / nk); // always leave some civilians
  const kinds = [];
  for (const k in counts) for (let i = 0; i < counts[k]; i++) kinds.push(k);
  while (kinds.length < n) kinds.push('civ');
  const homes = MAP.b.filter((b) => !b.rich);
  for (const kind of kinds) {
    let p = randomFree(true), sp = null;
    if (kind === 'civ' && homes.length && Math.random() < 0.18) { sp = pick(homes); p = interiorPoint(sp); } // at home
    const h = makeHuman(kind, p.x, p.y);
    h.space = sp; h.stayT = rand(5, 20);
    G.humans.push(h);
  }
  // mansions: bodyguards in suits patrol inside, rich owners hide, guard dogs in the yard
  for (const b of MAP.mansions) {
    const add = (kind, p, sp) => { const h = makeHuman(kind, p.x, p.y); h.space = sp; G.humans.push(h); return h; };
    for (let i = 0; i < 2 + (L >= 10) + (L >= 20); i++) add('guard', interiorPoint(b), b);
    for (let i = 0; i < 2 + (Math.random() < 0.5); i++) {
      const h = add('civ', interiorPoint(b), b);
      h.rich = true; h.pal = palFor('rich'); h.spr = Pix.get('human', h.pal); h.stayT = rand(40, 90);
    }
    for (let i = 0; i < 1 + (L >= 8); i++) { const p = findFree(b.door.x + rand(-14, 14), b.door.y + rand(4, 12)); if (p) add('dog', p, null); }
  }
  G.total = G.total0 = G.humans.length;
  for (let i = 0; i < F.skelN(); i++) spawnSkel(i * 0.15);
  if (G.weather === 'flood') MAP.water = weatherMask('#3d86b0');
  if (G.weather === 'cold') MAP.frost = weatherMask('#eef6ff');
  targeting = null;
  resetCam();
  hideBanner();
  UI.levelDirty = true; UI.evDirty = true;
  const sz = worldSize(L), wx = WEATHER[G.weather];
  toast(`ด่าน ${L} · ${MAP.th.name}` + (R !== ROUTES.normal ? ` · ${R.name}` : '') + (sz.k > 1 ? ` · แมพ x${sz.k}` : '') + (G.weather !== 'clear' ? ` · ${wx.name}: ${wx.desc}` : ''));
  if (isBossLevel(L)) spawnBoss(pick(Object.keys(BOSSES)));
}
// full-map overlay with every building cut out (floodwater / frost stay outdoors)
function weatherMask(col) {
  const c = Pix.mk(WW, WH), x = c.getContext('2d');
  x.fillStyle = col; x.fillRect(0, 0, WW, WH);
  for (const b of MAP.b) x.clearRect(b.x, b.y, b.w, b.h);
  return c;
}
function spawnBoss(type) {
  const def = BOSSES[type];
  let p = null;
  for (let i = 0; i < 40 && !p; i++) { const q = randomFree(true); if (Math.hypot(q.x - WW / 2, q.y - WH / 2) < Math.min(WW, WH) * 0.3) p = q; }
  p = p || randomFree(true);
  const h = makeHuman('boss', p.x, p.y);
  const pal = Object.assign({ s: pick(SKIN) }, def.pal);
  Object.assign(h, {
    btype: type, name: def.name, pal, spr: Pix.get('boss', pal), rad: 5,
    hp: LV.hp(G.L) * def.hp, maxHp: LV.hp(G.L) * def.hp, spd: def.spd, voice: 0.6,
    abT: rand(2, 4), ab2T: rand(5, 8), act: null, oy: 0, muzzle: 0, aimT: 0, summons: 0, flasks: 8,
  });
  G.humans.push(h); G.total++; G.total0++;
  G.boss = h;
  const el = $('bossIntro');
  el.innerHTML = `<img src="${Pix.icon('crown')}" alt=""><div><b>BOSS · ${def.name}</b><span>${def.desc}</span></div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  Snd.play('bossin');
}
function goLevel(L) {
  S.level = clamp(L, 1, S.maxLevel);
  newLevel(S.level);
  save();
}

function makeHuman(kind, x, y) {
  const L = G.L, K = KIND[kind];
  const hp = LV.hp(L) * K.hp;
  const pal = palFor(kind);
  return {
    t: 'h', kind, x, y, hp, maxHp: hp, pal, spr: Pix.get(K.sprite, pal), rad: isMelee(kind) ? 4 : kind === 'dog' ? 2.6 : 3.2,
    dir: Math.random() < 0.5 ? 1 : -1, anim: 0, pose: 'walk', state: 'ok', space: null, tx: x, ty: y, wt: 0, idle: rand(0, 2),
    stamina: 1, tired: false, cd: rand(0, 1), think: 0, threat: null, infectT: 0, detourT: 0, ddx: 0, ddy: 0, flash: 0,
    alerted: false, calmT: 0, shockT: 0, alertT: 0, fearT: 0, goal: null, goalT: 0, stayT: 0, closeDoor: null, hurt: false, punchT: 0, burst: 0,
    nades: kind === 'swat' && Math.random() < 0.5 ? (Math.random() < 0.5 ? 1 : 2) : 0, nadeCd: rand(2, 5), throwT: 0,
    spd: K.spd, run: (kind === 'dog' ? 17 : 13) * (1 + Math.min(0.3, L * 0.005)),
    range: K.range || 6, rate: K.rate || 0.9, dmg: LV.gunDmg(L) * (K.dmg || 1), sight: K.sight || 46, armor: K.armor || 1,
    voice: isMelee(kind) ? rand(0.6, 0.75) : kind === 'dog' ? rand(0.8, 1.3) : rand(0.8, 1.35),
  };
}
function makeZombie(x, y, fromPal, kind, strain = 'basic') {
  if (kind === 'dog') { // dead dogs come back as fast, rotten zombie dogs
    strain = 'dog';
    fromPal = { c: pick(['#6a7a5a', '#7a7a62', '#5a6a52']), b: pick(['#8a9a72', '#9aa080']), s: pick(ZSKIN), h: '#5a6a52', p: '#5a6a52' };
  }
  const pal = fromPal ? Object.assign({}, fromPal, { s: pick(ZSKIN) }) : zombiePal();
  const big = isMelee(kind);
  const kindMul = big ? 4 : kind === 'soldier' ? 1.6 : kind === 'swat' ? 1.5 : kind === 'police' ? 1.3 : 1;
  const sm = strainMul(strain);
  const hpMul = kindMul * sm.hp, dmgMul = (big ? 2.5 : 1) * sm.dmg;
  const spdMul = (big ? 0.85 : 1) * sm.spd * rand(0.9, 1.1);
  const hp = F.zHp() * hpMul;
  const sprite = big ? 'bigzombie' : strain === 'dog' ? 'zdog' : STRAINS[strain].sprite;
  return {
    t: 'u', kind: 'zombie', strain, big, x, y, hp, maxHp: hp, kindMul, hpMul, spdMul, dmgMul, dmg: F.zDmg() * dmgMul, spd: F.zSpd() * spdMul,
    rad: big ? 5 : strain === 'tank' ? 4.5 : strain === 'dog' ? 2.6 : 3.2, reach: big ? 7 : strain === 'tank' ? 6 : 5,
    pal, spr: Pix.get(sprite, pal), dir: Math.random() < 0.5 ? 1 : -1, anim: 0, pose: 'walk', target: null, think: 0, cd: 0, space: spaceOf(x, y),
    detourT: 0, ddx: 0, ddy: 0, rise: big ? 0.7 : 0.5, riseMax: big ? 0.7 : 0.5, flash: 0, wt: 0, tx: x, ty: y, idle: 0, pitch: big ? rand(0.55, 0.7) : rand(0.8, 1.2),
  };
}
function makeSkel(x, y, delay) {
  const hp = F.skelHp();
  return {
    t: 'u', kind: 'skel', strain: 'skel', x, y, hp, maxHp: hp, hpMul: 1, spdMul: 1, dmgMul: 1, dmg: F.skelDmg(), spd: 12, rad: 3.2, reach: 5,
    pal: null, spr: Pix.get('skel', null), dir: 1, anim: 0, pose: 'walk', target: null, think: 0, cd: 0, space: null,
    detourT: 0, ddx: 0, ddy: 0, rise: 0.6 + delay, riseMax: 0.6, flash: 0, wt: 0, tx: x, ty: y, idle: 0,
  };
}
function spawnSkel(delay = 0) {
  const gr = MAP.grave;
  const x = gr.x + rand(4, gr.w - 4), y = gr.y + rand(8, gr.h - 2);
  G.undead.push(makeSkel(x, y, delay));
  dirt(x, y, 5);
  Snd.play('rattle', x, y);
}
function refreshUndeadStats() {
  for (const u of G.undead) {
    if (u.kind === 'zombie') { // strain level may have changed too
      const sm = strainMul(u.strain);
      u.hpMul = u.kindMul * sm.hp; u.dmgMul = (u.big ? 2.5 : 1) * sm.dmg;
    }
    const newMax = (u.kind === 'zombie' ? F.zHp() : F.skelHp()) * u.hpMul;
    u.hp *= newMax / u.maxHp; u.maxHp = newMax;
    u.dmg = (u.kind === 'zombie' ? F.zDmg() : F.skelDmg()) * u.dmgMul;
    u.spd = u.kind === 'zombie' ? F.zSpd() * u.spdMul : 12;
  }
}

// ---------- resources ------------------------------------------------------
const rate = { t: 0, blood: 0, brains: 0, bones: 0 };
function gain(cur, amt, raw) {
  if (!raw) amt *= gainMult() * routeMul(cur);
  const c = cap(cur);
  if (S[cur] >= c) return 0;
  const got = Math.min(amt, c - S[cur]);
  S[cur] += got; rate[cur] += got;
  if (cur === 'blood') S.stats.bloodTotal += got;
  return got;
}

// ---------- doors & routing ------------------------------------------------
const doorShut = (d) => d.closed && !d.broken;
const nearDoor = (e, d) => Math.abs(e.x - d.x) < 4.5 && Math.abs(e.y - d.cy) < 6;
function gapClear(d) {
  const x0 = d.dx, x1 = d.dx + 6, y0 = d.b.y + d.b.h - 4, y1 = d.b.y + d.b.h + 2;
  for (const arr of [G.humans, G.undead]) {
    for (const e of arr) if (e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1) return false;
  }
  return true;
}
function openDoor(d) {
  if (!doorShut(d)) return;
  d.closed = false; d.anim = 0.3;
  Snd.play('creak', d.x, d.y);
}
function closeDoor(d) {
  if (d.broken || d.closed || !gapClear(d)) return false;
  d.closed = true; d.anim = 0.2;
  Snd.play('slam', d.x, d.y);
  return true;
}
function breakDoor(d) {
  d.broken = true; d.hp = 0; d.closed = false;
  S.stats.doors++;
  Snd.play('crash', d.x, d.y);
  for (let i = 0; i < 12; i++) G.parts.push({ x: d.x, y: d.cy - 2, vx: rand(-30, 30), vy: rand(-40, -10), gy: d.cy + rand(-4, 6), col: pick([d.wood, shade(d.wood, 30), shade(d.wood, -20)]), stain: true });
}
function bashDoor(u, d, dmg) {
  d.hp -= dmg; d.flash = 0.1;
  Snd.play('bash', d.x, d.y);
  G.parts.push({ x: d.x + rand(-2, 2), y: d.cy - 3, vx: rand(-15, 15), vy: rand(-25, -5), gy: d.cy + rand(0, 3), col: shade(d.wood, 25), stain: false });
  // people inside hear the pounding
  for (const h of G.humans) {
    if (h.space !== d.b || h.state !== 'ok') continue;
    h.threat = u; h.fearT = 2.5;
    if (!h.alerted) { h.alerted = true; h.shockT = rand(0.3, 0.6); h.alertT = 1.2; if (Math.random() < 0.3) Snd.play('scream', h.x, h.y, h.voice); }
  }
  if (d.hp <= 0) breakDoor(d);
}
// standing in the door column (just inside, in the gap, or on the step)
const inGapCol = (e, d) => Math.abs(e.x - d.x) < 2.3 && e.y > d.b.y + d.b.h - 7 && e.y < d.y + 2;
// walk around a building to stand in front of its door
function approach(e, d) {
  const b = d.b;
  if (e.y >= b.y + b.h + 1 || inGapCol(e, d)) return d;
  const left = b.x - 5, right = b.x + b.w + 5;
  if (e.x > b.x - 4 && e.x < b.x + b.w + 4) return { x: e.x < b.x + b.w / 2 ? left : right, y: e.y };
  return { x: e.x < b.x ? left : right, y: d.y + 1 };
}
// next waypoint from e toward point t in space tsp (null = outdoors). w.door = door on the way,
// w.thru = walking straight through the doorway (no sidestepping allowed there)
function route(e, t, tsp) {
  const esp = e.space;
  if (esp === tsp) return t;
  if (esp) { // leave the current house first
    const d = esp.door;
    if (inGapCol(e, d)) return { x: d.x, y: d.y + 3, door: d, thru: true };
    return { x: d.x, y: d.iy, door: d };
  }
  const d = tsp.door;
  if (inGapCol(e, d)) return { x: d.x, y: d.iy - 2, door: d, thru: true };
  const w = approach(e, d);
  if (w !== d) return w;
  return { x: d.x, y: d.y, door: d };
}
// safe house for a scared civilian: nearby, door intact, no undead inside, not toward the threat
function findRefuge(h, t) {
  let best = null, bd = 90 * 90;
  for (const b of MAP.b) {
    const d = b.door;
    if (d.broken || b.nUndead > 0 || b.nIn >= 6) continue;
    const dd = d2(h, d);
    if (dd >= bd) continue;
    if (t && d2(d, t) < d2(h, t) * 0.7) continue;
    bd = dd; best = b;
  }
  return best;
}

// move an entity to the nearest walkable spot (optionally a few px away even if its spot is free)
function unwedge(e, nudge) {
  for (let r = nudge ? 3 : 1; r <= 14; r += 1) {
    for (let a = 0; a < 12; a++) {
      const x = e.x + Math.cos((a / 12) * Math.PI * 2 + r) * r, y = e.y + Math.sin((a / 12) * Math.PI * 2 + r) * r;
      if (!blocked(x, y) && spaceOf(x, y) === e.space) { e.x = x; e.y = y; return; }
    }
  }
}

// ---------- movement -------------------------------------------------------
function tryMove(e, dx, dy) {
  const nx = e.x + dx;
  if (!blocked(nx, e.y)) e.x = nx;
  const ny = e.y + dy;
  if (!blocked(e.x, ny)) e.y = ny;
}
function steer(e, tx, ty, spd, dt, animK = 0.35, thru = false) {
  let dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  let mx = dx, my = dy;
  e.inGap = thru;
  if (e.slowT > 0) spd *= 0.55; // acid-burned
  if (thru) { // in a doorway: slide to the centre line, never sidestep into the frame
    e.detourT = 0;
    const cx = clamp(tx - e.x, -1, 1);
    mx = cx * 0.8; my = Math.sign(dy) * (1 - Math.abs(cx) * 0.5);
  } else if (e.detourT > 0) {
    e.detourT -= dt;
    mx = e.ddx * 0.85 + dx * 0.15; my = e.ddy * 0.85 + dy * 0.15;
    const m = Math.hypot(mx, my) || 1; mx /= m; my /= m;
  }
  const step = Math.min(spd * dt, d);
  const ox = e.x, oy = e.y;
  tryMove(e, mx * step, my * step);
  const moved = Math.hypot(e.x - ox, e.y - oy);
  if (!thru && step > 0.05 && moved < step * 0.3 && e.detourT <= 0) {
    let s = Math.random() < 0.5 ? 1 : -1;
    if (blocked(e.x - dy * s * 5, e.y + dx * s * 5)) s = -s;
    e.ddx = -dy * s; e.ddy = dx * s; e.detourT = rand(0.3, 0.8);
  }
  if (Math.abs(e.x - ox) > 0.01) e.dir = e.x > ox ? 1 : -1;
  e.anim += moved * animK;
  return d;
}
function wander(e, dt, spd) {
  if (e.idle > 0) { e.idle -= dt; return; }
  e.wt -= dt;
  if (Math.hypot(e.tx - e.x, e.ty - e.y) < 2 || e.wt <= 0) {
    const p = randomPointIn(e, 60);
    e.tx = p.x; e.ty = p.y; e.wt = 8;
    e.idle = Math.random() < 0.4 ? rand(0.5, 2.5) : 0;
    return;
  }
  steer(e, e.tx, e.ty, spd, dt);
}
// move a human toward a goal, opening doors on the way
function goTo(h, goal, spd, dt, animK) {
  const w = route(h, goal, goal.space);
  if (w.door && doorShut(w.door) && nearDoor(h, w.door)) openDoor(w.door);
  steer(h, w.x, w.y, spd, dt, animK, !!w.thru);
  return h.space === goal.space && d2(h, goal) < 5;
}
// nearest thing an undead can go after (humans behind walls count as further away)
function nearestPrey(u) {
  let best = null, bd = Infinity;
  for (const h of G.humans) {
    if (h.state !== 'ok') continue;
    let d = Math.hypot(h.x - u.x, h.y - u.y);
    if (h.space !== u.space) d += 25 + (h.space && doorShut(h.space.door) ? 20 : 0);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
// line of sight: false if any building (other than the one both stand in) is in the way
function los(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.ceil(Math.hypot(dx, dy) / 2.5);
  for (let i = 1; i < n; i++) {
    const x = a.x + (dx * i) / n, y = a.y + (dy * i) / n;
    const cell = cellAt(x, y);
    if (!cell) continue;
    for (const bd of cell) {
      if (x > bd.x && x < bd.x + bd.w && y > bd.y && y < bd.y + bd.h && !(a.space === bd && b.space === bd)) return false;
    }
  }
  return true;
}
// undead a human can see: same space, and no house in the way
// armed humans get taunted by blood tanks (they look 2x closer)
function nearestUndead(e, range) {
  let best = null, bd = Infinity;
  const taunt = e.kind !== 'civ';
  for (const u of G.undead) {
    if (u.dead || u.rise > 0 || u.space !== e.space) continue;
    const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
    if (d >= range * range) continue;
    const dw = taunt && u.strain === 'tank' ? d * 0.25 : d;
    if (dw < bd && los(e, u)) { bd = dw; best = u; }
  }
  return best;
}
function undeadNear(x, y, r) {
  for (const u of G.undead) if (!u.dead && (u.x - x) ** 2 + (u.y - y) ** 2 < r * r) return true;
  return false;
}
function separate() {
  const arr = [];
  for (const u of G.undead) if (!u.dead && u.rise <= 0) arr.push(u);
  for (const h of G.humans) if (h.state === 'ok') arr.push(h);
  arr.sort((a, b) => a.x - b.x);
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j];
      const R = (a.rad + b.rad) / 2;
      const dx = b.x - a.x;
      if (dx >= 5) break;
      if (dx >= R) continue;
      const dy = b.y - a.y;
      if (dy >= R || dy <= -R) continue;
      const d = Math.hypot(dx, dy);
      if (d >= R) continue;
      let nx, ny;
      if (d < 0.01) { nx = Math.random() - 0.5; ny = Math.random() - 0.5; } else { nx = dx / d; ny = dy / d; }
      const p = (R - d) * (a.inGap || b.inGap ? 1 : 0.5);
      if (!a.inGap) tryMove(a, -nx * p, -ny * p);
      if (!b.inGap) tryMove(b, nx * p, ny * p);
    }
  }
}

// ---------- effects --------------------------------------------------------
function stamp(x, y, col) { MAP.g.fillStyle = col; MAP.g.fillRect(Math.round(x), Math.round(y), 1, 1); }
function splat(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 3.5;
    stamp(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, col);
  }
}
function bleed(x, y, n, col) {
  if (G.parts.length > 900) return;
  for (let i = 0; i < n; i++) G.parts.push({ x, y, vx: rand(-20, 20), vy: rand(-32, -6), gy: y + rand(3, 7), col, stain: true });
}
function dirt(x, y, n) {
  for (let i = 0; i < n; i++) G.parts.push({ x, y, vx: rand(-14, 14), vy: rand(-26, -8), gy: y + rand(0, 2), col: pick(['#4a3522', '#6b4c30', '#2e2016']), stain: false });
}
function float(x, y, text, col) {
  if (G.floats.length > 80) G.floats.shift();
  G.floats.push({ x, y, text, col, life: 1.1 });
}

// ---------- combat ---------------------------------------------------------
function bite(u, h, dmg) {
  h.hp -= dmg * h.armor;
  // bosses get bitten constantly — only flash occasionally so they don't strobe
  if (h.kind !== 'boss' || G.time - (h.lastFlash || -9) > 0.45) { h.flash = h.kind === 'boss' ? 0.05 : 0.08; h.lastFlash = G.time; }
  bleed(h.x, h.y - 5, 4, pick(['#b01515', '#8a0f0f', '#d02020']));
  Snd.play(u.kind === 'skel' ? 'clack' : 'bite', h.x, h.y);
  if (h.hp > 0 && Math.random() < 0.5) Snd.play(h.kind === 'dog' ? 'yelp' : 'ouch', h.x, h.y, h.voice);
  if (!h.threat) h.threat = u;
  if (isMelee(h.kind) && !h.hurt && h.hp < h.maxHp * 0.35) { // the bodybuilder / bodyguard breaks and runs
    h.hurt = true; h.alerted = false; h.goal = null;
    Snd.play('scream', h.x, h.y, h.voice);
    float(h.x, h.y - 16, '!', '#ff5a5a');
  }
  if (h.hp <= 0) {
    if (h.kind === 'boss') { killBoss(h); return; }
    if (Math.random() < 0.5) Snd.play(h.kind === 'dog' ? 'yelp' : 'scream', h.x, h.y, h.voice * 0.9);
    if (u.kind === 'zombie') infectHuman(h);
    else killHuman(h);
  }
}
function killBoss(h) {
  if (h.dead) return;
  h.dead = true;
  rewardKill(h);
  const br = gain('brains', LV.clearBrains(G.L) * F.brainMult() * 1.5), bo = gain('bones', LV.clearBones(G.L) * F.boneMult() * 1.5);
  if (br > 0) float(h.x, h.y - 22, '+' + fmt(br), '#f08cb8');
  if (bo > 0) float(h.x, h.y - 28, '+' + fmt(bo), '#eadfc4');
  stampLying(h);
  splat(h.x, h.y, '#7a0e0e', 30);
  bleed(h.x, h.y - 8, 20, '#b01515');
  S.stats.bosses++;
  G.shake = 0.5;
  Snd.play('bossdie');
  toast(`ปราบบอส ${h.name} ได้แล้ว!`);
}
// thrown object (grenade / vaccine flask): lands after T seconds
function lob(from, x, y, kind) {
  G.nades.push({ x0: from.x + from.dir * 3, y0: from.y - 8, x1: x, y1: y, t: 0, T: 0.75, kind });
  Snd.play('throw', from.x, from.y);
}
function explode(x, y, r, dmg) {
  for (const u of G.undead) {
    if (u.dead || u.rise > 0) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > r) continue;
    hurtUndead(u, dmg * (1 - (d / r) * 0.5));
    if (!u.dead && d > 0.1) tryMove(u, ((u.x - x) / d) * 5, ((u.y - y) / d) * 5);
  }
  for (const h of G.humans) { // shrapnel doesn't care whose side you're on
    if (h.state !== 'ok' || h.kind === 'boss') continue;
    const d = Math.hypot(h.x - x, h.y - y);
    if (d > r * 0.7) continue;
    h.hp -= dmg * 0.3; h.flash = 0.08;
    if (h.hp <= 0) killHuman(h);
  }
  G.booms.push({ x, y, r, life: 0.45, max: 0.45 });
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(10, 45);
    G.parts.push({ x, y: y - 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - 25, gy: y + rand(-4, 5), col: pick(['#ffdf5a', '#ff8a2a', '#e04020', '#555555', '#333333']), stain: false });
  }
  for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * r * 0.6; stamp(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, pick(['#1a1510', '#2a2218', '#3a2e22'])); }
  G.shake = Math.max(G.shake, 0.3);
  Snd.play('boom', x, y);
}
// vaccine: zombies in range turn back into (confused) humans
function cureArea(x, y, r) {
  let n = 0;
  for (const u of G.undead) {
    if (u.dead || u.kind !== 'zombie' || u.immune || Math.hypot(u.x - x, u.y - y) > r) continue;
    u.dead = true; n++;
    const kind = u.big ? 'brute' : u.strain === 'dog' ? 'dog' : 'civ';
    const h = makeHuman(kind, u.x, u.y);
    if (u.strain === 'basic') { h.pal = Object.assign({}, u.pal, { s: pick(SKIN) }); h.spr = Pix.get(KIND[kind].sprite, h.pal); }
    h.space = u.space; h.cured = true;
    S.stats.cured++;
    G.humans.push(h); G.total++;
    for (let i = 0; i < 6; i++) G.parts.push({ x: u.x + rand(-3, 3), y: u.y - rand(2, 9), vx: rand(-6, 6), vy: rand(-20, -8), gy: u.y - rand(8, 16), col: pick(['#7fe0ff', '#ffffff', '#b0f0ff']), stain: false });
  }
  G.clouds.push({ x, y, r, life: 0.8, max: 0.8, cure: true });
  Snd.play('cure', x, y);
  if (n && inView(x, y)) float(x, y - 14, '-' + n, '#7fe0ff');
}
// densest group of undead to lob something at
function bestCluster(h, minD, maxD, r) {
  let best = null, bc = 0, tries = 0;
  for (const u of G.undead) {
    if (u.dead || u.rise > 0 || u.space || (h.kind === 'boss' && h.btype === 'doctor' && (u.kind === 'skel' || u.immune))) continue;
    const d = Math.hypot(u.x - h.x, u.y - h.y);
    if (d < minD || d > maxD) continue;
    if (++tries > 30) break;
    let n = 0;
    for (const v of G.undead) if (!v.dead && (v.x - u.x) ** 2 + (v.y - u.y) ** 2 < r * r) n++;
    if (n > bc) { bc = n; best = u; }
  }
  return best ? { u: best, n: bc } : null;
}
function rewardKill(h) {
  if (h.cured) { S.stats.kills++; return; } // vaccinated ex-zombies are worth nothing (no farming loop)
  // the rich bleed double · army-checkpoint soldiers carry a bounty · blood moon triples everything
  const b = gain('blood', LV.blood(G.L) * F.bloodMult() * KIND[h.kind].reward * (h.rich ? 2 : 1) * (h.bounty || 1) * (evOn('bloodmoon') ? 3 : 1));
  if (b > 0) float(h.x, h.y - 12, '+' + fmt(b), h.rich ? '#ffd84a' : '#ff5a5a');
  S.stats.kills++;
}
function infectHuman(h) {
  if (h.dead || h.state === 'infected') return;
  h.state = 'infected'; h.hp = 0;
  h.infectT = F.infectT() * rand(0.85, 1.15) * (isMelee(h.kind) ? 1.6 : 1);
  splat(h.x, h.y, '#7a0e0e', isMelee(h.kind) ? 16 : 10);
  rewardKill(h);
}
function riseHuman(h) {
  h.dead = true;
  const z = makeZombie(h.x, h.y, h.pal, h.kind);
  z.space = h.space;
  if (h.cured) { // rises vaccine-proof, gives no brains
    z.immune = true;
    G.undead.push(z); z.rise = 0.25; z.riseMax = 0.25;
    return;
  }
  if (z.big) { z.rise = 0.6; z.riseMax = 0.6; S.stats.giants++; Snd.play('roar', h.x, h.y); if (inView(h.x, h.y)) toast('ซอมบี้ยักษ์ตื่นขึ้นแล้ว!'); }
  else { z.rise = 0.25; z.riseMax = 0.25; if (Math.random() < 0.3) Snd.play('groan', h.x, h.y, z.pitch); }
  G.undead.push(z);
  const br = gain('brains', LV.brain(G.L) * F.brainMult() * KIND[h.kind].reward);
  if (br > 0 && Math.random() < 0.5) float(h.x, h.y - 14, '+' + fmt(br), '#f08cb8');
  S.stats.raised++;
}
function stampLying(h) {
  const l = h.spr.lying;
  MAP.g.drawImage(l, Math.round(h.x - l.width / 2), Math.round(h.y - l.height + 3));
}
function killHuman(h) { // killed by a skeleton — no infection
  if (h.dead) return;
  h.dead = true;
  rewardKill(h);
  gain('bones', LV.bone(G.L) * F.boneMult() * 0.5);
  stampLying(h);
  splat(h.x, h.y, '#7a0e0e', 12);
}
function hurtUndead(u, d) {
  u.hp -= d; u.flash = 0.08;
  if (u.kind === 'zombie') bleed(u.x, u.y - 5, 3, pick(['#4f6b2a', '#5a2a1a', '#3e5a22']));
  else bleed(u.x, u.y - 5, 2, '#e8e4d0');
  if (u.hp <= 0) killUndead(u);
}
function killUndead(u) {
  if (u.dead) return;
  if (u.strain === 'bomb') { zombieBlast(u, 0.6); return; } // shot bloaters still pop
  u.dead = true;
  if (u.kind === 'skel') Snd.play('bones', u.x, u.y);
  if (u.kind === 'zombie') {
    const bo = gain('bones', LV.bone(G.L) * F.boneMult() * (u.big ? 5 : 1));
    if (bo > 0) float(u.x, u.y - 12, '+' + fmt(bo), '#eadfc4');
    splat(u.x, u.y, '#3e4f22', u.big ? 16 : 8);
    stamp(u.x - 1, u.y, '#e8e4d0'); stamp(u.x + 1, u.y - 1, '#e8e4d0');
    S.stats.zdead++;
  } else {
    splat(u.x, u.y, '#d8d2bc', 7);
    G.skelQ.push(F.skelRespawn());
  }
  Snd.play('die', u.x, u.y);
}
function shoot(h, t) {
  if (h.kind === 'swat') { // 3-round bursts
    if (h.burst <= 0) h.burst = KIND.swat.burst;
    h.burst--;
    h.cd = h.burst > 0 ? 0.1 : h.rate * rand(0.85, 1.15);
  } else h.cd = h.rate * rand(0.85, 1.15);
  const hit = Math.random() < (h.kind === 'swat' ? 0.85 : 0.8);
  const ty0 = t.y - (t.big ? 8 : 5);
  const tx = t.x + (hit ? 0 : rand(-7, 7)), ty = ty0 + (hit ? 0 : rand(-7, 7));
  G.tracers.push({ x1: Math.round(h.x + h.dir * 5), y1: Math.round(h.y - 5), x2: Math.round(tx), y2: Math.round(ty), life: 0.07 });
  if (hit) hurtUndead(t, h.dmg);
  Snd.play('shot', h.x, h.y);
}
function punch(h, t) {
  h.cd = h.rate * rand(0.85, 1.1); h.punchT = 0.25;
  hurtUndead(t, h.dmg);
  const dx = t.x - h.x, dy = t.y - h.y, m = Math.hypot(dx, dy) || 1;
  if (!t.dead) tryMove(t, (dx / m) * (t.big ? 1.5 : 4), (dy / m) * (t.big ? 1.5 : 4)); // knockback
  G.parts.push({ x: t.x, y: t.y - 6, vx: 0, vy: -12, gy: t.y - 12, col: '#ffffff', stain: false });
  Snd.play('punch', h.x, h.y);
}

// ---------- AI -------------------------------------------------------------
function updUndead(u, dt) {
  if (u.flash > 0) u.flash -= dt;
  if (u.rise > 0) { u.rise -= dt; return; }
  if (u.kind === 'zombie') {
    u.hp -= u.maxHp * F.decay() * dt * (u.big ? 0.5 : 1);
    if (G.weather === 'hot' && !u.space) { // scorching sun burns rotten flesh outdoors
      u.hp -= u.maxHp * 0.008 * dt;
      if (Math.random() < dt * 1.5) G.parts.push({ x: u.x + rand(-2, 2), y: u.y - rand(6, 10), vx: rand(-3, 3), vy: rand(-14, -8), gy: u.y - 18, col: pick(['#8a8a8a', '#6a6a6a', '#b0b0a0']), stain: false });
    }
    if (u.hp <= 0) { killUndead(u); return; }
  }
  if (u.burnT > 0) { // set on fire by the flamethrower boss
    u.burnT -= dt; u.hp -= u.burnDps * dt;
    if (Math.random() < dt * 12) G.parts.push({ x: u.x + rand(-2, 2), y: u.y - rand(3, 9), vx: rand(-4, 4), vy: rand(-22, -12), gy: u.y - 14, col: pick(['#ffdf5a', '#ff8a2a', '#e04020']), stain: false });
    if (u.hp <= 0) { killUndead(u); return; }
  }
  const fr = G.frenzyT > 0 && u.kind === 'zombie' ? 1.6 : 1;
  // movement multiplier: frenzy, and cold stiffens zombies (skeletons don't mind), floodwater slows everyone
  const mv = fr * (G.weather === 'cold' && u.kind === 'zombie' ? 0.65 : 1) * (G.weather === 'flood' && !u.space ? 0.85 : 1);
  u.cd -= dt * fr; u.think -= dt;
  let t = u.target;
  if (t && (t.dead || t.state !== 'ok')) t = u.target = null;
  if (!t || u.think <= 0) { u.think = rand(0.3, 0.5); t = u.target = nearestPrey(u); }
  if (u.strain === 'bomb') { updBomber(u, t, dt, mv); return; }
  if (u.strain === 'dog' && Math.random() < dt * 0.15) Snd.play('growl', u.x, u.y);
  if (u.strain === 'spit' && t && t.space === u.space) { // stand off and spit acid
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (d <= 40 && los(u, t)) {
      u.dir = t.x >= u.x ? 1 : -1; u.lastAct = G.time;
      if (u.cd <= 0) { u.cd = 1.1; spitAt(u, t); }
      if (d < 14) { const m = d || 1; steer(u, u.x - ((t.x - u.x) / m) * 10, u.y - ((t.y - u.y) / m) * 10, u.spd * 0.6 * mv, dt); }
      return;
    }
  }
  if (t) {
    const w = route(u, t, t.space);
    const reach = u.reach + (t.rad > 4 ? 2 : 0);
    if (w.door && doorShut(w.door) && nearDoor(u, w.door)) { // closed door in the way: smash it
      u.dir = w.door.x >= u.x ? 1 : -1; u.lastAct = G.time;
      if (u.cd <= 0) { u.cd = u.kind === 'zombie' ? 1 : 0.8; bashDoor(u, w.door, u.dmg * (u.big ? 2 : 1)); }
    } else if (w === t && Math.hypot(t.x - u.x, t.y - u.y) <= reach) {
      u.dir = t.x >= u.x ? 1 : -1; u.lastAct = G.time;
      if (u.cd <= 0) { u.cd = u.kind === 'zombie' ? 1 : 0.8; bite(u, t, u.dmg); }
    } else steer(u, w.x, w.y, u.spd * mv, dt, fr > 1 ? 0.7 : 0.35, !!w.thru);
    if (fr > 1 && Math.random() < dt * 8) { // frenzy: steaming red rage + blood drool
      G.parts.push({ x: u.x + rand(-3, 3), y: u.y - rand(8, 11), vx: rand(-6, 6), vy: rand(-22, -10), gy: u.y - 22, col: pick(['#ff2020', '#ff6040', '#b00000']), stain: false });
      if (Math.random() < 0.3) G.parts.push({ x: u.x + u.dir * 2, y: u.y - 6, vx: u.dir * 4, vy: 0, gy: u.y + 1, col: '#9a0000', stain: true });
    }
  } else {
    wander(u, dt, 4);
  }
}
// ---------- strain abilities -----------------------------------------------
function spitAt(u, t) {
  G.spits.push({ x: u.x + u.dir * 3, y: u.y - 6, t, life: 1.5, from: u, dmg: u.dmg });
  Snd.play('spit', u.x, u.y);
}
function updSpits(dt) {
  for (let i = G.spits.length - 1; i >= 0; i--) {
    const s = G.spits[i], t = s.t;
    s.life -= dt;
    if (s.life <= 0 || t.dead || t.state !== 'ok') { G.spits.splice(i, 1); continue; }
    const tx = t.x, ty = t.y - 5, d = Math.hypot(tx - s.x, ty - s.y);
    if (d < 3) {
      G.spits.splice(i, 1);
      bite(s.from, t, s.dmg);
      if (t.state === 'infected') S.stats.spitKills++;
      else t.slowT = 2.5; // burning acid: the victim limps
      // splash: the acid spatters onto one person standing close by
      const o = G.humans.find((h) => h !== t && h.state === 'ok' && h.space === t.space && h.kind !== 'boss' && Math.abs(h.x - t.x) < 10 && Math.abs(h.y - t.y) < 10);
      if (o) { bite(s.from, o, s.dmg * 0.5); if (o.state === 'ok') o.slowT = 2.5; else S.stats.spitKills++; }
      for (let k = 0; k < 5; k++) G.parts.push({ x: t.x, y: t.y - 5, vx: rand(-15, 15), vy: rand(-20, -5), gy: t.y + rand(0, 3), col: pick(['#8cff3a', '#5ad020', '#c0ff80']), stain: true });
      continue;
    }
    const v = 95 * dt;
    s.x += ((tx - s.x) / d) * v; s.y += ((ty - s.y) / d) * v;
  }
}
// closest closed door with people hiding behind it
function bomberDoor(u) {
  let best = null, bd = 160 * 160;
  for (const b of MAP.b) {
    const d = b.door;
    if (d.broken || !d.closed || b.nIn - b.nUndead <= 0) continue;
    const dd = d2(u, d);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}
// bloater reached its target: it stops, swells and wobbles for a moment, then bursts
function lightFuse(u) {
  if (u.fuse > 0) return;
  u.fuse = 0.75;
  Snd.play('hiss', u.x, u.y);
}
function updBomber(u, t, dt, fr) {
  if (u.fuse > 0) {
    u.fuse -= dt;
    if (Math.random() < dt * 20) G.parts.push({ x: u.x + rand(-4, 4), y: u.y - rand(3, 9), vx: rand(-10, 10), vy: rand(-18, -6), gy: u.y + 1, col: pick(['#dcd65a', '#8cff3a', '#9a2a3a']), stain: Math.random() < 0.3 });
    if (u.fuse <= 0) zombieBlast(u);
    return;
  }
  u.think2 = (u.think2 || 0) - dt;
  if (u.think2 <= 0) { u.think2 = 0.6; u.bdoor = u.space ? null : bomberDoor(u); }
  const d = u.bdoor;
  if (d && !d.broken && d.closed) {
    if (nearDoor(u, d)) { lightFuse(u); return; }
    const w = approach(u, d);
    steer(u, w.x, w.y, u.spd * fr, dt);
    return;
  }
  if (!t) { wander(u, dt, 4); return; }
  const w = route(u, t, t.space);
  if ((w.door && doorShut(w.door) && nearDoor(u, w.door)) || (w === t && Math.hypot(t.x - u.x, t.y - u.y) <= 7)) { lightFuse(u); return; }
  steer(u, w.x, w.y, u.spd * fr, dt, 0.35, !!w.thru);
}
function zombieBlast(u, k = 1) {
  if (u.dead) return;
  u.dead = true;
  const x = u.x, y = u.y, r = 20 * (0.7 + 0.3 * k), dmg = u.dmg * k;
  G.clouds.push({ x, y: y - 2, r: r * 0.8, life: 0.9, max: 0.9, gas: true }); // green-yellow gas burst
  for (const h of G.humans) {
    if (h.state !== 'ok') continue;
    const d = Math.hypot(h.x - x, h.y - y);
    if (d > r) continue;
    h.hp -= dmg * (1 - (d / r) * 0.5) * h.armor; h.flash = 0.08;
    if (h.hp <= 0) { if (h.kind === 'boss') killBoss(h); else infectHuman(h); } // infected blast: victims rise
  }
  for (const b of MAP.b) {
    const dr = b.door;
    if (dr.broken || Math.hypot(dr.x - x, dr.cy - y) > 16) continue;
    dr.hp -= dmg * 8; dr.flash = 0.1;
    if (dr.hp <= 0) { breakDoor(dr); S.stats.bombDoors++; }
  }
  gain('bones', LV.bone(G.L) * F.boneMult());
  S.stats.blasts++; S.stats.zdead++;
  G.booms.push({ x, y, r, life: 0.45, max: 0.45 });
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(10, 45);
    G.parts.push({ x, y: y - 3, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - 25, gy: y + rand(-4, 5), col: pick(['#ffdf5a', '#ff8a2a', '#8cff3a', '#3e4f22', '#b01515']), stain: Math.random() < 0.5 });
  }
  for (let i = 0; i < 30; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 10; stamp(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, pick(['#1a1510', '#2a3a18', '#3e4f22'])); }
  G.shake = Math.max(G.shake, 0.3);
  Snd.play('boom', x, y);
}

function updHuman(h, dt) {
  if (h.flash > 0) h.flash -= dt;
  if (h.alertT > 0) h.alertT -= dt;
  if (h.fearT > 0) h.fearT -= dt;
  if (h.punchT > 0) h.punchT -= dt;
  if (h.slowT > 0) {
    h.slowT -= dt;
    if (Math.random() < dt * 6) G.parts.push({ x: h.x + rand(-2, 2), y: h.y - rand(3, 8), vx: 0, vy: 4, gy: h.y + 1, col: pick(['#8cff3a', '#5ad020']), stain: Math.random() < 0.4 });
  }
  if (h.state === 'infected') {
    h.infectT -= dt;
    if (h.infectT <= 0) riseHuman(h);
    return;
  }
  // entered / left a house this frame?
  const sp = spaceOf(h.x, h.y);
  if (sp !== h.space) {
    const prev = h.space;
    h.space = sp;
    if (sp) { h.stayT = h.alerted ? rand(15, 30) : rand(5, 14); if (Math.random() < (h.alerted ? 0.85 : 0.5)) h.closeDoor = { d: sp.door, t: 1.5, inside: true }; }
    else if (prev && !h.alerted && Math.random() < 0.3) h.closeDoor = { d: prev.door, t: 1.5, inside: false };
  }
  if (h.closeDoor) {
    const c = h.closeDoor;
    c.t -= dt;
    if ((c.inside ? h.space === c.d.b : !h.space) && closeDoor(c.d)) h.closeDoor = null;
    else if (c.t <= 0 || c.d.broken || c.d.closed) h.closeDoor = null;
  }

  h.think -= dt; h.cd -= dt;
  const thinking = h.think <= 0;
  if (thinking) {
    h.think = rand(0.2, 0.35);
    const t = nearestUndead(h, h.sight * (evOn('blackout') ? 0.35 : 1)); // pitch dark: they only notice what's right next to them
    if (t) h.threat = t;
    else if (h.fearT <= 0) h.threat = null;
  }
  if (h.threat && h.threat.dead) h.threat = null;
  const t = h.threat;
  if (h.kind === 'boss') return updBoss(h, t, dt);
  if (h.kind === 'dog') return updDog(h, t, dt);
  if (isMelee(h.kind) && !h.hurt) return updBrute(h, t, dt);
  if (h.kind === 'civ' || h.hurt) return updCiv(h, t, dt, thinking);
  return updArmed(h, t, dt);
}
// street dogs: bark, charge and bite the undead; run off yelping when badly hurt
function updDog(h, t, dt) {
  h.pose = 'walk';
  if (h.hp < h.maxHp * 0.3) {
    if (!h.hurt) { h.hurt = true; Snd.play('yelp', h.x, h.y, h.voice); }
    if (t) {
      const fx = h.x - t.x, fy = h.y - t.y, m = Math.hypot(fx, fy) || 1;
      steer(h, h.x + (fx / m) * 20, h.y + (fy / m) * 20, h.run, dt, 0.8);
    } else wander(h, dt, h.spd);
    return;
  }
  if (t) {
    if (!h.alerted) { h.alerted = true; h.barkT = 0; }
    h.barkT = (h.barkT || 0) - dt;
    if (h.barkT <= 0) { h.barkT = rand(1.4, 3); Snd.play('bark', h.x, h.y, h.voice); }
    const d = Math.hypot(t.x - h.x, t.y - h.y);
    if (d > 5) steer(h, t.x, t.y, h.run, dt, 0.8);
    else {
      h.dir = t.x >= h.x ? 1 : -1;
      if (h.cd <= 0) {
        h.cd = h.rate * rand(0.85, 1.15);
        hurtUndead(t, h.dmg);
        if (!t.dead) tryMove(t, h.dir * 1.5, 0);
        Snd.play('snarl', h.x, h.y);
      }
    }
    return;
  }
  h.alerted = false;
  wander(h, dt, h.spd);
}
function updCiv(h, t, dt, thinking) {
  const hurt = h.hurt;
  if (hurt && Math.random() < dt * 4) bleed(h.x, h.y - 4, 1, '#b01515');
  if (t) {
    h.calmT = 0;
    if (!h.alerted) { // first sight of the undead: freeze and scream
      h.alerted = true; h.shockT = hurt ? 0.15 : rand(0.35, 0.6); h.alertT = 1.4;
      h.dir = t.x >= h.x ? 1 : -1;
      if (Math.random() < 0.35) Snd.play('scream', h.x, h.y, h.voice);
    }
    if (h.shockT > 0) { h.shockT -= dt; h.pose = hurt ? 'hurt' : 'shock'; return; }
    if (thinking) planEscape(h, t);
    let spd;
    if (hurt) spd = 10;
    else if (h.tired) {
      spd = h.spd + 1; h.stamina += dt * 0.2;
      if (h.stamina > 0.6) h.tired = false;
    } else {
      spd = h.run; h.stamina -= dt / 3.5;
      if (h.stamina <= 0) { h.stamina = 0; h.tired = true; }
    }
    h.pose = hurt ? 'hurt' : h.tired ? 'walk' : 'run';
    if (!hurt && Math.random() < dt * 2) G.parts.push({ x: h.x + rand(-3, 3), y: h.y - 9, vx: rand(-8, 8), vy: rand(-18, -8), gy: h.y - 3, col: '#9fd8ff', stain: false });
    if (h.goal) {
      if (goTo(h, h.goal, spd, dt, 0.6)) { h.goal = null; if (h.fearT > 0) h.pose = 'shock'; }
      return;
    }
    if (h.space && h.fearT > 0 && t.space !== h.space) { h.pose = hurt ? 'hurt' : 'shock'; return; } // cowering indoors
    let fx = h.x - t.x, fy = h.y - t.y;
    const m = Math.hypot(fx, fy) || 1; fx /= m; fy /= m;
    const E = 24;
    if (h.x < E) fx += (E - h.x) / E;
    if (h.x > WW - E) fx -= (h.x - (WW - E)) / E;
    if (h.y < E + 10) fy += (E + 10 - h.y) / E;
    if (h.y > WH - E) fy -= (h.y - (WH - E)) / E;
    steer(h, h.x + fx * 20, h.y + fy * 20, spd, dt, h.tired && !hurt ? 0.35 : 0.6);
    return;
  }
  // calm
  h.calmT += dt;
  if (h.calmT > 3 && !hurt) { h.alerted = false; }
  h.shockT = 0;
  h.pose = hurt ? 'hurt' : 'walk';
  h.stamina = Math.min(1, h.stamina + dt * 0.15);
  if (h.stamina > 0.6) h.tired = false;
  // event crowds: dancing at the concert / cheering at the fireworks (hands up, bouncing)
  if (!h.goal && ((h.dance && evOn('concert')) || (h.watch && evOn('festival')))) {
    h.anim += dt * (h.dance ? 5 : 2);
    h.pose = Math.floor(G.time * (h.dance ? 3 : 1.5) + h.x) % 2 ? 'shock' : 'walk';
    if (h.dance && Math.random() < dt * 1.2) h.dir = -h.dir;
    if (h.watch) h.dir = G.ev.x >= h.x ? 1 : -1;
    return;
  }
  if (h.space && !h.goal) {
    h.stayT -= dt;
    if (h.stayT <= 0) {
      const d = h.space.door;
      if (undeadNear(d.x, d.y, 60) || hurt) h.stayT = rand(3, 6);
      else { const p = findFree(d.x + rand(-10, 10), d.y + rand(8, 20)); if (p) h.goal = { x: p.x, y: p.y, space: null }; }
    }
  }
  if (h.goal) {
    h.goalT -= dt;
    if (goTo(h, h.goal, hurt ? 7 : h.spd, dt) || (h.goalT <= 0 && !h.space)) h.goal = null;
    return;
  }
  if (!h.space && Math.random() < dt * (hurt ? 0.3 : 0.025)) { // go home for a while
    const b = findRefuge(h, null);
    if (b) { h.goal = interiorPoint(b); h.goalT = 20; return; }
  }
  wander(h, dt, hurt ? 5 : h.spd);
}
function planEscape(h, t) {
  if (!h.space) {
    if (!h.goal || h.goal.space === null) {
      const b = findRefuge(h, t);
      h.goal = b ? { x: rand(b.x + 4, b.x + b.w - 4), y: rand(b.y + 8, b.y + Math.max(9, b.h - 10)), space: b } : null;
    }
    return;
  }
  const b = h.space, d = b.door;
  if (t.space === b) { // it got in! run out if the door is on my side
    if (!doorShut(d) && d2(h, d) < d2(t, d)) {
      const p = findFree(d.x + rand(-14, 14), d.y + rand(14, 28));
      h.goal = p ? { x: p.x, y: p.y, space: null } : null;
    } else h.goal = null;
  } else if (!h.goal) { // pounding at the door: back into the far corner
    h.goal = { x: d.x < b.x + b.w / 2 ? b.x + b.w - 4 : b.x + 4, y: b.y + 8, space: b };
  }
}
function updBrute(h, t, dt) {
  h.pose = h.punchT > 0 ? 'punch' : 'walk';
  if (t && t.space === h.space) {
    const reach = 6 + (t.big ? 2 : 0);
    const d = Math.hypot(t.x - h.x, t.y - h.y);
    if (d > reach) steer(h, t.x, t.y, h.spd + 3, dt);
    else { h.dir = t.x >= h.x ? 1 : -1; if (h.cd <= 0) punch(h, t); }
    return;
  }
  wander(h, dt, h.spd);
}
function updArmed(h, t, dt) {
  if (h.throwT > 0) { h.throwT -= dt; h.pose = 'throw'; return; }
  h.pose = 'walk';
  h.nadeCd -= dt;
  if (h.nades > 0 && h.nadeCd <= 0 && !h.space) { // SWAT grenade at a crowd
    h.nadeCd = 1;
    const c = bestCluster(h, 25, 80, 14);
    if (c && c.n >= 3) {
      h.nades--; h.nadeCd = 5; h.throwT = 0.35; h.dir = c.u.x >= h.x ? 1 : -1;
      lob(h, c.u.x, c.u.y, 'nade');
      return;
    }
  }
  if (t) {
    const d = Math.hypot(t.x - h.x, t.y - h.y);
    if (d > h.range) steer(h, t.x, t.y, h.spd + 2, dt);
    else if (!los(h, t)) { h.threat = null; h.think = 0; } // a house is in the way — no shooting through walls
    else {
      if (d < h.range * 0.75) { // too close: back-pedal while firing, still facing the zombie
        const m = d || 1;
        steer(h, h.x - ((t.x - h.x) / m) * 12, h.y - ((t.y - h.y) / m) * 12, h.spd * 0.8, dt, 0.4);
      }
      h.dir = t.x >= h.x ? 1 : -1;
      if (h.cd <= 0) shoot(h, t);
    }
  } else if (evOn('airdrop') && G.ev.crate.age > 6 && !h.space && d2(h, G.ev.crate) < 130 * 130) { // they radio it in, then go
    steer(h, G.ev.crate.x, G.ev.crate.y, h.spd + 2, dt); // race the undead to the supply drop
  } else {
    wander(h, dt, h.spd);
  }
}
// ---------- bosses ---------------------------------------------------------
function shootAt(h, t, dmg, acc) {
  const hit = Math.random() < acc;
  const ty0 = t.y - (t.big ? 8 : 5);
  const tx = t.x + (hit ? 0 : rand(-8, 8)), ty = ty0 + (hit ? 0 : rand(-8, 8));
  G.tracers.push({ x1: Math.round(h.x + h.dir * 8), y1: Math.round(h.y - 7), x2: Math.round(tx), y2: Math.round(ty), life: 0.06 });
  if (hit) hurtUndead(t, dmg);
  Snd.play('shot', h.x, h.y);
}
function undeadAround(h, r, fn) {
  for (const u of G.undead) {
    if (u.dead || u.rise > 0 || u.space !== h.space) continue;
    const d = Math.hypot(u.x - h.x, u.y - h.y);
    if (d <= r) fn(u, d);
  }
}
// Every big boss move is a readable 3-beat: WIND-UP (pose + ground telegraph) → ATTACK → RECOVER.
// h.act = { k, t, T, ... } is the move in progress; drawBossTele() renders its telegraph.
function bossAct(h, k, T, extra) { h.act = Object.assign({ k, t: T, T }, extra); h.anim = 0; }
function flameCone(h, ax, ay, dt, gd) {
  undeadAround(h, 32, (u, du) => {
    if (du > 0.1 && ((u.x - h.x) * ax + (u.y - h.y) * ay) / du < 0.75) return;
    u.hp -= gd * 2.5 * dt; u.burnT = 2.5; u.burnDps = gd * 0.8;
    if (u.hp <= 0) killUndead(u);
  });
  for (let i = 0; i < 4; i++) {
    const s = rand(25, 60), sp = rand(-0.4, 0.4), ca = Math.cos(sp), sa = Math.sin(sp);
    G.parts.push({ x: h.x + h.dir * 9, y: h.y - 9, vx: (ax * ca - ay * sa) * s, vy: (ax * sa + ay * ca) * s - 6, gy: h.y + rand(0, 8), col: pick(['#ffdf5a', '#ff8a2a', '#e04020', '#fff3a0']), stain: false });
  }
  if (Math.random() < dt * 10) { const r = rand(8, 28); stamp(h.x + ax * r + rand(-3, 3), h.y + ay * r + rand(-2, 2), pick(['#1a1510', '#2a2218'])); } // scorched ground
  Snd.play('flame', h.x, h.y);
}
function startReload(h) {
  bossAct(h, 'reload', 1.3);
  float(h.x, h.y - 26, 'RELOAD', '#ffd84a');
  Snd.play('reload', h.x, h.y);
}
function updBoss(h, t, dt) {
  const L = G.L, gd = LV.gunDmg(L);
  h.abT -= dt; h.ab2T -= dt;
  if (h.muzzle > 0) h.muzzle -= dt;
  if (h.aimT > 0) h.aimT -= dt;
  if (h.fearT > 0) h.fearT = 0; // bosses don't cower
  h.pose = h.aimT > 0 ? 'aim' : h.punchT > 0 ? 'punch' : 'walk';
  const d = t ? Math.hypot(t.x - h.x, t.y - h.y) : 999;
  const a = h.act;
  if (a) { // a move is in progress
    a.t -= dt;
    const p = 1 - Math.max(0, a.t) / a.T;
    const tgt = t && !t.dead ? t : null;
    switch (a.k) {
      // ---- gunner: spin-up (laser sight) → long burst with recoil → reload
      case 'spin':
        h.pose = 'aim'; if (tgt) h.dir = tgt.x >= h.x ? 1 : -1;
        if (Math.random() < dt * 20) G.parts.push({ x: h.x + h.dir * 12, y: h.y - 9, vx: h.dir * rand(2, 6), vy: rand(-6, -2), gy: h.y - 12, col: '#8a8a8a', stain: false });
        if (a.t <= 0) bossAct(h, 'fire', 2.5);
        return;
      case 'fire':
        h.pose = 'aim';
        if (!tgt || !los(h, tgt)) { h.threat = null; if (a.t < a.T - 0.3) startReload(h); return; }
        h.dir = tgt.x >= h.x ? 1 : -1;
        if (h.cd <= 0) {
          h.cd = 0.07; h.anim += 1; h.muzzle = 0.05;
          shootAt(h, tgt, gd * 1.4, 0.7);
          G.parts.push({ x: h.x + h.dir * 3, y: h.y - 9, vx: -h.dir * rand(10, 20), vy: rand(-25, -15), gy: h.y + rand(0, 3), col: '#e0c040', stain: false }); // spent shells
          if (Math.random() < 0.3) tryMove(h, -h.dir * 0.4, 0); // the recoil walks him back
        }
        if (a.t <= 0) startReload(h);
        return;
      case 'reload':
        h.pose = 'walk'; h.anim = 0;
        if (a.t <= 0) { h.act = null; h.abT = 3.5; }
        return;
      // ---- flamer: pilot light + cone telegraph → 3s of fire
      case 'ignite':
        h.pose = 'aim';
        if (tgt) { h.dir = tgt.x >= h.x ? 1 : -1; a.ax = (tgt.x - h.x) / (d || 1); a.ay = (tgt.y - h.y) / (d || 1); }
        if (Math.random() < dt * 25) G.parts.push({ x: h.x + h.dir * 12, y: h.y - 9, vx: h.dir * rand(3, 8), vy: rand(-8, -2), gy: h.y - 13, col: pick(['#5ad0ff', '#ffdf5a']), stain: false });
        if (a.t <= 0) bossAct(h, 'burn', 3, { ax: a.ax, ay: a.ay });
        return;
      case 'burn': {
        h.pose = 'aim'; h.anim += dt * 14;
        if (tgt && d < 40) { // sweeps the nozzle slowly after its target
          h.dir = tgt.x >= h.x ? 1 : -1;
          const k = Math.min(1, dt * 3);
          a.ax += ((tgt.x - h.x) / (d || 1) - a.ax) * k; a.ay += ((tgt.y - h.y) / (d || 1) - a.ay) * k;
        }
        const m = Math.hypot(a.ax, a.ay) || 1;
        flameCone(h, a.ax / m, a.ay / m, dt, gd);
        if (a.t <= 0) { h.act = null; h.abT = 4; }
        return;
      }
      // ---- priest: raises the cross, a golden ring grows on the ground → holy nova
      case 'pray':
        h.pose = 'cast'; h.anim += dt * 6;
        if (Math.random() < dt * 30) { const ang = rand(0, 6.28), r = 60 * p; G.parts.push({ x: h.x + Math.cos(ang) * r, y: h.y + Math.sin(ang) * r * 0.75, vx: 0, vy: -14, gy: h.y - 40, col: pick(['#fff6c0', '#ffe070']), stain: false }); }
        if (a.t <= 0) {
          undeadAround(h, 60, (u) => hurtUndead(u, gd * 14));
          G.booms.push({ x: h.x, y: h.y - 4, r: 60, life: 0.5, max: 0.5, holy: true });
          G.shake = Math.max(G.shake, 0.25);
          Snd.play('holy', h.x, h.y);
          bossAct(h, 'amen', 0.5);
        }
        return;
      case 'amen':
        h.pose = 'cast'; h.anim = 1;
        if (a.t <= 0) { h.act = null; h.abT = 7; }
        return;
      // ---- doctor: wind up with the flask (landing spot marked in blue) → throw
      case 'windup':
        h.pose = 'throw'; h.anim = 0; h.dir = a.x >= h.x ? 1 : -1;
        if (a.t <= 0) { lob(h, a.x, a.y, 'cure'); h.flasks--; bossAct(h, 'release', 0.35); }
        return;
      case 'release':
        h.pose = 'throw'; h.anim = 1;
        if (a.t <= 0) { h.act = null; h.abT = 5.5; }
        return;
      // ---- wrestler: crouch + charge lane → shoulder charge · leap (landing ring) → slam
      case 'crouch':
        h.pose = 'charge'; h.anim = 0;
        if (Math.random() < dt * 20) G.parts.push({ x: h.x - a.dx * 6 + rand(-3, 3), y: h.y, vx: -a.dx * rand(10, 20), vy: rand(-8, -3), gy: h.y + 1, col: '#8a7a5a', stain: false });
        if (a.t <= 0) { bossAct(h, 'charge', 0.9, { dx: a.dx, dy: a.dy, hit: new Set() }); Snd.play('roar', h.x, h.y); }
        return;
      case 'charge': {
        h.pose = 'charge';
        const ox = h.x, oy = h.y;
        tryMove(h, a.dx * 60 * dt, a.dy * 60 * dt);
        h.anim += dt * 16;
        if (Math.random() < dt * 30) G.parts.push({ x: h.x - a.dx * 5, y: h.y, vx: -a.dx * 12 + rand(-5, 5), vy: rand(-10, -4), gy: h.y + 1, col: pick(['#8a7a5a', '#b0a080']), stain: false });
        undeadAround(h, 7, (u, du) => {
          if (a.hit.has(u)) return;
          a.hit.add(u);
          hurtUndead(u, gd * 5); G.shake = Math.max(G.shake, 0.12);
          if (!u.dead) tryMove(u, a.dx * 9 + ((u.x - h.x) / (du || 1)) * 3, a.dy * 9 + ((u.y - h.y) / (du || 1)) * 3);
          Snd.play('punch', h.x, h.y);
        });
        if (a.t <= 0 || Math.hypot(h.x - ox, h.y - oy) < 0.2) { h.act = null; h.abT = 6; }
        return;
      }
      case 'leap':
        h.pose = 'slam'; h.anim = 0;
        h.oy = Math.sin(Math.PI * p) * 16; // up in the air...
        if (a.t <= 0) { // ...and down
          h.oy = 0;
          undeadAround(h, 26, (u, du) => { hurtUndead(u, gd * 8); if (!u.dead && du > 0.1) tryMove(u, ((u.x - h.x) / du) * 10, ((u.y - h.y) / du) * 10); });
          G.booms.push({ x: h.x, y: h.y, r: 26, life: 0.4, max: 0.4, dust: true });
          for (let i = 0; i < 30; i++) { const ang = rand(0, 6.28); stamp(h.x + Math.cos(ang) * rand(2, 12), h.y + Math.sin(ang) * rand(1, 8), pick(['#3a2e22', '#2a2218'])); } // cratered ground
          G.shake = Math.max(G.shake, 0.45);
          Snd.play('quake', h.x, h.y);
          bossAct(h, 'land', 0.5);
        }
        return;
      case 'land':
        h.pose = 'slam'; h.anim = 1;
        if (a.t <= 0) { h.act = null; h.ab2T = 8; }
        return;
      // ---- commander: arm up, whistle, shouts orders → a SWAT squad drops in
      case 'call':
        h.pose = 'point'; h.anim = 0;
        if (a.t <= 0) {
          h.summons++;
          for (let i = 0; i < 3; i++) {
            const q = findFree(h.x + rand(-16, 16), h.y + rand(-12, 12));
            if (!q) continue;
            const s = makeHuman('swat', q.x, q.y); s.dir = h.dir;
            G.humans.push(s); G.total++;
            G.booms.push({ x: q.x, y: q.y, r: 8, life: 0.35, max: 0.35, dust: true }); dirt(q.x, q.y, 4);
          }
          Snd.play('siren');
          h.act = null; h.abT = 12;
        }
        return;
    }
    h.act = null;
  }
  if (t) h.dir = t.x >= h.x ? 1 : -1;
  switch (h.btype) {
    case 'gunner': {
      if (!t) break;
      if (d > 95) { steer(h, t.x, t.y, h.spd, dt); return; }
      if (!los(h, t)) { h.threat = null; break; }
      if (h.abT <= 0) { bossAct(h, 'spin', 0.8); Snd.play('spinup', h.x, h.y); return; }
      h.pose = 'aim'; // tracking the target between bursts
      if (d > 70) steer(h, t.x, t.y, h.spd * 0.6, dt);
      return;
    }
    case 'flamer': {
      if (!t) break;
      if (d > 24) { steer(h, t.x, t.y, h.spd, dt); return; }
      if (h.abT <= 0) { bossAct(h, 'ignite', 0.6, { ax: (t.x - h.x) / (d || 1), ay: (t.y - h.y) / (d || 1) }); Snd.play('hiss', h.x, h.y); }
      return;
    }
    case 'priest': { // holy aura burns nearby undead; periodic nova after a visible prayer
      undeadAround(h, 32, (u) => { u.hp -= gd * 1.5 * dt; if (u.hp <= 0) killUndead(u); });
      if (Math.random() < dt * 8) { const ang = rand(0, 6.28); G.parts.push({ x: h.x + Math.cos(ang) * 30, y: h.y + Math.sin(ang) * 22, vx: 0, vy: -10, gy: h.y - 30, col: '#fff6c0', stain: false }); }
      if (h.abT <= 0) {
        let n = 0; undeadAround(h, 60, () => n++);
        if (n >= 3) { bossAct(h, 'pray', 1.1); Snd.play('chant', h.x, h.y); return; }
        h.abT = 1;
      }
      if (t && d > 16) { steer(h, t.x, t.y, h.spd, dt); return; }
      if (t) return;
      break;
    }
    case 'doctor': { // keeps distance, lobs vaccine that turns zombies back into people
      if (h.abT <= 0 && h.flasks > 0) {
        const c = bestCluster(h, 20, 95, 18);
        if (c) { bossAct(h, 'windup', 0.55, { x: c.u.x, y: c.u.y }); return; }
        h.abT = 1.5;
      }
      if (t && d < 35) { // back off, snapping a pistol shot over the shoulder
        const fx = h.x - t.x, fy = h.y - t.y, m = Math.hypot(fx, fy) || 1;
        steer(h, h.x + (fx / m) * 20, h.y + (fy / m) * 20, h.spd, dt, 0.6);
        h.dir = t.x >= h.x ? 1 : -1;
      }
      if (t && h.cd <= 0 && los(h, t)) { h.cd = 1.2; h.aimT = 0.3; h.muzzle = 0.05; shootAt(h, t, gd, 0.8); }
      if (t) return;
      break;
    }
    case 'wrestler': {
      if (h.ab2T <= 0) {
        let n = 0; undeadAround(h, 26, () => n++);
        if (n >= 4) { bossAct(h, 'leap', 0.6); Snd.play('scream', h.x, h.y, 0.45); return; }
        h.ab2T = 1;
      }
      if (h.abT <= 0) { // charge through the thickest pack a little way off
        const c = bestCluster(h, 18, 75, 12);
        if (c && los(h, c.u)) {
          const cd = Math.hypot(c.u.x - h.x, c.u.y - h.y);
          bossAct(h, 'crouch', 0.65, { dx: (c.u.x - h.x) / cd, dy: (c.u.y - h.y) / cd });
          h.dir = c.u.x >= h.x ? 1 : -1;
          return;
        }
        h.abT = 1;
      }
      if (!t) break;
      if (d > 8) { steer(h, t.x, t.y, h.spd, dt); return; }
      if (h.cd <= 0) { h.cd = 0.8; h.punchT = 0.25; hurtUndead(t, gd * 6); if (!t.dead) tryMove(t, h.dir * 6, 0); G.shake = Math.max(G.shake, 0.1); Snd.play('punch', h.x, h.y); }
      return;
    }
    case 'commander': { // pistol + calls in SWAT squads
      if (h.abT <= 0 && h.summons < 5 && G.undead.length > 3) {
        bossAct(h, 'call', 1);
        Snd.play('whistle', h.x, h.y);
        if (inView(h.x, h.y)) toast(`${h.name}: "เรียกกำลังเสริม!"`);
        return;
      }
      if (!t) break;
      if (d > 65) { steer(h, t.x, t.y, h.spd, dt); return; }
      if (!los(h, t)) { h.threat = null; break; }
      if (h.cd <= 0) { h.cd = 0.6; h.aimT = 0.35; h.muzzle = 0.05; shootAt(h, t, gd * 2, 0.85); }
      return;
    }
  }
  wander(h, dt, h.spd * 0.7);
}
// ground telegraphs for the boss move being wound up (drawn under everyone)
function drawBossTele(b) {
  const a = b.act;
  if (!a || b.dead) return;
  const p = 1 - Math.max(0, a.t) / a.T, blink = Math.floor(G.time * 12) % 2;
  const ell = (x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2); ctx.fill(); };
  switch (a.k) {
    case 'spin': { // laser sight
      const t = b.threat;
      if (!t || t.dead) break;
      const x0 = Math.round(b.x + b.dir * 14), y0 = Math.round(b.y - 9), x1 = Math.round(t.x), y1 = Math.round(t.y - 5);
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
      ctx.fillStyle = blink ? '#ff2020' : '#ff8080';
      for (let i = 0; i <= n; i++) if ((i + Math.floor(G.time * 20)) % 3) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
      ring(x1, y1 + 5, 4, '#ff2020');
      break;
    }
    case 'ignite': case 'burn': { // fire cone on the ground
      const ang = Math.atan2(a.ay, a.ax), r = a.k === 'burn' ? 32 : 32 * p;
      ctx.fillStyle = a.k === 'burn' ? 'rgba(255,120,30,.16)' : `rgba(255,60,20,${0.12 + 0.12 * blink})`;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, Math.max(1, r), ang - 0.72, ang + 0.72); ctx.closePath(); ctx.fill();
      break;
    }
    case 'pray':
      ell(b.x, b.y, Math.max(1, 60 * p), 'rgba(255,230,120,.14)');
      ring(Math.round(b.x), Math.round(b.y), 60 * p, blink ? '#ffe070' : '#fff6c0');
      ring(Math.round(b.x), Math.round(b.y), 60, 'rgba(255,230,120,.5)');
      break;
    case 'windup': ell(a.x, a.y, 18, `rgba(127,224,255,${0.1 + 0.12 * blink})`); ring(Math.round(a.x), Math.round(a.y), 18, '#7fe0ff'); break;
    case 'crouch': { // charge lane + arrow head
      ctx.fillStyle = `rgba(255,40,40,${0.15 + 0.15 * blink})`;
      for (let i = 4; i < 54; i += 2) ctx.fillRect(Math.round(b.x + a.dx * i) - 2, Math.round(b.y + a.dy * i) - 1, 4, 3);
      const hx = b.x + a.dx * 56, hy = b.y + a.dy * 56;
      ctx.fillStyle = '#ff3030';
      for (let k = 0; k < 6; k++) {
        ctx.fillRect(Math.round(hx - a.dx * k - a.dy * k * 0.8), Math.round(hy - a.dy * k + a.dx * k * 0.8), 1, 1);
        ctx.fillRect(Math.round(hx - a.dx * k + a.dy * k * 0.8), Math.round(hy - a.dy * k - a.dx * k * 0.8), 1, 1);
      }
      break;
    }
    case 'leap': ell(b.x, b.y, 26, `rgba(255,40,40,${0.12 + 0.2 * p})`); ring(Math.round(b.x), Math.round(b.y), 26 * (1.3 - 0.3 * p), '#ff3030'); break;
    case 'call': ring(Math.round(b.x), Math.round(b.y), 16 * p + 4, blink ? '#5a8cff' : '#b0c8ff'); break;
  }
}

// ---------- SWAT reinforcements -------------------------------------------
function sendVan(kind = 'swat') {
  const y = pick(MAP.ys), fromLeft = Math.random() < 0.5;
  const army = kind === 'soldier';
  G.vans.push({ x: fromLeft ? -30 : WW + 30, y, dir: fromLeft ? 1 : -1, stopX: rand(WW * 0.25, WW * 0.75), state: 'drive', n: Math.min(8, (army ? 4 : 3) + Math.floor(G.L / 10)), t: 0, kind, army });
  if (!army) { G.vanCount++; toast('หน่วย SWAT กำลังมา!'); }
  Snd.play('siren');
}
function updVans(dt) {
  if (!G.cleared && G.L >= 5) {
    const alive = G.humans.reduce((n, h) => n + (h.state === 'ok'), 0);
    const lost = 1 - alive / G.total0;
    const thresholds = G.L >= 15 ? [0.3, 0.6] : [0.35];
    if (G.vanCount < thresholds.length && lost > thresholds[G.vanCount] && alive > 0) sendVan();
  }
  for (let i = G.vans.length - 1; i >= 0; i--) {
    const v = G.vans[i];
    v.t -= dt;
    if (v.state === 'drive') {
      v.x += v.dir * 70 * dt;
      if ((v.stopX - v.x) * v.dir <= 0) { v.state = 'unload'; v.t = 0.4; }
    } else if (v.state === 'unload') {
      if (v.t <= 0) {
        v.t = 0.35;
        const p = findFree(v.x - v.dir * 13, v.y + 2);
        if (p) {
          const h = makeHuman(v.kind || 'swat', p.x, p.y);
          h.dir = -v.dir;
          if (v.army) h.bounty = 3;
          G.humans.push(h); G.total++;
        }
        if (--v.n <= 0) { v.state = 'wait'; v.t = 2.5; }
      }
    } else if (v.state === 'wait') {
      if (v.t <= 0) v.state = 'leave';
    } else {
      v.x += v.dir * 80 * dt;
      if (v.x < -40 || v.x > WW + 40) G.vans.splice(i, 1);
    }
  }
}

// ---------- player actions -------------------------------------------------
const curStrain = () => (strainUnlocked(S.settings.strain) ? S.settings.strain : 'basic');
function spawnZombieAt(x, y, free, strain = 'basic') {
  if (G.undead.length >= 600) return false;
  if (!free) G.energy -= strainCost(strain);
  const z = makeZombie(x, y, null, 'civ', strain);
  G.undead.push(z);
  dirt(x, y, 6);
  S.stats.placed++;
  Snd.play('spawn', x, y);
  if (S.tutorial) { S.tutorial = false; $('tip').classList.add('hidden'); }
  return true;
}
// click to raise 1 / 2 / 3 zombies (extra ones fan out in a ring around the click)
function playerSpawn(x, y) {
  if (G.cleared) return;
  if (x < 0 || y < 0 || x > WW || y > WH) return;
  const s = curStrain(), c = strainCost(s), n = S.settings.spawnN || 1;
  if (G.energy < c) { UI.energyFlash = 0.4; return; }
  const base = findFree(x, y);
  if (!base) return;
  const a0 = rand(0, Math.PI * 2);
  for (let i = 0; i < n && G.energy >= c; i++) {
    let p = base;
    if (i > 0) {
      const a = a0 + (i / n) * Math.PI * 2, rr = rand(7, 11);
      p = findFree(base.x + Math.cos(a) * rr, base.y + Math.sin(a) * rr * 0.8);
      if (!p) continue;
    }
    spawnZombieAt(p.x, p.y, false, s);
  }
}
// spend ALL energy at once — each zombie claws out next to a different random victim, spread over the city
function spawnAll() {
  if (!G || G.cleared) return;
  const s = curStrain(), c = strainCost(s), n = Math.floor(G.energy / c);
  if (!n) { UI.energyFlash = 0.4; return; }
  let made = 0;
  for (let i = 0; i < n; i++) if (spawnNearHuman(false, s)) made++;
  if (made) { toast(`ปลุกซอมบี้ ${made} ตัวทั่วเมือง!`); G.shake = Math.max(G.shake, 0.25); Snd.play('groan', null, null, 0.8); }
}
function spawnNearHuman(free, strain = 'basic') {
  const alive = G.humans.filter((h) => h.state === 'ok');
  if (!alive.length) return false;
  for (let i = 0; i < 14; i++) {
    const h = pick(alive);
    const c = h.space ? h.space.door : h;
    const a = rand(0, Math.PI * 2), r = h.space ? rand(4, 14) : rand(16, 32);
    const x = c.x + Math.cos(a) * r, y = c.y + Math.abs(Math.sin(a)) * r * (h.space ? 1 : Math.sign(Math.sin(a)) || 1);
    if (freeOutside(x, y)) return spawnZombieAt(x, y, free, strain);
  }
  return false;
}
function castSpell(id, x, y) {
  const lv = S.spells[id];
  if (!lv || CD[id] > 0 || G.cleared) return false;
  const sp = SPELL[id];
  if (id === 'frenzy') {
    G.frenzyT = sp.dur(lv);
    G.shake = Math.max(G.shake, 0.5);
    let k = 0;
    for (const u of G.undead) { // every zombie lets out a burst of rage
      if (u.kind !== 'zombie' || u.rise > 0 || !inView(u.x, u.y) || ++k > 60) continue;
      G.booms.push({ x: u.x, y: u.y - 5, r: 9, life: 0.4, max: 0.4, rage: true });
    }
    Snd.play('frenzy');
  } else if (id === 'plague') {
    if (x == null) { targeting = 'plague'; return false; }
    const r = sp.rad(lv);
    G.clouds.push({ x, y, r, life: 1.6, max: 1.6 });
    for (const h of G.humans) {
      if (h.state !== 'ok' || h.space || Math.hypot(h.x - x, h.y - y) > r) continue; // walls keep the fog out
      if (h.kind === 'boss') { h.hp -= h.maxHp * 0.15; h.flash = 0.1; if (h.hp <= 0) killBoss(h); } // bosses resist the plague
      else infectHuman(h);
    }
    targeting = null;
  } else if (id === 'raise') {
    const n = sp.n(lv);
    for (let i = 0; i < n; i++) spawnNearHuman(true);
  }
  CD[id] = sp.cd(lv);
  Snd.play('spell');
  return true;
}
function autoCast() {
  const alive = G.humans.filter((h) => h.state === 'ok');
  if (!alive.length) return;
  if (S.spells.frenzy && CD.frenzy <= 0 && G.frenzyT <= 0 && G.undead.length >= 3) castSpell('frenzy');
  if (S.spells.raise && CD.raise <= 0) castSpell('raise');
  const out = alive.filter((h) => !h.space && h.kind !== 'boss'); // the fog can't reach people indoors
  if (S.spells.plague && CD.plague <= 0 && out.length) {
    const r = SPELL.plague.rad(S.spells.plague);
    let best = null, bc = 0;
    for (let i = 0; i < Math.min(30, out.length); i++) {
      const c = pick(out);
      let n = 0;
      for (const h of out) if (Math.hypot(h.x - c.x, h.y - c.y) <= r) n++;
      if (n > bc) { bc = n; best = c; }
    }
    if (best && (bc >= 3 || bc >= out.length)) castSpell('plague', best.x, best.y);
  }
}

// ---------- random events ----------------------------------------------------
function plazaPoint() { // an open spot on a road crossing
  for (let i = 0; i < 30; i++) {
    const p = findFree(pick(MAP.xs) + rand(-4, 4), pick(MAP.ys) + rand(-4, 4));
    if (p && !inGrave(p.x, p.y) && p.x > 30 && p.x < WW - 30 && p.y > 30 && p.y < WH - 20) return p;
  }
  return randomFree(true);
}
function startEvent(k) {
  const def = EVENTS[k];
  const e = G.ev = { k, t: def.dur, T: def.dur };
  G.evN++;
  if (k === 'festival') { // fireworks over a crossing: people pour out of their houses to watch
    const p = plazaPoint(); e.x = p.x; e.y = p.y; e.fwT = 0.3;
    for (const h of G.humans) {
      if (h.state !== 'ok' || h.kind !== 'civ' || h.hurt || h.alerted || h.rich || Math.random() > 0.75) continue;
      const q = findFree(p.x + rand(-28, 28), p.y + rand(-18, 18));
      if (q) { h.goal = { x: q.x, y: q.y, space: null }; h.goalT = 30; h.watch = true; }
    }
  } else if (k === 'concert') { // a mor lam stage pops up and a crowd gathers to dance
    const p = plazaPoint(); e.x = p.x; e.y = p.y;
    const n = Math.min(40, 8 + Math.floor(G.L / 3));
    for (let i = 0; i < n; i++) {
      const q = findFree(p.x + rand(-22, 22), p.y + rand(6, 22));
      if (!q) continue;
      const h = makeHuman('civ', q.x, q.y);
      h.dance = true; h.dir = -1; h.anim = rand(0, 2);
      G.humans.push(h); G.total++; G.total0++;
    }
  } else if (k === 'army') {
    sendVan('soldier');
  } else if (k === 'airdrop') { // a supply crate parachutes in — zombies race the gunmen for it
    const p = randomFree(true);
    e.crate = { x: p.x, y: p.y, drop: 2 };
  }
  toast(`${def.name}! ${def.desc}`);
  Snd.play('event');
  UI.evDirty = true;
}
function endEvent() {
  const e = G.ev;
  if (!e) return;
  for (const h of G.humans) { h.watch = false; h.dance = false; }
  if (e.k === 'airdrop' && e.crate && !e.claimed && !G.cleared) toast('กล่องเสบียงถูกทิ้งไว้จนพังเสียหาย');
  G.ev = null;
  G.evT = rand(35, 60);
  UI.evDirty = true;
}
function claimCrate(byUndead) {
  const e = G.ev, c = e.crate;
  e.claimed = true;
  if (byUndead) {
    const br = gain('brains', LV.clearBrains(G.L) * 0.6 * F.brainMult()), bo = gain('bones', LV.clearBones(G.L) * 0.6 * F.boneMult());
    G.energy = F.eMax();
    float(c.x, c.y - 12, '+' + fmt(br), '#f08cb8'); float(c.x, c.y - 18, '+' + fmt(bo), '#eadfc4');
    toast('ซอมบี้ชิงกล่องเสบียงได้! สมอง + กระดูก + พลังงานเต็ม');
    Snd.play('clear');
  } else { // the living patch themselves up
    for (const h of G.humans) if (h.state === 'ok' && Math.hypot(h.x - c.x, h.y - c.y) < 60) { h.hp = h.maxHp; h.hurt = false; }
    toast('มนุษย์ชิงกล่องเสบียงไปได้ — คนรอบๆ ฟื้นเลือดเต็ม!');
    Snd.play('cure', c.x, c.y);
  }
  for (let i = 0; i < 14; i++) G.parts.push({ x: c.x, y: c.y - 3, vx: rand(-25, 25), vy: rand(-40, -15), gy: c.y + rand(-2, 3), col: pick(['#b07a2a', '#6a4a1a', '#f0f0f0', '#e03030']), stain: false });
  endEvent();
}
function updEvents(dt) {
  // fireworks / floating lanterns live on even after the festival ends
  for (let i = G.fw.length - 1; i >= 0; i--) {
    const p = G.fw[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.lan ? 0 : 22) * dt;
    if (p.life <= 0) G.fw.splice(i, 1);
  }
  if (G.cleared) return;
  const e = G.ev;
  if (!e) {
    if (G.L < 3 || G.evN >= 3 || (G.evT -= dt) > 0) return;
    G.evT = rand(40, 65);
    let alive = 0;
    for (const h of G.humans) if (h.state === 'ok') alive++;
    if (alive < 8) return;
    startEvent(pick(Object.keys(EVENTS).filter((k) => G.L >= (EVENTS[k].from || 3))));
    return;
  }
  e.t -= dt;
  if (e.k === 'festival') {
    if ((e.fwT -= dt) <= 0) {
      e.fwT = rand(0.35, 0.9);
      const x = e.x + rand(-45, 45), y = e.y - rand(35, 70), col = pick(['#ff5a5a', '#ffd23a', '#5ad0ff', '#8cff3a', '#ff8ab0', '#ffffff']);
      for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2, s = rand(18, 30); G.fw.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.7, 1.1), col }); }
      if (Math.random() < 0.5) G.fw.push({ x: e.x + rand(-30, 30), y: e.y - 4, vx: rand(-2, 2), vy: -9, life: 6, col: '#ff9a2a', lan: true });
      Snd.play('firework', x, e.y);
    }
  } else if (e.k === 'concert') {
    if (Math.random() < dt * 3) G.parts.push({ x: e.x + rand(-12, 12), y: e.y - 12, vx: rand(-6, 6), vy: -16, gy: e.y - 34, col: pick(['#ffd23a', '#ff8ab0', '#5ad0ff']), stain: false });
    if (Math.random() < dt * 1.2) Snd.play('drum', e.x, e.y);
  } else if (e.k === 'airdrop' && e.crate) {
    const c = e.crate;
    if (c.drop > 0) {
      c.drop -= dt;
      if (c.drop <= 0) { dirt(c.x, c.y, 6); Snd.play('bash', c.x, c.y); }
    } else {
      c.age = (c.age || 0) + dt;
      for (const u of G.undead) if (!u.dead && u.rise <= 0 && !u.space && Math.abs(u.x - c.x) < 6 && Math.abs(u.y - c.y) < 5) { claimCrate(true); return; }
      for (const h of G.humans) if (h.state === 'ok' && h.kind !== 'civ' && h.kind !== 'dog' && Math.abs(h.x - c.x) < 6 && Math.abs(h.y - c.y) < 5) { claimCrate(false); return; }
    }
  }
  if (e.t <= 0) endEvent();
}

// ---------- level flow -----------------------------------------------------
function clearLevel() {
  G.cleared = true; G.clearT = 3.5;
  const L = G.L, R = G.route;
  const br = gain('brains', LV.clearBrains(L) * F.brainMult() * (R.clear || 1)), bo = gain('bones', LV.clearBones(L) * F.boneMult());
  S.stats.cleared++;
  S.maxLevel = Math.max(S.maxLevel, L + 1);
  // clearing the frontier level → the route map offers a choice of districts for the next one
  const fresh = L + 1 === S.maxLevel && L + 1 >= 3 && !S.routes[L + 1];
  S.stats.bestLevel = Math.max(S.stats.bestLevel, S.maxLevel);
  targeting = null;
  if (G.ev) endEvent();
  Snd.play('clear');
  G.choices = fresh ? rollRoutes(L + 1) : null;
  if (G.choices) G.clearT = S.settings.autoNext ? 12 : 8;
  const nextTxt = S.settings.autoNext ? (G.choices ? 'สุ่มเลือกเส้นทางให้' : 'ไปด่านถัดไป') : 'เริ่มด่านเดิมอีกครั้ง';
  const grow = worldSize(L + 1).k > worldSize(L).k ? '<div class="bgrow">ด่านถัดไปแมพจะกว้างขึ้น!</div>' : '';
  const boss = isBossLevel(L + 1) ? '<div class="bgrow">ด่านถัดไปมีบอส!</div>' : '';
  const cards = G.choices ? `<div class="rtitle">เลือกเส้นทางบุกด่าน ${L + 1}</div><div class="routes">${G.choices.map((id) => {
    const r = ROUTES[id];
    return `<button class="route" data-r="${id}"><img src="${Pix.icon(r.icon)}" alt=""><b>${r.name}</b><span>${r.desc}</span></button>`;
  }).join('')}</div>` : '';
  showBanner(`
    <div class="bt">ด่าน ${L} ผ่านแล้ว!</div>
    <div class="bsub">เมืองนี้ตกเป็นของกองทัพซอมบี้</div>
    <div class="brew"><span><img src="${Pix.icon('brain')}">+${fmt(br)}</span><span><img src="${Pix.icon('bone')}">+${fmt(bo)}</span></div>
    ${grow}${boss}${cards}
    <div class="bnext">${nextTxt}ใน <b id="bCount">3</b> วิ</div>
    <div class="bbtns">${G.choices ? '' : '<button class="px-btn go" id="bNext">ด่านต่อไป ▶</button>'}<button class="px-btn" id="bRepeat">เล่นซ้ำ ↻</button></div>`);
  if (G.choices) document.querySelectorAll('#banner .route').forEach((b) => { b.onclick = () => chooseRoute(L + 1, b.dataset.r); });
  else $('bNext').onclick = () => goLevel(L + 1);
  $('bRepeat').onclick = () => goLevel(L);
  save();
}
function chooseRoute(L, id) {
  S.routes[L] = id;
  Snd.play('buy');
  goLevel(L);
}
function advance() {
  if (!S.settings.autoNext) { goLevel(G.L); return; }
  if (G.choices) chooseRoute(G.L + 1, pick(G.choices)); // idle: the horde wanders off in a random direction
  else goLevel(G.L + 1);
}

// ---------- weather --------------------------------------------------------
function updWeather(dt) {
  const w = G.weather;
  if (w === 'flood') {
    // the current wanders in direction and strength — everyone outdoors gets pushed around
    const t = G.time;
    const a = G.curA + Math.sin(t * 0.23) * 1.3 + Math.sin(t * 0.61) * 0.6, m = 5 + 3.5 * Math.sin(t * 0.5 + 1);
    G.cur.x = Math.cos(a) * m; G.cur.y = Math.sin(a) * m;
    const push = (e) => { if (!e.space && !e.dead) tryMove(e, G.cur.x * dt, G.cur.y * dt); };
    for (const u of G.undead) if (u.rise <= 0) push(u);
    for (const h of G.humans) if (h.state === 'ok') push(h);
    // drifting debris and ripples
    if (G.sky.length < 60 + WW * WH / 3000) G.sky.push({ x: rand(0, WW), y: rand(12, WH), k: Math.random() < 0.15 ? 'junk' : 'wave', life: rand(3, 7) });
    for (let i = G.sky.length - 1; i >= 0; i--) {
      const p = G.sky[i];
      p.x += G.cur.x * dt * 1.4; p.y += G.cur.y * dt * 1.4; p.life -= dt;
      if (p.life <= 0 || p.x < 0 || p.x > WW || p.y < 0 || p.y > WH) G.sky.splice(i, 1);
    }
    G.thunderT -= dt;
    if (G.thunderT <= 0) { G.thunderT = rand(14, 30); G.flashT = 0.18; Snd.play('thunder'); }
  }
  if (G.flashT > 0) G.flashT -= dt;
}

// ---------- main update ----------------------------------------------------
function update(dt) {
  G.time += dt;
  S.stats.play += dt;
  G.energy = Math.min(F.eMax(), G.energy + F.eRegen() * dt);
  for (const k in CD) if (k !== 'frenzy' || G.frenzyT <= 0) CD[k] = Math.max(0, CD[k] - dt);
  if (G.frenzyT > 0) G.frenzyT -= dt;
  for (let i = G.skelQ.length - 1; i >= 0; i--) {
    G.skelQ[i] -= dt;
    if (G.skelQ[i] <= 0) { G.skelQ.splice(i, 1); spawnSkel(); }
  }
  // who is in which house
  for (const b of MAP.b) { b.nIn = 0; b.nUndead = 0; if (b.door.anim > 0) b.door.anim -= dt; if (b.door.flash > 0) b.door.flash -= dt; }
  for (const u of G.undead) { u.space = spaceOf(u.x, u.y); if (u.space) { u.space.nIn++; u.space.nUndead++; } }
  for (const h of G.humans) if (h.space) h.space.nIn++;

  if (!G.cleared) {
    const st = curStrain();
    if (U('auto') && S.settings.autoSpawn !== false && G.energy >= F.eMax() - 0.01 && G.energy >= strainCost(st)) {
      if (spawnNearHuman(false, st) === false) G.energy = F.eMax() * 0.99;
    }
    if (U('autoCast') && S.settings.autoCast) autoCast();
  }
  for (let i = 0; i < G.undead.length; i++) updUndead(G.undead[i], dt);
  for (let i = 0; i < G.humans.length; i++) updHuman(G.humans[i], dt);
  G.undead = G.undead.filter((u) => !u.dead);
  G.humans = G.humans.filter((h) => !h.dead);
  separate();
  updVans(dt);
  updSpits(dt);
  updWeather(dt);
  updEvents(dt);
  if (G.undead.length > S.stats.maxUndead) S.stats.maxUndead = G.undead.length;
  if (MAP.bts) { // BTS skytrain glides past every so often
    if (G.train) { G.train.x += G.train.dir * 90 * dt; if (G.train.x < -90 || G.train.x > WW + 90) { G.train = null; G.trainT = rand(12, 25); } }
    else if ((G.trainT -= dt) <= 0) { const d = Math.random() < 0.5 ? 1 : -1; G.train = { x: d > 0 ? -85 : WW + 85, dir: d }; Snd.play('train'); }
  }

  // grenades / vaccine flasks in flight
  for (let i = G.nades.length - 1; i >= 0; i--) {
    const n = G.nades[i];
    n.t += dt;
    if (n.t >= n.T) {
      G.nades.splice(i, 1);
      if (n.kind === 'cure') cureArea(n.x1, n.y1, 18);
      else explode(n.x1, n.y1, 18, LV.gunDmg(G.L) * 12);
    }
  }
  for (let i = G.booms.length - 1; i >= 0; i--) { G.booms[i].life -= dt; if (G.booms[i].life <= 0) G.booms.splice(i, 1); }
  if (G.shake > 0) G.shake -= dt;

  // watchdog: free anything wedged in a wall or making no progress
  G.stuckT -= dt;
  if (G.stuckT <= 0) {
    G.stuckT = 1.5;
    for (const e of [...G.undead, ...G.humans]) {
      if (e.dead || e.rise > 0 || (e.t === 'h' && e.state !== 'ok')) continue;
      if (blocked(e.x, e.y)) { unwedge(e); continue; }
      const moved = e.px == null ? 99 : Math.hypot(e.x - e.px, e.y - e.py);
      e.px = e.x; e.py = e.y;
      const busy = e.t === 'u' ? !e.target || G.time - (e.lastAct || -9) < 2 : !e.goal;
      if (moved < 0.8 && !busy) {
        e.stuckN = (e.stuckN || 0) + 1;
        const a = rand(0, Math.PI * 2);
        e.ddx = Math.cos(a); e.ddy = Math.sin(a); e.detourT = 1.2; e.inGap = false;
        if (e.stuckN >= 3) { unwedge(e, true); e.stuckN = 0; if (e.t === 'h') e.goal = null; }
      } else e.stuckN = 0;
    }
  }

  // ambient groans — kept sparse so a big horde doesn't become a wall of noise
  G.groanT -= dt;
  if (G.groanT <= 0) {
    G.groanT = rand(2.5, 6) / Math.min(1.6, 1 + G.undead.length / 80);
    const vis = G.undead.filter((u) => u.kind === 'zombie' && u.rise <= 0 && inView(u.x, u.y));
    if (vis.length) { const z = pick(vis); Snd.play(z.big ? 'roar' : 'groan', z.x, z.y, z.pitch); }
  }

  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.vy += 90 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.y >= p.gy && p.vy > 0) {
      if (p.stain) stamp(p.x, p.gy, p.col);
      G.parts.splice(i, 1);
    }
  }
  for (let i = G.floats.length - 1; i >= 0; i--) {
    const f = G.floats[i];
    f.y -= 14 * dt; f.life -= dt;
    if (f.life <= 0) G.floats.splice(i, 1);
  }
  for (let i = G.tracers.length - 1; i >= 0; i--) { G.tracers[i].life -= dt; if (G.tracers[i].life <= 0) G.tracers.splice(i, 1); }
  for (let i = G.clouds.length - 1; i >= 0; i--) { G.clouds[i].life -= dt; if (G.clouds[i].life <= 0) G.clouds.splice(i, 1); }

  if (!G.cleared && G.humans.length === 0) clearLevel();
  if (G.cleared) {
    G.clearT -= dt;
    if (G.clearT <= 0) advance();
  }
}

// ---------- rendering (world units; camera transform applied) --------------
function px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
function line(x0, y0, x1, y1, c) {
  ctx.fillStyle = c;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if ((x0 === x1 && y0 === y1) || ++n > 400) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function ring(cx, cy, r, c) {
  const steps = Math.max(12, Math.round(r * 6));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.75), c);
  }
}
function bubble(x, y) { // "!" speech bubble, x = centre, y = top
  ctx.fillStyle = '#000'; ctx.fillRect(x - 3, y - 1, 7, 9); ctx.fillRect(x - 1, y + 8, 2, 1);
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, y, 5, 7); ctx.fillRect(x - 1, y + 7, 1, 1);
  ctx.fillStyle = '#e02020'; ctx.fillRect(x, y + 1, 1, 3); ctx.fillRect(x, y + 5, 1, 1);
}
// roof + facade (fades) and the door, drawn in y-order with the units
function drawBuilding(b) {
  const d = b.door, a = b.roofA;
  if (a > 0.01) {
    ctx.globalAlpha = a;
    ctx.drawImage(MAP.roof, b.x - 1, b.y - 1, b.w + 2, b.h + 1, b.x - 1, b.y - 1, b.w + 2, b.h + 1);
    // facade door
    const x = d.dx + 1, y = b.y + b.h - 6;
    if (d.broken) {
      ctx.fillStyle = '#0d0806'; ctx.fillRect(x, y, 4, 6);
      ctx.fillStyle = d.wood; ctx.fillRect(x, y, 1, 2); ctx.fillRect(x + 3, y + 4, 1, 2);
    } else if (!d.closed || d.anim > 0) {
      ctx.fillStyle = '#140c08'; ctx.fillRect(x, y, 4, 6);
      ctx.fillStyle = shade(d.wood, -20); ctx.fillRect(x, y, 1, 6);
      if (b.nIn) { ctx.fillStyle = '#f7e07a'; ctx.fillRect(x + 2, y + 1, 1, 1); }
    } else {
      ctx.fillStyle = d.flash > 0 ? '#ffffff' : d.wood; ctx.fillRect(x, y, 4, 6);
      ctx.fillStyle = shade(d.wood, -30); ctx.fillRect(x, y + 2, 4, 1);
      ctx.fillStyle = '#e0b040'; ctx.fillRect(x + 3, y + 3, 1, 1);
      const dmg = 1 - d.hp / d.maxHp;
      ctx.fillStyle = '#1a0f08';
      if (dmg > 0.25) ctx.fillRect(x + 1, y + 1, 1, 2);
      if (dmg > 0.5) ctx.fillRect(x + 2, y + 3, 1, 2);
      if (dmg > 0.75) ctx.fillRect(x, y + 5, 2, 1);
    }
    ctx.globalAlpha = 1;
  }
  if (a < 0.99) { // cut-away: the door seen from above in the front wall
    ctx.globalAlpha = 1 - a;
    const x = d.dx + 1, y = b.y + b.h - 2;
    if (d.broken) { ctx.fillStyle = d.wood; ctx.fillRect(x, y + 1, 1, 1); ctx.fillRect(x + 3, y, 1, 1); }
    else if (!d.closed) { ctx.fillStyle = d.wood; ctx.fillRect(x, y - 4, 1, 5); }
    else { ctx.fillStyle = d.flash > 0 ? '#ffffff' : d.wood; ctx.fillRect(x, y, 4, 2); ctx.fillStyle = '#e0b040'; ctx.fillRect(x + 3, y, 1, 1); }
    ctx.globalAlpha = 1;
  }
  if (!d.broken && d.hp < d.maxHp) {
    const x = d.dx, y = b.y + b.h - 9;
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(x, y, 6, 1);
    ctx.fillStyle = '#e0a040'; ctx.fillRect(x, y, Math.max(0, Math.round((d.hp / d.maxHp) * 6)), 1);
  }
}
function drawVan(v) {
  const x = Math.round(v.x) - 12, y = Math.round(v.y) - 8, f = v.dir > 0;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1, y + 10, 24, 2);
  ctx.fillStyle = v.army ? '#4b5a2a' : '#1c2333'; ctx.fillRect(x, y + 2, 24, 8);
  ctx.fillStyle = v.army ? '#3a4520' : '#2c3850'; ctx.fillRect(x, y + 6, 24, 1);
  if (v.army) { ctx.fillStyle = '#6a7a3a'; ctx.fillRect(f ? x : x + 6, y, 18, 3); } // canvas cover over the truck bed
  else { ctx.fillStyle = '#e8e8e8'; ctx.fillRect(x + 4, y + 7, 12, 1); }
  ctx.fillStyle = '#7fa3c8'; ctx.fillRect(f ? x + 19 : x + 1, y + 3, 4, 3);
  ctx.fillStyle = '#0e0e0e'; ctx.fillRect(x + 3, y + 10, 4, 2); ctx.fillRect(x + 17, y + 10, 4, 2);
  const blink = Math.floor(G.time * 8) % 2;
  ctx.fillStyle = blink ? '#ff3030' : '#3060ff'; ctx.fillRect(x + 9, y, 3, 2);
  ctx.fillStyle = blink ? '#3060ff' : '#ff3030'; ctx.fillRect(x + 12, y, 3, 2);
}
function drawEnt(e) {
  const sp = e.spr, set = sp.anims[e.pose] || sp.anims.walk;
  const f = Math.floor(e.anim) % set.r.length;
  const right = e.dir > 0;
  const img = e.flash > 0 ? (right ? set.wr[f] : set.wl[f]) : right ? set.r[f] : set.l[f];
  const ax = right ? sp.ax : sp.w - 1 - sp.ax;
  const fx = Math.round(e.x), fy = Math.round(e.y);
  let dx = fx - ax, dy = fy - sp.h + 1;
  if (e.rise > 0) {
    const k = clamp(e.rise / e.riseMax, 0, 1);
    if (k >= 1) { px(fx - 1, fy, '#2e2016'); px(fx + 1, fy, '#2e2016'); return; }
    ctx.save();
    ctx.beginPath(); ctx.rect(dx - 2, dy - 2, sp.w + 4, sp.h + 2); ctx.clip();
    ctx.drawImage(img, dx, dy + Math.round(sp.h * k));
    ctx.restore();
    ctx.fillStyle = '#2e2016'; ctx.fillRect(fx - 3, fy, 7, 1);
    return;
  }
  if (e.pose === 'shock' && !e.dance && !e.watch) { dy -= Math.floor(G.time * 12) % 2; dx += Math.floor(G.time * 25) % 2; }
  if (e.oy) dy -= Math.round(e.oy); // airborne (wrestler leap) — the shadow stays on the ground
  const rage = G.frenzyT > 0 && e.t === 'u' && e.kind === 'zombie';
  let sprite = img;
  if (rage) { dx += (Math.random() * 3 | 0) - 1; dy -= Math.random() < 0.3 ? 1 : 0; } // shaking with fury
  if (e.fuse > 0) { // bloater about to burst: wobble and flash red / white faster and faster
    dx += Math.floor(G.time * 40) % 2 ? 1 : -1;
    const fl = Math.floor(G.time * (10 + (0.75 - e.fuse) * 30)) % 2;
    sprite = fl ? (right ? set.rr[f] : set.rl[f]) : (right ? set.wr[f] : set.wl[f]);
  }
  const wet = G.weather === 'flood' && !e.space; // wading: hide the feet under the water line
  ctx.fillStyle = 'rgba(0,0,0,.28)'; if (!wet) ctx.fillRect(fx - Math.round(sp.w / 3), fy, Math.round(sp.w / 1.6), 1);
  if (wet) { ctx.save(); ctx.beginPath(); ctx.rect(dx - 3, dy - 4, sp.w + 6, sp.h + 2); ctx.clip(); }
  if (rage) { // blood-red glow around every frenzied zombie
    const red = right ? set.rr[f] : set.rl[f];
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(G.time * 18 + e.x);
    ctx.drawImage(red, dx - 1, dy); ctx.drawImage(red, dx + 1, dy); ctx.drawImage(red, dx, dy - 1); ctx.drawImage(red, dx, dy + 1);
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(sprite, dx, dy);
  if (rage && Math.floor(G.time * 6 + e.x) % 3 === 0) { px(dx + (right ? sp.w - 4 : 3), dy + 2, '#ffff60'); } // glowing eyes
  if (wet) {
    ctx.restore();
    const ph = Math.floor(G.time * 6 + e.x) % 3;
    ctx.fillStyle = '#bfe4ff'; ctx.fillRect(fx - 3 - ph % 2, fy - 2, 1, 1); ctx.fillRect(fx + 2 + ph % 2, fy - 2, 1, 1);
    ctx.fillStyle = 'rgba(190,228,255,.6)'; ctx.fillRect(fx - 2, fy - 1, 5, 1);
  }
  if (e.hp < e.maxHp) {
    const w = e.kind === 'boss' ? 15 : e.big || isMelee(e.kind) ? 11 : 7, fill = Math.max(0, Math.round((e.hp / e.maxHp) * w));
    const bx = fx - (w >> 1);
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(bx, dy - 3, w, 1);
    ctx.fillStyle = e.t === 'h' ? (e.hurt ? '#ff9a30' : '#e04848') : e.kind === 'skel' ? '#e8e4d0' : '#8fe04a';
    ctx.fillRect(bx, dy - 3, fill, 1);
  }
  if (e.t === 'h' && e.alertT > 0) bubble(fx, dy - 12);
}
function drawInfected(h) {
  const shake = h.infectT < 0.8 ? (Math.floor(G.time * 30) % 2 ? 1 : -1) : 0;
  const l = h.spr.lying;
  ctx.drawImage(l, Math.round(h.x - l.width / 2) + shake, Math.round(h.y - l.height + 3));
  if (Math.random() < 0.3) px(Math.round(h.x + rand(-4, 4)), Math.round(h.y - rand(0, 6)), '#8fe04a');
}
let hoverB = null;
const crownImg = Pix.iconCanvas('crown');
function draw(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07050a'; ctx.fillRect(0, 0, CW, CH);
  let { tx, ty } = camT();
  if (G.shake > 0) { const k = G.shake * 3 * cam.s; tx += Math.round(rand(-k, k)); ty += Math.round(rand(-k, k)); }
  ctx.setTransform(cam.s, 0, 0, cam.s, tx, ty);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(MAP.bg, 0, 0);
  if (G.weather === 'cold' && MAP.frost) { ctx.globalAlpha = MAP.th.night ? 0.08 : 0.2; ctx.drawImage(MAP.frost, 0, 0); ctx.globalAlpha = 1; }
  if (G.weather === 'flood' && MAP.water) { // murky floodwater everywhere outdoors
    ctx.globalAlpha = 0.42 + 0.04 * Math.sin(G.time * 1.3); ctx.drawImage(MAP.water, 0, 0); ctx.globalAlpha = 1;
    for (const p of G.sky) {
      if (!inView(p.x, p.y) || spaceOf(p.x, p.y) || blocked(p.x, p.y)) continue;
      if (p.k === 'wave') { ctx.fillStyle = 'rgba(200,235,255,.55)'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 1); }
      else { ctx.fillStyle = '#6a5030'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); ctx.fillStyle = '#3a8a3a'; ctx.fillRect(Math.round(p.x) + 2, Math.round(p.y), 1, 1); }
    }
  }

  // roofs fade out when someone is inside or the mouse hovers the house
  hoverB = null;
  if (mouse.inside) {
    for (const b of MAP.b) if (mouse.x > b.x && mouse.x < b.x + b.w && mouse.y > b.y && mouse.y < b.y + b.h) { hoverB = b; break; }
  }
  const hideAll = S.settings.roofs === 'hide';
  const list = [];
  for (const b of MAP.b) {
    const target = hideAll || b.nIn > 0 || b === hoverB ? 0 : 1;
    b.roofA += (target - b.roofA) * Math.min(1, dt * 7);
    if (inView(b.x + b.w / 2, b.y + b.h / 2, b.w)) list.push({ sy: b.y + b.h - 0.5, b });
  }
  for (const u of G.undead) if (inView(u.x, u.y)) list.push({ sy: u.y, e: u });
  for (const h of G.humans) if (inView(h.x, h.y)) list.push({ sy: h.y, e: h });
  for (const v of G.vans) list.push({ sy: v.y + 4, v });
  list.sort((a, b) => a.sy - b.sy);
  drawEventGround();
  if (G.boss && !G.boss.dead) drawBossTele(G.boss);
  for (const n of G.nades) { // where the grenade / vaccine will land
    const blink = Math.floor(G.time * 10) % 2;
    ring(Math.round(n.x1), Math.round(n.y1), n.kind === 'cure' ? 18 : 12, n.kind === 'cure' ? (blink ? '#7fe0ff' : '#b0f0ff') : (blink ? '#ff3030' : '#ff9a9a'));
  }
  for (const it of list) {
    if (it.b) drawBuilding(it.b);
    else if (it.v) drawVan(it.v);
    else if (it.e.t === 'h' && it.e.state === 'infected') drawInfected(it.e);
    else drawEnt(it.e);
  }

  for (const p of G.parts) px(Math.round(p.x), Math.round(p.y), p.col);
  for (const t of G.tracers) { line(t.x1, t.y1, t.x2, t.y2, '#fff3a0'); px(t.x1, t.y1, '#ffffff'); }
  const CLOUD = ['#9be354', '#6fb83a', '#c8ff8a', '#4f8a2a'], CURE = ['#7fe0ff', '#ffffff', '#b0f0ff', '#4fb0e0'], GAS = ['#b8d04a', '#dcd65a', '#8cff3a', '#6a8a2a', '#9a2a3a'];
  for (const c of G.clouds) {
    const k = c.life / c.max, n = Math.round(c.r * c.r * 0.5 * k);
    const grow = 1 - k * 0.3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.r * grow;
      px(Math.round(c.x + Math.cos(a) * r), Math.round(c.y + Math.sin(a) * r * 0.75), pick(c.cure ? CURE : c.gas ? GAS : CLOUD));
    }
  }
  for (const b of G.booms) { // explosions / holy nova / ground slam / frenzy rage bursts
    const k = 1 - b.life / b.max, rr = b.r * (0.3 + 0.7 * k);
    const hollow = b.holy || b.dust || b.rage;
    const cols = b.holy ? ['#ffffff', '#fff6c0', '#ffe070'] : b.dust ? ['#8a7a5a', '#6a5a40', '#b0a080'] : b.rage ? ['#ff2020', '#ff6040', '#b00000'] : ['#ffffff', '#ffdf5a', '#ff8a2a', '#e04020'];
    if (hollow) ring(Math.round(b.x), Math.round(b.y), rr, cols[0]);
    const n = Math.round(rr * (hollow ? 3 : 6) * (1 - k));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = (hollow ? rand(0.85, 1) : Math.sqrt(Math.random())) * rr;
      px(Math.round(b.x + Math.cos(a) * r), Math.round(b.y + Math.sin(a) * r * 0.75), pick(cols));
    }
  }
  for (const s of G.spits) { // acid blobs
    ctx.fillStyle = '#5ad020'; ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2);
    px(Math.round(s.x), Math.round(s.y) - 1, '#c0ff80');
    if (Math.random() < 0.3) G.parts.push({ x: s.x, y: s.y, vx: 0, vy: 0, gy: s.y + 1, col: '#8cff3a', stain: false });
  }
  for (const n of G.nades) { // lobbed projectiles: shadow on the ground + arc
    const p = n.t / n.T, x = n.x0 + (n.x1 - n.x0) * p, gy = n.y0 + 8 + (n.y1 - n.y0 - 8) * p, h = 22 * 4 * p * (1 - p);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(Math.round(x) - 1, Math.round(gy), 3, 1);
    ctx.fillStyle = n.kind === 'cure' ? '#7fe0ff' : '#3d4a26'; ctx.fillRect(Math.round(x) - 1, Math.round(gy - h) - 1, 2, 2);
    if (n.kind !== 'cure' && Math.floor(G.time * 20) % 2) px(Math.round(x), Math.round(gy - h) - 2, '#ff4040');
  }
  if (G.boss && !G.boss.dead && inView(G.boss.x, G.boss.y)) { // crown marker + muzzle flash
    const b = G.boss, bob = Math.floor(G.time * 3) % 2;
    ctx.drawImage(crownImg, Math.round(b.x) - 4, Math.round(b.y - (b.oy || 0)) - 27 - bob);
    if (b.muzzle > 0) {
      const mx = Math.round(b.x + b.dir * 10), my = Math.round(b.y) - 9;
      ctx.fillStyle = '#fff3a0'; ctx.fillRect(mx - 1, my - 1, 3, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(mx, my, 1, 1);
      ctx.fillStyle = '#ff8a2a'; ctx.fillRect(mx + b.dir * 2, my, 1, 1); ctx.fillRect(mx, my - 2, 1, 1); ctx.fillRect(mx, my + 2, 1, 1);
    }
  }
  if (evOn('blackout')) { // city-wide power cut: only glowing zombie eyes and gun flashes stand out
    ctx.fillStyle = 'rgba(4,4,18,.62)'; ctx.fillRect(0, 0, WW, WH);
    for (const u of G.undead) {
      if (u.kind !== 'zombie' || u.rise > 0 || !inView(u.x, u.y)) continue;
      const ex = Math.round(u.x) + (u.dir > 0 ? 0 : -2), ey = Math.round(u.y) - u.spr.h + 3;
      ctx.fillStyle = '#ff3030'; ctx.fillRect(ex, ey, 1, 1); ctx.fillRect(ex + 2, ey, 1, 1);
    }
    for (const t of G.tracers) line(t.x1, t.y1, t.x2, t.y2, '#fff3a0');
  }
  // overhead layer: BTS viaduct + train, electric wires, lanterns
  if (MAP.top) ctx.drawImage(MAP.top, 0, 0);
  if (G.train && MAP.bts) drawTrain(G.train, MAP.bts.y);
  for (const p of G.fw) { // fireworks + floating khom loi lanterns
    if (p.lan) { ctx.fillStyle = '#ff9a2a'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); px(Math.round(p.x), Math.round(p.y) + 2, '#ffe890'); continue; }
    ctx.globalAlpha = Math.min(1, p.life * 1.5);
    ctx.fillStyle = p.life > 0.35 ? p.col : '#fff3a0';
    const z = p.life > 0.5 ? 2 : 1;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), z, z);
  }
  ctx.globalAlpha = 1;
  for (const f of G.floats) {
    if (f.life < 0.3 && Math.floor(f.life * 20) % 2) continue;
    Pix.drawText(ctx, f.text, Math.round(f.x - Pix.textWidth(f.text) / 2), Math.round(f.y), f.col);
  }
  if (mouse.inside && !G.cleared && !pan.active) {
    const mx = Math.round(mouse.x), my = Math.round(mouse.y);
    if (targeting === 'plague') ring(mx, my, SPELL.plague.rad(S.spells.plague), '#9be354');
    else {
      const ok = G.energy >= strainCost(curStrain()) && freeOutside(mx, my);
      ring(mx, my, 4, ok ? '#8fe04a' : '#e04848');
      px(mx, my, ok ? '#8fe04a' : '#e04848');
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSky(dt);
  drawEventSky();
  if (G.frenzyT > 0) { // pulsing blood-red vignette
    const v = ctx.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.3, CW / 2, CH / 2, Math.max(CW, CH) * 0.72);
    v.addColorStop(0, 'rgba(160,0,0,0)');
    v.addColorStop(1, `rgba(170,0,0,${0.45 + 0.15 * Math.sin(G.time * 9)})`);
    ctx.fillStyle = v; ctx.fillRect(0, 0, CW, CH);
    const b = Math.round(4 * DPR);
    ctx.fillStyle = `rgba(230,20,20,${0.5 + 0.2 * Math.sin(G.time * 9)})`;
    ctx.fillRect(0, 0, CW, b); ctx.fillRect(0, CH - b, CW, b); ctx.fillRect(0, 0, b, CH); ctx.fillRect(CW - b, 0, b, CH);
  }
}
// event props on the ground: the mor lam stage, the parachuting supply crate
function drawEventGround() {
  const e = G.ev;
  if (!e) return;
  if (e.k === 'concert') {
    const x = Math.round(e.x) - 14, y = Math.round(e.y) - 10, blink = Math.floor(G.time * 4);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1, y + 8, 28, 2);
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(x, y + 3, 28, 6); // plank stage
    ctx.fillStyle = '#7a5232'; ctx.fillRect(x, y + 3, 28, 1);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x - 3, y - 4, 4, 12); ctx.fillRect(x + 27, y - 4, 4, 12); // speaker stacks
    ctx.fillStyle = '#4a4a4a'; ctx.fillRect(x - 2, y - 2, 2, 2); ctx.fillRect(x - 2, y + 3, 2, 2); ctx.fillRect(x + 28, y - 2, 2, 2); ctx.fillRect(x + 28, y + 3, 2, 2);
    const LC = ['#ff3a3a', '#ffd23a', '#3ad0ff', '#ff5ab0', '#8cff3a'];
    for (let i = 0; i < 7; i++) px(x + 2 + i * 4, y - 6, LC[(i + blink) % LC.length]); // light rig
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x + 1, y - 5, 26, 1);
    // the singer in a sparkly suit
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(x + 13, y - 2, 3, 4); ctx.fillStyle = '#f1c27d'; ctx.fillRect(x + 13, y - 4, 3, 2);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x + 13, y - 5, 3, 1); ctx.fillRect(x + (blink % 2 ? 12 : 16), y - 2, 1, 2);
  } else if (e.k === 'airdrop' && e.crate) {
    const c = e.crate, x = Math.round(c.x), y = Math.round(c.y);
    if (c.drop > 0) { // still falling under its parachute
      const h = Math.round(c.drop * 45), sway = Math.round(Math.sin(G.time * 3) * 2);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x - 3, y, 7, 1);
      ctx.fillStyle = '#b07a2a'; ctx.fillRect(x - 3 + sway, y - h - 5, 7, 5);
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(x - 6 + sway, y - h - 14, 13, 3); ctx.fillRect(x - 7 + sway, y - h - 12, 2, 1); ctx.fillRect(x + 6 + sway, y - h - 12, 2, 1);
      ctx.fillStyle = '#e03030'; ctx.fillRect(x - 2 + sway, y - h - 14, 5, 1);
      ctx.fillStyle = '#9a9a9a'; line(x - 6 + sway, y - h - 11, x - 3 + sway, y - h - 5, '#9a9a9a'); line(x + 6 + sway, y - h - 11, x + 3 + sway, y - h - 5, '#9a9a9a');
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x - 3, y, 8, 1);
      ctx.fillStyle = '#6a4a1a'; ctx.fillRect(x - 3, y - 5, 7, 5);
      ctx.fillStyle = '#b07a2a'; ctx.fillRect(x - 2, y - 4, 5, 3);
      ctx.fillStyle = '#e03030'; ctx.fillRect(x - 1, y - 4, 1, 3); ctx.fillRect(x - 2, y - 3, 3, 1);
      if (Math.floor(G.time * 4) % 2) { px(x, y - 7, '#ff3030'); ring(x, y - 2, 7 + (G.time * 6) % 5, '#ffd23a'); }
    }
  }
}
// screen-space tint for the blood moon event
function drawEventSky() {
  if (!evOn('bloodmoon')) return;
  const k = Math.min(1, (G.ev.T - G.ev.t) * 2, G.ev.t * 2);
  ctx.fillStyle = `rgba(150,0,10,${0.18 * k})`; ctx.fillRect(0, 0, CW, CH);
  const r = Math.round(Math.min(CW, CH) * 0.07), mx = Math.round(CW * 0.72), my = Math.round(r * 1.6);
  const gl = ctx.createRadialGradient(mx, my, r * 0.6, mx, my, r * 3);
  gl.addColorStop(0, `rgba(255,60,40,${0.45 * k})`); gl.addColorStop(1, 'rgba(255,60,40,0)');
  ctx.fillStyle = gl; ctx.fillRect(mx - r * 3, my - r * 3, r * 6, r * 6);
  ctx.globalAlpha = k;
  ctx.fillStyle = '#d02a20'; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a01810'; ctx.beginPath(); ctx.arc(mx - r * 0.3, my + r * 0.2, r * 0.25, 0, Math.PI * 2); ctx.arc(mx + r * 0.35, my - r * 0.3, r * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}
function drawTrain(t, deckY) { // 3-car BTS train in green & white livery
  const y = deckY - 5;
  for (let i = 0; i < 3; i++) {
    const x = Math.round(t.x - t.dir * i * 27) - 12;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 1, y + 6, 25, 1);
    ctx.fillStyle = '#f2f2f0'; ctx.fillRect(x, y, 25, 6);
    ctx.fillStyle = '#1a9a4a'; ctx.fillRect(x, y + 4, 25, 1);
    ctx.fillStyle = '#1a4a8a'; ctx.fillRect(x, y + 5, 25, 1);
    ctx.fillStyle = '#2a3a50'; for (let k = 2; k < 23; k += 4) ctx.fillRect(x + k, y + 1, 3, 2);
    if (i === 0) { ctx.fillStyle = '#ffe890'; ctx.fillRect(t.dir > 0 ? x + 24 : x, y + 3, 1, 1); }
  }
}
// screen-space weather: heat haze, snow, rain + lightning
const skyParts = [];
function drawSky(dt) {
  const w = G.weather, s = DPR;
  if (w === 'hot') {
    ctx.fillStyle = `rgba(255,140,40,${0.1 + 0.03 * Math.sin(G.time * 2)})`; ctx.fillRect(0, 0, CW, CH);
    const gl = ctx.createRadialGradient(CW * 0.9, 0, 0, CW * 0.9, 0, CW * 0.55);
    gl.addColorStop(0, 'rgba(255,240,180,.45)'); gl.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, CW, CH);
    return;
  }
  if (w !== 'cold' && w !== 'flood') return;
  const want = w === 'cold' ? 140 : 220;
  while (skyParts.length < want) skyParts.push({ x: Math.random() * CW, y: Math.random() * CH, v: rand(0.6, 1.4), p: Math.random() * 6 });
  if (w === 'cold') {
    ctx.fillStyle = 'rgba(150,190,255,.12)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const p of skyParts) {
      p.y += 28 * s * p.v * dt; p.x += Math.sin(G.time * 1.5 + p.p) * 12 * s * dt;
      if (p.y > CH) { p.y = -4; p.x = Math.random() * CW; }
      const z = Math.max(1, Math.round(s * (p.v > 1 ? 2 : 1.2)));
      ctx.fillRect(p.x | 0, p.y | 0, z, z);
    }
  } else {
    ctx.fillStyle = 'rgba(40,70,110,.18)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(190,215,255,.45)';
    for (const p of skyParts) {
      p.y += 420 * s * p.v * dt; p.x -= 70 * s * p.v * dt;
      if (p.y > CH) { p.y = -10 * s; p.x = Math.random() * (CW + 100 * s); }
      ctx.fillRect(p.x | 0, p.y | 0, Math.max(1, s | 0), Math.round(7 * s * p.v));
    }
    if (G.flashT > 0) { ctx.fillStyle = `rgba(255,255,255,${G.flashT * 2})`; ctx.fillRect(0, 0, CW, CH); }
  }
}
let miniT = 0;
const MINI_COL = { civ: '#ffd8b0', police: '#5a8cff', swat: '#9aa6c0', soldier: '#8a9a4a', brute: '#ff9a30', guard: '#e0e0e0', dog: '#c08040', boss: '#ff3030' };
function drawMini(dt) {
  miniT -= dt;
  if (miniT > 0) return;
  miniT = 0.2;
  const mw = mini.width, mh = mini.height, k = Math.min(mw / WW, mh / WH);
  const ox = (mw - WW * k) / 2, oy = (mh - WH * k) / 2;
  mctx.imageSmoothingEnabled = true;
  mctx.fillStyle = '#07050a'; mctx.fillRect(0, 0, mw, mh);
  mctx.drawImage(MAP.bg, ox, oy, WW * k, WH * k);
  mctx.drawImage(MAP.roof, ox, oy, WW * k, WH * k);
  mctx.fillStyle = 'rgba(0,0,0,.25)'; mctx.fillRect(ox, oy, WW * k, WH * k);
  const dot = (x, y, c, s = 2) => { mctx.fillStyle = c; mctx.fillRect(Math.round(ox + x * k - s / 2), Math.round(oy + y * k - s / 2), s, s); };
  for (const h of G.humans) if (h.state === 'ok') dot(h.x, h.y, MINI_COL[h.kind], h.kind === 'boss' ? 5 : h.kind === 'brute' ? 3 : 2);
  for (const u of G.undead) dot(u.x, u.y, u.kind === 'skel' ? '#ffffff' : '#8fe04a', u.big ? 4 : 2);
  for (const v of G.vans) dot(v.x, v.y, Math.floor(G.time * 8) % 2 ? '#ff3030' : '#3060ff', 5);
  if (G.ev && G.ev.crate) dot(G.ev.crate.x, G.ev.crate.y, Math.floor(G.time * 4) % 2 ? '#ffd23a' : '#b07a2a', 5);
  if (G.ev && (G.ev.k === 'concert' || G.ev.k === 'festival')) dot(G.ev.x, G.ev.y, '#ff8ab0', 4);
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1;
  mctx.strokeRect(Math.round(ox + cam.x * k) + 0.5, Math.round(oy + cam.y * k) + 0.5, Math.round((CW / cam.s) * k), Math.round((CH / cam.s) * k));
}

// ---------- sound (all synthesized) ---------------------------------------
// Voices (groans/screams) and effects go through separate gain buses into a
// compressor. A voice budget caps how many voices can overlap, so a big fight
// stays readable instead of turning into a constant wall of noise.
const Snd = {
  ac: null, fx: null, vox: null, noiseBuf: null, last: {}, voices: [],
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      const comp = this.ac.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.2;
      comp.connect(this.ac.destination);
      this.comp = comp;
      this.fx = this.ac.createGain(); this.fx.connect(comp);
      this.vox = this.ac.createGain(); this.vox.connect(comp);
      this.setVol();
      const len = this.ac.sampleRate * 1;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      Music.start();
    } catch (e) { this.ac = null; }
  },
  setVol() {
    if (!this.fx) return;
    this.fx.gain.value = 0.6 * (S.settings.vol / 100);
    this.vox.gain.value = 0.6 * (S.settings.vvol / 100);
    Music.setVol();
  },
  tone(f1, f2, dur, type, vol, delay = 0) {
    const ac = this.ac, t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.fx);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, type, freq, delay = 0, bus = this.fx) {
    const ac = this.ac, t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  voiceFree(max) {
    const now = this.ac.currentTime;
    this.voices = this.voices.filter((t) => t > now);
    return this.voices.length < max;
  },
  // sawtooth through formant filters, 3-point pitch contour + vibrato
  voice(p0, p1, p2, dur, formants, vol, vibHz, vibDepth, breath = 0) {
    const ac = this.ac, t = ac.currentTime;
    this.voices.push(t + dur);
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(p0, t);
    o.frequency.linearRampToValueAtTime(p1, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(p2, t + dur);
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = vibHz; lg.gain.value = vibDepth;
    lfo.connect(lg); lg.connect(o.frequency);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, dur * 0.2));
    env.gain.setValueAtTime(vol, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, q, gv] of formants) {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ac.createGain(); g.gain.value = gv;
      o.connect(bp); bp.connect(g); g.connect(env);
    }
    env.connect(this.vox);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    if (breath) this.noise(dur * 0.9, breath, 'bandpass', 700, 0, this.vox);
  },
  // one dog "woof": sharp attack, fast pitch drop, throaty formants
  woof(delay, f0, vol) {
    const ac = this.ac, t = ac.currentTime + delay, dur = 0.13;
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 1.25, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(vol, t + 0.012); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, q, gv] of [[650, 4, 1.2], [1300, 5, 0.6], [2600, 6, 0.2]]) {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ac.createGain(); g.gain.value = gv; o.connect(bp); bp.connect(g); g.connect(env);
    }
    env.connect(this.vox); o.start(t); o.stop(t + dur + 0.02);
    this.noise(0.05, vol * 0.25, 'bandpass', 1500, delay, this.vox);
  },
  // rapid bone clicks (skeletons)
  clicks(n, spread, vol, freq) {
    for (let i = 0; i < n; i++) {
      const d = i * spread * rand(0.6, 1.4);
      this.noise(0.018, vol, 'bandpass', freq * rand(0.8, 1.3), d);
      this.tone(freq * rand(0.9, 1.2), freq * 0.7, 0.02, 'square', vol * 0.25, d);
    }
  },
  play(k, wx, wy, pitch = 1) {
    if (!S.settings.sound || !this.ac || this.ac.state !== 'running') return;
    let v = 1;
    if (wx != null) { // world sounds: full volume on screen, quiet just off screen, silent far away
      if (inView(wx, wy, 0)) v = 1;
      else if (inView(wx, wy, 80)) v = 0.35;
      else return;
    }
    const now = this.ac.currentTime;
    const gap = { shot: 0.09, bite: 0.14, die: 0.15, spawn: 0.06, punch: 0.12, groan: 1.1, roar: 2.5, scream: 0.8, ouch: 0.5, bash: 0.2, creak: 0.3, slam: 0.3, crash: 0.3, siren: 3, boom: 0.15, throw: 0.3, flame: 0.25, holy: 1, cure: 0.5, quake: 0.5, spit: 0.2, ach: 0.5,
      rattle: 0.35, clack: 0.15, bones: 0.25, bark: 0.5, yelp: 0.5, snarl: 0.3, growl: 1.5, hiss: 0.3, frenzy: 2, thunder: 4, train: 5,
      event: 1, firework: 0.25, drum: 0.3, spinup: 1, reload: 1, whistle: 1, chant: 1 }[k] || 0.04;
    if (this.last[k] && now - this.last[k] < gap) return;
    const isVoice = k === 'groan' || k === 'roar' || k === 'scream' || k === 'ouch' || k === 'bark' || k === 'yelp' || k === 'growl';
    if (isVoice && !this.voiceFree(k === 'groan' || k === 'growl' ? 2 : 3)) return;
    if (k === 'bark') this.voices.push(now + 0.35); // barks don't go through voice(), so reserve a slot by hand
    this.last[k] = now;
    switch (k) {
      case 'bite': this.noise(0.07, 0.22 * v, 'lowpass', 900); this.tone(200, 80, 0.06, 'square', 0.04 * v); break;
      case 'shot': this.noise(0.06, 0.16 * v, 'highpass', 1400); break;
      case 'spawn': this.tone(110, 40, 0.22, 'sawtooth', 0.06 * v); this.noise(0.12, 0.08 * v, 'lowpass', 400); break;
      case 'die': this.tone(220, 55, 0.14, 'triangle', 0.08 * v); break;
      case 'punch': this.tone(120, 50, 0.1, 'sine', 0.4 * v); this.noise(0.05, 0.25 * v, 'bandpass', 1800); break;
      case 'groan': { // "uuurrgh"
        const f = rand(62, 95) * pitch, dur = rand(0.7, 1.2);
        this.voice(f * 1.05, f * 1.2, f * 0.75, dur, [[420, 5, 1.2], [800, 7, 0.6], [2300, 10, 0.12]], 0.45 * v, rand(4, 7), rand(3, 7), 0.025 * v);
        break;
      }
      case 'roar': { // giant zombie
        const f = rand(45, 58), dur = 1.3;
        this.voice(f, f * 1.3, f * 0.7, dur, [[330, 4, 1.4], [650, 6, 0.8], [1800, 8, 0.2]], 0.6 * v, 5, 5, 0.06 * v);
        break;
      }
      case 'scream': { // "aaaah!"
        const f = rand(430, 620) * pitch, dur = rand(0.45, 0.7);
        this.voice(f, f * 1.35, f * 0.85, dur, [[900, 4, 1], [1350, 5, 0.8], [2900, 7, 0.35]], 0.18 * v, 7, f * 0.035, 0.015 * v);
        break;
      }
      case 'ouch': { const f = rand(350, 480) * pitch; this.voice(f * 1.2, f, f * 0.8, 0.18, [[750, 4, 1], [1200, 5, 0.6]], 0.13 * v, 9, 10); break; }
      case 'bash': this.tone(95, 45, 0.16, 'sine', 0.4 * v); this.noise(0.1, 0.2 * v, 'lowpass', 500); break;
      case 'crash': this.noise(0.4, 0.32 * v, 'bandpass', 1300); this.tone(140, 40, 0.3, 'triangle', 0.3 * v); this.noise(0.25, 0.2 * v, 'lowpass', 400, 0.08); break;
      case 'creak': this.tone(330, 460, 0.22, 'sawtooth', 0.02 * v); break;
      case 'slam': this.tone(300, 420, 0.12, 'sawtooth', 0.02 * v); this.tone(90, 40, 0.12, 'sine', 0.3 * v, 0.12); this.noise(0.07, 0.14 * v, 'lowpass', 600, 0.12); break;
      case 'siren': for (let i = 0; i < 4; i++) { this.tone(700, 1000, 0.35, 'square', 0.025, i * 0.7); this.tone(1000, 700, 0.35, 'square', 0.025, i * 0.7 + 0.35); } break;
      case 'boom': this.noise(0.6, 0.45 * v, 'lowpass', 700); this.tone(90, 30, 0.5, 'sine', 0.5 * v); this.noise(0.15, 0.25 * v, 'highpass', 2000); break;
      case 'quake': this.noise(0.45, 0.4 * v, 'lowpass', 300); this.tone(70, 25, 0.45, 'sine', 0.55 * v); break;
      case 'throw': this.noise(0.18, 0.08 * v, 'bandpass', 2500); this.tone(900, 500, 0.15, 'sine', 0.02 * v); break;
      case 'flame': this.noise(0.28, 0.12 * v, 'bandpass', 500); this.noise(0.28, 0.05 * v, 'highpass', 3000); break;
      case 'holy': [523, 659, 784, 1047].forEach((f) => this.tone(f, f, 0.9, 'sine', 0.05 * v)); this.noise(0.4, 0.05 * v, 'highpass', 4000); break;
      case 'cure': [1047, 1319, 1568].forEach((f, i) => this.tone(f, f * 1.01, 0.18, 'triangle', 0.05 * v, i * 0.06)); break;
      case 'bossin': [196, 185, 175, 165].forEach((f, i) => this.tone(f, f, 0.35, 'sawtooth', 0.06, i * 0.3)); this.tone(55, 50, 1.4, 'square', 0.05); break;
      case 'bossdie': [262, 330, 392, 523, 659].forEach((f, i) => this.tone(f, f, 0.18, 'square', 0.06, i * 0.09)); this.noise(0.6, 0.3, 'lowpass', 600); break;
      case 'spit': this.noise(0.12, 0.12 * v, 'bandpass', 900); this.tone(400, 150, 0.1, 'sine', 0.05 * v); break;
      case 'rattle': this.clicks(9, 0.035, 0.14 * v, 2400); break; // skeleton clawing out of its grave
      case 'clack': this.clicks(2, 0.05, 0.16 * v, 1800); this.tone(700, 520, 0.04, 'triangle', 0.08 * v); break; // bony strike
      case 'bones': this.clicks(12, 0.03, 0.15 * v, 2000); this.tone(300, 120, 0.2, 'triangle', 0.06 * v, 0.05); break; // collapsing pile
      case 'bark': { const f = 330 * pitch; this.woof(0, f, 0.3 * v); if (Math.random() < 0.7) this.woof(0.19, f * 0.95, 0.26 * v); break; }
      case 'yelp': { const f = 900 * pitch; this.voice(f, f * 1.2, f * 0.6, 0.2, [[1200, 4, 1], [2400, 6, 0.4]], 0.14 * v, 12, 30); break; }
      case 'snarl': this.noise(0.1, 0.16 * v, 'bandpass', 700); this.tone(190, 130, 0.1, 'sawtooth', 0.05 * v); break;
      case 'growl': this.voice(62, 70, 55, 0.7, [[300, 4, 1.4], [700, 6, 0.5]], 0.35 * v, 22, 9, 0.04 * v); break; // zombie dog
      case 'hiss': this.noise(0.75, 0.16 * v, 'highpass', 2500); this.tone(90, 40, 0.75, 'sawtooth', 0.06 * v); this.tone(160, 400, 0.7, 'sine', 0.04 * v); break;
      case 'frenzy': // war drum + a chorus of roars
        for (let i = 0; i < 3; i++) { this.tone(80, 40, 0.18, 'sine', 0.5, i * 0.13); this.noise(0.1, 0.2, 'lowpass', 400, i * 0.13); }
        this.voice(70, 110, 55, 1.1, [[380, 4, 1.4], [760, 6, 0.7]], 0.55, 6, 8, 0.06);
        this.tone(120, 60, 0.9, 'sawtooth', 0.06, 0.1);
        break;
      case 'thunder': this.noise(1.6, 0.4, 'lowpass', 260); this.noise(0.25, 0.25, 'lowpass', 1200); this.tone(60, 30, 1.2, 'sine', 0.3, 0.05); break;
      case 'train': this.noise(3.2, 0.05, 'lowpass', 500); this.tone(620, 620, 0.25, 'triangle', 0.035); this.tone(520, 520, 0.35, 'triangle', 0.035, 0.28); break;
      case 'event': [440, 554, 659].forEach((f, i) => this.tone(f, f, 0.5, 'triangle', 0.05, i * 0.07)); this.tone(110, 108, 1.2, 'sine', 0.2); break; // gong-ish sting
      case 'firework': this.tone(900, 2400, 0.35, 'sine', 0.03 * v); this.noise(0.5, 0.25 * v, 'lowpass', 1400, 0.35); this.noise(0.6, 0.08 * v, 'highpass', 5000, 0.4); break;
      case 'drum': [0, 0.18, 0.27].forEach((d) => { this.tone(110, 50, 0.12, 'sine', 0.35 * v, d); this.noise(0.05, 0.1 * v, 'bandpass', 2500, d + 0.09); }); break; // mor lam beat
      case 'spinup': this.tone(80, 900, 0.8, 'sawtooth', 0.04 * v); this.noise(0.8, 0.05 * v, 'bandpass', 1500); break; // minigun barrel spinning up
      case 'reload': this.clicks(2, 0.25, 0.2 * v, 1400); this.tone(300, 200, 0.08, 'square', 0.05 * v, 0.6); break;
      case 'whistle': this.tone(2200, 2300, 0.25, 'sine', 0.06 * v); this.tone(2200, 2400, 0.45, 'sine', 0.06 * v, 0.32); break;
      case 'chant': [262, 330, 392].forEach((f) => this.voice(f * 0.5, f * 0.5, f * 0.5, 1.1, [[700, 5, 1], [1100, 6, 0.5]], 0.07 * v, 5, 2)); break; // choir hum
      case 'ach': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.16, 'triangle', 0.07, i * 0.08)); break;
      case 'rebirth': [131, 165, 196, 262, 330, 392, 523].forEach((f, i) => this.tone(f, f, 0.5, 'triangle', 0.06, i * 0.12)); break;
      case 'buy': this.tone(660, 990, 0.07, 'square', 0.05); break;
      case 'spell': this.tone(180, 900, 0.35, 'sawtooth', 0.06); this.noise(0.3, 0.06, 'bandpass', 1200); break;
      case 'clear': [392, 494, 587, 784].forEach((f, i) => this.tone(f, f, 0.14, 'square', 0.05, i * 0.1)); break;
    }
  },
};

// ---------- music (procedural chiptune, look-ahead scheduler) -------------
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TRACKS = {
  // spooky A-minor groove: i – VI – iv – V
  main: {
    bpm: 92, bars: 4,
    chords: [[45, [57, 60, 64]], [41, [53, 57, 60]], [38, [50, 53, 57]], [40, [52, 56, 59]]],
    mel: [[[0, 76], [6, 74], [8, 72], [12, 71]], [[0, 72], [8, 69]], [[0, 74], [6, 72], [8, 69], [12, 65]], [[0, 68], [8, 71]]],
    play(step, t, dt) {
      const bar = Math.floor(step / 16) % 4, s = step % 16, [root, ch] = this.chords[bar];
      if (s === 0 || s === 6 || s === 8 || s === 14) Music.note(root, t, dt * 3, 'triangle', 0.16);
      if (s % 2 === 0) Music.note(ch[(s / 2) % 3] + 12, t, dt * 1.5, 'square', 0.02, 1800);
      for (const [ms, m] of this.mel[bar]) if (ms === s) Music.note(m, t, dt * 5, 'triangle', 0.045);
      if (s === 0 || s === 8) Music.hit(t, 'kick', 0.12);
      if (s % 4 === 2) Music.hit(t, 'hat', 0.02);
    },
  },
  // driving E-phrygian boss theme
  boss: {
    bpm: 140, bars: 4,
    chords: [[40, [52, 55, 59]], [41, [53, 57, 60]], [40, [52, 55, 59]], [38, [50, 53, 56]]],
    mel: [[0, 76], [3, 77], [6, 76], [8, 74], [12, 71]],
    play(step, t, dt) {
      const bar = Math.floor(step / 16) % 4, s = step % 16, [root, ch] = this.chords[bar];
      if (s % 2 === 0) Music.note(root + (s % 4 === 2 ? 12 : 0), t, dt * 1.8, 'sawtooth', 0.06, 700);
      Music.note(ch[s % 3] + (s >= 8 ? 24 : 12), t, dt * 0.9, 'square', 0.016, 2600);
      if (bar % 2 === 0) for (const [ms, m] of this.mel) if (ms === s) Music.note(m + (root - 40), t, dt * 3, 'triangle', 0.035);
      if (s % 4 === 0) Music.hit(t, 'kick', 0.18);
      if (s === 4 || s === 12) Music.hit(t, 'snare', 0.08);
      if (s % 2 === 1) Music.hit(t, 'hat', 0.02);
    },
  },
};
const Music = {
  gain: null, next: 0, step: 0, timer: null, track: 'main',
  start() {
    if (!Snd.ac || this.timer) return;
    this.gain = Snd.ac.createGain(); this.gain.connect(Snd.comp);
    this.setVol();
    this.next = Snd.ac.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 60);
  },
  setVol() { if (this.gain) this.gain.gain.value = S.settings.music ? 0.55 * (S.settings.mvol / 100) : 0; },
  tick() {
    const ac = Snd.ac;
    if (!ac || ac.state !== 'running' || document.hidden) return;
    const want = G && G.boss && !G.boss.dead ? 'boss' : 'main';
    if (want !== this.track) { this.track = want; this.step = 0; }
    if (!S.settings.sound || !S.settings.music) { this.next = ac.currentTime + 0.05; return; }
    if (this.next < ac.currentTime) this.next = ac.currentTime + 0.05;
    const T = TRACKS[this.track], dt = 60 / T.bpm / 4;
    while (this.next < ac.currentTime + 0.25) {
      T.play(this.step, this.next, dt);
      this.next += dt;
      this.step = (this.step + 1) % (16 * T.bars);
    }
  },
  note(m, t, dur, type, vol, cutoff) {
    const ac = Snd.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = midi(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if (cutoff) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); out = f; }
    out.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + dur + 0.02);
  },
  hit(t, kind, vol) {
    const ac = Snd.ac, g = ac.createGain();
    g.connect(this.gain);
    if (kind === 'kick') {
      const o = ac.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); o.start(t); o.stop(t + 0.16);
      return;
    }
    const s = ac.createBufferSource(); s.buffer = Snd.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 6000 : 1800;
    const dur = kind === 'hat' ? 0.03 : 0.09;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
};

// ---------- achievements -----------------------------------------------------
// each unlocked achievement = +2% blood/brains/bones forever (see gainMult)
const st = (k) => () => S.stats[k];
const ACH = [
  { id: 'k1', name: 'รสชาติแรก', desc: 'กินมนุษย์คนแรก', v: st('kills'), n: 1 },
  { id: 'k100', name: 'หิวโหย', desc: 'กินมนุษย์ 100 คน', v: st('kills'), n: 100 },
  { id: 'k1k', name: 'โรคระบาด', desc: 'กินมนุษย์ 1,000 คน', v: st('kills'), n: 1000 },
  { id: 'k10k', name: 'วันสิ้นโลก', desc: 'กินมนุษย์ 10,000 คน', v: st('kills'), n: 10000 },
  { id: 'r500', name: 'กองทัพศพ', desc: 'ศพลุกเป็นซอมบี้ 500 ตัว', v: st('raised'), n: 500 },
  { id: 'p100', name: 'มือปั้นศพ', desc: 'วางซอมบี้เอง 100 ตัว', v: st('placed'), n: 100 },
  { id: 'd10', name: 'ใครอยู่ในบ้าน?', desc: 'ทุบประตูพัง 10 บาน', v: st('doors'), n: 10 },
  { id: 'd100', name: 'ช่างรื้อถอน', desc: 'ทุบประตูพัง 100 บาน', v: st('doors'), n: 100 },
  { id: 'l5', name: 'เมืองแรกล่มสลาย', desc: 'ไปถึงด่าน 5', v: st('bestLevel'), n: 5 },
  { id: 'l11', name: 'ผ่านด่าน 10', desc: 'ผ่านด่านบอสแรก', v: st('bestLevel'), n: 11 },
  { id: 'l25', name: 'ผู้ครองแคว้น', desc: 'ไปถึงด่าน 25', v: st('bestLevel'), n: 25 },
  { id: 'l50', name: 'จักรพรรดิซอมบี้', desc: 'ไปถึงด่าน 50', v: st('bestLevel'), n: 50 },
  { id: 'b1', name: 'ล้มยักษ์', desc: 'ปราบบอสตัวแรก', v: st('bosses'), n: 1 },
  { id: 'b5', name: 'นักล่าบอส', desc: 'ปราบบอส 5 ตัว', v: st('bosses'), n: 5 },
  { id: 'g1', name: 'ยักษ์ตื่น', desc: 'ได้ซอมบี้ยักษ์ตัวแรก', v: st('giants'), n: 1 },
  { id: 'sp50', name: 'กรดกัดกร่อน', desc: 'ฆ่าด้วยกรดของซอมบี้ถ่มกรด 50 ครั้ง', v: st('spitKills'), n: 50 },
  { id: 'bd10', name: 'บึ้ม!', desc: 'ซอมบี้บึ้มพลีชีพพังประตู 10 บาน', v: st('bombDoors'), n: 10 },
  { id: 'st3', name: 'นักพันธุกรรม', desc: 'ปลดล็อกซอมบี้ครบทุกสายพันธุ์', v: () => ['spit', 'bomb', 'tank'].filter((s) => U(s) > 0).length, n: 3 },
  { id: 'u200', name: 'ทะเลศพ', desc: 'มีอันเดดในแมพพร้อมกัน 200 ตัว', v: st('maxUndead'), n: 200 },
  { id: 'pr1', name: 'เกิดใหม่', desc: 'เกิดใหม่ครั้งแรก', v: st('prestiges'), n: 1 },
  { id: 'pr5', name: 'วัฏจักรแห่งความตาย', desc: 'เกิดใหม่ 5 ครั้ง', v: st('prestiges'), n: 5 },
  { id: 'bl1m', name: 'ทะเลเลือด', desc: 'เก็บเลือดสะสม 1M', v: st('bloodTotal'), n: 1e6 },
  { id: 't1h', name: 'ไม่หลับไม่นอน', desc: 'เล่นรวม 1 ชั่วโมง', v: st('play'), n: 3600 },
  { id: 'cur20', name: 'ต้านวัคซีน', desc: 'โดน ดร.วัคซีน รักษาซอมบี้ไป 20 ตัว', v: st('cured'), n: 20 },
];
const achQueue = [];
let achT = 0;
function checkAch() {
  for (const a of ACH) {
    if (S.ach[a.id] || a.v() < a.n) continue;
    S.ach[a.id] = Date.now();
    achQueue.push(a);
  }
}
function achPopups(dt) {
  achT -= dt;
  if (achT > 0 || !achQueue.length) return;
  const a = achQueue.shift();
  const el = $('achPop');
  el.innerHTML = `<img src="${Pix.icon('trophy')}" alt=""><div><b>ความสำเร็จ: ${a.name}</b><span>${a.desc} · รายได้ถาวร +2%</span></div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  Snd.play('ach');
  achT = 3.2;
}

// ---------- prestige -----------------------------------------------------------
// souls = 3 * (levels cleared / 10)^2.2  (needs 10+ levels cleared this run)
function soulsOnReset() {
  const c = S.maxLevel - 1;
  if (c < 10) return 0;
  return Math.floor(3 * Math.pow(c / 10, 2.2) * (1 + 0.2 * P('pSouls')));
}
function doPrestige() {
  const n = soulsOnReset();
  if (!n) return;
  if (!confirm(`เกิดใหม่ตอนนี้?\n\nจะได้ +${n} แก่นวิญญาณ\nรีเซ็ต: ด่าน · เลือด สมอง กระดูก · อัปเกรดทั้งหมด · เวทมนตร์ · สายพันธุ์ซอมบี้\nเก็บไว้: แก่นวิญญาณ · อัปเกรดถาวร · ความสำเร็จ · สถิติ`)) return;
  S.prestige.souls += n; S.prestige.total += n; S.stats.prestiges++;
  const keep = {};
  if (P('pKeep')) { if (U('auto')) keep.auto = 1; if (U('autoCast')) keep.autoCast = 1; }
  S.up = keep;
  S.spells = { frenzy: 0, plague: 0, raise: 0 };
  S.routes = {};
  for (const k in CD) CD[k] = 0;
  S.blood = 0; S.brains = 0; S.bones = 0;
  S.settings.strain = 'basic';
  const start = Math.min(1 + 3 * P('pStart'), Math.max(1, Math.floor(S.stats.bestLevel / 2)));
  S.level = S.maxLevel = start;
  newLevel(start);
  buildList(); buildSpellBar(); buildStrainBar();
  save();
  Snd.play('rebirth');
  modal('เกิดใหม่!', `<p>วิญญาณของคุณหวนคืนสู่สุสาน พร้อมพลังที่แข็งแกร่งกว่าเดิม</p>
    <div class="offres"><span><img src="${Pix.icon('soul')}">+${n} แก่นวิญญาณ</span></div>
    <p class="small">โบนัสรายได้ถาวรตอนนี้ x${gainMult().toFixed(2)} · เริ่มที่ด่าน ${start}</p>`);
}

// ---------- UI -------------------------------------------------------------
const UI = { tab: 'blood', rows: {}, spellBtns: {}, strainBtns: {}, energyFlash: 0, t: 0, levelDirty: true };
const CUR_ICON = { blood: 'blood', brains: 'brain', bones: 'bone', souls: 'soul' };
const TABS = [['blood', 'เลือด', 'blood'], ['brains', 'สมอง', 'brain'], ['bones', 'กระดูก', 'bone'], ['strains', 'ซอมบี้', 'zombie'],
  ['spells', 'เวทมนตร์', 'plague'], ['prestige', 'เกิดใหม่', 'soul'], ['ach', 'ความสำเร็จ', 'trophy'], ['system', 'ระบบ', 'gear']];
const defsOf = (tab) => (tab === 'spells' ? SPELLS : tab === 'prestige' ? PUP : UPG.filter((u) => tabOf(u) === tab));
const TAB_NOTE = {
  strains: 'ปลดล็อกสายพันธุ์แล้วเลือกได้จากแถบใต้พลังงาน (ปุ่ม Z X C V) · อัปเกรดเพิ่มความแรง · ซอมบี้ที่มีอยู่จะแข็งแรงขึ้นทันที',
  spells: 'ปลดล็อกและอัปเกรดเวทมนตร์ด้วยสมอง ใช้งานได้จากแถบใต้แผนที่หรือกดปุ่ม 1 / 2 / 3',
};

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
}
function showBanner(html) { const b = $('banner'); b.innerHTML = `<div class="box">${html}</div>`; b.classList.remove('hidden'); }
function hideBanner() { $('banner').classList.add('hidden'); }
function modal(title, body) { $('mTitle').textContent = title; $('mBody').innerHTML = body; $('modal').classList.remove('hidden'); }

function initUI() {
  document.querySelectorAll('img[data-icon]').forEach((img) => { img.src = Pix.icon(img.dataset.icon); });
  const tabs = $('tabs');
  for (const [id, label, ic] of TABS) {
    const b = document.createElement('button');
    b.dataset.tab = id;
    b.innerHTML = `<img src="${Pix.icon(ic)}" alt=""><span>${label}</span><i class="dot"></i>`;
    b.onclick = () => { UI.tab = id; buildList(); };
    tabs.appendChild(b);
  }
  document.querySelectorAll('#buymode button').forEach((b) => {
    b.onclick = () => {
      S.settings.buyMode = b.dataset.m === 'max' ? 'max' : +b.dataset.m;
      refreshBuyMode(); refreshList();
    };
  });
  refreshBuyMode();
  buildSpellBar();
  buildStrainBar();
  document.querySelectorAll('#spawnCtl button[data-n]').forEach((b) => {
    b.onclick = () => { S.settings.spawnN = +b.dataset.n; syncSpawnCtl(); };
  });
  $('spawnAll').onclick = () => { Snd.init(); spawnAll(); };
  $('autoBtn').onclick = () => { S.settings.autoSpawn = S.settings.autoSpawn === false; syncSpawnCtl(); toast(S.settings.autoSpawn ? 'เปิดวางซอมบี้อัตโนมัติ' : 'ปิดวางซอมบี้อัตโนมัติ'); };
  syncSpawnCtl();
  $('prevLvl').onclick = () => { if (S.level > 1) goLevel(S.level - 1); };
  // type any level already reached and press Enter to jump straight there
  const lvIn = $('lvlIn');
  const jump = () => {
    const v = Math.round(+lvIn.value);
    if (v >= 1 && v <= S.maxLevel) { if (v !== S.level) goLevel(v); }
    else if (lvIn.value !== '') toast(`ไปได้เฉพาะด่าน 1 – ${S.maxLevel} ที่เคยผ่านมาแล้ว`);
    lvIn.value = S.level;
    lvIn.blur();
  };
  lvIn.addEventListener('change', jump);
  lvIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') jump();
    else if (e.key === 'Escape') { lvIn.value = S.level; lvIn.blur(); }
  });
  lvIn.addEventListener('focus', () => lvIn.select());
  $('nextLvl').onclick = () => { if (S.level < S.maxLevel) goLevel(S.level + 1); };
  $('speedBtn').onclick = () => { S.settings.speed = (S.settings.speed % 3) + 1; };
  $('mOk').onclick = () => $('modal').classList.add('hidden');
  $('zIn').onclick = () => zoomAt(CW / 2, CH / 2, 1.3);
  $('zOut').onclick = () => zoomAt(CW / 2, CH / 2, 1 / 1.3);
  $('zFit').onclick = () => { cam.s = minScale(); centerOn(WW / 2, WH / 2); };
  $('zRoof').onclick = () => { S.settings.roofs = S.settings.roofs === 'hide' ? 'auto' : 'hide'; syncRoofBtn(); };
  syncRoofBtn();
  buildList();
}
function syncSpawnCtl() {
  const n = S.settings.spawnN || 1;
  document.querySelectorAll('#spawnCtl button[data-n]').forEach((b) => b.classList.toggle('active', +b.dataset.n === n));
  const a = $('autoBtn');
  a.classList.toggle('hidden', !U('auto'));
  a.classList.toggle('on', S.settings.autoSpawn !== false);
  a.textContent = S.settings.autoSpawn !== false ? 'AUTO เปิด' : 'AUTO ปิด';
}
function syncRoofBtn() {
  const b = $('zRoof');
  b.classList.toggle('on', S.settings.roofs === 'hide');
  b.title = S.settings.roofs === 'hide' ? 'แสดงหลังคา (ตอนนี้: มองทะลุทุกบ้าน)' : 'มองทะลุหลังคาทุกบ้าน (ตอนนี้: อัตโนมัติ)';
}
function refreshBuyMode() {
  document.querySelectorAll('#buymode button').forEach((b) => {
    b.classList.toggle('active', String(S.settings.buyMode) === b.dataset.m);
  });
}
function buildList() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === UI.tab));
  const list = $('list');
  list.innerHTML = ''; UI.rows = {};
  $('buymode').classList.toggle('hidden', UI.tab === 'system' || UI.tab === 'ach');
  if (UI.tab === 'system') { buildSystem(list); return; }
  if (UI.tab === 'ach') { buildAch(list); return; }
  if (UI.tab === 'prestige') buildPrestigeHead(list);
  const defs = defsOf(UI.tab);
  if (TAB_NOTE[UI.tab]) {
    const note = document.createElement('div'); note.className = 'note';
    note.textContent = TAB_NOTE[UI.tab];
    list.appendChild(note);
  }
  for (const d of defs) {
    const el = document.createElement('div');
    el.className = 'upg' + (d.id.endsWith('Cap') ? ' capupg' : '') + (d.store === 'prestige' ? ' pupg' : '');
    el.innerHTML = `
      ${d.icon ? `<img class="uicon" src="${Pix.icon(d.icon)}" alt="">` : ''}
      <div class="info"><div class="name">${d.name}<span class="lv"></span></div><div class="lvbar"><i></i></div><div class="desc">${d.desc}</div><div class="eff"></div></div>
      <button class="buy"><span class="qty"></span><span class="cost"><img src="${Pix.icon(CUR_ICON[d.cur])}" alt=""><b></b></span></button>`;
    const btn = el.querySelector('.buy');
    btn.onclick = () => buy(d);
    list.appendChild(el);
    UI.rows[d.id] = { el, lv: el.querySelector('.lv'), bar: el.querySelector('.lvbar'), eff: el.querySelector('.eff'), btn, qty: el.querySelector('.qty'), cost: el.querySelector('.cost b'), cache: '' };
  }
  refreshList();
}
function refreshList() {
  for (const id in UI.rows) {
    const r = UI.rows[id], d = DEF[id];
    const l = lvlOf(d), plan = buyPlan(d);
    const can = !plan.maxed && have(d.cur) >= plan.cost;
    const overCap = !plan.maxed && costAt(d, l) > cap(d.cur);
    const key = `${l}|${plan.n}|${plan.cost}|${can}|${overCap}`;
    if (r.cache === key) continue;
    r.cache = key;
    const locked = unlockType(d) && l === 0;
    // show how far the upgrade can go: Lv.3/20, or /∞ when it has no limit
    r.lv.textContent = locked ? ' ล็อก' : d.max ? ` Lv.${l}/${d.max}` : ` Lv.${l}/∞`;
    r.lv.classList.toggle('maxlv', !!plan.maxed);
    r.bar.classList.toggle('hidden', !d.max || d.max === 1);
    if (d.max) r.bar.firstChild.style.width = ((l / d.max) * 100).toFixed(1) + '%';
    r.bar.classList.toggle('full', !!plan.maxed);
    r.eff.textContent = locked ? d.show(1) : plan.maxed || d.max === 1 ? d.show(l) : `${d.show(l)}  →  ${d.show(l + plan.n)}`;
    r.btn.classList.toggle('overcap', overCap);
    if (plan.maxed) {
      r.btn.disabled = true; r.btn.classList.add('maxed'); r.btn.classList.remove('can');
      r.qty.textContent = 'สูงสุด'; r.cost.textContent = '—';
    } else {
      r.btn.disabled = !can; r.btn.classList.toggle('can', can);
      r.qty.textContent = overCap ? 'คลังไม่พอ!' : locked ? 'ปลดล็อก' : d.max === 1 ? 'ซื้อ' : `+${plan.n}`;
      r.cost.textContent = fmt(plan.cost);
    }
  }
}
function buy(d) {
  const plan = buyPlan(d);
  if (plan.maxed || have(d.cur) < plan.cost) return;
  spend(d.cur, plan.cost);
  const l = lvlOf(d);
  setLvl(d, l + plan.n);
  Snd.init(); Snd.play('buy');
  if (['bite', 'flesh', 'legs', 'skelPower', 'spit', 'bomb', 'tank', 'pZombie'].includes(d.id)) refreshUndeadStats();
  if (d.id === 'graveyard' && !G.cleared) for (let i = 0; i < plan.n; i++) spawnSkel(i * 0.15);
  if (d.id === 'pSkel' && !G.cleared) for (let i = 0; i < plan.n * 2; i++) spawnSkel(i * 0.15);
  if (d.id === 'auto') { toast('ซอมบี้จะถูกวางอัตโนมัติเมื่อพลังงานเต็ม! (ปิดได้ที่ปุ่ม AUTO)'); syncSpawnCtl(); }
  if (d.id === 'autoCast') toast('เวทมนตร์จะร่ายเองเมื่อพร้อม!');
  if (d.store === 'spells' && l === 0) toast(`ปลดล็อกเวท "${d.name}" แล้ว! กด ${d.key} เพื่อใช้`);
  if (d.tab === 'strains' && l === 0) {
    toast(`ปลดล็อก ${d.name} แล้ว! กด ${STRAINS[d.id].key.toUpperCase()} เพื่อเลือก`);
    S.settings.strain = d.id;
  }
  refreshList();
  refreshSpellBar();
  refreshStrainBar();
  if (UI.tab === 'prestige') refreshPrestigeHead();
}

// strain picker under the energy bar
function buildStrainBar() {
  const bar = $('strains');
  bar.innerHTML = '';
  for (const id in STRAINS) {
    const s = STRAINS[id];
    const b = document.createElement('button');
    b.className = 'strain';
    b.innerHTML = `<img src="${Pix.icon(s.icon)}" alt=""><span class="nm">${s.name}</span><span class="sc"></span><span class="key">${s.key.toUpperCase()}</span>`;
    b.onclick = () => pickStrain(id);
    bar.appendChild(b);
    UI.strainBtns[id] = { b, sc: b.querySelector('.sc') };
  }
  refreshStrainBar();
}
function pickStrain(id) {
  if (!strainUnlocked(id)) { UI.tab = 'strains'; buildList(); toast('ปลดล็อกสายพันธุ์นี้ได้ที่แท็บ ซอมบี้'); return; }
  S.settings.strain = id;
  refreshStrainBar();
}
function refreshStrainBar() {
  for (const id in UI.strainBtns) {
    const { b, sc } = UI.strainBtns[id];
    const un = strainUnlocked(id), c = strainCost(id);
    b.classList.toggle('locked', !un);
    b.classList.toggle('sel', curStrain() === id);
    b.classList.toggle('poor', !!(un && G && G.energy < c));
    sc.textContent = un ? `⚡${c.toFixed(c % 1 ? 1 : 0)}` : `🔒 ${fmt(DEF[id].base)}`;
  }
}

// prestige tab header
function buildPrestigeHead(list) {
  const el = document.createElement('div');
  el.className = 'phead';
  el.innerHTML = `
    <div class="pr"><img src="${Pix.icon('soul')}" alt=""><div><b id="pSouls"></b><span>แก่นวิญญาณ</span></div></div>
    <div class="pinfo" id="pInfo"></div>
    <button class="px-btn go" id="pReset"></button>
    <p class="note">เกิดใหม่ = รีเซ็ตด่าน ทรัพยากร อัปเกรด เวทมนตร์ และสายพันธุ์ เพื่อแลกกับ<b>แก่นวิญญาณ</b> (ต้องผ่านด่าน 10 ขึ้นไป ยิ่งไปไกลยิ่งได้มาก) · แก่นวิญญาณทุกหน่วยที่เคยได้ เพิ่มรายได้ถาวร +5% · ใช้ซื้ออัปเกรดถาวรด้านล่าง</p>`;
  list.appendChild(el);
  $('pReset').onclick = doPrestige;
  refreshPrestigeHead();
}
function refreshPrestigeHead() {
  const s = $('pSouls');
  if (!s) return;
  const n = soulsOnReset(), c = S.maxLevel - 1;
  s.textContent = fmt(S.prestige.souls);
  $('pInfo').innerHTML = `ได้มาทั้งหมด <b>${fmt(S.prestige.total)}</b> · เกิดใหม่แล้ว <b>${S.stats.prestiges}</b> ครั้ง<br>โบนัสรายได้รวม <b>x${gainMult().toFixed(2)}</b> · รอบนี้ผ่านมา <b>${c}</b> ด่าน`;
  const btn = $('pReset');
  btn.disabled = !n;
  btn.textContent = n ? `เกิดใหม่ · รับ +${n} แก่นวิญญาณ` : `ต้องผ่านด่าน 10 ก่อน (ตอนนี้ ${c})`;
}

// achievements tab
function buildAch(list) {
  const n = achCount();
  let html = `<div class="note">ปลดล็อกแล้ว <b>${n}/${ACH.length}</b> · โบนัสรายได้ถาวร <b>+${n * 2}%</b> (ความสำเร็จละ +2%)</div>`;
  for (const a of ACH) {
    const done = !!S.ach[a.id], v = Math.min(a.v(), a.n);
    html += `<div class="ach${done ? ' done' : ''}"><img src="${Pix.icon('trophy')}" alt=""><div class="info"><div class="name">${a.name}</div><div class="desc">${a.desc}</div>
      <div class="lvbar${done ? ' full' : ''}"><i style="width:${((v / a.n) * 100).toFixed(1)}%"></i></div></div><span class="av">${done ? '✓' : `${fmt(v)}/${fmt(a.n)}`}</span></div>`;
  }
  list.innerHTML = html;
}

function buildSpellBar() {
  const bar = $('spells');
  bar.innerHTML = '';
  for (const d of SPELLS) {
    const b = document.createElement('button');
    b.className = 'spell';
    b.innerHTML = `<i class="cdv"></i><img src="${Pix.icon(d.icon)}" alt=""><span class="nm">${d.name}</span><span class="key">${d.key}</span><span class="cdt"></span>`;
    b.onclick = () => onSpellButton(d.id);
    bar.appendChild(b);
    UI.spellBtns[d.id] = { b, cdv: b.querySelector('.cdv'), cdt: b.querySelector('.cdt') };
  }
  refreshSpellBar();
}
function onSpellButton(id) {
  Snd.init();
  if (!S.spells[id]) { UI.tab = 'spells'; buildList(); toast('ปลดล็อกเวทนี้ได้ที่แท็บ เวทมนตร์'); return; }
  if (targeting === id) { targeting = null; return; }
  if (CD[id] > 0) return;
  castSpell(id);
  if (id === 'plague' && targeting) toast('คลิกบนแผนที่เพื่อปล่อยหมอกโรคระบาด (คลิกขวา = ยกเลิก)');
}
function refreshSpellBar() {
  for (const d of SPELLS) {
    const s = UI.spellBtns[d.id];
    if (!s) continue;
    const lv = S.spells[d.id];
    s.b.classList.toggle('locked', !lv);
    s.b.classList.toggle('targeting', targeting === d.id);
    const ready = lv && CD[d.id] <= 0;
    s.b.classList.toggle('ready', !!ready);
    const frac = lv && CD[d.id] > 0 ? CD[d.id] / d.cd(lv) : 0;
    s.cdv.style.height = (frac * 100).toFixed(1) + '%';
    s.cdt.textContent = !lv ? `🔒 ${fmt(d.base)}` : d.id === 'frenzy' && G && G.frenzyT > 0 ? `คลั่ง! ${Math.ceil(G.frenzyT)}วิ` : CD[d.id] > 0 ? Math.ceil(CD[d.id]) + 'วิ' : 'พร้อม';
  }
}

function buildSystem(list) {
  list.innerHTML = `
    <div class="sys">
      <h3>ตั้งค่า</h3>
      <div class="opt"><span>ความเร็วเกม</span><div class="seg" id="sSpeed"><button data-v="1">x1</button><button data-v="2">x2</button><button data-v="3">x3</button></div></div>
      <div class="opt"><span>หลังผ่านด่าน</span><div class="seg" id="sNext"><button data-v="1">ด่านต่อไป</button><button data-v="0">ฟาร์มด่านเดิม</button></div></div>
      <div class="opt"><span>หลังคาบ้าน</span><div class="seg" id="sRoof"><button data-v="auto">อัตโนมัติ</button><button data-v="hide">มองทะลุตลอด</button></div></div>
      <div class="opt"><span>เสียง</span><div class="seg" id="sSound"><button data-v="1">เปิด</button><button data-v="0">ปิด</button></div></div>
      <div class="opt"><span>เสียงเอฟเฟกต์</span><input type="range" id="sVol" min="0" max="100" step="5"></div>
      <div class="opt"><span>เสียงร้องซอมบี้/คน</span><input type="range" id="sVVol" min="0" max="100" step="5"></div>
      <div class="opt"><span>เพลงประกอบ</span><div class="seg" id="sMusic"><button data-v="1">เปิด</button><button data-v="0">ปิด</button></div></div>
      <div class="opt"><span>ระดับเพลง</span><input type="range" id="sMVol" min="0" max="100" step="5"></div>
      <div class="opt" id="optCast"><span>ร่ายเวทอัตโนมัติ</span><div class="seg" id="sCast"><button data-v="1">เปิด</button><button data-v="0">ปิด</button></div></div>
      <div class="opt" id="optAuto"><span>วางซอมบี้อัตโนมัติ</span><div class="seg" id="sAuto"><button data-v="1">เปิด</button><button data-v="0">ปิด</button></div></div>
      <div class="btnrow">
        <button class="px-btn" id="bSave">บันทึก</button>
        <button class="px-btn" id="bExport">ส่งออกเซฟ</button>
        <button class="px-btn" id="bImport">นำเข้าเซฟ</button>
        <button class="px-btn danger" id="bReset">ล้างเซฟ</button>
      </div>
      <h3>การควบคุม</h3>
      <ul class="howto">
        <li><b>คลิกซ้าย / กดค้าง</b> — วางซอมบี้ (วางได้เฉพาะนอกบ้าน)</li>
        <li><b>คลิกขวาลาก</b> หรือ <b>Space + ลาก</b> หรือ <b>W A S D / ลูกศร</b> — เลื่อนแมพ</li>
        <li><b>ล้อเมาส์</b> หรือปุ่ม + / − — ซูม · ⤢ ดูทั้งแมพ · 🏠 มองทะลุหลังคา · คลิกมินิแมพเพื่อกระโดดไปจุดนั้น</li>
        <li>ชี้เมาส์ที่บ้านเพื่อมองเข้าไปข้างใน</li>
        <li>มือถือ: <b>แตะ</b> = วางซอมบี้ · <b>ลากนิ้ว</b> = เลื่อน · <b>สองนิ้ว</b> = ซูม</li>
        <li><b>1 / 2 / 3</b> — ร่ายเวท · <b>Esc</b> — ยกเลิกการเล็ง</li>
        <li><b>Z / X / C / V</b> — เลือกสายพันธุ์ซอมบี้: ธรรมดา / ถ่มกรด / บึ้มพลีชีพ / ถังเลือด</li>
      </ul>
      <h3>ศัตรู</h3>
      <ul class="howto">
        <li><b>ชาวบ้าน</b> — ตกใจ วิ่งหนีเข้าบ้านแล้วปิดประตู</li>
        <li><b>ตำรวจ</b> (ด่าน 3+) — ยิงปืนพก</li>
        <li><b>นักกล้าม</b> (ด่าน 4+) — เลือดเยอะ ต่อยซอมบี้กระเด็น พอเลือดน้อยจะเลือดออกแล้ววิ่งหนี ถ้าตายจะลุกเป็น<b>ซอมบี้ยักษ์</b></li>
        <li><b>SWAT</b> (ด่าน 6+) — ใส่เกราะ ยิงชุดละ 3 นัด บางคนพก<b>ระเบิดมือ</b> 1–2 ลูก · ตั้งแต่ด่าน 5 ถ้าเมืองติดเชื้อหนักจะมีรถ SWAT มาเสริมกำลัง</li>
        <li><b>ทหาร</b> (ด่าน 8+) — ปืนไรเฟิลระยะไกล ดาเมจสูง · คนถือปืนจะเดินถอยหลังไปยิงไปเมื่อซอมบี้เข้าใกล้</li>
        <li><b>หมา</b> (ด่าน 4+) — เห่าแล้ววิ่งเข้ากัดซอมบี้ ถ้าโดนกัดตายจะลุกเป็น<b>ซอมบี้หมา</b>ที่วิ่งเร็วมาก</li>
        <li><b>คฤหาสน์</b> (ด่าน 3+) — บ้านหลังใหญ่ของคนรวย มี<b>บอดี้การ์ดใส่สูท</b>เฝ้าอยู่ข้างใน ประตูแข็ง 3 เท่า · คนรวยให้เลือด x2</li>
        <li><b>สภาพอากาศ</b> สุ่มทุกด่าน: ร้อนจัด (ซอมบี้โดนแดดเผา 0.8% HP/วิ) · หนาว (ซอมบี้ช้าลง 35%) · น้ำท่วม (กระแสน้ำพัดทุกคนไปมา) — ในบ้านไม่โดนผล</li>
        <li>คนถือปืนยิงทะลุบ้านไม่ได้ — ซอมบี้ใช้บ้านเป็นที่กำบังได้</li>
        <li><b>บอส</b> ทุกด่านที่ 10 สุ่ม 1 จาก 6 ตัว: จ่าปืนกลเหล็ก · พลพ่นไฟ · บาทหลวงไล่ผี · ดร.วัคซีน (รักษาซอมบี้กลับเป็นคน!) · แชมป์มวยปล้ำ · ผู้บัญชาการ — บอสไม่ติดเชื้อ ต้องรุมกัดจนตาย ได้รางวัลก้อนใหญ่</li>
        <li>ท่าไม้ตายบอสมี<b>สัญญาณเตือนบนพื้น</b>ก่อนเสมอ: เลเซอร์แดง (กราดยิง) · กรวยไฟ · วงแหวนทอง (แสงศักดิ์สิทธิ์) · วงฟ้า (จุดตกวัคซีน) · ลูกศรแดง (พุ่งชน) · วงแดง (กระโดดทุบพื้น)</li>
      </ul>
      <h3>เส้นทาง & อีเวนต์</h3>
      <ul class="howto">
        <li><b>แผนที่เลือกเส้นทาง</b> — ผ่านด่านใหม่ครั้งแรก (ตั้งแต่ด่าน 3) ได้เลือก 1 ใน 3 ย่านที่จะบุกต่อ เช่น ตลาดนัด (คนเยอะ) · หมู่บ้านไฮโซ (คฤหาสน์เพียบ) · ใกล้สถานีตำรวจ (อันตรายแต่สมอง/กระดูก x2) · ริมเจ้าพระยา (น้ำท่วมแต่รางวัล x1.5) — ถ้าไม่เลือกภายในเวลา ระบบสุ่มให้</li>
        <li><b>อีเวนต์สุ่มกลางด่าน</b> (ด่าน 3+): ลอยกระทง (คนออกจากบ้านมาดูพลุ) · จันทร์สีเลือด (เลือด x3) · คอนเสิร์ตหมอลำ (ฝูงชนมาเต้น) · ไฟดับ (คนมองไม่เห็นซอมบี้) · ด่านตรวจทหาร (ทหารค่าหัว x3) · เสบียงตกจากฟ้า (แย่งกล่องกับคนถือปืน)</li>
        <li>พิมพ์เลขด่านในช่อง <b>ด่าน</b> ด้านบนแผนที่ แล้วกด Enter เพื่อกลับไปเล่นด่านที่เคยผ่าน</li>
      </ul>
      <h3>สถิติ</h3>
      <div id="statBox" class="stats"></div>
      <h3>วิธีเล่น</h3>
      <ul class="howto">
        <li>ซอมบี้ไล่กัดมนุษย์ เหยื่อที่ตายจะลุกขึ้นเป็นซอมบี้ตัวใหม่</li>
        <li>บ้านเดินเข้าไปได้ — ถ้าประตูปิด ซอมบี้ต้องทุบให้พังก่อน ถ้าเปิดอยู่ก็เดินเข้าไปกินได้เลย</li>
        <li>ทรัพยากรมี<b>ความจุสูงสุด</b> เมื่อเต็มจะเก็บเพิ่มไม่ได้ — อัปเกรดคลังในแต่ละแท็บ</li>
        <li><b>เลือด</b> ได้จากการฆ่า · <b>สมอง</b> ได้จากศพที่ลุกขึ้นและผ่านด่าน · <b>กระดูก</b> ได้จากซอมบี้ที่ตาย</li>
        <li>ทุก 5 ด่านแมพจะกว้างขึ้น · ออฟไลน์ได้ทรัพยากร 50% ของอัตราเฉลี่ย (สูงสุด 8 ชม.)</li>
      </ul>
    </div>`;
  const seg = (id, get, set) => {
    const el = $(id);
    const sync = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === String(get())));
    el.querySelectorAll('button').forEach((b) => { b.onclick = () => { set(b.dataset.v); sync(); }; });
    sync();
  };
  seg('sSpeed', () => S.settings.speed, (v) => { S.settings.speed = +v; });
  seg('sNext', () => (S.settings.autoNext ? 1 : 0), (v) => { S.settings.autoNext = v === '1'; });
  seg('sRoof', () => S.settings.roofs, (v) => { S.settings.roofs = v; syncRoofBtn(); });
  seg('sSound', () => (S.settings.sound ? 1 : 0), (v) => { S.settings.sound = v === '1'; Snd.init(); });
  seg('sCast', () => (S.settings.autoCast ? 1 : 0), (v) => { S.settings.autoCast = v === '1'; });
  seg('sAuto', () => (S.settings.autoSpawn !== false ? 1 : 0), (v) => { S.settings.autoSpawn = v === '1'; syncSpawnCtl(); });
  $('optAuto').classList.toggle('hidden', !U('auto'));
  seg('sMusic', () => (S.settings.music ? 1 : 0), (v) => { S.settings.music = v === '1'; Snd.init(); Snd.setVol(); });
  for (const [id, key, test] of [['sVol', 'vol', 'bash'], ['sVVol', 'vvol', 'groan'], ['sMVol', 'mvol', null]]) {
    const el = $(id);
    el.value = S.settings[key];
    el.oninput = () => { S.settings[key] = +el.value; Snd.init(); Snd.setVol(); };
    el.onchange = () => { if (test) { Snd.last[test] = 0; Snd.play(test); } };
  }
  $('optCast').classList.toggle('hidden', !U('autoCast'));
  $('bSave').onclick = () => { save(); toast('บันทึกเกมแล้ว'); };
  $('bExport').onclick = () => {
    save();
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(S))));
    modal('ส่งออกเซฟ', `<p>คัดลอกโค้ดนี้เก็บไว้:</p><textarea readonly class="savecode">${code}</textarea>`);
    const ta = document.querySelector('.savecode'); ta.focus(); ta.select();
  };
  $('bImport').onclick = () => {
    const code = prompt('วางโค้ดเซฟที่นี่:');
    if (!code) return;
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (typeof d.level !== 'number') throw new Error('bad');
      applySave(d); save(); location.reload();
    } catch (e) { toast('โค้ดเซฟไม่ถูกต้อง'); }
  };
  $('bReset').onclick = () => {
    if (!confirm('ล้างเซฟทั้งหมดและเริ่มใหม่? การกระทำนี้ย้อนกลับไม่ได้')) return;
    resetting = true;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  };
  refreshStats();
}
function refreshStats() {
  const box = $('statBox');
  if (!box) return;
  const rows = [
    ['เวลาเล่น', fmtTime(S.stats.play)],
    ['ด่านสูงสุด (รอบนี้ / ตลอดกาล)', `${S.maxLevel} / ${S.stats.bestLevel}`],
    ['เกิดใหม่', fmt(S.stats.prestiges)],
    ['ซอมบี้บึ้มที่ระเบิด', fmt(S.stats.blasts)],
    ['ฆ่าด้วยกรด', fmt(S.stats.spitKills)],
    ['ผ่านด่านทั้งหมด', fmt(S.stats.cleared)],
    ['มนุษย์ที่ถูกกิน', fmt(S.stats.kills)],
    ['ศพที่ลุกเป็นซอมบี้', fmt(S.stats.raised)],
    ['ซอมบี้ยักษ์ที่เกิดขึ้น', fmt(S.stats.giants)],
    ['บอสที่ปราบได้', fmt(S.stats.bosses)],
    ['ซอมบี้ที่วางเอง', fmt(S.stats.placed)],
    ['ซอมบี้ที่เน่าสลาย', fmt(S.stats.zdead)],
    ['ประตูที่ถูกทุบพัง', fmt(S.stats.doors)],
    ['เลือดสะสมทั้งหมด', fmt(S.stats.bloodTotal)],
    ['อัตราเลือดเฉลี่ย', fmt(S.avg.blood) + '/วิ'],
  ];
  box.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

function tabHasAffordable(tab) {
  if (tab === 'ach' || tab === 'system') return false;
  if (tab === 'prestige' && soulsOnReset() > 0) return true;
  return defsOf(tab).some((d) => { const l = lvlOf(d); return !(d.max && l >= d.max) && have(d.cur) >= costAt(d, l); });
}

const HUD_KEYS = [['blood', 'Blood'], ['brains', 'Brains'], ['bones', 'Bones']];
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const setWidth = (el, v) => { if (el.style.width !== v) el.style.width = v; };
let achCheckT = 1;
function uiFrame(dt) {
  const eMax = F.eMax(), cost = strainCost(curStrain());
  setWidth($('eFill'), ((G.energy / eMax) * 100).toFixed(1) + '%');
  setText($('eText'), `${Math.floor(G.energy)} / ${eMax}  ·  ${STRAINS[curStrain()].name} ใช้ ${cost.toFixed(cost % 1 ? 1 : 0)}`);
  if (UI.energyFlash > 0) UI.energyFlash -= dt;
  $('energy').classList.toggle('flash', UI.energyFlash > 0);
  drawMini(dt);
  achCheckT -= dt;
  if (achCheckT <= 0) { achCheckT = 1; checkAch(); }
  achPopups(dt);

  UI.t -= dt;
  if (UI.t > 0) return;
  UI.t = 0.1;
  for (const [cur, suf] of HUD_KEYS) {
    const c = cap(cur), frac = clamp(S[cur] / c, 0, 1);
    setText($('r' + suf), fmt(S[cur]));
    setText($('c' + suf), fmt(c));
    setWidth($('f' + suf), (frac * 100).toFixed(1) + '%');
    $('h' + suf).classList.toggle('full', frac >= 1); // steady highlight, no flashing
  }
  let alive = 0, inside = 0;
  for (const h of G.humans) { if (h.state !== 'infected') alive++; if (h.space && h.state === 'ok') inside++; }
  $('cHumans').textContent = `${alive}/${G.total}`;
  $('cInside').textContent = inside;
  $('cUndead').textContent = G.undead.length;
  if (UI.levelDirty) {
    const lvIn = $('lvlIn');
    lvIn.max = S.maxLevel;
    if (document.activeElement !== lvIn) lvIn.value = S.level;
    $('lvlMax').textContent = '/' + S.maxLevel;
    const R = G.route, th = $('lvlTheme');
    th.innerHTML = (isBossLevel(S.level) ? '<b>BOSS</b> · ' : '') + MAP.th.name + (R !== ROUTES.normal ? ` · <b>${R.name}</b>` : '');
    th.title = R !== ROUTES.normal ? `${R.name}: ${R.desc}` : `แมพ ${WW}×${WH}`;
    const wx = WEATHER[G.weather], el = $('wx');
    el.querySelector('img').src = Pix.icon(wx.icon);
    el.querySelector('span').textContent = wx.name;
    el.title = wx.desc;
    el.className = 'w-' + G.weather;
    UI.levelDirty = false;
    syncSpawnCtl();
  }
  // random event pill with its remaining time
  const ev = G.ev, pill = $('evPill');
  if (UI.evDirty) {
    UI.evDirty = false;
    pill.classList.toggle('hidden', !ev);
    if (ev) {
      const d = EVENTS[ev.k];
      pill.className = 'ev-' + ev.k;
      pill.querySelector('img').src = Pix.icon(d.icon);
      pill.querySelector('b').textContent = d.name;
      pill.querySelector('span').textContent = d.desc;
    }
  }
  if (ev) setWidth(pill.querySelector('.evbar i'), (clamp(ev.t / ev.T, 0, 1) * 100).toFixed(1) + '%');
  const boss = G.boss, bb = $('bossbar');
  bb.classList.toggle('hidden', !boss || !!boss.dead); // force must be a real boolean — undefined makes toggle() flip every tick
  if (boss && !boss.dead) {
    setText($('bossName'), boss.name);
    setWidth($('bossFill'), ((boss.hp / boss.maxHp) * 100).toFixed(1) + '%');
    setText($('bossHp'), `${fmt(Math.max(0, boss.hp))} / ${fmt(boss.maxHp)}`);
  }
  $('prevLvl').disabled = S.level <= 1;
  $('nextLvl').disabled = S.level >= S.maxLevel;
  $('speedBtn').textContent = 'x' + S.settings.speed;
  $('speedBtn').classList.toggle('fast', S.settings.speed > 1);
  refreshList();
  refreshSpellBar();
  refreshStrainBar();
  for (const [id] of TABS) {
    const b = document.querySelector(`#tabs button[data-tab="${id}"]`);
    b.classList.toggle('has', tabHasAffordable(id));
  }
  if (G.cleared) { const c = $('bCount'); if (c) c.textContent = Math.max(0, Math.ceil(G.clearT)); }
  UI.statT = (UI.statT || 0) - 0.1;
  if (UI.statT <= 0) {
    UI.statT = 1;
    if (UI.tab === 'system') refreshStats();
    if (UI.tab === 'prestige') refreshPrestigeHead();
    if (UI.tab === 'ach') buildAch($('list'));
  }
}

// ---------- input ----------------------------------------------------------
const pan = { active: false, id: null, lx: 0, ly: 0, moved: 0 };
const touches = new Map();
let pinch = null, spaceHeld = false, touchTap = null;
function startPan(e) {
  pan.active = true; pan.id = e.pointerId; pan.lx = e.clientX; pan.ly = e.clientY; pan.moved = 0;
  canvas.classList.add('panning');
}
function movePan(e) {
  const r = canvas.getBoundingClientRect(), k = CW / r.width;
  const dx = e.clientX - pan.lx, dy = e.clientY - pan.ly;
  pan.moved += Math.abs(dx) + Math.abs(dy);
  cam.x -= (dx * k) / cam.s; cam.y -= (dy * k) / cam.s;
  clampCam();
  pan.lx = e.clientX; pan.ly = e.clientY;
}
function endPan() { pan.active = false; pan.id = null; canvas.classList.remove('panning'); }

canvas.addEventListener('pointerdown', (e) => {
  Snd.init();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const p = screenToWorld(e.clientX, e.clientY);
  mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { // pinch
      touchTap = null; endPan();
      const [a, b] = [...touches.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    } else if (touches.size === 1) {
      touchTap = { x: e.clientX, y: e.clientY };
      startPan(e);
    }
    return;
  }
  if (e.button === 2) { if (targeting) { targeting = null; return; } startPan(e); return; }
  if (e.button === 1 || (e.button === 0 && spaceHeld)) { e.preventDefault(); startPan(e); return; }
  if (targeting) { castSpell(targeting, p.x, p.y); return; }
  mouse.down = true; mouse.hold = 0.18;
  playerSpawn(p.x, p.y);
});
canvas.addEventListener('pointermove', (e) => {
  const p = screenToWorld(e.clientX, e.clientY);
  mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const r = canvas.getBoundingClientRect(), k = CW / r.width;
      cam.x -= ((mx - pinch.mx) * k) / cam.s; cam.y -= ((my - pinch.my) * k) / cam.s;
      zoomAt((mx - r.left) * k, (my - r.top) * k, dist / pinch.dist);
      pinch = { dist, mx, my };
      return;
    }
  }
  if (pan.active && e.pointerId === pan.id) {
    movePan(e);
    if (touchTap && pan.moved > 10) touchTap = null;
  }
});
function pointerEnd(e) {
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (touchTap && e.type === 'pointerup' && touches.size === 0) {
      const p = screenToWorld(touchTap.x, touchTap.y);
      if (targeting) castSpell(targeting, p.x, p.y); else playerSpawn(p.x, p.y);
    }
    if (touches.size === 0) { touchTap = null; mouse.inside = false; }
  }
  if (pan.active && e.pointerId === pan.id) endPan();
  mouse.down = false;
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('pointerleave', () => { if (!pan.active) mouse.inside = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), k = CW / r.width;
  zoomAt((e.clientX - r.left) * k, (e.clientY - r.top) * k, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// minimap: click / drag to jump
let miniDrag = false;
function miniJump(e) {
  const r = mini.getBoundingClientRect();
  const mw = mini.width, mh = mini.height, k = Math.min(mw / WW, mh / WH);
  const ox = (mw - WW * k) / 2, oy = (mh - WH * k) / 2;
  const mx = ((e.clientX - r.left) * mw) / r.width, my = ((e.clientY - r.top) * mh) / r.height;
  centerOn((mx - ox) / k, (my - oy) / k);
}
mini.addEventListener('pointerdown', (e) => { miniDrag = true; try { mini.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } miniJump(e); });
mini.addEventListener('pointermove', (e) => { if (miniDrag) miniJump(e); });
mini.addEventListener('pointerup', () => { miniDrag = false; });

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { spaceHeld = true; e.preventDefault(); }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault(); }
  if (k === '+' || k === '=') zoomAt(CW / 2, CH / 2, 1.25);
  if (k === '-' || k === '_') zoomAt(CW / 2, CH / 2, 0.8);
  if (k === '0') { cam.s = minScale(); centerOn(WW / 2, WH / 2); }
  const s = SPELLS.find((d) => d.key === e.key);
  if (s) onSpellButton(s.id);
  for (const id in STRAINS) if (STRAINS[id].key === k) pickStrain(id);
  if (k === 'q') { Snd.init(); spawnAll(); }
  if (k === 'escape') targeting = null;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ') spaceHeld = false;
  keys.delete(k);
});
window.addEventListener('blur', () => { keys.clear(); spaceHeld = false; });
function keyPan(dt) {
  if (!keys.size) return;
  let dx = 0, dy = 0;
  if (keys.has('a') || keys.has('arrowleft')) dx--;
  if (keys.has('d') || keys.has('arrowright')) dx++;
  if (keys.has('w') || keys.has('arrowup')) dy--;
  if (keys.has('s') || keys.has('arrowdown')) dy++;
  const sp = (600 * DPR * dt) / cam.s;
  cam.x += dx * sp; cam.y += dy * sp;
  clampCam();
}

// ---------- offline progress ----------------------------------------------
function applyOffline(sec) {
  if (sec < 60) return;
  const t = Math.min(sec, 8 * 3600);
  // averages already include every multiplier, so add them raw
  const gb = gain('blood', S.avg.blood * t * 0.5, true), gbr = gain('brains', S.avg.brains * t * 0.5, true), gbo = gain('bones', S.avg.bones * t * 0.5, true);
  if (gb + gbr + gbo < 1) return;
  modal('ระหว่างที่คุณไม่อยู่...', `
    <p>กองทัพซอมบี้ออกล่าต่อเป็นเวลา <b>${fmtTime(t)}</b></p>
    <div class="offres">
      <span><img src="${Pix.icon('blood')}">+${fmt(gb)}</span>
      <span><img src="${Pix.icon('brain')}">+${fmt(gbr)}</span>
      <span><img src="${Pix.icon('bone')}">+${fmt(gbo)}</span>
    </div>
    <p class="small">ได้รับ 50% ของอัตราเฉลี่ยขณะเล่น (สูงสุด 8 ชั่วโมง และไม่เกินความจุคลัง)</p>`);
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); save(); }
  else if (hiddenAt) { applyOffline((Date.now() - hiddenAt) / 1000); hiddenAt = 0; last = performance.now(); }
});
window.addEventListener('beforeunload', save);

// ---------- main loop ------------------------------------------------------
let last = performance.now();
let saveT = 15;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  if (dt < 0) dt = 0;

  let rem = dt * S.settings.speed;
  while (rem > 0) {
    const st = Math.min(rem, 1 / 30);
    update(st);
    rem -= st;
  }
  keyPan(dt);
  if (mouse.down && !targeting) {
    mouse.hold -= dt;
    if (mouse.hold <= 0) { mouse.hold = 0.12; playerSpawn(mouse.x, mouse.y); }
  }
  rate.t += dt;
  if (rate.t >= 20) {
    for (const c of ['blood', 'brains', 'bones']) {
      const inst = rate[c] / rate.t;
      S.avg[c] = S.avg[c] ? S.avg[c] * 0.6 + inst * 0.4 : inst;
      rate[c] = 0;
    }
    rate.t = 0;
  }
  saveT -= dt;
  if (saveT <= 0) { saveT = 15; save(); }

  draw(dt);
  uiFrame(dt);
  requestAnimationFrame(frame);
}

// ---------- boot -----------------------------------------------------------
const hadSave = load();
initUI();
resize();
newLevel(S.level);
new ResizeObserver(resize).observe(canvas);
if (!S.tutorial) $('tip').classList.add('hidden');
if (hadSave) applyOffline((Date.now() - S.t) / 1000);
// debug handle (console): ZR.step(seconds) fast-forwards the simulation
window.ZR = { get S() { return S; }, get G() { return G; }, get MAP() { return MAP; }, cam, goLevel, save, step: (sec) => { for (let t = 0; t < sec; t += 1 / 30) update(1 / 30); }, render: () => { draw(0); uiFrame(0.2); }, event: (k) => startEvent(k), boss: (k) => spawnBoss(k), defs: [...UPG, ...SPELLS], buy: (d) => buy(d) };
requestAnimationFrame(frame);
})();
