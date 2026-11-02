'use strict';
// NEOGUN — a run & gun where the gun only gets bigger.

const W = 960, H = 540;
const GROUND_Y = 460;
const HORIZON = 340;
const GRAV = 0.6;
const MAX_HP = 100;
const ENEMY_SCALE = 1.5;
const GROW_FRAMES = 45;

const canvas = document.getElementById('game');
// `let` so gun sprites can temporarily redirect drawing to their low-res buffer.
let ctx = canvas.getContext('2d');
const wrap = document.getElementById('wrap');

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  wrap.style.width = canvas.style.width = Math.floor(W * s) + 'px';
  wrap.style.height = canvas.style.height = Math.floor(H * s) + 'px';
}
addEventListener('resize', fit);
fit();

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const FONT = '"Press Start 2P", monospace';

// ---------------------------------------------------------------------------
// Guns. Each power-up moves one row down. Past the end it just keeps scaling.
// ---------------------------------------------------------------------------
// Sizes grow ~15% per level (len = 24 * 1.15^n, thick = 8 * 1.15^n).
const GUN_TABLE = [
  // name             len thick   cd   n spread jitter   r   dmg  spd pierce recoil shake color shot
  ['PEA SHOOTER',        24,    8,  16,  1,     0,     0,   4,    1,    9,  false, 0, 0, '#7ff', 'pellet'],
  ['LASER PISTOL',       28,    9,  12,  1,     0,  0.02,   4,  1.5,   12,  false, 0.2, 0, '#0ff', 'laser'],
  ['NEON SMG',           32,   11,   6,  1,     0,  0.07,   4,    1,   13,  false, 0.3, 1, '#0fc', 'tracer'],
  ['SCATTERBLASTER',     37,   12,  15,  5,  0.22,  0.03,   5,  1.5,   11,  false, 1.5, 3, '#ff0', 'buckshot'],
  ['TURBO RIFLE',        42,   14,   4,  2,  0.05,  0.03,   5,    2,   15,  false, 0.5, 2, '#f0f', 'tracer'],
  ['MINIGUN',            48,   16,   2,  1,     0,   0.1,   5,    2,   15,  false, 0.6, 3, '#f6f', 'tracer'],
  ['HAND CANNON',        56,   19,  16,  1,     0,     0,  12,   12,   11,   true, 4, 8, '#f80', 'shell'],
  ['PLASMA HOSE',        64,   21,   3,  2,   0.1,  0.12,   9,    3,   13,   true, 1, 4, '#8f0', 'plasma'],
  ['RAILGUN',            73,   24,  18,  1,     0,     0,  10,   30,   30,   true, 5, 10, '#0ff', 'beam'],
  ['TANK BARREL',        84,   28,  14,  5,  0.25,  0.03,  13,   12,   13,   true, 5, 12, '#fd0', 'shell'],
  ['BATTLESHIP GUN',     97,   32,  10,  7,   0.3,  0.03,  16,   15,   14,   true, 6, 14, '#f44', 'shell'],
  ['ORBITAL CANNON',    112,   37,  16,  1,     0,     0,  40,   80,   16,   true, 9, 22, '#fff', 'orb'],
  ['PLANET SPLITTER',   128,   43,   8,  9,   0.4,  0.05,  24,   50,   16,   true, 8, 20, '#f0f', 'planet'],
].map(([name, len, thick, cd, count, spread, jitter, r, dmg, speed, pierce, recoil, shake, color, shot]) =>
  ({ name, len, thick, cd, count, spread, jitter, r, dmg, speed, pierce, recoil, shake, color, shot }));

// After the table come five Gun of God marks, then the nuke, which ends the game.
const GOD_LEVELS = 5;
const NUKE_LEVEL = GUN_TABLE.length + GOD_LEVELS;
const NUKE_GUN = {
  ...GUN_TABLE[GUN_TABLE.length - 1],
  name: 'SUPER ULTIMATE MEGA NUKE', len: 290, thick: 100, cd: 999, color: '#ff0', shot: 'nuke',
};

function gunStats(level) {
  if (level < GUN_TABLE.length) return GUN_TABLE[level];
  if (level >= NUKE_LEVEL) return NUKE_GUN;
  const base = GUN_TABLE[GUN_TABLE.length - 1];
  const k = level - (GUN_TABLE.length - 1);
  const f = Math.pow(1.15, k);
  return {
    ...base,
    name: 'GUN OF GOD MK.' + k,
    len: base.len * f, thick: base.thick * f, r: base.r * f,
    dmg: base.dmg * f, count: Math.min(15, base.count + k),
    color: ['#ffd700', '#7ff', '#fff', '#f6f', '#ff4'][k - 1],
  };
}

// ---------------------------------------------------------------------------
// Input: keyboard + any standard-mapping gamepad
// ---------------------------------------------------------------------------
const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'KeyK'], fire: ['KeyX', 'KeyJ'],
  start: ['Enter', 'Escape', 'KeyP'], mute: [],
};
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

const Input = {
  keys: {}, state: {}, pressed: {}, prev: {}, pad: null, padName: '', padToast: 0,
  update() {
    const s = {};
    for (const a in KEYMAP) s[a] = KEYMAP[a].some(k => this.keys[k]);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const b = i => gp.buttons[i] && gp.buttons[i].pressed;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const p = {
        left: ax < -0.4 || b(14), right: ax > 0.4 || b(15),
        up: ay < -0.5 || b(12), down: ay > 0.5 || b(13),
        jump: b(0),
        fire: b(2) || b(1) || b(5) || b(7) || b(3),
        start: b(9), mute: b(8),
      };
      let active = false;
      for (const a in p) if (p[a]) { s[a] = true; active = true; }
      if (active) this.pad = gp;
    }
    for (const a in s) this.pressed[a] = s[a] && !this.prev[a];
    this.prev = s;
    this.state = s;
  },
};
addEventListener('keydown', e => {
  if (PREVENT.has(e.code)) e.preventDefault();
  Input.keys[e.code] = true;
  Sound.init();
  // Handled here rather than in the polled input so a quick tap can't be missed.
  if (e.code === 'KeyM' && !e.repeat) Sound.toggleMute();
});
addEventListener('keyup', e => { Input.keys[e.code] = false; });
addEventListener('pointerdown', () => Sound.init());
addEventListener('gamepadconnected', e => {
  Input.pad = e.gamepad;
  Input.padName = e.gamepad.id.replace(/\(.*\)/, '').trim().slice(0, 30).toUpperCase() || 'GAMEPAD';
  Input.padToast = 240;
});

function rumble(strong, weak, ms) {
  const a = Input.pad && Input.pad.vibrationActuator;
  if (a && a.playEffect) {
    a.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Sound: tiny WebAudio synth for SFX + a synthwave loop
// ---------------------------------------------------------------------------
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const MUSIC_BPM = 124;

let savedMute = false;
try { savedMute = localStorage.getItem('neogun-muted') === '1'; } catch (e) {}

const Sound = {
  ctx: null, master: null, music: null, muted: savedMute, musicOn: false, step: 0, nextTime: 0, toast: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.45;
    this.master.connect(this.ctx.destination);
    // Music bus: a gentle lowpass to take the edge off the saws.
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.22;
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3800;
    this.music.connect(tone);
    tone.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Gated reverb for that 80s snare: a dense burst that stops dead after 0.3s.
    this.verb = this.ctx.createConvolver();
    const irLen = Math.floor(this.ctx.sampleRate * 0.3);
    const ir = this.ctx.createBuffer(2, irLen, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * (1 - 0.3 * i / irLen);
    }
    this.verb.buffer = ir;
    const verbGain = this.ctx.createGain();
    verbGain.gain.value = 0.18;
    this.verb.connect(verbGain);
    verbGain.connect(this.music);
    this.nextTime = this.ctx.currentTime + 0.1;
    setInterval(() => this.schedule(), 25);
  },
  toggleMute() {
    this.muted = !this.muted;
    this.toast = 90;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.45, t);
    }
    try { localStorage.setItem('neogun-muted', this.muted ? '1' : ''); } catch (e) {}
  },
  tone(freq, dur, type = 'square', vol = 0.2, slideTo = 0, t = 0, dest = null) {
    if (!this.ctx) return;
    t = t || this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.3, cutoff = 1500, t = 0, dest = null) {
    if (!this.ctx) return;
    t = t || this.ctx.currentTime;
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noiseBuf;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  },
  // Two detuned saws with a soft attack: the classic 80s polysynth pad / lead.
  synth(freq, dur, vol, t, dest, attack = 0.01, type = 'sawtooth') {
    for (const det of [-9, 9]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.08));
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur + 0.02);
    }
  },
  schedule() {
    if (!this.musicOn) { this.nextTime = this.ctx.currentTime + 0.05; return; }
    const stepDur = 60 / MUSIC_BPM / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += stepDur;
      this.step++;
    }
  },
  playStep(step, t) {
    // Dm  Bb  Gm  A, in four-bar phrases. Sections build up over 16 bars:
    // drums + bass + pads, then + arpeggio, then + lead, then everything.
    const roots = [38, 34, 43, 33];
    const chords = [[0, 3, 7, 12], [0, 4, 7, 12], [0, 3, 7, 12], [0, 4, 7, 12]];
    const bar = Math.floor(step / 16) % 4, s = step % 16, m = this.music;
    const section = Math.floor(step / 64) % 4;
    const root = roots[bar], chord = chords[bar];
    const dur = 60 / MUSIC_BPM / 4;
    // Pulsing 16th-note octave bass
    this.tone(midi(root + (s % 2 ? 12 : 0)), dur * 0.9, 'sawtooth', 0.2, 0, t, m);
    // Detuned pad chord held for the bar
    if (s === 0) for (const n of chord.slice(0, 3)) this.synth(midi(root + 24 + n), dur * 16, 0.035, t, m, 0.25);
    // Drums: four-on-the-floor kick, gated snare on 2 and 4, 16th hats
    if (s % 4 === 0) this.tone(130, 0.25, 'sine', 1, 35, t, m);
    if (s === 4 || s === 12) {
      this.noise(0.2, 0.5, 6000, t, m);
      this.noise(0.2, 0.6, 6000, t, this.verb);
      this.tone(190, 0.1, 'triangle', 0.3, 120, t, m);
    }
    this.noise(0.03, s % 4 === 2 ? 0.12 : 0.05, 10000, t, m);
    // Falling tom fill at the end of every eighth bar
    if (step % 128 >= 124) this.tone([260, 210, 165, 125][s - 12], 0.25, 'sine', 0.7, 60, t, m);
    // Arpeggio: chord tones up and down over two octaves
    if (section === 1 || section === 3) {
      const pat = [0, 1, 2, 3, 2, 1, 2, 3];
      const n = chord[pat[s % 8] % 4] + (s >= 8 ? 12 : 0);
      this.tone(midi(root + 36 + n), dur * 0.8, 'square', 0.05, 0, t, m);
    }
    // Lead melody
    if (section >= 2) {
      const LEAD = [
        { 0: [74, 6], 6: [77, 4], 10: [76, 6] },
        { 0: [74, 8], 8: [72, 4], 12: [70, 4] },
        { 0: [70, 6], 6: [74, 4], 10: [79, 6] },
        { 0: [76, 8], 8: [73, 8] },
      ];
      const note = LEAD[bar][s];
      if (note) this.synth(midi(note[0]), dur * note[1], 0.06, t, m, 0.02, 'square');
    }
  },
  shoot(level) {
    const f = 900 * Math.pow(0.8, level);
    this.tone(f, 0.07 + level * 0.012, level > 6 ? 'sawtooth' : 'square', 0.12, f * 0.35);
    if (level >= 6) this.noise(0.12 + level * 0.03, Math.min(0.7, 0.2 + level * 0.04), 300 + 2000 / level);
  },
  nuke() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(1.2, 1, 6000, t);          // the crack
    this.noise(5, 0.9, 500, t);           // the roar
    this.noise(8, 0.5, 160, t + 0.8);     // the long rumble after
    this.tone(90, 4, 'sine', 1, 18, t);
    this.tone(55, 6, 'sawtooth', 0.35, 15, t + 0.2);
  },
  explode(big) {
    this.noise(big ? 0.7 : 0.3, big ? 0.7 : 0.4, big ? 600 : 1200);
    this.tone(big ? 90 : 140, big ? 0.5 : 0.25, 'sine', 0.5, 30);
  },
  powerup() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(midi(69 + n), 0.12, 'square', 0.15, 0, t + i * 0.05));
  },
  heal() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    [0, 7, 12].forEach((n, i) => this.tone(midi(62 + n), 0.15, 'triangle', 0.2, 0, t + i * 0.06));
  },
  hit() { this.noise(0.12, 0.35, 2500); this.tone(220, 0.15, 'square', 0.15, 90); },
  hurt() { this.tone(320, 0.35, 'sawtooth', 0.3, 50); },
  jump() { this.tone(280, 0.12, 'square', 0.08, 640); },
  enemyShot() { this.tone(700, 0.09, 'triangle', 0.08, 250); },
};

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let state = 'title';
let game = null;
let titleT = 0;
let best = 0;
try { best = +localStorage.getItem('neogun-best') || 0; } catch (e) {}

