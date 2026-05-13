// ── 테트리스 게임 엔진 ────────────────────────────────────────
'use strict';

const COLS = 10, ROWS = 20;
const BLOCK = 24; // my canvas block size
const OPP_BLOCK = 10; // opponent canvas block size

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
    this.showGhost = options.showGhost !== false; // 기본값 true

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

    this._bindKeys();
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
    this.bag = [];
    this.next = this._spawnPiece(this._getFromBag());
    this._spawn();
    this.lastTime = performance.now();
    requestAnimationFrame(this._loop.bind(this));
  }

  stop() { this.running = false; }

  _spawn() {
    this.current = this.next;
    this.next = this._spawnPiece(this._getFromBag());
    if (this._collides(this.current.shape, this.current.x, this.current.y)) {
      this.running = false;
      this.gameOver = true;
      this.onGameOver(this.score, this.lines);
    }
    this._drawNext();
  }

  _loop(ts) {
    if (!this.running) return;
    const delta = ts - this.lastTime;
    this.lastTime = ts;
    this.dropAccum += delta;
    const speed = LEVEL_SPEED[Math.min(this.level - 1, LEVEL_SPEED.length - 1)];
    if (this.dropAccum >= speed) {
      this._drop();
      this.dropAccum = 0;
    }
    this._draw();
    this.onStateChange(this._getState());
    requestAnimationFrame(this._loop.bind(this));
  }

  _drop() {
    if (this._collides(this.current.shape, this.current.x, this.current.y + 1)) {
      this._lock();
    } else {
      this.current.y++;
    }
  }

  _lock() {
    const { shape, x, y, type } = this.current;
    shape.forEach((row, r) => row.forEach((v, c) => {
      if (v) this.board[y + r][x + c] = type;
    }));
    const cleared = this._clearLines();
    if (cleared > 0) {
      this.score += (SCORE_TABLE[cleared] || 0) * this.level;
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10) + 1;
      if (cleared >= 2) this.onAttack(cleared - 1);
    }
    this._spawn();
  }

  _clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every(c => c !== 0)) {
        this.board.splice(r, 1);
        this.board.unshift(Array(COLS).fill(0));
        cleared++;
        r++;
      }
    }
    return cleared;
  }

  _collides(shape, px, py) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nr = py + r, nc = px + c;
        if (nr >= ROWS || nc < 0 || nc >= COLS) return true;
        if (nr >= 0 && this.board[nr][nc]) return true;
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
    while (!this._collides(this.current.shape, this.current.x, this.current.y + 1)) {
      this.current.y++;
      this.score += 2;
    }
    this._lock();
  }

  addGarbage(lines) {
    const gapCol = Math.floor(Math.random() * COLS);
    for (let i = 0; i < lines; i++) {
      this.board.shift();
      const row = Array(COLS).fill('G');
      row[gapCol] = 0;
      this.board.push(row);
    }
    // 현재 피스가 겹치면 올려줌
    while (this._collides(this.current.shape, this.current.x, this.current.y)) {
      this.current.y--;
      if (this.current.y < 0) {
        this.running = false;
        this.gameOver = true;
        this.onGameOver(this.score, this.lines);
        return;
      }
    }
  }

  _getGhostY() {
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
    return {
      board: this.board,
      score: this.score,
      lines: this.lines,
      level: this.level,
      over: this.gameOver,
    };
  }

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.running) return;
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

// 상대방 보드 그리기 (작은 캔버스)
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
  if (state.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, COLS * B, ROWS * B);
    ctx.fillStyle = '#ff4081';
    ctx.font = `bold ${B * 1.2}px Jua, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('OVER', COLS * B / 2, ROWS * B / 2);
  }
}
