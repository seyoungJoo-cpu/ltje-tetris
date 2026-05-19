// ── AI 테트리스 엔진 ─────────────────────────────────────────
// 난이도별로 다른 전략 파라미터를 사용하는 AI 봇
'use strict';

// AI 반응·이동 간격 배율 (1보다 클수록 느림)
const AI_TEMPO_SCALE = 3.0;

// AI 난이도 프로파일
const AI_PROFILES = {
  // 스테이지 1~2: 멍청하게 플레이 (랜덤 실수 많음)
  1: { thinkDelay: 1800, mistakeRate: 0.55, lookahead: false, name: '왕초보봇', emoji: '🤖' },
  2: { thinkDelay: 1400, mistakeRate: 0.40, lookahead: false, name: '초보봇',   emoji: '🤖' },
  // 스테이지 3~4: 기본기 있음
  3: { thinkDelay: 1000, mistakeRate: 0.28, lookahead: false, name: '중수봇',   emoji: '🤖' },
  4: { thinkDelay:  700, mistakeRate: 0.18, lookahead: false, name: '고수봇',   emoji: '🦾' },
  // 스테이지 5~6: 잘함
  5: { thinkDelay:  450, mistakeRate: 0.10, lookahead: true,  name: '강자봇',   emoji: '🦾' },
  6: { thinkDelay:  280, mistakeRate: 0.05, lookahead: true,  name: '마스터봇', emoji: '💀' },
  // 스테이지 7+: 거의 완벽
  7: { thinkDelay:  150, mistakeRate: 0.02, lookahead: true,  name: '악마봇',   emoji: '💀' },
};

function getAIProfile(stage) {
  const key = Math.min(stage, 7);
  return AI_PROFILES[key];
}

// ── AI 평가 함수 (Dellacherie 휴리스틱) ──────────────────────
class AIEvaluator {
  // 보드 높이 합계
  static aggregateHeight(board) {
    let total = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (board[r][c]) { total += (ROWS - r); break; }
      }
    }
    return total;
  }

  // 클리어 가능한 줄 수
  static completeLines(board) {
    return board.filter(row => row.every(v => v !== 0)).length;
  }

  // 구멍 수 (블록 아래에 빈 칸)
  static holes(board) {
    let count = 0;
    for (let c = 0; c < COLS; c++) {
      let found = false;
      for (let r = 0; r < ROWS; r++) {
        if (board[r][c]) found = true;
        else if (found) count++;
      }
    }
    return count;
  }

  // 울퉁불퉁함 (인접 열 높이 차이 합)
  static bumpiness(board) {
    const heights = [];
    for (let c = 0; c < COLS; c++) {
      let h = 0;
      for (let r = 0; r < ROWS; r++) {
        if (board[r][c]) { h = ROWS - r; break; }
      }
      heights.push(h);
    }
    let bump = 0;
    for (let i = 0; i < heights.length - 1; i++) {
      bump += Math.abs(heights[i] - heights[i + 1]);
    }
    return bump;
  }

  // 종합 점수 (높을수록 좋음)
  static evaluate(board) {
    const h = this.aggregateHeight(board);
    const l = this.completeLines(board);
    const o = this.holes(board);
    const b = this.bumpiness(board);
    return -0.510066 * h + 0.760666 * l - 0.35663 * o - 0.184483 * b;
  }
}

// ── AI 봇 클래스 ─────────────────────────────────────────────
class AIBot {
  constructor(canvas, nextCanvas, stage, onAttack, onGameOver, onStateChange, botOpts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;
    this.stage = stage;
    this.profile = getAIProfile(stage);
    this.onAttack = onAttack;
    this.onGameOver = onGameOver;
    this.onStateChange = onStateChange;
    this.botOpts = botOpts || {};
    this.thinkCapMs = this.botOpts.thinkCapMs != null ? this.botOpts.thinkCapMs : null;
    this.onLock = typeof this.botOpts.onLock === 'function' ? this.botOpts.onLock : null;
    this.onLineClear = typeof this.botOpts.onLineClear === 'function' ? this.botOpts.onLineClear : null;

    this.board = this._emptyBoard();
    this.current = null;
    this.next = null;
    this.score = 0;
    this.lines = 0;
    this.level = stage; // AI는 스테이지 레벨로 시작
    this.running = false;
    this.gameOver = false;
    this.bag = [];
    this.thinkTimer = null;
    this.targetMove = null; // { x, rotations }
    this.movePhase = 'think';
    this.pendingRots = 0;
    this.pendingX = 0;
    this.moveStepAccum = 0;
    this.animFrame = null;
    this.lastTime = 0;
    this.dropAccum = 0;
    this.comboCount = 0;
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
    return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
  }