function newGame() {
  const g = {
    camX: 0, zoom: 1, frame: 0, shake: 0,
    player: { x: 120, y: GROUND_Y - 81, w: 45, h: 81, vx: 0, vy: 0, face: 1, ang: 0,
              onGround: false, plat: null, coyote: 0, jumpBuf: 0, jumping: false, drop: 0,
              cool: 0, inv: 0, muzzle: 0, hp: MAX_HP, hitFlash: 0 },
    gunLevel: 0, lives: 3, score: 0, maxX: 120, gunGrow: 0, gunFromLen: 0,
    plats: [], enemies: [], bullets: [], ebullets: [], pickups: [], particles: [], texts: [],
    genX: 0, chunk: 0, banner: null, overT: 0,
  };
  game = g;
  return g;
}

function addPlat(g, x, y, w, ground) {
  const p = { x, y, w, ground };
  g.plats.push(p);
  return p;
}

function spawnEnemy(g, type, x, y) {
  const d = g.chunk;
  const defs = {
    grunt: { w: 26, h: 34, hp: 2 + Math.floor(d / 3), speed: rand(0.75, 1.25) + Math.min(0.85, d * 0.034), score: 100, contact: 20 },
    drone: { w: 32, h: 18, hp: 1 + Math.floor(d / 4), speed: 2.1, score: 150, contact: 15 },
    heavy: { w: 60, h: 64, hp: 30 + d * 2, speed: 0.5, score: 1000, contact: 30 },
  };
  const def = defs[type];
  const w = def.w * ENEMY_SCALE, h = def.h * ENEMY_SCALE;
  g.enemies.push({ type, x, y: y - h, w, h, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, contact: def.contact,
    speed: def.speed, score: def.score, face: -1, t: rand(0, 600), baseY: y - h,
    cool: randi(100, 220), flash: 0, onGround: false, dead: false });
}

function spawnPickup(g, x, y, vy = 0, kind = 'gun') {
  g.pickups.push({ kind, x: x - 15, y: y - 30, w: 30, h: 30, vx: 0, vy, t: 0, onGround: false });
}

function genChunk(g) {
  const d = g.chunk;
  if (d === 0) {
    addPlat(g, -600, GROUND_Y, 1700, true);
    addPlat(g, 520, GROUND_Y - 130, 180, false);
    spawnPickup(g, 610, GROUND_Y - 130);
    spawnEnemy(g, 'grunt', 900, GROUND_Y);
    g.genX = 1100;
    g.chunk++;
    return;
  }
  const gap = Math.random() < Math.min(0.56, 0.24 + d * 0.024);
  if (gap) g.genX += randi(90, 170);
  const len = randi(450, 900);
  const x0 = g.genX;
  // Keep floating platforms clear of the hole we just made.
  const minPx = x0 + (gap ? 160 : 0);
  const surfaces = [addPlat(g, x0, GROUND_Y, len, true)];
  const n = randi(0, 2);
  for (let i = 0; i < n; i++) {
    const w = randi(120, 240);
    const px = rand(minPx, Math.max(minPx, x0 + len - w));
    const py = GROUND_Y - (i === 0 ? randi(120, 150) : randi(240, 280));
    surfaces.push(addPlat(g, px, py, w, false));
  }
  const grunts = randi(1, 1 + Math.min(4, Math.floor(d / 2)));
  for (let i = 0; i < grunts; i++) {
    const s = surfaces[randi(0, surfaces.length - 1)];
    spawnEnemy(g, 'grunt', s.x + rand(10, s.w - 50), s.y);
  }
  if (d >= 2) {
    const drones = randi(0, Math.min(3, Math.floor(d / 3)));
    for (let i = 0; i < drones; i++) spawnEnemy(g, 'drone', x0 + rand(100, len), GROUND_Y - rand(200, 330));
  }
  if (d % 6 === 5) spawnEnemy(g, 'heavy', x0 + len - 160, GROUND_Y);
  if (d % 3 === 0 && Math.random() < 0.64) {
    const s = surfaces[surfaces.length - 1];
    spawnPickup(g, s.x + s.w / 2, s.y);
  }
  g.genX += len;
  g.chunk++;
}

// Gravity + landing on one-way platforms (everything is jump-through from below).
function physics(o, g, dropThrough) {
  o.vy = Math.min(o.vy + GRAV, 15);
  o.x += o.vx;
  const prevBottom = o.y + o.h;
  o.y += o.vy;
  o.onGround = false;
  o.plat = null;
  if (o.vy >= 0) {
    for (const p of g.plats) {
      if (dropThrough && !p.ground) continue;
      if (o.x + o.w > p.x && o.x < p.x + p.w && prevBottom <= p.y + 0.5 && o.y + o.h >= p.y) {
        o.y = p.y - o.h; o.vy = 0; o.onGround = true; o.plat = p;
        break;
      }
    }
  }
}

function floorBelow(g, x, feetY) {
  return g.plats.some(p => x >= p.x && x <= p.x + p.w && p.y >= feetY - 1);
}

const viewW = g => W / g.zoom;
const viewTop = g => GROUND_Y + 80 - H / g.zoom;
// How far (in gun thicknesses) each gun's stock/housing sticks out behind its grip.
const GUN_REAR = [0.3, 0.4, 1.6, 2, 2.2, 0.8, 0.4, 0.3, 1.1, 0.9, 1.4, 0.75, 1.2];
const shoulderPos = p => ({ x: p.x + p.w / 2 + p.face * 4, y: p.y + p.h * 0.47 });
// Arm length: enough to push the back of the gun past the hero's chest. Scales with the grow animation.
function armLength(g) {
  const s = gunStats(g.gunLevel);
  const k = g.gunGrow > 0 ? gunGrowScale(g) : 1;
  const rear = g.gunLevel >= NUKE_LEVEL ? 0.6 : GUN_REAR[Math.min(g.gunLevel, GUN_REAR.length - 1)];
  return (22 + rear * s.thick) * k;
}
function handPos(g) {
  const p = g.player, sh = shoulderPos(p);
  // Aiming upwards needs extra reach to clear the head.
  const a = armLength(g) + Math.max(0, -Math.sin(p.ang)) * p.h * 0.5;
  // Lift thicker guns when held level, so the big ones don't hide the floor and holes.
  const lift = gunStats(g.gunLevel).thick * 0.5 * Math.abs(Math.cos(p.ang));
  return { x: sh.x + Math.cos(p.ang) * a, y: sh.y + Math.sin(p.ang) * a - lift };
}

function banner(g, text, sub, color) {
  g.banner = { text, sub, color, t: 0 };
}

function floatText(g, x, y, text, color = '#fff') {
  g.texts.push({ x, y, text, color, life: 50 });
}

function burst(g, x, y, n, speed, colors, size = 4) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(0.5, 1) * speed;
    g.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: randi(20, 45), max: 45,
      color: colors[randi(0, colors.length - 1)], size: rand(size * 0.5, size * 1.3) });
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
function updatePlayer(g) {
  const p = g.player, I = Input.state, P = Input.pressed;
  const ax = (I.right ? 1 : 0) - (I.left ? 1 : 0);
  p.vx += ax * 1.25;
  p.vx *= 0.8;
  if (ax) p.face = ax;

  p.coyote = p.onGround ? 6 : p.coyote - 1;
  p.jumpBuf = P.jump ? 8 : p.jumpBuf - 1;
  if (p.jumpBuf > 0 && p.coyote > 0) {
    if (I.down && p.plat && !p.plat.ground) {
      p.drop = 14;
    } else {
      p.vy = -14.5; p.jumping = true;
      Sound.jump();
    }
    p.jumpBuf = 0; p.coyote = 0;
  }
  if (p.jumping && !I.jump && p.vy < -6) p.vy = -6;
  if (p.vy >= 0) p.jumping = false;

  physics(p, g, p.drop > 0);
  p.drop--;

  if (p.x < g.camX + 4) { p.x = g.camX + 4; if (p.vx < 0) p.vx = 0; }
  if (p.x > g.maxX) { g.score += Math.floor((p.x - g.maxX) / 10); g.maxX = p.x; }

  // Aim: 8-way, but no straight-down while standing.
  if (I.up && !ax) p.ang = -Math.PI / 2;
  else if (I.up) p.ang = p.face > 0 ? -Math.PI / 4 : -3 * Math.PI / 4;
  else if (I.down && !p.onGround) p.ang = ax ? (p.face > 0 ? Math.PI / 4 : 3 * Math.PI / 4) : Math.PI / 2;
  else p.ang = p.face > 0 ? 0 : Math.PI;

  p.cool--;
  p.muzzle--;
  if (p.inv > 0) p.inv--;
  if (p.hitFlash > 0) p.hitFlash--;
  if (I.fire && p.cool <= 0) fire(g);

  if (p.y > GROUND_Y + 300) loseLife(g, true);
}

