// ── 테트리스 게임 엔진 ────────────────────────────────────────
'use strict';

const COLS = 10, ROWS = 20;
const BLOCK = 24; // my canvas block size
const OPP_BLOCK = 13; // opponent minimap block size (온라인 상대 미니맵)

const COLORS = {
  I: '#00e5ff',
  O: '#ffd700',
  T: '#ce93d8',
  S: '#00e676',
  Z: '#ff1744',
  J: '#ff9800',
  L: '#42a5f5',
  G: '#333355',  // garbage
};

const PIECES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};

const PIECE_KEYS = Object.keys(PIECES);
const SPAWN_ENTRY_KICKS = [0, -1, 1, -2, 2];
/** 보드·조각 화면이 이 시간(ms) 동안 전혀 안 바뀌면 탈락 */
const STALE_SCREEN_MS = 6000;

const SCORE_TABLE = { 1: 100, 2: 300, 3: 500, 4: 800 };
const LEVEL_SPEED = [800, 700, 600, 500, 400, 300, 250, 200, 150, 100];

class TetrisGame {
  constructor(canvas, nextCanvas, onStateChange, onAttack, onGameOver, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.nextCtx = nextCanvas.getContext('2d');
    this.onStateChange = onStateChange;
    this.onAttack = onAttack;
    this.onGameOver = onGameOver;
    this.onLock = typeof options.onLock === 'function' ? options.onLock : null;
    this.onLineClear = typeof options.onLineClear === 'function' ? options.onLineClear : null;
    this.showGhost = options.showGhost !== false; // 기본값 true
    this.allowPause = options.allowPause === true;
    this.paused = false;

    this.board = this._emptyBoard();
    this.current = null;
    this.next = null;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.running = false;
    this.lastTime = 0;
    this.dropAccum = 0;
    this.gameOver = false;
    this.bag = [];
    this.comboCount = 0;
    this._freezeSig = '';
    this._freezeSince = 0;

    this._bindKeys();
  }

  _resetFreezeWatch() {
    this._freezeSig = '';
    this._freezeSince = 0;
  }