  start() {
    this.board = this._emptyBoard();
    this.score = 0; this.lines = 0;
    this.level = this.stage;
    this.gameOver = false; this.running = true;
    this.bag = [];
    this.movePhase = 'think';
    this.pendingRots = 0;
    this.pendingX = 0;
    this.moveStepAccum = 0;
    this.dropAccum = 0;
    this.comboCount = 0;
    this.next = this._spawnPiece(this._getFromBag());
    this._spawn();
    this.lastTime = performance.now();
    this.animFrame = requestAnimationFrame(this._loop.bind(this));
  }

  stop() {
    this.running = false;
    if (this.thinkTimer) {
      clearTimeout(this.thinkTimer);
      this.thinkTimer = null;
    }
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  _effectiveThinkDelay() {
    const d = this.profile.thinkDelay * AI_TEMPO_SCALE;
    if (this.thinkCapMs == null) return Math.round(d);
    return Math.round(Math.min(d, this.thinkCapMs * AI_TEMPO_SCALE));
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
    if (this.gameOver) return;
    this.movePhase = 'think';
    this.dropAccum = 0;
    this.moveStepAccum = 0;
    if (this.thinkTimer) clearTimeout(this.thinkTimer);
    this.thinkTimer = setTimeout(() => this._think(), this._effectiveThinkDelay());
  }

  // ── AI 사고 ──
  _think() {
    if (!this.running || this.gameOver) return;

    // 실수 확률
    if (Math.random() < this.profile.mistakeRate) {
      // 랜덤 배치 (실수)
      const rotCount = Math.floor(Math.random() * 4);
      let shape = this.current.shape;
      for (let i = 0; i < rotCount; i++) shape = this._rotate(shape);
      const maxX = COLS - shape[0].length;
      const rx = Math.floor(Math.random() * (maxX + 1));
      this.targetMove = { x: rx, rotations: rotCount };
    } else {
      // 최적 배치 계산
      this.targetMove = this._findBestMove();
    }

    this.pendingRots = this.targetMove.rotations;
    this.pendingX = this.targetMove.x;
    this.movePhase = 'adjust';
    this.moveStepAccum = 0;
  }

  _findBestMove() {
    let bestScore = -Infinity;
    let bestMove = { x: this.current.x, rotations: 0 };

    for (let rot = 0; rot < 4; rot++) {
      let shape = this.current.shape;
      for (let i = 0; i < rot; i++) shape = this._rotate(shape);

      for (let x = -1; x < COLS; x++) {
        if (this._collides(shape, x, 0)) continue;
        // 드롭 시뮬레이션
        let y = 0;
        while (!this._collides(shape, x, y + 1)) y++;
        const simBoard = this._simulateLock(shape, x, y);
        const score = AIEvaluator.evaluate(simBoard);
        if (score > bestScore) {
          bestScore = score;
          bestMove = { x, rotations: rot };
        }
      }
    }
    return bestMove;
  }

  _simulateLock(shape, px, py) {
    const b = this.board.map(r => [...r]);
    shape.forEach((row, r) => row.forEach((v, c) => {
      if (v && py + r >= 0) b[py + r][px + c] = 'X';
    }));
    // 줄 제거
    for (let r = ROWS - 1; r >= 0; r--) {
      if (b[r].every(v => v !== 0)) {
        b.splice(r, 1);
        b.unshift(Array(COLS).fill(0));
        r++;
      }
    }
    return b;
  }

  _doRotate() {
    const rotated = this._rotate(this.current.shape);
    if (!this._collides(rotated, this.current.x, this.current.y)) {
      this.current.shape = rotated;
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
      this.level = this.stage + Math.floor(this.lines / 10);
      let attackPower = 0;
      if (cleared >= 2) attackPower += cleared - 1;
      if (cleared >= 1 && this.comboCount >= 2) {
        attackPower += this.comboCount - 1;
      }
      attackPower = Math.min(12, attackPower);
      if (attackPower > 0) this.onAttack(attackPower);
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

  _hardDropPiece() {
    if (!this.running || !this.current) return;
    while (!this._collides(this.current.shape, this.current.x, this.current.y + 1)) {
      this.current.y++;
    }
    this._lock();
  }

  _collides(shape, px, py) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const nr = py + r;
        const nc = px + c;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return true;
        if (this.board[nr][nc]) return true;
      }
    }
    return false;
  }

  _rotate(shape) {
    const N = shape.length, M = shape[0].length;
    const rotated = Array.from({ length: M }, () => Array(N).fill(0));
    for (let r = 0; r < N; r++)
      for (let c = 0; c < M; c++)
        rotated[c][N - 1 - r] = shape[r][c];
    return rotated;
  }