function fire(g) {
  const p = g.player, L = g.gunLevel, s = gunStats(L);
  const h = handPos(g);
  const mx = h.x + Math.cos(p.ang) * s.len, my = h.y + Math.sin(p.ang) * s.len;
  if (L >= NUKE_LEVEL) { detonate(g, mx, my); return; }
  p.cool = s.cd;
  for (let i = 0; i < s.count; i++) {
    const a = p.ang + (s.count > 1 ? lerp(-s.spread, s.spread, i / (s.count - 1)) : 0) + rand(-1, 1) * s.jitter;
    g.bullets.push({ x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
      r: s.r, dmg: s.dmg, pierce: s.pierce, life: 140, color: s.color, hit: new Set(),
      shot: s.shot, age: 0, spin: rand(0, Math.PI * 2), hue: randi(0, 360) });
  }
  // Spent brass for the bullet guns, red shells for the shotgun.
  if (s.shot === 'tracer' || s.shot === 'buckshot') {
    const shotgun = s.shot === 'buckshot';
    g.particles.push({ x: h.x, y: h.y - 4, vx: -p.face * rand(1.5, 3), vy: rand(-5, -3), life: 40, max: 40,
      color: shotgun ? '#f33' : '#d9a441', size: shotgun ? 6 : 4 });
  }
  // Recoil. Pointing down in mid-air turns big guns into a jetpack.
  p.vx -= Math.cos(p.ang) * s.recoil * (p.onGround ? 0.35 : 1);
  if (Math.sin(p.ang) > 0.1) p.vy = Math.min(p.vy, 0) - s.recoil * 0.9;
  p.muzzle = 4;
  g.shake = Math.max(g.shake, s.shake);
  burst(g, mx, my, 2 + Math.min(10, L), 2 + L * 0.4, [s.color, '#fff'], 2 + L * 0.4);
  Sound.shoot(L);
  if (L >= 3) rumble(Math.min(1, L / 12), 0.3 + L * 0.05, 40 + L * 8);
}

const NUKE_BONUS = 1000000;

function detonate(g, x, y) {
  state = 'nuke';
  g.nukeT = 0;
  g.nukeX = x; g.nukeY = y;
  g.nukeKills = g.enemies.filter(e => !e.dead).length;
  g.score += NUKE_BONUS + g.nukeKills * 1000;
  g.shake = 60;
  Sound.nuke();
  rumble(1, 1, 4000);
  if (g.score > best) {
    best = g.score;
    try { localStorage.setItem('neogun-best', best); } catch (e) {}
  }
}

function hurt(g, dmg) {
  const p = g.player;
  if (p.inv > 0 || state !== 'play') return;
  p.hp -= dmg;
  if (p.hp <= 0) { loseLife(g, false); return; }
  p.inv = 50;
  p.hitFlash = 20;
  p.vy = Math.min(p.vy, -4); p.vx = -p.face * 4;
  g.shake = Math.max(g.shake, 8);
  burst(g, p.x + p.w / 2, p.y + p.h * 0.4, 16, 5, ['#f44', '#fff', '#ff2fa0']);
  Sound.hit();
  rumble(0.6, 0.6, 150);
}

function loseLife(g, pit) {
  const p = g.player;
  g.lives--;
  Sound.hurt();
  g.shake = 16;
  rumble(1, 1, 400);
  burst(g, p.x + p.w / 2, Math.min(p.y + p.h / 2, GROUND_Y), 40, 6, ['#ff2fa0', '#ffe66d', '#fff']);
  if (g.lives <= 0) { p.hp = 0; gameOver(g); return; }
  p.hp = MAX_HP;
  p.inv = 120;
  if (pit) {
    // Respawn on the first stretch of ground with room to stand, and pull the camera back if needed.
    const ground = g.plats.find(pl => pl.ground && pl.x + pl.w > g.camX + 160) || g.plats.find(pl => pl.ground);
    p.x = clamp(g.camX + 60, ground.x + 20, ground.x + ground.w - 60);
    p.y = ground.y - 200; p.vx = 0; p.vy = 0;
    g.camX = Math.min(g.camX, p.x - 60);
  } else {
    p.vy = -8; p.vx = -p.face * 5;
  }
}

function gameOver(g) {
  state = 'over';
  g.overT = 0;
  if (g.score > best) {
    best = g.score;
    try { localStorage.setItem('neogun-best', best); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// World update
// ---------------------------------------------------------------------------
function circleRect(c, r) {
  const cx = clamp(c.x, r.x, r.x + r.w), cy = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - cx, dy = c.y - cy;
  return dx * dx + dy * dy < c.r * c.r;
}
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function killEnemy(g, e) {
  e.dead = true;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const big = e.type === 'heavy';
  g.score += e.score;
  floatText(g, cx, e.y, '+' + e.score, '#ffe66d');
  burst(g, cx, cy, big ? 70 : 25, big ? 9 : 5, ['#ff2fa0', '#ffe66d', '#0ff', '#fff', '#f80'], big ? 7 : 4);
  Sound.explode(big);
  g.shake = Math.max(g.shake, big ? 18 : 5);
  if (big) rumble(1, 0.6, 300);
  if (big || Math.random() < 0.048) spawnPickup(g, cx, e.y + e.h / 2, -7);
  else if (Math.random() < 0.07) spawnPickup(g, cx, e.y + e.h / 2, -7, 'health');
}

function update(g) {
  g.frame++;
  const p = g.player;
  // Zoom out only a little, so each upgrade still reads as a bigger gun on screen.
  g.zoom = lerp(g.zoom, Math.max(0.8, 1 - g.gunLevel * 0.015), 0.03);
  if (g.gunGrow > 0) g.gunGrow--;
  while (g.genX < g.camX + viewW(g) + 600) genChunk(g);

  updatePlayer(g);

  // Big guns push the hero towards the left edge to leave room for the barrel.
  const lead = Math.max(0.2, 0.35 - g.gunLevel * 0.012);
  const target = p.x - viewW(g) * lead;
  if (target > g.camX) g.camX = lerp(g.camX, target, 0.12);

  const right = g.camX + viewW(g), top = viewTop(g);
  const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
  const s = gunStats(g.gunLevel);
  const h = handPos(g);
  const mx = h.x + Math.cos(p.ang) * s.len, my = h.y + Math.sin(p.ang) * s.len;

  // Enemies
  const onScreen = e => e.x < right && e.x + e.w > g.camX && e.y + e.h > top;
  for (const e of g.enemies) {
    if (e.dead || e.x > right + 40) continue;
    e.t++;
    if (e.flash > 0) e.flash--;
    const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
    const dx = pcx - ecx;
    e.cool--;
    if (e.type === 'drone') {
      const tx = pcx + Math.sin(e.t * 0.017) * 220;
      e.x += clamp((tx - ecx) * 0.017, -e.speed, e.speed);
      e.y = e.baseY + Math.sin(e.t * 0.042) * 30;
      if (e.cool <= 0) {
        e.cool = randi(130, 230);
        const a = Math.atan2(pcy - ecy, dx);
        g.ebullets.push({ x: ecx, y: ecy + 6, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, r: 6, dmg: 12, life: 280 });
        Sound.enemyShot();
      }
    } else {
      e.face = dx < 0 ? -1 : 1;
      e.vx = Math.abs(dx) > 30 ? e.face * e.speed : 0;
      // Don't walk off into a pit; dropping from a platform onto something below is fine.
      if (e.onGround && e.vx && !floorBelow(g, e.face > 0 ? e.x + e.w + 4 : e.x - 4, e.y + e.h)) e.vx = 0;
      physics(e, g, false);
      if (e.cool <= 0 && Math.abs(dx) < 600) {
        const heavy = e.type === 'heavy';
        e.cool = heavy ? 95 : Math.max(85, randi(130, 240) - g.chunk * 3);
        const a = Math.atan2(pcy - (e.y + e.h * 0.3), dx);
        const spread = heavy ? [-0.2, 0, 0.2] : [0];
        for (const off of spread) {
          g.ebullets.push({ x: ecx + e.face * e.w / 2, y: e.y + e.h * 0.3, vx: Math.cos(a + off) * 3.8, vy: Math.sin(a + off) * 3.8,
            r: heavy ? 9 : 6, dmg: heavy ? 18 : 12, life: 280 });
        }
        Sound.enemyShot();
      }
      if (e.y > GROUND_Y + 400) e.dead = true;
    }
    if (overlap(e, p)) hurt(g, e.contact);

    // From the hand cannon onwards the barrel itself is a weapon.
    if (g.gunLevel >= 6 && onScreen(e)) {
      const sx = mx - h.x, sy = my - h.y;
      const t = clamp(((ecx - h.x) * sx + (ecy - h.y) * sy) / (sx * sx + sy * sy), 0, 1);
      const qx = h.x + sx * t, qy = h.y + sy * t;
      if (Math.hypot(ecx - qx, ecy - qy) < s.thick / 2 + Math.min(e.w, e.h) / 2) {
        e.hp -= s.dmg * 0.04;
        e.flash = 2;
        if (g.frame % 4 === 0) burst(g, ecx, ecy, 2, 3, ['#fff', s.color], 3);
      }
    }
    if (e.hp <= 0 && !e.dead) killEnemy(g, e);
  }

  // Player bullets
  for (const b of g.bullets) {
    b.px = b.x; b.py = b.y;
    b.x += b.vx; b.y += b.vy;
    b.life--;
    b.age++;
    // Trails
    if (b.shot === 'shell' && b.age % 2 === 0) {
      g.particles.push({ x: b.x - b.vx * 1.5, y: b.y - b.vy * 1.5, vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5),
        life: 20, max: 20, color: Math.random() < 0.5 ? '#f80' : '#fd0', size: b.r * 0.5 });
    } else if (b.shot === 'plasma' && b.age % 3 === 0) {
      burst(g, b.x, b.y, 1, 1.5, [b.color, '#fff'], b.r * 0.3);
    } else if (b.shot === 'planet' && b.age % 4 === 0) {
      burst(g, b.x, b.y, 1, 1, ['#fff', '#ffe66d'], 3);
    }
    for (const e of g.enemies) {
      if (e.dead || b.hit.has(e) || !onScreen(e) || !circleRect(b, e)) continue;
      e.hp -= b.dmg;
      e.flash = 4;
      b.hit.add(e);
      burst(g, b.x, b.y, 3, 3, [b.color, '#fff'], 2);
      if (e.hp <= 0) killEnemy(g, e);
      if (!b.pierce) { b.life = 0; break; }
    }
    if (b.r >= 8) {
      for (const eb of g.ebullets) if (Math.hypot(eb.x - b.x, eb.y - b.y) < b.r + eb.r) eb.life = 0;
    }
    // Bullets die as they leave the screen, so nothing off-camera can be hit.
    if (b.x + b.r < g.camX || b.x - b.r > right || b.y + b.r < top || b.y - b.r > GROUND_Y + 80) b.life = 0;
  }

  // Enemy bullets
  for (const b of g.ebullets) {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (circleRect(b, { x: p.x + 4, y: p.y + 4, w: p.w - 8, h: p.h - 6 })) { b.life = 0; hurt(g, b.dmg); }
    // A big enough barrel is also a shield.
    if (g.gunLevel >= 6) {
      const sx = mx - h.x, sy = my - h.y;
      const t = clamp(((b.x - h.x) * sx + (b.y - h.y) * sy) / (sx * sx + sy * sy), 0, 1);
      if (Math.hypot(b.x - (h.x + sx * t), b.y - (h.y + sy * t)) < s.thick / 2 + b.r) {
        b.life = 0;
        burst(g, b.x, b.y, 4, 3, ['#ff2fa0', '#fff'], 2);
      }
    }
  }

  // Pickups
  for (const u of g.pickups) {
    u.t++;
    physics(u, g, false);
    if (overlap(u, p) && state === 'play') {
      u.dead = true;
      const cx = u.x + u.w / 2, cy = u.y + u.h / 2;
      if (u.kind === 'health') {
        p.hp = Math.min(MAX_HP, p.hp + 35);
        floatText(g, cx, u.y, '+HEALTH', '#3f6');
        burst(g, cx, cy, 20, 4, ['#3f6', '#fff'], 3);
        Sound.heal();
        continue;
      }
      p.hp = Math.min(MAX_HP, p.hp + 15);
      if (g.gunLevel >= NUKE_LEVEL) {
        g.score += 500;
        floatText(g, cx, u.y, 'JUST FIRE IT', '#ff0');
        Sound.heal();
        continue;
      }
      g.gunFromLen = gunStats(g.gunLevel).len;
      g.gunGrow = GROW_FRAMES;
      g.gunLevel++;
      const ns = gunStats(g.gunLevel);
      if (g.gunLevel === NUKE_LEVEL) banner(g, '!! WARNING !!', ns.name, '#ff0');
      else banner(g, 'GUN UPGRADE!', ns.name, ns.color);
      g.score += 500;
      floatText(g, cx, u.y, 'BIGGER GUN', ns.color);
      burst(g, cx, cy, 40, 7, ['#0ff', '#f0f', '#ffe66d', '#fff'], 4);
      g.shake = Math.max(g.shake, 10);
      Sound.powerup();
      rumble(0.4, 1, 300);
    }
    if (u.y > GROUND_Y + 400 || u.x < g.camX - 300) u.dead = true;
  }

  g.enemies = g.enemies.filter(e => !e.dead && e.x + e.w > g.camX - 300);
  g.bullets = g.bullets.filter(b => b.life > 0);
  g.ebullets = g.ebullets.filter(b => b.life > 0 && b.x > g.camX - 200 && b.x < right + 200);
  g.pickups = g.pickups.filter(u => !u.dead);
  g.plats = g.plats.filter(pl => pl.x + pl.w > g.camX - 800);

  updateFx(g);
}

function updateFx(g) {
  for (const q of g.particles) { q.x += q.vx; q.y += q.vy; q.vy += 0.15; q.vx *= 0.97; q.life--; }
  g.particles = g.particles.filter(q => q.life > 0);
  if (g.particles.length > 900) g.particles.splice(0, g.particles.length - 900);
  for (const t of g.texts) { t.y -= 0.8; t.life--; }
  g.texts = g.texts.filter(t => t.life > 0);
  g.shake *= 0.86;
  if (g.banner && ++g.banner.t > 130) g.banner = null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const STARS = Array.from({ length: 90 }, () => ({ x: rand(0, W), y: rand(0, HORIZON - 40), s: rand(1, 2.5), p: rand(0, 6) }));
const skyGrad = ctx.createLinearGradient(0, 0, 0, HORIZON);
skyGrad.addColorStop(0, '#07011a');
skyGrad.addColorStop(0.55, '#26073f');
skyGrad.addColorStop(1, '#a3206f');
const sunGrad = ctx.createLinearGradient(0, 180, 0, HORIZON);
sunGrad.addColorStop(0, '#ffe66d');
sunGrad.addColorStop(0.5, '#ff8a5c');
sunGrad.addColorStop(1, '#ff2fa0');

function ridge(x, k) {
  return k === 0
    ? 70 + 40 * Math.sin(x * 0.004) + 25 * Math.sin(x * 0.011 + 1) + 12 * Math.sin(x * 0.027)
    : 35 + 22 * Math.sin(x * 0.007 + 3) + 14 * Math.sin(x * 0.019) + 6 * Math.sin(x * 0.05);
}

function drawBackground(cx, t) {
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, HORIZON);

  for (const s of STARS) {
    const x = ((s.x - cx * 0.02) % W + W) % W;
    ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.03 + s.p));
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, s.y, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  // Striped synthwave sun
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, HORIZON); ctx.clip();
  ctx.shadowColor = '#ff2fa0'; ctx.shadowBlur = 40;
  ctx.fillStyle = sunGrad;
  ctx.beginPath(); ctx.arc(W / 2, 300, 130, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = skyGrad;
  for (let i = 0; i < 8; i++) {
    const y = 240 + i * 13 + ((t * 0.25) % 13);
    ctx.fillRect(W / 2 - 140, y, 280, 1.5 + i * 0.9);
  }
  ctx.restore();

  // Two parallax mountain ranges
  [[0.08, '#1a0633', 'rgba(255,63,180,0.8)', 0], [0.2, '#10022a', 'rgba(0,255,255,0.6)', 1]].forEach(([par, fill, edge, k]) => {
    const off = cx * par;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, HORIZON - ridge(x + off, k));
    ctx.lineTo(W, HORIZON);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
  });

  // Perspective grid floor
  ctx.fillStyle = '#0d0120';
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  ctx.strokeStyle = 'rgba(255,47,160,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const N = 12, scroll = (t * 0.008) % 1;
  for (let i = 0; i < N; i++) {
    const y = HORIZON + (H - HORIZON) * Math.pow((i + scroll) / N, 2.2);
    ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  const frac = ((cx * 0.5) / 160) % 1;
  for (let i = -24; i <= 24; i++) {
    const k = i - frac;
    ctx.moveTo(W / 2 + k * 14, HORIZON);
    ctx.lineTo(W / 2 + k * 170, H);
  }
  ctx.stroke();
  ctx.strokeStyle = '#ff7bd0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, HORIZON); ctx.lineTo(W, HORIZON); ctx.stroke();
}

function drawPlatforms(g) {
  const right = g.camX + viewW(g);
  for (const p of g.plats) {
    if (p.x > right || p.x + p.w < g.camX) continue;
    if (p.ground) {
      ctx.fillStyle = '#14062a';
      ctx.fillRect(p.x, p.y, p.w, 500);
      ctx.strokeStyle = 'rgba(0,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = p.x + 20 - (p.x % 40); x < p.x + p.w; x += 40) { ctx.moveTo(x, p.y + 6); ctx.lineTo(x, p.y + 500); }
      for (let y = p.y + 30; y < p.y + 500; y += 30) { ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); }
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1d0b3a';
      ctx.fillRect(p.x, p.y, p.w, 14);
      ctx.fillStyle = '#ff2fa0';
      ctx.fillRect(p.x, p.y + 12, p.w, 2);
    }
    ctx.fillStyle = 'rgba(0,255,255,0.25)';
    ctx.fillRect(p.x, p.y - 2, p.w, 6);
    ctx.fillStyle = '#0ff';
    ctx.fillRect(p.x, p.y, p.w, 2);
  }
}

