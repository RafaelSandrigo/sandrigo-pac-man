'use strict';

/* ============================================================
   PAC-MAN — recriação do arcade original (Namco, 1980)
   Lógica baseada no "Pac-Man Dossier": velocidades, IA dos
   fantasmas, modos scatter/chase, Elroy, frutas e casa dos
   fantasmas com contadores de pastilhas.
   ============================================================ */

// ---------- Integração: envio do score ----------
function reportGameOver(score) {
  window.parent.postMessage(
    { source: "bitman", version: 1, type: "game-over", score: Math.floor(score) },
    "*"
  );
}

(() => {
  // ---------- Constantes ----------
  const TS = 8;                 // tamanho do tile em pixels lógicos
  const COLS = 28, ROWS = 31;   // labirinto
  const MAZE_Y = 3 * TS;        // 3 linhas de HUD acima do labirinto
  const W = 224, H = 288;       // resolução original do arcade
  const STEP = 1000 / 60;       // lógica a 60 fps fixos
  const BASE = 75.75757625 / 60; // 100% de velocidade em px/frame

  const UP = 0, LEFT = 1, DOWN = 2, RIGHT = 3;
  const DX = [0, -1, 0, 1];
  const DY = [-1, 0, 1, 0];
  const mod = (a, n) => ((a % n) + n) % n;

  // # parede · - porta da casa · . pastilha · o energizador · espaço vazio
  const MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '     #.##### ## #####.#     ',
    '     #.##          ##.#     ',
    '     #.## ###--### ##.#     ',
    '######.## #      # ##.######',
    '      .   #      #   .      ',
    '######.## #      # ##.######',
    '     #.## ######## ##.#     ',
    '     #.##          ##.#     ',
    '     #.## ######## ##.#     ',
    '######.## ######## ##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################',
  ];

  const FRUITS = [
    { name: 'cherry', pts: 100 },
    { name: 'strawberry', pts: 300 },
    { name: 'orange', pts: 500 },
    { name: 'apple', pts: 700 },
    { name: 'melon', pts: 1000 },
    { name: 'galaxian', pts: 2000 },
    { name: 'bell', pts: 3000 },
    { name: 'key', pts: 5000 },
  ];

  const fruitIndex = lv =>
    lv === 1 ? 0 : lv === 2 ? 1 : lv <= 4 ? 2 : lv <= 6 ? 3 :
    lv <= 8 ? 4 : lv <= 10 ? 5 : lv <= 12 ? 6 : 7;

  // Tabela de níveis (velocidades em % de BASE, tempos em segundos)
  function levelSpec(lv) {
    let s;
    if (lv === 1) s = { pac: 0.80, pacF: 0.90, ghost: 0.75, ghostF: 0.50, tunnel: 0.40 };
    else if (lv <= 4) s = { pac: 0.90, pacF: 0.95, ghost: 0.85, ghostF: 0.55, tunnel: 0.45 };
    else if (lv <= 20) s = { pac: 1.00, pacF: 1.00, ghost: 0.95, ghostF: 0.60, tunnel: 0.50 };
    else s = { pac: 0.90, pacF: 0.90, ghost: 0.95, ghostF: 0.60, tunnel: 0.50 };

    const FR = [[6, 5], [5, 5], [4, 5], [3, 5], [2, 5], [5, 5], [2, 5], [2, 5], [1, 3],
      [5, 5], [2, 5], [1, 3], [1, 3], [3, 5], [1, 3], [1, 3], [0, 0], [1, 3]];
    const [frightTime, flashes] = lv <= 18 ? FR[lv - 1] : [0, 0];

    const EL =
      lv === 1 ? [20, 0.80, 10, 0.85] :
      lv === 2 ? [30, 0.90, 15, 0.95] :
      lv <= 4 ? [40, 0.90, 20, 0.95] :
      lv === 5 ? [40, 1.00, 20, 1.05] :
      lv <= 8 ? [50, 1.00, 25, 1.05] :
      lv <= 11 ? [60, 1.00, 30, 1.05] :
      lv <= 14 ? [80, 1.00, 40, 1.05] :
      lv <= 18 ? [100, 1.00, 50, 1.05] : [120, 1.00, 60, 1.05];

    const modes =
      lv === 1 ? [7, 20, 7, 20, 5, 20, 5, Infinity] :
      lv <= 4 ? [7, 20, 7, 20, 5, 1033, 1 / 60, Infinity] :
      [5, 20, 5, 20, 5, 1037, 1 / 60, Infinity];

    return {
      ...s, frightTime, flashes, modes,
      elroy1Dots: EL[0], elroy1Speed: EL[1], elroy2Dots: EL[2], elroy2Speed: EL[3],
    };
  }

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Desenha na resolução nativa (224x288) e amplia por um fator inteiro de pixels
  // do dispositivo, para todos os pixels terem o mesmo tamanho. Em telas pequenas
  // demais para 2x, usa o maior tamanho que couber.
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(1, window.innerWidth - 32);
    const availH = Math.max(1, window.innerHeight - 40);
    const fit = Math.min(availW / W, availH / H) * dpr;
    const scale = fit >= 2 ? Math.floor(fit) : fit;
    canvas.style.width = `${(W * scale) / dpr}px`;
    canvas.style.height = `${(H * scale) / dpr}px`;
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // ---------- Som (sintetizado com Web Audio) ----------
  const Sound = (() => {
    const VOL = 0.2;
    let ac = null, master = null, muted = false;
    let sOsc = null, sGain = null, sMode = null, sLevel = 0, sPhase = 0;
    let wakaFlip = false, wakaUntil = 0;

    function init() {
      try {
        if (!ac) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ac = new AC();
          master = ac.createGain();
          master.gain.value = muted ? 0 : VOL;
          master.connect(ac.destination);
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (e) {
        ac = null;
      }
    }

    function freqOf(n) {
      const m = /^([A-G])(#?)(\d)$/.exec(n);
      const idx = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
      const midi = (+m[3] + 1) * 12 + idx;
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    // Cria uma voz e devolve o AudioParam de frequência para automação
    function voice(type, t0, dur, vol) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
      g.gain.setValueAtTime(vol, Math.max(t0 + 0.006, t0 + dur - 0.02));
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
      return o.frequency;
    }

    const U = 0.135; // duração de uma semicolcheia da música de abertura
    const MELODY = [
      ['B4', 1], ['B5', 1], ['F#5', 1], ['D#5', 1], ['B5', 0.5], ['F#5', 1.5], ['D#5', 2],
      ['C5', 1], ['C6', 1], ['G5', 1], ['E5', 1], ['C6', 0.5], ['G5', 1.5], ['E5', 2],
      ['B4', 1], ['B5', 1], ['F#5', 1], ['D#5', 1], ['B5', 0.5], ['F#5', 1.5], ['D#5', 2],
      ['D#5', 0.5], ['E5', 0.5], ['F5', 1], ['F5', 0.5], ['F#5', 0.5], ['G5', 1],
      ['G5', 0.5], ['G#5', 0.5], ['A5', 1], ['B5', 2],
    ];
    const BASS = [];
    for (const root of ['B2', 'C3', 'B2']) {
      const oct = root.replace(/\d/, d => +d + 1);
      for (let i = 0; i < 4; i++) BASS.push([root, 1.5], [oct, 0.5]);
    }
    BASS.push(['F#2', 2], ['G#2', 2], ['A#2', 2], ['B2', 2]);

    function intro() {
      const total = 32 * U + 0.1;
      if (!ac) return total;
      const t = ac.currentTime + 0.05;
      let tt = t;
      for (const [n, d] of MELODY) {
        voice('square', tt, d * U * 0.92, 0.2).setValueAtTime(freqOf(n), tt);
        tt += d * U;
      }
      tt = t;
      for (const [n, d] of BASS) {
        voice('triangle', tt, d * U * 0.9, 0.55).setValueAtTime(freqOf(n), tt);
        tt += d * U;
      }
      return total;
    }

    function waka() {
      if (!ac) return;
      const t = ac.currentTime;
      if (t < wakaUntil - 0.01) return;
      const d = 0.12;
      const f = voice('triangle', t, d, 0.6);
      const [a, b] = wakaFlip ? [220, 520] : [520, 220];
      f.setValueAtTime(a, t);
      f.linearRampToValueAtTime(b, t + d);
      wakaFlip = !wakaFlip;
      wakaUntil = t + d;
    }

    function eatGhost() {
      if (!ac) return;
      const t = ac.currentTime;
      const f = voice('square', t, 0.5, 0.18);
      f.setValueAtTime(110, t);
      f.exponentialRampToValueAtTime(1800, t + 0.5);
    }

    function fruit() {
      if (!ac) return;
      const t = ac.currentTime;
      const f = voice('triangle', t, 0.32, 0.6);
      f.setValueAtTime(1400, t);
      f.linearRampToValueAtTime(250, t + 0.16);
      f.linearRampToValueAtTime(1400, t + 0.32);
    }

    function extraLife() {
      if (!ac) return;
      const t = ac.currentTime;
      for (let i = 0; i < 4; i++) {
        voice('square', t + i * 0.16, 0.1, 0.15).setValueAtTime(1046.5, t + i * 0.16);
      }
    }

    function death() {
      if (!ac) return;
      const t = ac.currentTime;
      for (let i = 0; i < 11; i++) {
        const st = t + i * 0.12;
        const f0 = 760 - i * 52;
        const f = voice('square', st, 0.12, 0.16);
        f.setValueAtTime(f0, st);
        f.linearRampToValueAtTime(f0 * 1.25, st + 0.05);
        f.linearRampToValueAtTime(f0 * 0.65, st + 0.12);
      }
      for (let i = 0; i < 2; i++) {
        const st = t + 1.42 + i * 0.16;
        const f = voice('square', st, 0.12, 0.16);
        f.setValueAtTime(90, st);
        f.exponentialRampToValueAtTime(900, st + 0.12);
      }
    }

    // Som contínuo de fundo: sirene, fantasmas azuis ou olhos voltando
    function siren(mode, level = 0) {
      sMode = mode;
      sLevel = level;
    }

    function tick() {
      if (!ac) return;
      if (!sOsc) {
        if (!sMode) return;
        sOsc = ac.createOscillator();
        sGain = ac.createGain();
        sGain.gain.value = 0;
        sOsc.connect(sGain).connect(master);
        sOsc.start();
      }
      const t = ac.currentTime;
      if (!sMode) {
        sGain.gain.setTargetAtTime(0, t, 0.02);
        return;
      }
      sPhase += 1 / 60;
      let f, v, type;
      if (sMode === 'siren') {
        const per = 0.42 - sLevel * 0.05;
        const p = (sPhase % per) / per;
        const tri = p < 0.5 ? p * 2 : 2 - p * 2;
        const lo = 330 + sLevel * 70, hi = 600 + sLevel * 110;
        f = lo + (hi - lo) * tri;
        v = 0.28;
        type = 'triangle';
      } else if (sMode === 'fright') {
        const per = 0.13;
        const p = (sPhase % per) / per;
        f = 150 + 450 * p;
        v = 0.09;
        type = 'square';
      } else {
        const per = 0.09;
        const p = (sPhase % per) / per;
        f = 1700 - 1200 * p;
        v = 0.22;
        type = 'triangle';
      }
      if (sOsc.type !== type) sOsc.type = type;
      sOsc.frequency.setTargetAtTime(f, t, 0.004);
      sGain.gain.setTargetAtTime(v, t, 0.01);
    }

    function toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : VOL;
      return muted;
    }

    return { init, intro, waka, eatGhost, fruit, extraLife, death, siren, tick, toggleMute };
  })();

  // ---------- Paredes pixel a pixel (como os tiles 8x8 do arcade) ----------
  // Cada vizinho de um tile de parede é W (parede), E (corredor) ou V (vazio:
  // fora do labirinto, caixas laterais dos túneis e interior da casa). Linhas
  // voltadas para E ficam junto ao centro do tile; voltadas para V, na beirada,
  // o que forma as linhas duplas da borda e da casa.
  const isHouse = (c, r) => r >= 12 && r <= 16 && c >= 10 && c <= 17;

  function cellType(c, r) {
    if (r < 0 || r >= ROWS) return 'V';
    if (c < 0 || c >= COLS) return r === 14 ? 'E' : r === 13 || r === 15 ? 'W' : 'V';
    const ch = MAZE[r][c];
    if (ch === '#' || ch === '-') return 'W';
    if (ch !== ' ') return 'E';
    if (r >= 13 && r <= 15 && c >= 11 && c <= 16) return 'V';
    if (r >= 9 && r <= 19 && r !== 14 && (c <= 4 || c >= 23)) return 'V';
    return 'E';
  }

  // Formatos dos cantos no quadrante (+1,+1); os outros quadrantes são espelhados
  const CONVEX_SMALL = [[6, 4], [7, 4], [5, 5], [4, 6], [4, 7]];
  const CONVEX_BIG = [[4, 0], [5, 0], [6, 0], [7, 0], [2, 1], [3, 1], [1, 2], [1, 3],
    [0, 4], [0, 5], [0, 6], [0, 7]];
  const CONCAVE = [[5, 3], [6, 3], [7, 3], [4, 4], [3, 5], [3, 6], [3, 7]];

  function buildWallBitmap() {
    const bmp = new Uint8Array(W * ROWS * TS);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (MAZE[r][c] !== '#') continue;
        const set = (x, y) => { bmp[(r * TS + y) * W + c * TS + x] = 1; };
        const shape = (pts, dx, dy) => {
          for (const [x, y] of pts) set(dx > 0 ? x : 7 - x, dy > 0 ? y : 7 - y);
        };
        const t = (dx, dy) => cellType(c + dx, r + dy);
        // posição da linha voltada para um vizinho (sinal s = -1 antes, +1 depois)
        const pos = (type, s) => (type === 'V' ? (s < 0 ? 0 : 7) : (s < 0 ? 4 : 3));
        const house = isHouse(c, r);
        const concave = (dx, dy) => {
          const d = t(dx, dy);
          if (d === 'E') shape(CONCAVE, dx, dy);
          else if (d === 'V' && house) set(dx > 0 ? 7 : 0, dy > 0 ? 7 : 0);
        };

        const U = t(0, -1) === 'W', D = t(0, 1) === 'W', L = t(-1, 0) === 'W', R = t(1, 0) === 'W';
        if (U + D + L + R === 2 && U !== D) {
          // canto convexo
          const dx = R ? 1 : -1, dy = D ? 1 : -1;
          if (house) {
            const row = pos(t(0, -dy), -dy), col = pos(t(-dx, 0), -dx);
            for (let i = 0; i < 8; i++) {
              if ((i - col) * dx >= 0) set(i, row);
              if ((i - row) * dy >= 0) set(col, i);
            }
          } else if (t(0, -dy) === 'V' && t(-dx, 0) === 'V') {
            shape(CONVEX_BIG, dx, dy);
          } else {
            shape(CONVEX_SMALL, dx, dy);
          }
          if (t(dx, dy) !== 'W') concave(dx, dy);
        } else {
          for (const dx of [-1, 1]) {
            for (const dy of [-1, 1]) {
              const h = t(dx, 0) === 'W', v = t(0, dy) === 'W';
              if (h && v) {
                if (t(dx, dy) !== 'W') concave(dx, dy);
              } else if (h) {
                const y = pos(t(0, dy), dy);
                for (let x = 0; x < 4; x++) set(dx < 0 ? x : 4 + x, y);
              } else if (v) {
                const x = pos(t(dx, 0), dx);
                for (let y = 0; y < 4; y++) set(x, dy < 0 ? y : 4 + y);
              }
            }
          }
        }
        // remates das paredes ao lado da porta
        if (MAZE[r][c + 1] === '-') { set(7, 5); set(7, 6); }
        if (MAZE[r][c - 1] === '-') { set(0, 5); set(0, 6); }
      }
    }
    return bmp;
  }

  const wallBitmap = buildWallBitmap();

  function buildMazeCanvas(color) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = ROWS * TS;
    const g = cv.getContext('2d');
    g.fillStyle = color;
    for (let i = 0; i < wallBitmap.length; i++) {
      if (wallBitmap[i]) g.fillRect(i % W, Math.floor(i / W), 1, 1);
    }
    return cv;
  }

  const mazeBlue = buildMazeCanvas('#2121de');
  const mazeWhite = buildMazeCanvas('#ffffff');

  // ---------- Estado do jogo ----------
  let state = 'attract', stateTimer = 0, frame = 0, paused = false;
  let level = 1, score = 0, highScore = 0, lives = 3, extraLifeGiven = false;
  let spec, grid, totalDots = 0, dotsLeft = 0, dotsEaten = 0;
  let pac = null, ghosts = [], blinky, pinky, inky, clyde;
  let frightTimer = 0, ghostEatCount = 0, modeIdx = 0, modeTimer = 0;
  let houseCounters, globalDotActive = false, globalDot = 0, idleTimer = 0, elroySuspended = false;
  let fruit = null, fruitPopup = null, eatenPopup = null;
  let firstReady = false, introFrames = 0, scoreSaved = false;
  let muteToast = 0, muteState = false;
  let attract = { chase: null };

  function setState(s) {
    state = s;
    stateTimer = 0;
  }

  function resetMaze() {
    grid = MAZE.map(row => row.split(''));
    totalDots = 0;
    for (const row of grid) for (const ch of row) if (ch === '.' || ch === 'o') totalDots++;
    dotsLeft = totalDots;
    dotsEaten = 0;
  }

  function cell(c, r) {
    if (r === 14 && (c < 0 || c >= COLS)) return ' '; // túnel
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return '#';
    return grid[r][c];
  }

  function isWall(c, r) {
    const ch = cell(c, r);
    return ch === '#' || ch === '-';
  }

  // ---------- Atores ----------
  function makeGhost(name, color, x, y, st, dir, scatter, homeX) {
    return {
      name, color, x, y, dir, state: st, scatter, homeX,
      frightened: false, reverse: false, acc: 0, bobDir: dir === DOWN ? 1 : -1,
    };
  }

  function resetActors() {
    pac = { x: 112, y: 188, dir: LEFT, next: LEFT, acc: 0, stall: 0, anim: 0 };
    blinky = makeGhost('blinky', '#ff0000', 112, 92, 'active', LEFT, [25, -3], 112);
    pinky = makeGhost('pinky', '#ffb8ff', 112, 116, 'house', DOWN, [2, -3], 112);
    inky = makeGhost('inky', '#00ffff', 96, 116, 'house', UP, [27, 32], 96);
    clyde = makeGhost('clyde', '#ffb852', 128, 116, 'house', UP, [0, 32], 128);
    ghosts = [blinky, pinky, inky, clyde];
    frightTimer = 0;
    modeIdx = 0;
    modeTimer = spec.modes[0] * 60;
    idleTimer = 0;
    fruit = null;
    fruitPopup = null;
    eatenPopup = null;
  }

  function startLevel() {
    spec = levelSpec(level);
    resetMaze();
    houseCounters = { pinky: 0, inky: 0, clyde: 0 };
    globalDotActive = false;
    globalDot = 0;
    elroySuspended = false;
    resetActors();
  }

  function startGame() {
    hideOverlay();
    scoreSaved = false;
    paused = false;
    level = 1;
    score = 0;
    lives = 3;
    extraLifeGiven = false;
    startLevel();
    firstReady = true;
    introFrames = Math.round(Sound.intro() * 60);
    setState('ready');
  }

  function addScore(n) {
    score += n;
    if (!extraLifeGiven && score >= 10000) {
      extraLifeGiven = true;
      lives++;
      Sound.extraLife();
    }
    if (score > highScore) highScore = score;
  }

  // ---------- Pac-Man ----------
  function pacSpeed() {
    return (frightTimer > 0 ? spec.pacF : spec.pac) * BASE;
  }

  function wrap(e) {
    if (e.x < -12) e.x += 240;
    else if (e.x > 236) e.x -= 240;
  }

  function pacStep() {
    const p = pac;
    if (p.next === (p.dir + 2) % 4) p.dir = p.next;

    const tc = Math.floor(p.x / TS), tr = Math.floor(p.y / TS);
    const cx = tc * TS + 4, cy = tr * TS + 4;

    // Curva com "cornering": aceita a virada até 3px antes/depois do centro do tile
    if (p.next !== p.dir && !isWall(tc + DX[p.next], tr + DY[p.next])) {
      const off = DX[p.dir] ? Math.abs(p.x - cx) : Math.abs(p.y - cy);
      if (off <= 3) p.dir = p.next;
    }

    const onAxisCenter = DX[p.dir] ? p.x === cx : p.y === cy;
    if (onAxisCenter && isWall(tc + DX[p.dir], tr + DY[p.dir])) return false; // parado na parede

    p.x += DX[p.dir];
    p.y += DY[p.dir];
    // corrige o eixo perpendicular durante a curva (movimento diagonal)
    if (DX[p.dir] === 0 && p.x !== cx) p.x += Math.sign(cx - p.x);
    else if (DY[p.dir] === 0 && p.y !== cy) p.y += Math.sign(cy - p.y);
    wrap(p);
    p.anim++;
    return true;
  }

  function eatAt() {
    const c = Math.floor(pac.x / TS), r = Math.floor(pac.y / TS);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    const ch = grid[r][c];
    if (ch !== '.' && ch !== 'o') return;

    grid[r][c] = ' ';
    dotsLeft--;
    dotsEaten++;
    idleTimer = 0;
    addScore(ch === '.' ? 10 : 50);
    pac.stall = ch === '.' ? 1 : 3; // Pac-Man perde frames ao comer, como no original
    Sound.waka();
    dotForRelease();
    if (ch === 'o') energize();
    if (dotsEaten === 70 || dotsEaten === 170) {
      fruit = { timer: 540 + Math.floor(Math.random() * 60) };
    }
    if (dotsLeft === 0) setState('levelDone');
  }

  function energize() {
    ghostEatCount = 0;
    for (const g of ghosts) if (g.state === 'active') g.reverse = true;
    if (spec.frightTime > 0) {
      frightTimer = spec.frightTime * 60;
      for (const g of ghosts) {
        if (g.state !== 'eaten' && g.state !== 'entering') g.frightened = true;
      }
    }
  }

  // ---------- Casa dos fantasmas ----------
  const firstInHouse = () => [pinky, inky, clyde].find(g => g.state === 'house');

  function dotLimit(g) {
    if (g === inky) return level === 1 ? 30 : 0;
    if (g === clyde) return level === 1 ? 60 : level === 2 ? 50 : 0;
    return 0;
  }

  function dotForRelease() {
    if (globalDotActive) {
      globalDot++;
      if (globalDot === 7 && pinky.state === 'house') pinky.state = 'leaving';
      else if (globalDot === 17 && inky.state === 'house') inky.state = 'leaving';
      else if (globalDot === 32 && clyde.state === 'house') {
        clyde.state = 'leaving';
        globalDotActive = false;
      }
    } else {
      const g = firstInHouse();
      if (g) houseCounters[g.name]++;
    }
  }

  function updateRelease() {
    idleTimer++;
    const g = firstInHouse();
    if (!g) return;
    if (!globalDotActive && houseCounters[g.name] >= dotLimit(g)) {
      g.state = 'leaving';
      return;
    }
    if (idleTimer >= (level < 5 ? 240 : 180)) {
      idleTimer = 0;
      g.state = 'leaving';
    }
  }

  // ---------- Fantasmas ----------
  function elroyLevel() {
    if (elroySuspended) return 0;
    if (dotsLeft <= spec.elroy2Dots) return 2;
    if (dotsLeft <= spec.elroy1Dots) return 1;
    return 0;
  }

  function ghostSpeed(g) {
    if (g.state === 'eaten') return 1.9;
    if (g.state === 'entering') return 1.2;
    if (g.state === 'house' || g.state === 'leaving') return 0.6;
    const c = Math.floor(g.x / TS), r = Math.floor(g.y / TS);
    if (r === 14 && (c <= 5 || c >= 22)) return spec.tunnel * BASE;
    if (g.frightened) return spec.ghostF * BASE;
    if (g === blinky) {
      const el = elroyLevel();
      if (el === 2) return spec.elroy2Speed * BASE;
      if (el === 1) return spec.elroy1Speed * BASE;
    }
    return spec.ghost * BASE;
  }

  const isScatter = () => modeIdx % 2 === 0;

  function ghostTarget(g) {
    if (g.state === 'eaten') return [13, 11];
    const pc = Math.floor(pac.x / TS), pr = Math.floor(pac.y / TS);
    if (isScatter() && !(g === blinky && elroyLevel() > 0)) return g.scatter;

    switch (g.name) {
      case 'blinky':
        return [pc, pr];
      case 'pinky': {
        // 4 tiles à frente (com o bug original quando olhando para cima)
        let tx = pc + 4 * DX[pac.dir], ty = pr + 4 * DY[pac.dir];
        if (pac.dir === UP) tx -= 4;
        return [tx, ty];
      }
      case 'inky': {
        let ax = pc + 2 * DX[pac.dir], ay = pr + 2 * DY[pac.dir];
        if (pac.dir === UP) ax -= 2;
        const bc = Math.floor(blinky.x / TS), br = Math.floor(blinky.y / TS);
        return [2 * ax - bc, 2 * ay - br];
      }
      default: {
        const gc = Math.floor(g.x / TS), gr = Math.floor(g.y / TS);
        return (gc - pc) ** 2 + (gr - pr) ** 2 > 64 ? [pc, pr] : g.scatter;
      }
    }
  }

  function chooseDir(g, tc, tr) {
    const rev = (g.dir + 2) % 4;
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (d === rev || isWall(tc + DX[d], tr + DY[d])) continue;
      // zonas onde os fantasmas não podem virar para cima (scatter/chase)
      if (d === UP && g.state === 'active' && !g.frightened &&
          (tr === 11 || tr === 23) && (tc === 12 || tc === 15)) continue;
      opts.push(d);
    }
    if (!opts.length) return rev;
    if (g.frightened) return opts[Math.floor(Math.random() * opts.length)];

    const [tx, ty] = ghostTarget(g);
    let best = opts[0], bestD = Infinity;
    for (const d of opts) { // ordem de desempate: cima, esquerda, baixo, direita
      const dist = (tc + DX[d] - tx) ** 2 + (tr + DY[d] - ty) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  function ghostStep(g) {
    switch (g.state) {
      case 'house':
        g.y += g.bobDir;
        if (g.y <= 112) g.bobDir = 1;
        else if (g.y >= 120) g.bobDir = -1;
        g.dir = g.bobDir > 0 ? DOWN : UP;
        return;

      case 'leaving':
        if (g.x !== 112) {
          g.dir = g.x < 112 ? RIGHT : LEFT;
          g.x += g.x < 112 ? 1 : -1;
        } else if (g.y > 92) {
          g.dir = UP;
          g.y--;
        } else {
          g.state = 'active';
          g.dir = LEFT;
          g.reverse = false;
        }
        return;

      case 'entering':
        if (g.y < 116 && g.x !== 112) {
          g.x += Math.sign(112 - g.x);
        } else if (g.y < 116) {
          g.dir = DOWN;
          g.y++;
        } else if (g.x !== g.homeX) {
          g.dir = g.homeX < g.x ? LEFT : RIGHT;
          g.x += Math.sign(g.homeX - g.x);
        } else {
          g.state = 'leaving';
          g.frightened = false;
        }
        return;
    }

    // 'active' ou 'eaten'
    if (g.reverse) {
      g.reverse = false;
      g.dir = (g.dir + 2) % 4;
    }
    if (mod(g.x, TS) === 4 && mod(g.y, TS) === 4) {
      const tc = Math.floor(g.x / TS), tr = Math.floor(g.y / TS);
      if (g.state === 'eaten' && tr === 11 && (tc === 13 || tc === 14)) {
        g.state = 'entering';
        return;
      }
      g.dir = chooseDir(g, tc, tr);
    }
    g.x += DX[g.dir];
    g.y += DY[g.dir];
    wrap(g);
  }

  // ---------- Colisões ----------
  function checkCollisions() {
    const pc = Math.floor(pac.x / TS), pr = Math.floor(pac.y / TS);
    for (const g of ghosts) {
      if (g.state !== 'active') continue;
      if (Math.floor(g.x / TS) !== pc || Math.floor(g.y / TS) !== pr) continue;
      if (g.frightened) {
        ghostEatCount++;
        const pts = 200 * Math.pow(2, ghostEatCount - 1);
        addScore(pts);
        g.state = 'eaten';
        g.frightened = false;
        eatenPopup = { ghost: g, x: g.x, y: g.y, pts };
        Sound.eatGhost();
        setState('ghostEaten');
      } else {
        setState('dying');
      }
      return true;
    }
    return false;
  }

  // ---------- Atualização ----------
  function updatePlaying() {
    // temporizadores de modo (pausados durante o modo assustado)
    if (frightTimer > 0) {
      if (--frightTimer === 0) for (const g of ghosts) g.frightened = false;
    } else if (modeIdx < spec.modes.length - 1 && --modeTimer <= 0) {
      modeIdx++;
      modeTimer = spec.modes[modeIdx] * 60;
      for (const g of ghosts) if (g.state === 'active') g.reverse = true;
    }

    if (elroySuspended && clyde.state !== 'house') elroySuspended = false;
    updateRelease();

    // Pac-Man
    if (pac.stall > 0) {
      pac.stall--;
    } else {
      pac.acc += pacSpeed();
      while (pac.acc >= 1) {
        pac.acc -= 1;
        pacStep();
        eatAt();
        if (state !== 'playing') return;
      }
    }
    if (checkCollisions()) return;

    // Fantasmas
    for (const g of ghosts) {
      g.acc += ghostSpeed(g);
      while (g.acc >= 1) {
        g.acc -= 1;
        ghostStep(g);
      }
    }
    if (checkCollisions()) return;

    // Fruta bônus
    if (fruit) {
      if (--fruit.timer <= 0) {
        fruit = null;
      } else if (Math.floor(pac.y / TS) === 17 && Math.abs(pac.x - 112) <= 4) {
        const pts = FRUITS[fruitIndex(level)].pts;
        addScore(pts);
        fruitPopup = { timer: 120, pts };
        fruit = null;
        Sound.fruit();
      }
    }
    if (fruitPopup && --fruitPopup.timer <= 0) fruitPopup = null;
  }

  function updateDying() {
    if (stateTimer === 60) Sound.death();
    if (stateTimer < 190) return;
    lives--;
    if (lives <= 0) {
      setState('gameover');
    } else {
      globalDotActive = true;
      globalDot = 0;
      elroySuspended = true;
      resetActors();
      setState('ready');
    }
  }

  function updateSound() {
    if (state === 'playing' && !paused) {
      if (ghosts.some(g => g.state === 'eaten' || g.state === 'entering')) Sound.siren('eyes');
      else if (frightTimer > 0) Sound.siren('fright');
      else {
        const f = dotsLeft / totalDots;
        Sound.siren('siren', f > 0.6 ? 0 : f > 0.35 ? 1 : f > 0.15 ? 2 : 3);
      }
    } else {
      Sound.siren(null);
    }
    Sound.tick();
  }

  // ---------- Tela de atração ----------
  const ATTRACT_GHOSTS = [
    ['SHADOW', '"BLINKY"', '#ff0000'],
    ['SPEEDY', '"PINKY"', '#ffb8ff'],
    ['BASHFUL', '"INKY"', '#00ffff'],
    ['POKEY', '"CLYDE"', '#ffb852'],
  ];
  const ATTRACT_POINTS_AT = 360, ATTRACT_CHASE_AT = 420, ATTRACT_ROW_Y = 20 * TS + 4;

  function updateAttract() {
    if (stateTimer === ATTRACT_CHASE_AT) {
      attract.chase = {
        pac: { x: 240, dir: LEFT },
        ghosts: ATTRACT_GHOSTS.map((g, i) => ({ x: 264 + i * 16, color: g[2], eaten: false })),
        powered: false, eatenCount: 0, freeze: 0, popup: null, end: 0,
      };
    }
    const ch = attract.chase;
    if (!ch || stateTimer < ATTRACT_CHASE_AT) return;

    if (ch.freeze > 0) {
      if (--ch.freeze === 0) ch.popup = null;
      return;
    }
    if (!ch.powered) {
      ch.pac.x -= 1.25;
      for (const g of ch.ghosts) g.x -= 1.32;
      if (ch.pac.x <= 36) {
        ch.powered = true;
        ch.pac.dir = RIGHT;
      }
      return;
    }
    ch.pac.x += 1.3;
    for (const g of ch.ghosts) if (!g.eaten) g.x += 0.65;
    const target = ch.ghosts.find(g => !g.eaten);
    if (target && ch.pac.x >= target.x - 3) {
      target.eaten = true;
      ch.popup = { x: target.x, pts: 200 << ch.eatenCount };
      ch.eatenCount++;
      ch.freeze = 50;
    } else if (!target && ch.pac.x > 250 && ++ch.end > 60) {
      attract.chase = null;
      setState('attract');
    }
  }

  // ---------- Loop principal ----------
  function update() {
    frame++;
    stateTimer++;
    if (muteToast > 0) muteToast--;

    switch (state) {
      case 'attract':
        updateAttract();
        break;
      case 'ready':
        if (stateTimer >= (firstReady ? introFrames : 120)) {
          firstReady = false;
          setState('playing');
        }
        break;
      case 'playing':
        updatePlaying();
        break;
      case 'ghostEaten':
        if (stateTimer >= 60) {
          eatenPopup = null;
          setState('playing');
        }
        break;
      case 'dying':
        updateDying();
        break;
      case 'levelDone':
        if (stateTimer >= 170) {
          level++;
          startLevel();
          setState('ready');
        }
        break;
      case 'gameover':
        if (stateTimer === 90) showOverlay();
        break;
    }
  }

  // ---------- Desenho ----------
  function text(s, x, y, color, align = 'left', size = 8) {
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillText(s, x, y);
  }

  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPac(x, y, dir, open) {
    const a = 0.05 + open * 0.8;
    const rot = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][dir];
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, 6.5, rot + a, rot + Math.PI * 2 - a);
    ctx.closePath();
    ctx.fill();
  }

  const pacMouth = p => [1, 0.5, 0, 0.5][Math.floor(p.anim / 2) % 4];

  function drawPacDeath(x, y, t) {
    if (t < 0.85) {
      const a = 0.05 + (t / 0.85) * (Math.PI - 0.05);
      ctx.fillStyle = '#ffff00';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, 6.5, -Math.PI / 2 + a, -Math.PI / 2 + Math.PI * 2 - a);
      ctx.closePath();
      ctx.fill();
    } else {
      const k = (t - 0.85) / 0.15;
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        const r1 = 2 + k * 3, r2 = 4 + k * 3;
        ctx.moveTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
        ctx.lineTo(x + Math.cos(ang) * r2, y + Math.sin(ang) * r2);
      }
      ctx.stroke();
    }
  }

  function drawGhost(x, y, mode, color, dir) {
    const c = ctx;
    if (mode !== 'eyes') {
      c.fillStyle = mode === 'fright' ? '#2121ff' : mode === 'flash' ? '#ffffff' : color;
      c.beginPath();
      c.moveTo(x - 7, y - 1);
      c.arc(x, y - 1, 7, Math.PI, 0);
      const wob = Math.floor(frame / 8) % 2;
      for (let k = 0; k <= 8; k++) {
        c.lineTo(x + 7 - k * 1.75, (k + wob) % 2 === 0 ? y + 7 : y + 4.5);
      }
      c.closePath();
      c.fill();
    }

    if (mode === 'fright' || mode === 'flash') {
      const fc = mode === 'flash' ? '#ff0000' : '#ffb8ae';
      c.fillStyle = fc;
      c.fillRect(x - 4, y - 3, 2, 2);
      c.fillRect(x + 2, y - 3, 2, 2);
      c.strokeStyle = fc;
      c.lineWidth = 1;
      c.beginPath();
      for (let k = 0; k <= 6; k++) {
        const px = x - 5 + (k * 10) / 6, py = y + (k % 2 ? 2 : 3.5);
        if (k === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();
      return;
    }

    const ex = DX[dir], ey = DY[dir];
    for (const s of [-3, 3]) {
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(x + s + ex, y - 2 + ey, 2.3, 2.8, 0, 0, Math.PI * 2);
      c.fill();
      circle(x + s + ex * 2, y - 2 + ey * 2, 1.3, '#2121ff');
    }
  }

  function drawGhostEntity(g) {
    if (g.state === 'eaten' || g.state === 'entering') {
      drawGhost(g.x, g.y, 'eyes', null, g.dir);
    } else if (g.frightened) {
      const flashing = frightTimer < spec.flashes * 28 && Math.floor(frightTimer / 14) % 2 === 0;
      drawGhost(g.x, g.y, flashing ? 'flash' : 'fright');
    } else {
      drawGhost(g.x, g.y, 'normal', g.color, g.dir);
    }
  }

  function drawFruit(idx, x, y) {
    const c = ctx;
    c.save();
    c.translate(x, y);
    c.lineWidth = 1;
    switch (FRUITS[idx].name) {
      case 'cherry':
        c.strokeStyle = '#de9751';
        c.beginPath();
        c.moveTo(-3, 1);
        c.quadraticCurveTo(-1, -4, 4, -5);
        c.moveTo(2.5, 2);
        c.quadraticCurveTo(2, -2, 4, -5);
        c.stroke();
        circle(-3, 2.5, 2.8, '#ff0000');
        circle(2.5, 3.2, 2.8, '#ff0000');
        circle(-4, 1.8, 0.7, '#ffffff');
        circle(1.5, 2.5, 0.7, '#ffffff');
        break;
      case 'strawberry':
        c.fillStyle = '#ff0000';
        c.beginPath();
        c.moveTo(0, 6);
        c.bezierCurveTo(-7, 1, -6, -4, 0, -3);
        c.bezierCurveTo(6, -4, 7, 1, 0, 6);
        c.fill();
        c.fillStyle = '#ffffff';
        for (const [sx, sy] of [[-3, -1], [0, 0], [3, -1], [-1.5, 2.5], [1.5, 2.5], [0, -2]]) {
          c.fillRect(sx, sy, 1, 1);
        }
        c.fillStyle = '#00de00';
        c.beginPath();
        c.moveTo(-4, -3);
        c.lineTo(0, -6);
        c.lineTo(4, -3);
        c.lineTo(0, -2);
        c.closePath();
        c.fill();
        break;
      case 'orange':
        circle(0, 1, 5, '#ffb847');
        c.fillStyle = '#00de00';
        c.beginPath();
        c.ellipse(2, -4.5, 2.5, 1.2, -0.4, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#de9751';
        c.beginPath();
        c.moveTo(0, -4);
        c.lineTo(0, -6);
        c.stroke();
        break;
      case 'apple':
        circle(-2, 1.5, 4, '#ff0000');
        circle(2, 1.5, 4, '#ff0000');
        circle(-2.5, 0, 1, '#ffffff');
        c.strokeStyle = '#de9751';
        c.beginPath();
        c.moveTo(0, -2);
        c.lineTo(1, -6);
        c.stroke();
        c.fillStyle = '#00de00';
        c.beginPath();
        c.ellipse(3, -4.5, 2, 1, 0.3, 0, Math.PI * 2);
        c.fill();
        break;
      case 'melon':
        circle(0, 1, 5, '#7bde4a');
        c.strokeStyle = '#00a000';
        c.beginPath();
        for (const sx of [-2.5, 0, 2.5]) {
          c.moveTo(sx, -3.5);
          c.quadraticCurveTo(sx * 1.6, 1, sx, 5.5);
        }
        c.stroke();
        c.strokeStyle = '#de9751';
        c.beginPath();
        c.moveTo(0, -4);
        c.lineTo(0, -6);
        c.stroke();
        break;
      case 'galaxian':
        c.fillStyle = '#ffff00';
        c.beginPath();
        c.moveTo(0, 6);
        c.lineTo(-3, -1);
        c.lineTo(3, -1);
        c.closePath();
        c.fill();
        c.fillStyle = '#2121ff';
        c.beginPath();
        c.moveTo(-6, -4);
        c.lineTo(-2, 0);
        c.lineTo(-2, 3);
        c.closePath();
        c.moveTo(6, -4);
        c.lineTo(2, 0);
        c.lineTo(2, 3);
        c.closePath();
        c.fill();
        c.fillStyle = '#ff0000';
        c.fillRect(-1.5, -5, 3, 4);
        break;
      case 'bell':
        c.fillStyle = '#ffff00';
        c.beginPath();
        c.moveTo(-5.5, 4);
        c.quadraticCurveTo(-5, -6, 0, -6);
        c.quadraticCurveTo(5, -6, 5.5, 4);
        c.closePath();
        c.fill();
        c.fillStyle = '#00ffff';
        c.fillRect(-5.5, 3.5, 11, 1.5);
        circle(0, 5.5, 1.3, '#ffffff');
        c.fillStyle = '#ffffff';
        c.fillRect(-3, -3, 1, 4);
        break;
      case 'key':
        c.fillStyle = '#00ffff';
        c.beginPath();
        c.ellipse(0, -3, 3.5, 2.5, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#000000';
        c.fillRect(-1.5, -4, 3, 1);
        c.fillStyle = '#ffffff';
        c.fillRect(-0.75, -0.5, 1.5, 7);
        c.fillRect(0.75, 2, 2, 1);
        c.fillRect(0.75, 4.5, 2, 1);
        break;
    }
    c.restore();
  }

  function drawHUD(blink1up) {
    if (!blink1up || Math.floor(frame / 16) % 2 === 0) text('1UP', 3 * TS, 0, '#ffffff');
    text(score ? String(score) : '00', 7 * TS, TS, '#ffffff', 'right');
    text('HIGH SCORE', 9 * TS, 0, '#ffffff');
    if (highScore) text(String(highScore), 17 * TS, TS, '#ffffff', 'right');

    if (muteToast > 0) text(muteState ? 'SOUND OFF' : 'SOUND ON', W / 2, 2 * TS + 1, '#ffb8ff', 'center', 6);

    if (state === 'attract') return;
    for (let i = 0; i < Math.min(lives - 1, 5); i++) drawPac(24 + i * 16, 35 * TS, LEFT, 0.5);
    for (let lv = Math.max(1, level - 6); lv <= level; lv++) {
      drawFruit(fruitIndex(lv), 26 * TS - (level - lv) * 16, 35 * TS);
    }
  }

  function drawDots() {
    const blinkOn = state !== 'playing' || Math.floor(frame / 10) % 2 === 0;
    ctx.fillStyle = '#ffb8ae';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = grid[r][c];
        if (ch === '.') ctx.fillRect(c * TS + 3, r * TS + 3, 2, 2);
        else if (ch === 'o' && blinkOn) {
          ctx.beginPath();
          ctx.arc(c * TS + 4, r * TS + 4, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function renderGame() {
    drawHUD(state === 'playing');

    ctx.save();
    ctx.translate(0, MAZE_Y);

    const flashPhase = state === 'levelDone' && stateTimer >= 60;
    const white = flashPhase && Math.floor((stateTimer - 60) / 12) % 2 === 1;
    ctx.drawImage(white ? mazeWhite : mazeBlue, 0, 0, W, ROWS * TS);
    if (!flashPhase) {
      ctx.fillStyle = '#ffb8ff';
      ctx.fillRect(13 * TS, 12 * TS + 5, 16, 2);
    }
    drawDots();

    if (fruit) drawFruit(fruitIndex(level), 112, 140);
    if (fruitPopup) text(String(fruitPopup.pts), 112, 137, '#ffb8ff', 'center', 6);

    const actorsVisible = !(state === 'ready' && firstReady && stateTimer < 120);
    const ghostsVisible = actorsVisible && !(state === 'dying' && stateTimer >= 60) && !flashPhase;
    if (ghostsVisible) {
      for (const g of ghosts) {
        if (state === 'ghostEaten' && eatenPopup && g === eatenPopup.ghost) continue;
        drawGhostEntity(g);
      }
    }

    if (actorsVisible) {
      if (state === 'dying') {
        if (stateTimer < 60) drawPac(pac.x, pac.y, pac.dir, pacMouth(pac));
        else if (stateTimer < 160) drawPacDeath(pac.x, pac.y, (stateTimer - 60) / 100);
      } else if (state === 'levelDone') {
        drawPac(pac.x, pac.y, pac.dir, 0);
      } else if (state !== 'ghostEaten' && state !== 'gameover') {
        drawPac(pac.x, pac.y, pac.dir, state === 'ready' ? 0 : pacMouth(pac));
      }
    }

    if (state === 'ghostEaten' && eatenPopup) {
      text(String(eatenPopup.pts), eatenPopup.x, eatenPopup.y - 3, '#00ffff', 'center', 6);
    }

    if (state === 'ready') {
      if (firstReady && stateTimer < 120) text('PLAYER ONE', W / 2, 11 * TS, '#00ffff', 'center');
      text('READY!', W / 2, 17 * TS, '#ffff00', 'center');
    }
    if (state === 'gameover') text('GAME  OVER', W / 2, 17 * TS, '#ff0000', 'center');
    if (paused && !menuVisible()) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(9 * TS, 17 * TS - 2, 10 * TS, TS + 4);
      text('PAUSED', W / 2, 17 * TS, '#ffff00', 'center');
    }
    ctx.restore();
  }

  function renderAttract() {
    drawHUD(false);
    const t = stateTimer;

    if (t >= 10) text('CHARACTER / NICKNAME', 7 * TS, 5 * TS, '#ffffff');
    ATTRACT_GHOSTS.forEach(([nick, name, color], i) => {
      const base = 30 + i * 80;
      const y = (7 + i * 3) * TS;
      if (t >= base) drawGhost(4 * TS + 4, y + 4, 'normal', color, RIGHT);
      if (t >= base + 25) text('-' + nick, 7 * TS, y, color);
      if (t >= base + 50) text(name, 18 * TS, y, color);
    });

    if (t >= ATTRACT_POINTS_AT) {
      ctx.fillStyle = '#ffb8ae';
      ctx.fillRect(10 * TS + 3, 25 * TS + 3, 2, 2);
      circle(10 * TS + 4, 27 * TS + 4, 4, '#ffb8ae');
      text('10', 12 * TS, 25 * TS, '#ffffff');
      text('PTS', 15 * TS, 25 * TS + 2, '#ffffff', 'left', 6);
      text('50', 12 * TS, 27 * TS, '#ffffff');
      text('PTS', 15 * TS, 27 * TS + 2, '#ffffff', 'left', 6);
    }

    const ch = attract.chase;
    if (t >= ATTRACT_POINTS_AT && (!ch || !ch.powered) && Math.floor(frame / 10) % 2 === 0) {
      circle(4 * TS + 4, ATTRACT_ROW_Y, 4, '#ffb8ae');
    }
    if (ch) {
      for (const g of ch.ghosts) {
        if (g.eaten) continue;
        if (ch.powered) drawGhost(g.x, ATTRACT_ROW_Y, 'fright');
        else drawGhost(g.x, ATTRACT_ROW_Y, 'normal', g.color, LEFT);
      }
      if (ch.popup) text(String(ch.popup.pts), ch.popup.x, ATTRACT_ROW_Y - 3, '#00ffff', 'center', 6);
      else drawPac(ch.pac.x, ATTRACT_ROW_Y, ch.pac.dir, [1, 0.5, 0, 0.5][Math.floor(frame / 3) % 4]);
    }

    if (Math.floor(frame / 30) % 2 === 0) {
      text('PRESS ENTER OR TAP', W / 2, 31 * TS, '#ffff00', 'center');
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    if (state === 'attract') renderAttract();
    else renderGame();
  }

  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= STEP) {
      if (!paused) update();
      updateSound();
      acc -= STEP;
    }
    render();
    if (menuBtn.hidden === inGame()) menuBtn.hidden = !inGame();
    requestAnimationFrame(loop);
  }

  // ---------- Game Over / salvar score ----------
  const overlay = document.getElementById('overlay');
  const saveBtn = document.getElementById('saveBtn');
  const againBtn = document.getElementById('againBtn');
  const saveMsg = document.getElementById('saveMsg');
  const finalScore = document.getElementById('finalScore');
  const overlayVisible = () => !overlay.classList.contains('hidden');

  function showOverlay() {
    finalScore.textContent = String(score);
    saveBtn.disabled = false;
    saveMsg.textContent = '';
    overlay.classList.remove('hidden');
    saveBtn.focus();
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function saveScore() {
    if (state !== 'gameover' || scoreSaved) return;
    scoreSaved = true;
    reportGameOver(score);
    saveBtn.disabled = true;
    saveMsg.textContent = 'SCORE SAVED!';
    againBtn.focus();
  }

  function playAgain() {
    if (state !== 'gameover') return;
    Sound.init();
    startGame();
  }

  saveBtn.addEventListener('click', saveScore);
  againBtn.addEventListener('click', playAgain);

  // ---------- Entrada ----------
  const KEYMAP = {
    ArrowUp: UP, KeyW: UP, ArrowLeft: LEFT, KeyA: LEFT,
    ArrowDown: DOWN, KeyS: DOWN, ArrowRight: RIGHT, KeyD: RIGHT,
  };
  const inGame = () => state !== 'attract' && state !== 'gameover';

  function startFromAttract() {
    if (state !== 'attract') return;
    Sound.init();
    startGame();
  }

  function togglePause() {
    if (!inGame()) return;
    paused = !paused;
  }

  // ---------- Menu (ESC) ----------
  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const menuButtons = [...menu.querySelectorAll('button')];
  const menuVisible = () => !menu.classList.contains('hidden');
  let menuIndex = 0;

  // Opção destacada por classe, para funcionar mesmo sem foco na página (ex.: iframe)
  function selectMenu(i) {
    menuIndex = (i + menuButtons.length) % menuButtons.length;
    menuButtons.forEach((b, j) => b.classList.toggle('selected', j === menuIndex));
    menuButtons[menuIndex].focus();
  }

  function openMenu() {
    if (!inGame() || menuVisible()) return;
    paused = true;
    menu.classList.remove('hidden');
    selectMenu(0);
  }

  function closeMenu() {
    menu.classList.add('hidden');
    if (menu.contains(document.activeElement)) document.activeElement.blur();
  }

  function resumeGame() {
    closeMenu();
    paused = false;
  }

  function restartGame() {
    closeMenu();
    Sound.init();
    startGame();
  }

  function goHome() {
    closeMenu();
    hideOverlay();
    paused = false;
    attract.chase = null;
    setState('attract');
  }


  document.getElementById('resumeBtn').addEventListener('click', resumeGame);
  document.getElementById('restartBtn').addEventListener('click', restartGame);
  document.getElementById('homeBtn').addEventListener('click', goHome);
  menuButtons.forEach((b, i) => b.addEventListener('mouseenter', () => selectMenu(i)));
  menuBtn.addEventListener('click', openMenu);

  window.addEventListener('keydown', e => {
    const isStart = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
    if (e.code in KEYMAP || e.code === 'Space') e.preventDefault();

    if (e.code === 'KeyM') {
      Sound.init();
      muteState = Sound.toggleMute();
      muteToast = 90;
      return;
    }
    if (menuVisible()) {
      if (e.code === 'Escape') {
        e.preventDefault();
        resumeGame();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        selectMenu(menuIndex - 1);
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        selectMenu(menuIndex + 1);
      } else if (isStart) {
        e.preventDefault();
        menuButtons[menuIndex].click();
      }
      return;
    }
    if (state === 'attract') {
      if (isStart) startFromAttract();
      return;
    }
    if (state === 'gameover') {
      if (!overlayVisible()) return;
      if (e.code === 'KeyS') {
        e.preventDefault();
        saveScore();
      } else if (isStart) {
        e.preventDefault();
        playAgain();
      }
      return;
    }
    if (e.code === 'Escape') {
      openMenu();
      return;
    }
    if (e.code === 'KeyP') {
      togglePause();
      return;
    }
    if (e.code in KEYMAP && pac && !paused) pac.next = KEYMAP[e.code];
  });

  canvas.addEventListener('click', startFromAttract);

  // Swipe no celular
  let touch = null;
  document.addEventListener('touchstart', e => {
    if (e.target.closest('button')) return;
    const t = e.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY, moved: false };
    Sound.init();
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!touch) return;
    if (inGame()) e.preventDefault();
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP);
    if (pac && inGame() && !paused) pac.next = dir;
    touch.x = t.clientX;
    touch.y = t.clientY;
    touch.moved = true;
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (touch && !touch.moved) {
      if (state === 'attract') {
        e.preventDefault();
        startFromAttract();
      } else if (paused && !menuVisible()) {
        togglePause();
      }
    }
    touch = null;
  });

  // Abre o menu automaticamente ao perder o foco
  const autoPause = () => {
    if (inGame()) openMenu();
  };
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autoPause();
  });

  // ---------- Início ----------
  spec = levelSpec(1);
  resetMaze();
  setState('attract');
  requestAnimationFrame(loop);
})();