  _loop(ts) {
    if (!this.running || this.gameOver) return;
    const delta = Math.min(90, ts - this.lastTime);
    this.lastTime = ts;

    if (this.movePhase === 'adjust') {
      this.moveStepAccum += delta;
      const stepMs = (Math.max(18, 56 - this.stage * 5)) * AI_TEMPO_SCALE;
      while (this.movePhase === 'adjust' && this.moveStepAccum >= stepMs) {
        this.moveStepAccum -= stepMs;
        if (this.pendingRots > 0) {
          this._doRotate();
          this.pendingRots--;
          continue;
        }
        if (this.current.x < this.pendingX) {
          const nx = this.current.x + 1;
          if (!this._collides(this.current.shape, nx, this.current.y)) this.current.x = nx;
          else break;
          continue;
        }
        if (this.current.x > this.pendingX) {
          const nx = this.current.x - 1;
          if (!this._collides(this.current.shape, nx, this.current.y)) this.current.x = nx;
          else break;
          continue;
        }
        this._hardDropPiece();
        break;
      }
    }

    this._checkNewBlockBlocked();
    this._draw();
    if (this.onStateChange) this.onStateChange(this._getState());
    this.animFrame = requestAnimationFrame(this._loop.bind(this));
  }

  _draw() {
    const ctx = this.ctx;
    const B = Math.max(1, Math.floor((this.canvas && this.canvas.width) / COLS)) || OPP_BLOCK;
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, COLS * B, ROWS * B);
    this.board.forEach((row, r) => row.forEach((v, c) => {
      if (v) {
        ctx.fillStyle = COLORS[v] || '#888';
        ctx.fillRect(c * B, r * B, B - 1, B - 1);
      }
    }));
    // 현재 피스 표시
    if (this.current) {
      ctx.fillStyle = COLORS[this.current.type] + 'cc';
      this.current.shape.forEach((row, r) => row.forEach((v, c) => {
        if (v) ctx.fillRect((this.current.x + c) * B, (this.current.y + r) * B, B - 1, B - 1);
      }));
    }
    if (this.gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, COLS * B, ROWS * B);
      ctx.fillStyle = '#ff4081';
      ctx.font = `bold ${B * 1.2}px Jua, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('OVER', COLS * B / 2, ROWS * B / 2);
      ctx.textAlign = 'start';
    }
  }

  _drawNext() {
    if (!this.nextCtx) return;
    const ctx = this.nextCtx;
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, 60, 60);
    if (!this.next) return;
    const shape = this.next.shape;
    const bSize = 12;
    const ox = Math.floor((60 - shape[0].length * bSize) / 2);
    const oy = Math.floor((60 - shape.length * bSize) / 2);
    shape.forEach((row, r) => row.forEach((v, c) => {
      if (v) {
        ctx.fillStyle = COLORS[this.next.type];
        ctx.fillRect(ox + c * bSize, oy + r * bSize, bSize - 2, bSize - 2);
      }
    }));
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
    };
  }
}

(function copyPenaltyMethodsToAIBot() {
  if (typeof TetrisGame === 'undefined') return;
  const names = [
    'applyPenalty', 'addGarbage', '_garbageRectOccupied', '_placeGarbageRect',
    '_penaltyRows', '_penaltyCheese', '_penaltyMeteors', '_resolveCurrentAfterGarbage',
    '_checkNewBlockBlocked', '_cannotSpawnNewBlock', '_canSpawnTypeAtEntry',
    '_isCurrentPieceTrapped', '_hasCellsAboveCeiling', '_pieceFitsAt',
  ];
  names.forEach((n) => { AIBot.prototype[n] = TetrisGame.prototype[n]; });
})();

function _stopAIBotLoops(bot) {
  if (bot.thinkTimer) {
    clearTimeout(bot.thinkTimer);
    bot.thinkTimer = null;
  }
  if (bot.animFrame) {
    cancelAnimationFrame(bot.animFrame);
    bot.animFrame = null;
  }
}

AIBot.prototype._endGame = function aiEndGame() {
  TetrisGame.prototype._endGame.call(this);
  _stopAIBotLoops(this);
};

/** 훼방으로 눌려 게임오버될 때도 think 타이머·rAF를 끊어 onGameOver 이후 유령 루프 방지 */
AIBot.prototype._resolveCurrentAfterGarbage = function aiResolveAfterGarbage() {
  TetrisGame.prototype._resolveCurrentAfterGarbage.call(this);
  if (this.gameOver) _stopAIBotLoops(this);
};