function drawPlayer(g) {
  const p = g.player;
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y);
  // Sprite is drawn on a 40px-tall grid and scaled up to the hitbox.
  const S = p.h / 40;
  ctx.scale(p.face * S, S);
  const run = p.onGround && Math.abs(p.vx) > 0.6;
  const ph = run ? Math.sin(g.frame * 0.4) : 0;
  ctx.fillStyle = '#2b2b7a';
  if (p.onGround) {
    ctx.fillRect(-7 + ph * 3, 28, 6, 12);
    ctx.fillRect(1 - ph * 3, 28, 6, 12);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-8 + ph * 3, 38, 8, 2);
    ctx.fillRect(0 - ph * 3, 38, 8, 2);
  } else {
    ctx.fillRect(-7, 27, 6, 9);
    ctx.fillRect(1, 25, 6, 9);
  }
  ctx.fillStyle = '#19e3d0'; ctx.fillRect(-9, 17, 18, 12);   // jacket
  ctx.fillStyle = '#ff2fa0'; ctx.fillRect(-9, 22, 18, 3);
  ctx.fillStyle = '#f5c09a'; ctx.fillRect(-7, 2, 16, 15);    // big head
  ctx.fillStyle = '#2a1810';
  ctx.fillRect(-8, -1, 17, 4);                               // hair
  ctx.fillRect(-11, 1, 5, 17);                               // mullet
  ctx.fillRect(-6, 6, 2, 8);                                 // sideburn
  ctx.fillRect(-5, 11, 15, 7);                               // beard
  ctx.fillRect(-4, 17, 12, 2);
  ctx.fillStyle = '#3f2619';                                 // beard texture
  ctx.fillRect(-2, 14, 1, 1); ctx.fillRect(1, 16, 1, 1); ctx.fillRect(5, 15, 1, 1); ctx.fillRect(-4, 16, 1, 1);
  ctx.fillStyle = '#1a0e08'; ctx.fillRect(2, 11, 8, 2);      // moustache
  ctx.fillStyle = '#b5524a'; ctx.fillRect(4, 13, 4, 1);      // mouth
  ctx.fillStyle = '#ff2fa0'; ctx.fillRect(-8, 2, 17, 2);     // headband
  ctx.fillRect(-11, 3, 3, 2);                                // headband tail
  ctx.fillStyle = '#000';                                    // aviator shades
  ctx.fillRect(-2, 6, 12, 1);
  ctx.fillRect(-1, 7, 5, 3); ctx.fillRect(5, 7, 5, 3);
  ctx.fillStyle = '#0ff'; ctx.fillRect(1, 7, 2, 1); ctx.fillRect(7, 7, 2, 1);
  ctx.fillStyle = '#f0f'; ctx.fillRect(0, 9, 1, 1); ctx.fillRect(6, 9, 1, 1);
  ctx.restore();
}

// The gun arm: jacket sleeve from shoulder to grip, getting beefier with bigger guns.
function drawArm(g) {
  const p = g.player, sh = shoulderPos(p), h = handPos(g);
  const width = 9 + gunStats(g.gunLevel).thick * 0.08;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#0e8f84';
  ctx.lineWidth = width + 3;
  ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(h.x, h.y); ctx.stroke();
  ctx.strokeStyle = '#19e3d0';
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(h.x, h.y); ctx.stroke();
  ctx.lineCap = 'butt';
}

// Gun palette
const G_DARK = '#1a0d33', G_MID = '#2a1650', G_LIGHT = '#3a2270', G_WOOD = '#6b3416', G_STEEL = '#55557a';
// Body and trim colours for the Planet Splitter (0) and Gun of God Mk.1-5.
const GOD_BODY = [G_MID, G_MID, '#1d2a50', '#3a3a5a', '#4a1a4a', '#8a6a10'];
const GOD_TRIM = [G_LIGHT, '#b08a20', G_LIGHT, '#b08a20', G_LIGHT, '#ffd700'];

function gunBox(x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
}