  _getFreezeSignature() {
    let s = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) s += this.board[r][c] ? '1' : '0';
    }
    if (this.current) {
      const p = this.current;
      s += '|' + p.type + ',' + p.x + ',' + p.y + ',';
      for (let r = 0; r < p.shape.length; r++) s += p.shape[r].join('');
    } else {
      s += '|_';
    }
    s += '|' + (this.next ? this.next.type : '-');
    return s;
  }

  /** 화면(보드+현재 조각)이 STALE_SCREEN_MS 동안 동일하면 사망 */
  _checkFrozenScreen(now) {
    if (this.gameOver || !this.running || this.paused) {
      this._resetFreezeWatch();
      return;
    }
    const sig = this._getFreezeSignature();
    if (sig !== this._freezeSig) {
      this._freezeSig = sig;
      this._freezeSince = now;
      return;
    }
    if (!this._freezeSince) this._freezeSince = now;
    if (now - this._freezeSince >= STALE_SCREEN_MS) this._endGame();
  }

  _emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  }

  _getFromBag() {
    if (this.bag.length === 0) {
      this.bag = [...PIECE_KEYS].sort(() => Math.random() - 0.5);
    }
    return this.bag.pop();
  }

  _spawnPiece(type) {
    const shape = PIECES[type].map(r => [...r]);
    return {
      type,
      shape,
      x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
      y: 0,
    };
  }

  start() {
    this.board = this._emptyBoard();
    this.score = 0; this.lines = 0; this.level = 1;
    this.gameOver = false; this.running = true;
    this.paused = false;
    this.bag = [];
    this.comboCount = 0;
    this._resetFreezeWatch();
    this.next = this._spawnPiece(this._getFromBag());
    this._spawn();
    this.lastTime = performance.now();
    this._freezeSince = this.lastTime;
    requestAnimationFrame(this._loop.bind(this));
  }

  stop() {
    this.running = false;
    this.paused = false;
    this._resetFreezeWatch();
  }

  togglePause() {
    if (!this.allowPause || !this.running || this.gameOver) return;
    this.paused = !this.paused;
    if (!this.paused) this.lastTime = performance.now();
    this._draw();
    if (typeof window.syncSoloPauseButton === 'function') window.syncSoloPauseButton();
  }

  setShowGhost(on) {
    this.showGhost = !!on;
    if (this.running) this._draw();
  }

  /** 현재 떨어지는 조각까지 합친 가상 보드 (스폰 가능 여부 판정용) */
  _boardWithCurrent() {
    const b = this.board.map((row) => row.slice());
    if (!this.current) return b;
    const { shape, x, y, type } = this.current;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nr = y + r;
        const nc = x + c;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) b[nr][nc] = type;
      }
    }
    return b;
  }

  /** 스폰 위치(y=0) + 회전·벽킥 — 현재 조각이 막고 있어도 반영 */
  _canSpawnTypeAtEntry(type) {
    const virtual = this._boardWithCurrent();
    let shape = PIECES[type].map((row) => row.map((cell) => cell));
    for (let rot = 0; rot < 4; rot++) {
      const w = shape[0].length;
      const spawnX = Math.floor(COLS / 2) - Math.floor(w / 2);
      for (let ki = 0; ki < SPAWN_ENTRY_KICKS.length; ki++) {
        const px = spawnX + SPAWN_ENTRY_KICKS[ki];
        if (px < 0 || px + w > COLS) continue;
        if (!this._collides(shape, px, 0, virtual)) return true;
      }
      shape = this._rotate(shape);
    }
    return false;
  }

  /** 맨 윗줄이 현재 조각 포함해 전부 막혔는지 */
  _isTopRowSealed() {
    const virtual = this._boardWithCurrent();
    return virtual[0].every((c) => c !== 0);
  }

  _hasCellsAboveCeiling() {
    if (!this.current) return false;
    const { shape, x, y } = this.current;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c] && y + r < 0) return true;
      }
    }
    return false;
  }

  /** 현재 조각이 보드에 끼여 어느 방향으로도 못 움직이면 사망 */
  _isCurrentPieceTrapped() {
    if (!this.current) return false;
    const { shape, x, y } = this.current;
    if (!this._collides(shape, x, y)) return false;
    const deltas = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (let i = 0; i < deltas.length; i++) {
      const dx = deltas[i][0];
      const dy = deltas[i][1];
      if (!this._collides(shape, x + dx, y + dy)) return false;
    }
    return true;
  }

  /**
   * 새 블록을 더 이상 낼 수 없을 때 사망:
   * - 7종·4회전 모두 스폰 불가 (현재 조각이 막는 경우 포함)
   * - 맨 윗줄 완전 봉쇄
   * - 천장 위로 나감 / 조각 완전 끼임
   */
  _cannotSpawnNewBlock() {
    if (!PIECE_KEYS.some((t) => this._canSpawnTypeAtEntry(t))) return true;
    if (this._isTopRowSealed()) return true;
    if (this._hasCellsAboveCeiling()) return true;
    if (this._isCurrentPieceTrapped()) return true;
    return false;
  }

  _checkNewBlockBlocked() {
    if (this.gameOver || !this.running) return;
    if (this._cannotSpawnNewBlock()) this._endGame();
  }

  _endGame() {
    if (this.gameOver) return;
    this.running = false;
    this.gameOver = true;
    this.current = null;
    this._draw();
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this._getState());
    }
    if (typeof this.onGameOver === 'function') {
      this.onGameOver(this.score, this.lines);
    }
  }

  _spawn() {
    const incoming = this.next;
    this.current = incoming;
    this.next = this._spawnPiece(this._getFromBag());
    if (!incoming || this._collides(incoming.shape, incoming.x, incoming.y)) {
      this._endGame();
      return;
    }
    this._drawNext();
    this._checkNewBlockBlocked();
  }

  _loop(ts) {
    if (!this.running || this.gameOver) return;
    const delta = ts - this.lastTime;
    this.lastTime = ts;
    if (!this.paused) {
      this.dropAccum += delta;
      const speed = LEVEL_SPEED[Math.min(this.level - 1, LEVEL_SPEED.length - 1)];
      if (this.dropAccum >= speed) {
        this._drop();
        this.dropAccum = 0;
      }
      this._checkNewBlockBlocked();
      this._checkFrozenScreen(ts);
    }
    this._draw();
    if (!this.paused) this.onStateChange(this._getState());
    requestAnimationFrame(this._loop.bind(this));
  }

  _drop() {
    if (!this.current || this.gameOver) return;
    if (this._collides(this.current.shape, this.current.x, this.current.y + 1)) {
      this._lock();
    } else {
      this.current.y++;
    }
  }

  _lock() {
    const { shape, x, y, type } = this.current;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        if (y + r < 0) {
          this._endGame();
          return;
        }
      }
    }
    shape.forEach((row, r) => row.forEach((v, c) => {
      if (v && y + r >= 0 && y + r < ROWS && x + c >= 0 && x + c < COLS) {
        this.board[y + r][x + c] = type;
      }
    }));
    const clearResult = this._clearLines();
    const cleared = clearResult.count;
    if (cleared > 0) {
      this.comboCount++;
      this.score += (SCORE_TABLE[cleared] || 0) * this.level;
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10) + 1;
      let attackPower = 0;
      if (cleared >= 2) attackPower += cleared - 1;
      if (cleared >= 1 && this.comboCount >= 2) {
        attackPower += this.comboCount - 1;
      }
      attackPower = Math.min(12, attackPower);
      if (attackPower > 0 && typeof this.onAttack === 'function') this.onAttack(attackPower);
      if (typeof this.onLineClear === 'function') {
        this.onLineClear({
          cleared,
          rowIndices: clearResult.rows,
          comboCount: this.comboCount,
        });
      }
    } else {
      this.comboCount = 0;
    }
    this._spawn();
    if (this.gameOver) return;
    if (typeof this.onLock === 'function') this.onLock(cleared);
  }

  _clearLines() {
    const fullRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (this.board[r].every((c) => c !== 0)) fullRows.push(r);
    }
    if (!fullRows.length) return { count: 0, rows: [] };
    fullRows.sort((a, b) => b - a);
    for (const r of fullRows) {
      this.board.splice(r, 1);
      this.board.unshift(Array(COLS).fill(0));
    }
    fullRows.sort((a, b) => a - b);
    return { count: fullRows.length, rows: fullRows };
  }

  _collides(shape, px, py, boardOpt) {
    const board = boardOpt || this.board;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nr = py + r;
        const nc = px + c;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return true;
        if (board[nr][nc]) return true;
      }
    }
    return false;
  }

  _rotate(shape) {
    const N = shape.length;
    const M = shape[0].length;
    const rotated = Array.from({ length: M }, () => Array(N).fill(0));
    for (let r = 0; r < N; r++)
      for (let c = 0; c < M; c++)
        rotated[c][N - 1 - r] = shape[r][c];
    return rotated;
  }

  _tryRotate() {
    if (!this.current || this.gameOver) return;
    const rotated = this._rotate(this.current.shape);
    const kicks = [0, 1, -1, 2, -2];
    for (const kick of kicks) {
      if (!this._collides(rotated, this.current.x + kick, this.current.y)) {
        this.current.shape = rotated;
        this.current.x += kick;
        return;
      }
    }
  }

  hardDrop() {
    if (!this.current || this.gameOver) return;
    while (!this._collides(this.current.shape, this.current.x, this.current.y + 1)) {
      this.current.y++;
      this.score += 2;
    }
    this._lock();
  }

  addGarbage(arg) {
    const p = typeof arg === 'number' ? { kind: 'rows', lines: arg } : (arg || { kind: 'rows', lines: 1 });
    return this.applyPenalty(p);
  }

  /** 다양한 훼방(가비지) — 서버에서 kind 지정 */
  applyPenalty(penalty) {
    if (!this.running || this.gameOver) return;
    const kind = penalty.kind || 'rows';
    switch (kind) {
      case 'rows':
        this._penaltyRows(penalty.lines || 1, 1);
        break;
      case 'split':
        this._penaltyRows(penalty.lines || 1, 2);
        break;
      case 'cheese':
        this._penaltyCheese(penalty.lines || 2);
        break;
      case 'meteor':
        this._penaltyMeteors(penalty.meteors || 1);
        break;
      case 'cloud':
      case 'ink':
        break;
      default:
        this._penaltyRows(penalty.lines || penalty.power || 1, 1);
    }
    this._resolveCurrentAfterGarbage();
    this._checkNewBlockBlocked();
  }

  _garbageRectOccupied(px, py, w, h) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const nr = py + r;
        const nc = px + c;
        if (nr < 0) continue;
        if (nr >= ROWS || nc < 0 || nc >= COLS) return true;
        if (this.board[nr][nc]) return true;
      }
    }
    return false;
  }

  _placeGarbageRect(px, py, w, h) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const nr = py + r;
        const nc = px + c;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) this.board[nr][nc] = 'G';
      }
    }
  }

  _penaltyRows(lines, holes) {
    const n = Math.max(1, Math.min(12, parseInt(lines, 10) || 1));
    const h = Math.min(3, Math.max(1, parseInt(holes, 10) || 1));
    for (let i = 0; i < n; i++) {
      this.board.shift();
      const row = Array(COLS).fill('G');
      const used = new Set();
      for (let k = 0; k < h; k++) {
        let col = Math.floor(Math.random() * COLS);
        let guard = 0;
        while (used.has(col) && guard++ < 20) col = Math.floor(Math.random() * COLS);
        used.add(col);
        row[col] = 0;
      }
      this.board.push(row);
    }
  }

  _penaltyCheese(lines) {
    const n = Math.max(2, Math.min(10, parseInt(lines, 10) || 3));
    for (let i = 0; i < n; i++) {
      this.board.shift();
      const row = Array(COLS).fill(0);
      const blocks = 7 + Math.floor(Math.random() * 2);
      const set = new Set();
      while (set.size < blocks) set.add(Math.floor(Math.random() * COLS));
      for (let c = 0; c < COLS; c++) {
        if (set.has(c)) row[c] = 'G';
      }
      this.board.push(row);
    }
  }

  _penaltyMeteors(meteors) {
    const m = Math.max(1, Math.min(8, parseInt(meteors, 10) || 1));
    for (let i = 0; i < m; i++) {
      const big = Math.random() < 0.62;
      if (big) {
        const px = Math.floor(Math.random() * (COLS - 1));
        let py = -2;
        while (!this._garbageRectOccupied(px, py + 1, 2, 2)) py++;
        this._placeGarbageRect(px, py, 2, 2);
      } else {
        const px = Math.floor(Math.random() * COLS);
        let py = -1;
        while (!this._garbageRectOccupied(px, py + 1, 1, 1)) py++;
        this._placeGarbageRect(px, py, 1, 1);
      }
    }
  }

  _resolveCurrentAfterGarbage() {
    if (!this.current || !this.running || this.gameOver) return;
    while (this._collides(this.current.shape, this.current.x, this.current.y)) {
      this.current.y--;
      if (this.current.y < 0) {
        this._endGame();
        return;
      }
    }
    this._checkNewBlockBlocked();
  }

  _getGhostY() {
    if (!this.current) return 0;
    let gy = this.current.y;
    while (!this._collides(this.current.shape, this.current.x, gy + 1)) gy++;
    return gy;
  }

  _draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, COLS * BLOCK, ROWS * BLOCK);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.strokeRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
      }
    }

    // board
    this.board.forEach((row, r) => row.forEach((v, c) => {
      if (v) this._drawBlock(ctx, c, r, COLORS[v] || '#888', BLOCK);
    }));

    // ghost
    if (this.current && this.showGhost) {
      const gy = this._getGhostY();
      if (gy !== this.current.y) {
        const ghostColor = COLORS[this.current.type];
        this.current.shape.forEach((row, r) => row.forEach((v, c) => {
          if (v) {
            ctx.fillStyle = ghostColor + '30';
            ctx.fillRect((this.current.x + c) * BLOCK, (gy + r) * BLOCK, BLOCK - 1, BLOCK - 1);
            ctx.strokeStyle = ghostColor + '60';
            ctx.lineWidth = 1;
            ctx.strokeRect((this.current.x + c) * BLOCK, (gy + r) * BLOCK, BLOCK - 1, BLOCK - 1);
          }
        }));
      }
    }

    // current piece
    if (this.current) {
      this.current.shape.forEach((row, r) => row.forEach((v, c) => {
        if (v) this._drawBlock(ctx, this.current.x + c, this.current.y + r, COLORS[this.current.type], BLOCK);
      }));
    }

    if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.52)';
      ctx.fillRect(0, 0, COLS * BLOCK, ROWS * BLOCK);
      ctx.fillStyle = 'rgba(230,230,255,0.95)';
      ctx.font = `bold ${Math.floor(BLOCK * 1.1)}px Jua, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('일시정지', (COLS * BLOCK) / 2, (ROWS * BLOCK) / 2);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    if (this.gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, COLS * BLOCK, ROWS * BLOCK);
      ctx.fillStyle = '#ff4081';
      ctx.font = `bold ${Math.floor(BLOCK * 1.15)}px Jua, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('OVER', (COLS * BLOCK) / 2, (ROWS * BLOCK) / 2);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  _drawNext() {
    const ctx = this.nextCtx;
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, 80, 80);
    if (!this.next) return;
    const shape = this.next.shape;
    const bSize = 16;
    const ox = Math.floor((80 - shape[0].length * bSize) / 2);
    const oy = Math.floor((80 - shape.length * bSize) / 2);
    shape.forEach((row, r) => row.forEach((v, c) => {
      if (v) {
        ctx.fillStyle = COLORS[this.next.type];
        ctx.fillRect(ox + c * bSize, oy + r * bSize, bSize - 2, bSize - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(ox + c * bSize, oy + r * bSize, bSize - 2, 3);
      }
    }));
  }

  _drawBlock(ctx, col, row, color, size) {
    ctx.fillStyle = color;
    ctx.fillRect(col * size, row * size, size - 1, size - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(col * size, row * size, size - 1, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(col * size, row * size + size - 4, size - 1, 3);
  }

  _getState() {
    let current = null;
    if (this.current && !this.gameOver) {
      current = {
        type: this.current.type,
        shape: this.current.shape.map((row) => row.map((c) => c)),
        x: this.current.x,
        y: this.current.y,
      };
    }
    return {
      board: this.board,
      current,
      score: this.score,
      lines: this.lines,
      level: this.level,
      over: this.gameOver,
      combo: this.comboCount,
    };
  }

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.running || this.gameOver) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      if (this.allowPause && (e.key === 'p' || e.key === 'P')) {
        if (!this.gameOver) {
          e.preventDefault();
          this.togglePause();
        }
        return;
      }
      if (this.paused || !this.current) return;
      switch (e.key) {
        case 'ArrowLeft':
          if (!this._collides(this.current.shape, this.current.x - 1, this.current.y))
            this.current.x--;
          break;
        case 'ArrowRight':
          if (!this._collides(this.current.shape, this.current.x + 1, this.current.y))
            this.current.x++;
          break;
        case 'ArrowDown':
          if (!this._collides(this.current.shape, this.current.x, this.current.y + 1))
            this.current.y++;
          this.score += 1;
          break;
        case 'ArrowUp':
        case 'z': case 'Z':
          this._tryRotate();
          break;
        case ' ':
          e.preventDefault();
          this.hardDrop();
          break;
      }
    });
  }
}

// 상대방 보드 그리기 (작은 캔버스) — 고정 블록 + 낙하 중 미노
function drawOpponentBoard(canvas, state) {
  if (!canvas || !state) return;
  const ctx = canvas.getContext('2d');
  const B = OPP_BLOCK;
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, COLS * B, ROWS * B);
  if (!state.board) return;
  state.board.forEach((row, r) => row.forEach((v, c) => {
    if (v) {
      ctx.fillStyle = COLORS[v] || '#888';
      ctx.fillRect(c * B, r * B, B - 1, B - 1);
    }
  }));
  if (state.current && !state.over) {
    const { shape, x, y, type } = state.current;
    shape.forEach((row, r) => row.forEach((v, c) => {
      if (v) {
        ctx.fillStyle = COLORS[type] || '#888';
        ctx.fillRect((x + c) * B, (y + r) * B, B - 1, B - 1);
      }
    }));
  }
  if (state.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, COLS * B, ROWS * B);
    ctx.fillStyle = '#ff4081';
    ctx.font = `bold ${B * 1.2}px Jua, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('OVER', COLS * B / 2, ROWS * B / 2);
    ctx.textAlign = 'start';
  }
}