function gunCircle(x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

function glow(x, y, r, color, alpha) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function hazard(x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#ffe600'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#111';
  for (let i = x - h; i < x + w + h; i += h * 0.5) {
    ctx.beginPath();
    ctx.moveTo(i, y); ctx.lineTo(i + h * 0.25, y); ctx.lineTo(i + h * 1.25, y + h); ctx.lineTo(i + h, y + h);
    ctx.fill();
  }
  ctx.restore();
}

function grip(T, fill = G_DARK) {
  ctx.save();
  ctx.translate(0, T * 0.3);
  ctx.rotate(0.25);
  gunBox(-T * 0.15, 0, T * 0.4, T * 0.9, fill);
  ctx.restore();
}

// Each gun tier has its own silhouette. Drawn pointing along +x, grip at the origin.
const GUN_DRAW = [
  // Pea shooter: tiny toy pistol
  (L, T, s) => {
    grip(T);
    gunBox(-T * 0.3, -T / 2, L * 0.55, T, G_MID);
    gunBox(L * 0.5, -T * 0.25, L * 0.5, T * 0.5, G_LIGHT);
  },
  // Laser pistol: sleek body, fin, emitter rings
  (L, T, s, t) => {
    grip(T);
    gunBox(-T * 0.4, -T / 2, L * 0.7, T, G_MID);
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.moveTo(0, -T / 2); ctx.lineTo(L * 0.25, -T); ctx.lineTo(L * 0.45, -T / 2); ctx.fill();
    gunBox(L * 0.6, -T * 0.3, L * 0.4, T * 0.6, G_LIGHT);
    for (let i = 0; i < 3; i++) gunBox(L * 0.66 + i * L * 0.11, -T * 0.4, L * 0.04, T * 0.8, s.color);
  },
  // SMG: boxy, long magazine, wire stock
  (L, T, s) => {
    grip(T);
    gunBox(L * 0.28, T * 0.4, T * 0.45, T * 1.5, G_DARK);
    gunBox(-T * 0.3, -T / 2, L * 0.65, T, G_MID);
    gunBox(L * 0.6, -T * 0.2, L * 0.4, T * 0.4, G_STEEL);
    ctx.strokeRect(-T * 1.6, -T * 0.3, T * 1.3, T * 0.6);
    ctx.fillStyle = s.color; ctx.fillRect(0, -T * 0.1, L * 0.5, T * 0.2);
  },
  // Scatterblaster: double barrel pump shotgun with a wooden stock
  (L, T, s) => {
    grip(T, G_WOOD);
    ctx.beginPath();
    ctx.moveTo(-T * 0.3, -T * 0.4); ctx.lineTo(-T * 2, -T * 0.1); ctx.lineTo(-T * 2, T * 0.6); ctx.lineTo(-T * 0.3, T * 0.4);
    ctx.closePath(); ctx.fillStyle = G_WOOD; ctx.fill(); ctx.stroke();
    gunBox(-T * 0.3, -T / 2, L * 0.3, T, G_MID);
    gunBox(L * 0.25, -T / 2, L * 0.75, T * 0.45, G_STEEL);
    gunBox(L * 0.25, T * 0.05, L * 0.75, T * 0.45, G_STEEL);
    gunBox(L * 0.42, T * 0.45, L * 0.28, T * 0.4, G_WOOD);
  },
  // Turbo rifle: long thin barrel, curved mag, scope, long stock
  (L, T, s) => {
    grip(T);
    gunBox(-T * 2.2, -T * 0.4, T * 1.9, T * 0.8, G_DARK);
    gunBox(-T * 0.3, -T / 2, L * 0.45, T, G_MID);
    ctx.beginPath();
    ctx.moveTo(L * 0.2, T / 2); ctx.quadraticCurveTo(L * 0.22, T * 1.6, L * 0.35, T * 1.8);
    ctx.lineTo(L * 0.4, T * 1.5); ctx.quadraticCurveTo(L * 0.3, T * 1.2, L * 0.32, T / 2);
    ctx.closePath(); ctx.fillStyle = G_DARK; ctx.fill(); ctx.stroke();
    gunBox(L * 0.4, -T * 0.15, L * 0.6, T * 0.3, G_STEEL);
    gunBox(L * 0.03, -T * 1.15, L * 0.3, T * 0.45, G_DARK);
    glow(L * 0.33, -T * 0.92, T * 0.25, s.color, 0.8);
    ctx.fillStyle = s.color; ctx.fillRect(0, -T * 0.08, L * 0.4, T * 0.16);
  },
  // Minigun: drum mag, motor housing, spinning barrel cluster
  (L, T, s, t) => {
    grip(T);
    gunCircle(-T * 0.2, T * 0.9, T * 0.6, G_DARK);
    gunBox(-T * 0.6, -T / 2, L * 0.3, T, G_MID);
    for (let i = 0; i < 3; i++) {
      const y = Math.sin(t * 0.6 + i * 2.09) * T * 0.34;
      gunBox(L * 0.25, y - T * 0.13, L * 0.75, T * 0.26, i === 0 ? G_STEEL : G_LIGHT);
    }
    gunBox(L * 0.45, -T * 0.45, L * 0.05, T * 0.9, s.color);
    gunBox(L * 0.92, -T * 0.45, L * 0.05, T * 0.9, s.color);
  },
  // Hand cannon: giant revolver
  (L, T, s) => {
    grip(T * 1.3, G_WOOD);
    gunBox(-T * 0.4, -T / 2, L * 0.2, T, G_MID);
    gunBox(L * 0.12, -T * 0.65, L * 0.28, T * 1.3, G_STEEL);
    for (let i = -1; i <= 1; i++) gunCircle(L * 0.26, i * T * 0.38, T * 0.13, G_DARK);
    gunBox(L * 0.4, -T * 0.32, L * 0.6, T * 0.64, G_MID);
    gunBox(L * 0.4, -T * 0.5, L * 0.6, T * 0.15, G_STEEL);
    gunBox(L - T * 0.2, -T * 0.7, T * 0.15, T * 0.2, s.color);
  },
  // Plasma hose: glowing tank and coiled nozzle
  (L, T, s, t) => {
    grip(T * 0.8);
    ctx.fillStyle = G_DARK;
    ctx.beginPath(); ctx.ellipse(L * 0.12, 0, L * 0.16, T * 0.75, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    glow(L * 0.12, 0, T * (0.45 + 0.08 * Math.sin(t * 0.3)), s.color, 0.7);
    gunBox(L * 0.27, -T * 0.2, L * 0.6, T * 0.4, G_MID);
    for (let x = L * 0.3; x < L * 0.85; x += T * 0.45) gunBox(x, -T * 0.32, T * 0.15, T * 0.64, s.color);
    ctx.beginPath();
    ctx.moveTo(L * 0.87, -T * 0.2); ctx.lineTo(L, -T * 0.5); ctx.lineTo(L, T * 0.5); ctx.lineTo(L * 0.87, T * 0.2);
    ctx.closePath(); ctx.fillStyle = G_LIGHT; ctx.fill(); ctx.stroke();
  },
  // Railgun: twin rails with crackling energy between
  (L, T, s, t) => {
    grip(T * 0.7);
    gunBox(-T * 1.1, -T * 0.6, T * 1.2, T * 1.2, G_DARK);
    for (let i = 0; i < 3; i++) gunBox(-T * 0.95 + i * T * 0.35, -T * 0.4, T * 0.2, T * 0.8, s.color);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4 + 0.3 * Math.random();
    ctx.fillStyle = s.color;
    ctx.fillRect(0, -T * 0.22, L, T * 0.44);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    gunBox(0, -T * 0.5, L, T * 0.25, G_STEEL);
    gunBox(0, T * 0.25, L, T * 0.25, G_STEEL);
    for (let x = T; x < L; x += T * 1.5) gunBox(x, -T * 0.6, T * 0.2, T * 1.2, G_DARK);
  },
  // Tank barrel: armoured mantlet, bore evacuator, muzzle brake
  (L, T, s) => {
    grip(T * 0.5);
    gunBox(-T * 0.9, -T * 0.8, T * 1.7, T * 1.6, G_MID);
    hazard(-T * 0.9, T * 0.5, T * 1.7, T * 0.3);
    gunBox(T * 0.8, -T * 0.3, L - T * 0.8, T * 0.6, G_STEEL);
    gunBox(L * 0.55, -T * 0.42, L * 0.12, T * 0.84, G_MID);
    gunBox(L - T * 0.6, -T * 0.45, T * 0.6, T * 0.9, G_DARK);
    for (let i = 0; i < 3; i++) gunBox(L - T * 0.5 + i * T * 0.17, -T * 0.45, T * 0.06, T * 0.9, '#000');
    ctx.fillStyle = s.color; ctx.font = (T * 0.3) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('XL', 0, -T * 0.2);
  },
  // Battleship gun: whole turret with three staggered barrels
  (L, T, s, t) => {
    grip(T * 0.4);
    for (const [y, len] of [[-0.55, 0.9], [0, 1], [0.55, 0.85]]) {
      gunBox(T * 0.8, T * y - T * 0.14, L * len - T * 0.8, T * 0.28, G_STEEL);
      gunBox(L * len - T * 0.3, T * y - T * 0.18, T * 0.3, T * 0.36, G_DARK);
    }
    ctx.beginPath();
    ctx.moveTo(-T * 1.4, -T * 0.6); ctx.lineTo(T * 0.4, -T * 0.9); ctx.lineTo(T * 1.1, -T * 0.4);
    ctx.lineTo(T * 1.1, T * 0.8); ctx.lineTo(-T * 1.4, T * 0.8); ctx.closePath();
    ctx.fillStyle = G_MID; ctx.fill(); ctx.stroke();
    hazard(-T * 1.4, T * 0.55, T * 2.5, T * 0.25);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = (Math.floor(t / 8) + i) % 2 ? '#f44' : '#400';
      ctx.fillRect(-T * 1.1 + i * T * 0.5, -T * 0.4, T * 0.15, T * 0.15);
    }
  },
  // Orbital cannon: lattice truss, satellite dish, ring emitters
  (L, T, s, t) => {
    grip(T * 0.35);
    ctx.fillStyle = G_DARK;
    ctx.beginPath(); ctx.ellipse(-T * 0.4, 0, T * 0.35, T * 1.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    gunCircle(-T * 0.2, 0, T * 0.15, s.color);
    gunBox(0, -T * 0.45, L * 0.82, T * 0.1, G_STEEL);
    gunBox(0, T * 0.35, L * 0.82, T * 0.1, G_STEEL);
    ctx.beginPath();
    for (let x = 0, up = true; x < L * 0.82; x += T * 0.5, up = !up) {
      ctx.moveTo(x, up ? -T * 0.35 : T * 0.35);
      ctx.lineTo(x + T * 0.5, up ? T * 0.35 : -T * 0.35);
    }
    ctx.stroke();
    glow(L * 0.4, 0, T * 0.12, s.color, 0.9);
    ctx.fillStyle = G_DARK;
    for (let i = 0; i < 3; i++) {
      const x = L * 0.82 + i * L * 0.06, r = T * (0.6 - i * 0.12);
      ctx.beginPath(); ctx.ellipse(x, 0, T * 0.12, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    glow(L, 0, T * (0.35 + 0.1 * Math.sin(t * 0.25)), '#fff', 0.8);
  },
  // Planet splitter: the base the Gun of God tiers build on
  (L, T, s, t) => drawGodGun(L, T, s, t, 0),
];

// Guns are drawn as vector shapes into a low-res buffer, then snapped to a palette,
// given a 1px outline and top/bottom shading, and scaled back up without smoothing.
const GUN_PX = 2; // world units per art pixel, matching the hero sprite
const gunCanvas = document.createElement('canvas');
const gunCtx = gunCanvas.getContext('2d', { willReadFrequently: true });
const OUTLINE = [7, 2, 15];

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const GUN_PALETTE = [...new Set([
  G_DARK, G_MID, G_LIGHT, G_WOOD, G_STEEL, '#e6c200', '#ffe600', '#111111', '#ffffff', '#c33', '#f00', '#400',
  '#555', '#3a4a1a', '#9ff', '#ff0', '#f44', '#f0f', '#0ff', '#d9a441',
  ...GOD_BODY, ...GOD_TRIM, '#ffd700', '#7ff', '#f6f', '#ff4',
  ...GUN_TABLE.map(s => s.color),
])].map(hexToRgb);
const paletteCache = new Map();
function nearestColour(r, g, b) {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  let c = paletteCache.get(key);
  if (c) return c;
  let best = Infinity;
  for (const p of GUN_PALETTE) {
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < best) { best = d; c = p; }
  }
  paletteCache.set(key, c);
  return c;
}

function pixelateGun(w, h) {
  const img = gunCtx.getImageData(0, 0, w, h), d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      if (solid[i]) {
        const c = nearestColour(d[o], d[o + 1], d[o + 2]);
        const f = y > 0 && !solid[i - w] ? 1.35 : y < h - 1 && !solid[i + w] ? 0.6 : 1;
        d[o] = Math.min(255, c[0] * f); d[o + 1] = Math.min(255, c[1] * f); d[o + 2] = Math.min(255, c[2] * f);
        d[o + 3] = 255;
      } else if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) {
        d[o] = OUTLINE[0]; d[o + 1] = OUTLINE[1]; d[o + 2] = OUTLINE[2]; d[o + 3] = 255;
      } else {
        d[o + 3] = 0;
      }
    }
  }
  gunCtx.putImageData(img, 0, 0);
}

// Draws the gun pointing along +x with its grip at the origin. `flip` mirrors it vertically
// before pixelation so the shading still lights it from above.
function drawGunShape(s, level, muzzle, t, flip = false) {
  const L = s.len, T = s.thick;
  const x0 = -2.5 * T - 4, x1 = L + 0.3 * T + 4, yTop = -1.4 * T - 4, yBot = 2.1 * T + 4;
  const w = Math.ceil((x1 - x0) / GUN_PX) + 2, h = Math.ceil((yBot - yTop) / GUN_PX) + 2;
  if (gunCanvas.width < w || gunCanvas.height < h) {
    gunCanvas.width = Math.max(gunCanvas.width, w);
    gunCanvas.height = Math.max(gunCanvas.height, h);
  }
  gunCtx.setTransform(1, 0, 0, 1, 0, 0);
  gunCtx.clearRect(0, 0, w, h);
  gunCtx.setTransform(1 / GUN_PX, 0, 0, (flip ? -1 : 1) / GUN_PX, -x0 / GUN_PX + 1, (flip ? yBot : -yTop) / GUN_PX + 1);
  const main = ctx;
  ctx = gunCtx;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = Math.max(GUN_PX, T * 0.06);
  ctx.strokeStyle = s.color;
  ctx.lineJoin = 'miter';
  if (level >= NUKE_LEVEL) drawNukeGun(L, T, s, t);
  else if (level >= GUN_TABLE.length) drawGodGun(L, T, s, t, level - (GUN_TABLE.length - 1));
  else GUN_DRAW[level](L, T, s, t);
  ctx = main;
  pixelateGun(w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(gunCanvas, 0, 0, w, h, x0 - GUN_PX, (flip ? -yBot : yTop) - GUN_PX, w * GUN_PX, h * GUN_PX);
  ctx.imageSmoothingEnabled = true;
  // muzzle glow / flash
  glow(L, 0, T * 0.25, s.color, 0.35 + 0.15 * Math.sin(t * 0.2));
  if (muzzle > 0) {
    glow(L + T * 0.3, 0, T * 0.5 + 4, '#fff', 0.9);
    glow(L + T * 0.6, 0, T * 0.8 + 8, s.color, 0.5);
  }
}

function trefoil(cx, cy, r) {
  ctx.fillStyle = '#ffe600';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 - Math.PI / 6 + i * (Math.PI * 2 / 3);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r * 0.85, a, a + Math.PI / 3); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#ffe600';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2); ctx.fill();
}

// Planet Splitter (mk 0) and the Gun of God tiers (mk 1-5). Each tier keeps the
// previous tier's parts and adds one more.

function drawGodGun(L, T, s, t, mk) {
  const body = GOD_BODY[mk], trim = GOD_TRIM[mk];
  grip(T * 0.3);
  // Mk.3: swept wings at the back
  if (mk >= 3) {
    ctx.fillStyle = G_LIGHT;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-T * 1.1, dir * T * 0.5); ctx.lineTo(-T * 1.9, dir * T * 1.3);
      ctx.lineTo(-T * 0.9, dir * T * 1.3); ctx.lineTo(L * 0.15, dir * T * 0.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  // side barrels; Mk.4 makes them longer with capped muzzles
  const sideLen = mk >= 4 ? L * 0.88 : L * 0.7;
  for (const y of [-0.75, 0.75]) {
    gunBox(T * 0.5, T * y - T * 0.12, sideLen, T * 0.24, G_STEEL);
    if (mk >= 4) gunBox(T * 0.5 + sideLen - T * 0.2, T * y - T * 0.18, T * 0.2, T * 0.36, s.color);
  }
  // flat trapezoid housing on top
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-T * 1.0, -T * 0.5); ctx.lineTo(-T * 0.6, -T * 0.95);
  ctx.lineTo(L * 0.48, -T * 0.95); ctx.lineTo(L * 0.6, -T * 0.5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  gunBox(-T * 0.3, -T * 0.82, L * 0.6, T * 0.12, trim);
  // Mk.5: battlements along the top, like a crown
  if (mk >= 5) for (let i = 0; i < 4; i++) gunBox(-T * 0.4 + i * L * 0.16, -T * 1.2, T * 0.3, T * 0.27, '#ffd700');
  // main body
  gunBox(-T * 1.2, -T * 0.5, L * 0.65 + T * 1.2, T, body);
  if (mk < 3) hazard(L * 0.05, -T * 0.5, L * 0.12, T);
  else gunBox(L * 0.05, -T * 0.5, L * 0.12, T, trim);
  // front barrel and cooling fins
  gunBox(L * 0.6, -T * 0.35, L * 0.4, T * 0.7, G_LIGHT);
  for (let i = 0; i < 4; i++) gunBox(L * 0.65 + i * L * 0.085, -T * 0.5, T * 0.15, T, s.color);
  // Mk.2: pulsing halo rings round the barrel
  if (mk >= 2) {
    ctx.save();
    ctx.lineWidth = Math.max(GUN_PX, T * 0.08);
    ctx.strokeStyle = '#ffd700';
    for (let i = 0; i < 2; i++) {
      const ry = T * (0.75 + 0.08 * Math.sin(t * 0.15 + i * 2));
      ctx.beginPath(); ctx.ellipse(L * (0.74 + i * 0.16), 0, T * 0.14, ry, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = (Math.floor(t / 5) + i) % 3 === 0 ? '#fff' : (i % 2 ? '#f0f' : '#0ff');
    ctx.fillRect(L * 0.2 + i * L * 0.05, -T * 0.06, T * 0.12, T * 0.12);
  }
  // power core; Mk.1 and up it's an all-seeing eye
  gunCircle(-T * 0.6, 0, T * 0.3, G_DARK);
  if (mk >= 1) {
    gunCircle(-T * 0.6, 0, T * 0.22, '#fff');
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(-T * 0.6 + Math.sin(t * 0.05) * T * 0.08, 0, T * 0.1, 0, Math.PI * 2); ctx.fill();
  } else {
    glow(-T * 0.6, 0, T * 0.25, s.color, 0.7 + 0.3 * Math.sin(t * 0.2));
  }
}

// Launcher tube with a warhead strapped to the front.
function drawNukeGun(L, T, s, t) {
  grip(T * 0.4);
  gunBox(-T * 0.6, -T * 0.35, L * 0.45 + T * 0.6, T * 0.7, '#3a4a1a');
  hazard(-T * 0.6, -T * 0.35, T * 0.5, T * 0.7);
  // fins
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(L * 0.45, -T * 0.5); ctx.lineTo(L * 0.38, -T * 0.85); ctx.lineTo(L * 0.52, -T * 0.5);
  ctx.moveTo(L * 0.45, T * 0.5); ctx.lineTo(L * 0.38, T * 0.85); ctx.lineTo(L * 0.52, T * 0.5);
  ctx.fill(); ctx.stroke();
  gunBox(L * 0.45, -T * 0.5, L * 0.4, T, '#e6c200');
  ctx.beginPath();
  ctx.moveTo(L * 0.85, -T * 0.5); ctx.quadraticCurveTo(L * 1.02, -T * 0.3, L, 0);
  ctx.quadraticCurveTo(L * 1.02, T * 0.3, L * 0.85, T * 0.5); ctx.closePath();
  ctx.fillStyle = '#c33'; ctx.fill(); ctx.stroke();
  trefoil(L * 0.65, 0, T * 0.38);
  ctx.fillStyle = (t >> 3) % 2 ? '#f00' : '#400';
  ctx.beginPath(); ctx.arc(L * 0.5, -T * 0.35, T * 0.08, 0, Math.PI * 2); ctx.fill();
}

function easeOutElastic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
}

function gunGrowScale(g) {
  return lerp(g.gunFromLen / gunStats(g.gunLevel).len, 1, easeOutElastic(1 - g.gunGrow / GROW_FRAMES));
}

function drawGun(g) {
  const p = g.player, s = gunStats(g.gunLevel), h = handPos(g);
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(p.ang);
  const c = Math.cos(p.ang);
  const flip = c < -0.01 || (Math.abs(c) <= 0.01 && p.face < 0);
  // Freshly upgraded guns spring out from their old size.
  if (g.gunGrow > 0) {
    const k = gunGrowScale(g);
    ctx.scale(k, k);
  }
  drawGunShape(s, g.gunLevel, p.muzzle, g.frame, flip);
  ctx.restore();
  if (g.gunGrow > GROW_FRAMES - 8) {
    ctx.save();
    glow(h.x, h.y, 60, '#fff', (g.gunGrow - (GROW_FRAMES - 8)) / 8);
    ctx.restore();
  }
}

function drawEnemy(e, t) {
  const flash = e.flash > 0;
  const w = e.w / ENEMY_SCALE, h = e.h / ENEMY_SCALE;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(ENEMY_SCALE, ENEMY_SCALE);
  if (e.type === 'grunt') {
    const ph = Math.sin(t * 0.3) * 2;
    ctx.fillStyle = flash ? '#fff' : '#3a0a24';
    ctx.fillRect(4 + ph, 26, 6, 8); ctx.fillRect(16 - ph, 26, 6, 8);
    ctx.fillStyle = flash ? '#fff' : '#ff2a6d';
    ctx.fillRect(2, 4, 22, 23);
    ctx.fillStyle = flash ? '#fff' : '#7a0f3a';
    ctx.fillRect(2, 18, 22, 3);
    ctx.fillStyle = '#ffe66d';
    ctx.fillRect(e.face > 0 ? 14 : 4, 9, 8, 4);
    ctx.fillStyle = '#ff2a6d';
    ctx.fillRect(11, 0, 4, 4);
    ctx.fillStyle = flash ? '#fff' : '#555';
    ctx.fillRect(e.face > 0 ? 20 : -6, 13, 12, 3);
  } else if (e.type === 'drone') {
    ctx.fillStyle = flash ? '#fff' : '#5b2bd1';
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2 + 2, w / 2, h / 2 - 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : '#9d7bff';
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2 - 2, w / 4, h / 3, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = (Math.floor(t / 8) % 2) ? '#0ff' : '#f0f';
    for (let i = 0; i < 3; i++) ctx.fillRect(5 + i * 10, h / 2 + 3, 3, 3);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
    const pw = Math.abs(Math.sin(t * 0.8)) * 14;
    ctx.beginPath(); ctx.moveTo(w / 2 - pw, -2); ctx.lineTo(w / 2 + pw, -2); ctx.stroke();
  } else {
    const ph = Math.sin(t * 0.15) * 3;
    ctx.fillStyle = flash ? '#fff' : '#2b0a3a';
    ctx.fillRect(6 + ph, 46, 16, 18); ctx.fillRect(38 - ph, 46, 16, 18);
    ctx.fillStyle = flash ? '#fff' : '#7a1fa2';
    ctx.fillRect(0, 6, 60, 42);
    ctx.fillStyle = flash ? '#fff' : '#4a0f6a';
    ctx.fillRect(e.face > 0 ? 44 : -12, 18, 28, 10);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff2fa0';
    ctx.beginPath(); ctx.arc(30, 26, 8 + Math.sin(t * 0.2) * 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffe66d';
    ctx.fillRect(e.face > 0 ? 36 : 12, 10, 12, 5);
    ctx.fillStyle = '#300';
    ctx.fillRect(0, -10, 60, 5);
    ctx.fillStyle = '#ff2a6d';
    ctx.fillRect(0, -10, 60 * clamp(e.hp / e.maxHp, 0, 1), 5);
  }
  ctx.restore();
}

function drawPickup(u, t) {
  const bob = Math.sin(t * 0.1) * 4;
  const cx = u.x + u.w / 2, cy = u.y + u.h / 2 + bob;
  const health = u.kind === 'health';
  const c1 = health ? '#3f6' : '#0ff', c2 = health ? '#fff' : '#f0f';
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = health ? 'rgba(50,255,100,0.12)' : 'rgba(0,255,255,0.12)';
  ctx.fillRect(cx - 13, cy - 150, 26, 150);
  ctx.fillStyle = health ? 'rgba(50,255,100,0.3)' : 'rgba(255,0,255,0.35)';
  ctx.beginPath(); ctx.arc(cx, cy, 24 + Math.sin(t * 0.2) * 4, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const sx = Math.cos(t * 0.08);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(Math.max(0.15, Math.abs(sx)), 1);
  ctx.fillStyle = sx > 0 ? c1 : c2;
  ctx.fillRect(-16, -16, 32, 32);
  ctx.fillStyle = '#12002a';
  ctx.fillRect(-12, -12, 24, 24);
  if (health) {
    ctx.fillStyle = '#3f6';
    ctx.fillRect(-3, -8, 6, 16);
    ctx.fillRect(-8, -3, 16, 6);
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = '10px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('G+', 1, 1);
  }
  ctx.restore();
}

function streak(b, len, width, color, alpha) {
  const sp = Math.hypot(b.vx, b.vy) || 1;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(b.x - (b.vx / sp) * len, b.y - (b.vy / sp) * len);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function orb(x, y, r, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// Called with 'lighter' compositing on, from drawWorld.
function drawBullet(b) {
  const r = b.r, a = Math.atan2(b.vy, b.vx);
  ctx.lineCap = 'round';
  switch (b.shot) {
    case 'pellet':
      orb(b.x, b.y, r * 2, b.color, 0.3);
      orb(b.x, b.y, r, '#fff', 1);
      break;
    case 'laser':
      streak(b, r * 7, r * 1.4, b.color, 0.6);
      streak(b, r * 6, r * 0.5, '#fff', 1);
      break;
    case 'tracer':
      streak(b, r * 5, r * 0.9, b.color, 0.7);
      orb(b.x, b.y, r * 0.7, '#fff', 1);
      break;
    case 'buckshot':
      orb(b.x, b.y, r * 1.6, b.color, 0.25);
      for (let i = 0; i < 3; i++) {
        const o = b.spin + i * 2.1;
        orb(b.x + Math.cos(o) * r * 0.5, b.y + Math.sin(o) * r * 0.5, r * 0.45, '#fff', 1);
      }
      break;
    case 'shell': {
      orb(b.x - Math.cos(a) * r * 1.6, b.y - Math.sin(a) * r * 1.6, r * 1.1, '#f80', 0.5);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.translate(b.x, b.y);
      ctx.rotate(a);
      ctx.fillStyle = '#d9a441';
      ctx.fillRect(-r * 1.4, -r * 0.55, r * 1.6, r * 1.1);
      ctx.fillStyle = '#b8562e';
      ctx.fillRect(-r * 0.3, -r * 0.6, r * 0.25, r * 1.2);
      ctx.fillStyle = '#eee';
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.55); ctx.quadraticCurveTo(r * 1.3, 0, r * 0.2, r * 0.55);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'plasma': {
      const wob = 1 + 0.25 * Math.sin(b.age * 0.6 + b.spin);
      orb(b.x, b.y, r * 2 * wob, b.color, 0.25);
      orb(b.x, b.y, r * 1.1 / wob, b.color, 0.6);
      for (let i = 0; i < 3; i++) {
        const o = b.age * 0.3 + i * 2.1;
        orb(b.x + Math.cos(o) * r * 0.6, b.y + Math.sin(o * 1.3) * r * 0.6, r * 0.35, '#fff', 0.9);
      }
      break;
    }
    case 'beam':
      streak(b, Math.min(b.age, 8) * 30, r * 2.2, b.color, 0.35);
      streak(b, Math.min(b.age, 8) * 30, r * 0.7, '#fff', 0.9);
      orb(b.x, b.y, r * 1.4, '#fff', 0.8);
      break;
    case 'orb': {
      orb(b.x, b.y, r * 1.6, b.color, 0.2);
      orb(b.x, b.y, r * 0.9, '#9ff', 0.5);
      orb(b.x, b.y, r * 0.5, '#fff', 1);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#0ff';
      ctx.lineWidth = Math.max(2, r * 0.08);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, r * 1.2, r * 0.35, b.age * 0.08 + i * Math.PI / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'planet': {
      // Each shot is a tiny ringed planet in a random colour.
      orb(b.x, b.y, r * 1.5, 'hsl(' + b.hue + ',100%,60%)', 0.25);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.spin + b.age * 0.03);
      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, 'hsl(' + b.hue + ',90%,70%)');
      grad.addColorStop(1, 'hsl(' + ((b.hue + 60) % 360) + ',80%,35%)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(-r * 0.75, -r * 0.15, r * 1.5, r * 0.2);
      ctx.strokeStyle = '#ffe66d';
      ctx.lineWidth = Math.max(2, r * 0.12);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.3, r * 0.3, -0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      break;
    }
  }
  ctx.globalAlpha = 1;
}

function drawWorld(g) {
  const z = g.zoom;
  const sx = (Math.random() - 0.5) * g.shake, sy = (Math.random() - 0.5) * g.shake;
  ctx.save();
  ctx.setTransform(z, 0, 0, z, -g.camX * z + sx, -viewTop(g) * z + sy);

  drawPlatforms(g);
  for (const u of g.pickups) drawPickup(u, g.frame + u.x);
  for (const e of g.enemies) drawEnemy(e, e.t);

  if (state !== 'over') {
    const p = g.player;
    // The arm stretches to hold the gun out in front so the hero stays readable.
    if (!(p.inv > 0 && (g.frame >> 2) % 2)) {
      drawPlayer(g);
      drawArm(g);
      drawGun(g);
      const h = handPos(g);
      ctx.fillStyle = '#f5c09a';
      ctx.fillRect(h.x - 6, h.y - 5, 12, 10);
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  for (const b of g.bullets) drawBullet(b);
  for (const b of g.ebullets) {
    ctx.fillStyle = 'rgba(255,90,40,0.5)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.7, 0, Math.PI * 2); ctx.fill();
  }
  for (const q of g.particles) {
    ctx.globalAlpha = q.life / q.max;
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.font = '10px ' + FONT;
  ctx.textAlign = 'center';
  for (const t of g.texts) {
    ctx.globalAlpha = Math.min(1, t.life / 20);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function neonText(text, x, y, size, color, align = 'center') {
  ctx.font = size + 'px ' + FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#12002a';
  ctx.fillText(text, x + Math.max(2, size / 8), y + Math.max(2, size / 8));
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHeart(x, y, s) {
  ctx.fillStyle = '#ff2fa0';
  const px = [[1, 0], [2, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3],
    [2, 4], [3, 4], [4, 4], [3, 5]];
  for (const [i, j] of px) ctx.fillRect(x + i * s, y + j * s, s, s);
}

function drawHUD(g) {
  neonText('SCORE ' + String(g.score).padStart(7, '0'), 20, 24, 14, '#fff', 'left');
  neonText('BEST  ' + String(Math.max(best, g.score)).padStart(7, '0'), 20, 46, 10, '#ff7bd0', 'left');
  for (let i = 0; i < g.lives; i++) drawHeart(20 + i * 26, 62, 3);

  // Health bar: 10 segments, colour shifts as it drains, flashes on a hit.
  const p = g.player, frac = clamp(p.hp / MAX_HP, 0, 1);
  const barCol = p.hitFlash > 0 && (p.hitFlash >> 2) % 2 ? '#fff' : frac > 0.6 ? '#3f6' : frac > 0.3 ? '#ffe66d' : '#ff2a6d';
  neonText('HP', 20, 94, 10, '#fff', 'left');
  ctx.fillStyle = 'rgba(18,0,42,0.8)';
  ctx.fillRect(48, 86, 204, 16);
  for (let i = 0; i < 10; i++) {
    const segFill = clamp(frac * 10 - i, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(50 + i * 20, 88, 18, 12);
    if (segFill > 0) { ctx.fillStyle = barCol; ctx.fillRect(50 + i * 20, 88, 18 * segFill, 12); }
  }
  if (frac <= 0.3 && (g.frame >> 4) % 2) neonText('LOW!', 262, 94, 10, '#ff2a6d', 'left');

  const s = gunStats(g.gunLevel);
  neonText('GUN LV.' + (g.gunLevel + 1), W - 20, 24, 14, s.color, 'right');
  neonText(s.name, W - 20, 46, 10, '#fff', 'right');
  const segs = GUN_TABLE.length;
  for (let i = 0; i < segs; i++) {
    const x = W - 20 - (segs - i) * 15;
    ctx.fillStyle = i <= g.gunLevel ? GUN_TABLE[i].color : 'rgba(255,255,255,0.15)';
    ctx.fillRect(x, 60, 11, 8 + i);
  }
  if (g.gunLevel >= NUKE_LEVEL) {
    neonText('NUKE ARMED', W - 20, 90, 12, (g.frame >> 3) % 2 ? '#ff0' : '#f44', 'right');
    if ((g.frame >> 4) % 2 && !g.banner) neonText('FIRE TO END IT ALL', W / 2, H - 40, 16, '#ff0');
  } else if (g.gunLevel >= segs) {
    neonText('GOD +' + (g.gunLevel - segs + 1) + '/' + GOD_LEVELS, W - 20, 90, 12, '#ffe66d', 'right');
  }

  if (g.banner) {
    const b = g.banner;
    const sc = b.t < 10 ? 2.2 - b.t * 0.12 : 1;
    ctx.save();
    ctx.globalAlpha = b.t > 110 ? (130 - b.t) / 20 : 1;
    ctx.translate(W / 2, 150);
    ctx.scale(sc, sc);
    neonText(b.text, 0, 0, 30, (g.frame >> 2) % 2 ? b.color : '#fff');
    neonText(b.sub, 0, 40, 16, '#fff');
    ctx.restore();
  }
}

function drawPadToast() {
  if (Input.padToast <= 0) return;
  Input.padToast--;
  ctx.globalAlpha = Math.min(1, Input.padToast / 30);
  ctx.fillStyle = 'rgba(18,0,42,0.8)';
  ctx.fillRect(16, H - 44, 420, 28);
  neonText('PAD READY: ' + Input.padName, 26, H - 30, 9, '#0ff', 'left');
  ctx.globalAlpha = 1;
}

function drawLogo(y, t) {
  ctx.save();
  ctx.translate(W / 2, y);
  ctx.transform(1, 0, -0.2, 1, 0, 0);
  ctx.font = '96px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const grad = ctx.createLinearGradient(0, -48, 0, 48);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#7ff');
  grad.addColorStop(0.5, '#1a0633');
  grad.addColorStop(0.55, '#ff2fa0');
  grad.addColorStop(1, '#ffe66d');
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#12002a';
  ctx.strokeText('NEOGUN', 6, 6);
  ctx.shadowColor = '#ff2fa0';
  ctx.shadowBlur = 25 + Math.sin(t * 0.05) * 10;
  ctx.strokeStyle = '#ff2fa0';
  ctx.lineWidth = 4;
  ctx.strokeText('NEOGUN', 0, 0);
  ctx.shadowBlur = 0;
  ctx.fillStyle = grad;
  ctx.fillText('NEOGUN', 0, 0);
  ctx.restore();
}

function drawTitle() {
  drawLogo(130, titleT);
  neonText('THE GUN ONLY GETS BIGGER', W / 2, 210, 14, '#ffe66d');

  if ((titleT >> 5) % 2 === 0) neonText('PRESS START / ENTER', W / 2, 360, 16, '#fff');
  neonText('MOVE ARROWS/WASD  JUMP Z/SPACE  SHOOT X  AIM UP/DOWN  M MUTE', W / 2, 460, 8, '#7ff');
  neonText('PAD: STICK/DPAD MOVE  A JUMP  X/B/RT SHOOT  START PAUSE', W / 2, 480, 8, '#7ff');
  neonText('DOWN+JUMP TO DROP THROUGH PLATFORMS', W / 2, 500, 8, '#7ff');
  if (best) neonText('BEST ' + best, W / 2, 255, 10, '#ff7bd0');
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cx = game && state !== 'title' ? game.camX : titleT * 2;
  const t = game && state !== 'title' ? game.frame : titleT;
  drawBackground(cx, t);

  if (state === 'title') {
    drawTitle();
  } else if (state === 'nuke') {
    drawNukeSequence(game);
  } else {
    drawWorld(game);
    drawHUD(game);
    if (state === 'paused') {
      ctx.fillStyle = 'rgba(7,1,26,0.6)';
      ctx.fillRect(0, 0, W, H);
      neonText('PAUSED', W / 2, H / 2 - 10, 32, '#0ff');
      neonText('START / ENTER TO RESUME', W / 2, H / 2 + 34, 10, '#fff');
    } else if (state === 'over') {
      ctx.fillStyle = 'rgba(7,1,26,' + Math.min(0.7, game.overT / 60) + ')';
      ctx.fillRect(0, 0, W, H);
      neonText('GAME OVER', W / 2, H / 2 - 60, 40, '#ff2fa0');
      neonText('SCORE ' + game.score, W / 2, H / 2, 16, '#fff');
      neonText(game.score >= best ? 'NEW BEST!' : 'BEST ' + best, W / 2, H / 2 + 30, 12, '#ffe66d');
      if (game.overT > 60 && (game.overT >> 5) % 2 === 0) neonText('PRESS START', W / 2, H / 2 + 80, 14, '#0ff');
    }
  }
  drawPadToast();
  if (Sound.toast > 0) {
    Sound.toast--;
    ctx.globalAlpha = Math.min(1, Sound.toast / 20);
    neonText(Sound.muted ? 'SOUND OFF' : 'SOUND ON', W / 2, 24, 12, Sound.muted ? '#f44' : '#0ff');
    ctx.globalAlpha = 1;
  }
}

// The ending: frozen frame, blinding flash, white-out, then the aftermath.
function drawNukeSequence(g) {
  const t = g.nukeT;
  if (t < 100) {
    drawWorld(g);
    const sx = (g.nukeX - g.camX) * g.zoom, sy = (g.nukeY - viewTop(g)) * g.zoom;
    ctx.globalCompositeOperation = 'lighter';
    const r = t * 90;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, r));
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.6, 'rgba(255,240,180,0.9)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,255,255,' + clamp(t / 14, 0, 1) + ')';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  drawAftermath(t);
  if (t < 240) {
    ctx.fillStyle = 'rgba(255,255,255,' + clamp(1 - (t - 100) / 140, 0, 1) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  if (t > 200) {
    ctx.globalAlpha = clamp((t - 200) / 40, 0, 1);
    neonText('THE END', W / 2, 90, 40, '#ffe66d');
    neonText('YOU NUKED EVERYTHING', W / 2, 140, 14, '#fff');
    ctx.globalAlpha = 1;
  }
  if (t > 260) {
    ctx.globalAlpha = clamp((t - 260) / 30, 0, 1);
    neonText('NUKE BONUS +' + NUKE_BONUS.toLocaleString('en-GB'), W / 2, H - 120, 12, '#ff7bd0');
    neonText('FINAL SCORE ' + g.score.toLocaleString('en-GB'), W / 2, H - 92, 16, '#fff');
    if (g.score >= best) neonText('NEW BEST!', W / 2, H - 66, 12, '#ffe66d');
    ctx.globalAlpha = 1;
  }
  if (t > 360 && (t >> 5) % 2 === 0) neonText('PRESS START', W / 2, H - 30, 14, '#0ff');
}

// Mushroom cloud rendered at 1/6 resolution with a 4x4 ordered dither, then scaled up crisp.
const CLOUD_W = 160, CLOUD_H = 90;
const cloudCanvas = document.createElement('canvas');
cloudCanvas.width = CLOUD_W; cloudCanvas.height = CLOUD_H;
const cloudCtx = cloudCanvas.getContext('2d');
const CLOUD_PAL = [[58, 10, 6], [122, 26, 10], [196, 64, 18], [255, 122, 42], [255, 180, 71], [255, 230, 150]];
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const CLOUD_PUFFS = [[0, 0, 1], [-0.55, 0.15, 0.6], [0.55, 0.15, 0.6], [-0.3, -0.3, 0.6], [0.3, -0.3, 0.6],
  [0, -0.45, 0.5], [-0.8, 0.35, 0.4], [0.8, 0.35, 0.4]];

function drawPixelCloud(t) {
  const grow = clamp((t - 100) / 260, 0, 1);
  const e = 1 - Math.pow(1 - grow, 3);
  const cx = CLOUD_W / 2, groundY = Math.round(CLOUD_H * 0.8);
  const capY = groundY - 20 - e * 33, capR = 10 + e * 18;
  const stemTop = capY + capR * 0.4;
  const puffs = CLOUD_PUFFS.map(([ox, oy, rs]) =>
    [Math.round(cx + ox * capR + Math.sin(t * 0.03 + ox * 5)), Math.round(capY + oy * capR), capR * rs]);
  const ringY = capY + capR * 1.1, ringRx = capR * 0.55, ringRy = Math.max(1.5, capR * 0.12);
  const img = cloudCtx.createImageData(CLOUD_W, CLOUD_H);
  const d = img.data;
  for (let y = 0; y < CLOUD_H; y++) {
    for (let x = 0; x < CLOUD_W; x++) {
      let shade = -1;
      for (const [px, py, r] of puffs) {
        const dx = x - px, dy = y - py, q = (dx * dx + dy * dy) / (r * r);
        // brighter towards each puff's upper middle
        if (q < 1) shade = Math.max(shade, 0.25 + (1 - q) * 0.45 + ((py - y) / r) * 0.3);
      }
      if (shade < 0 && y >= stemTop && y <= groundY) {
        const k = (y - stemTop) / (groundY - stemTop);
        const hw = lerp(capR * 0.2, capR * 0.42, k * k);
        if (Math.abs(x - cx) < hw) shade = 0.55 - k * 0.35 - (Math.abs(x - cx) / hw) * 0.2;
      }
      const rv = ((x - cx) / ringRx) ** 2 + ((y - ringY) / ringRy) ** 2;
      if (rv > 0.6 && rv < 1.4 && (shade < 0 || y > ringY)) shade = 0.85;
      if (shade < 0) continue;
      shade += (BAYER[y & 3][x & 3] / 16 - 0.5) * 0.22;
      const c = CLOUD_PAL[clamp(Math.floor(shade * CLOUD_PAL.length), 0, CLOUD_PAL.length - 1)];
      const i = (y * CLOUD_W + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  cloudCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cloudCanvas, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
}

function drawAftermath(t) {
  // Banded sky to match the pixel cloud
  const stops = [[0, [26, 2, 5]], [0.6, [122, 26, 8]], [0.78, [255, 106, 26]], [1, [42, 10, 2]]];
  const band = 18;
  for (let y = 0; y < H; y += band) {
    const f = y / H;
    let i = 0;
    while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
    const [f0, c0] = stops[i], [f1, c1] = stops[i + 1];
    const k = clamp((f - f0) / (f1 - f0), 0, 1);
    ctx.fillStyle = 'rgb(' + c0.map((v, j) => Math.round(lerp(v, c1[j], k))).join(',') + ')';
    ctx.fillRect(0, y, W, band);
  }

  const cx = W / 2, groundY = H * 0.8;
  drawPixelCloud(t);
  // glow at the base
  ctx.globalCompositeOperation = 'lighter';
  const bg = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, 260);
  bg.addColorStop(0, 'rgba(255,200,80,0.6)');
  bg.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  // scorched ground and ash
  ctx.fillStyle = '#120402';
  const px = W / CLOUD_W;
  for (let x = 0; x < W; x += px) {
    const y = Math.round((groundY + 6 + Math.sin(x * 0.05) * 4 + Math.sin(x * 0.17) * 3) / px) * px;
    ctx.fillRect(x, y, px, H - y);
  }
  ctx.fillStyle = 'rgba(200,180,170,0.7)';
  for (let i = 0; i < 70; i++) {
    const x = (i * 97 + t * (0.3 + (i % 3) * 0.2)) % W;
    const y = (i * 53 + t * (0.4 + (i % 5) * 0.15)) % H;
    ctx.fillRect(Math.floor(x / px) * px, Math.floor(y / px) * px, px / 2, px / 2);
  }
}

// ---------------------------------------------------------------------------
// Main loop (fixed 60Hz simulation)
// ---------------------------------------------------------------------------
function tick() {
  Input.update();
  const P = Input.pressed;
  if (Object.values(P).some(Boolean)) Sound.init();
  if (P.mute) Sound.toggleMute();
  Sound.musicOn = state === 'play' || state === 'title';

  if (state === 'title') {
    titleT++;
    if (P.start || P.jump) { newGame(); state = 'play'; }
  } else if (state === 'play') {
    if (P.start) state = 'paused';
    else update(game);
  } else if (state === 'paused') {
    if (P.start) state = 'play';
  } else if (state === 'nuke') {
    const g = game;
    g.nukeT++;
    g.frame++;
    if (g.nukeT < 100) g.shake = Math.max(g.shake, 50 * (1 - g.nukeT / 100));
    updateFx(g);
    if (g.nukeT > 360 && (P.start || P.jump)) state = 'title';
  } else if (state === 'over') {
    game.overT++;
    game.frame++;
    updateFx(game);
    if (game.overT > 60 && (P.start || P.jump)) { newGame(); state = 'play'; }
  }
}

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= 1000 / 60) { tick(); acc -= 1000 / 60; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
