// ── 클라이언트 로직 ────────────────────────────────────────
'use strict';

const socket = io();

// ── 상태 ──
let myNickname = '';
let myRoomId = null;
let myRoomData = null;
let isReady = false;
let tetris = null;
let opponentCanvases = {};
let pendingJoinRoomId = null;
const onlineHostBots = {};

function stopHostOnlineBots() {
  Object.keys(onlineHostBots).forEach((k) => {
    try { onlineHostBots[k].stop(); } catch (e) { /* ignore */ }
    delete onlineHostBots[k];
  });
  const root = document.getElementById('online-bot-root');
  if (root) root.innerHTML = '';
}

function spawnHostAiBots(playersList) {
  stopHostOnlineBots();
  if (!myRoomData || myRoomData.host !== socket.id) return;
  const root = document.getElementById('online-bot-root');
  if (!root) return;
  const lastEmit = {};
  playersList.filter((p) => p.isBot).forEach((p) => {
    const c = document.createElement('canvas');
    const cw = typeof COLS !== 'undefined' && typeof BLOCK !== 'undefined' ? COLS * BLOCK : 240;
    const ch = typeof ROWS !== 'undefined' && typeof BLOCK !== 'undefined' ? ROWS * BLOCK : 480;
    c.width = cw;
    c.height = ch;
    root.appendChild(c);
    const stage = Math.min(7, Math.max(1, parseInt(p.stage, 10) || 3));
    const bot = new AIBot(
      c,
      null,
      stage,
      (lines) => { socket.emit('game:botAttack', { botId: p.id, lines }); },
      (score, lines) => { socket.emit('game:botOver', { botId: p.id, score, lines }); },
      (state) => {
        const now = performance.now();
        if ((now - (lastEmit[p.id] || 0)) < 22) return;
        lastEmit[p.id] = now;
        socket.emit('game:botState', { botId: p.id, state });
        if (typeof drawOpponentBoard === 'function' && opponentCanvases[p.id]) {
          drawOpponentBoard(opponentCanvases[p.id], state);
        }
      },
      { thinkCapMs: 380 }
    );
    onlineHostBots[p.id] = bot;
    bot.start();
  });
}

// ── 닉네임 입력 → 로비 진입 ──
function enterLobby() {
  const nick = document.getElementById('nick-input').value.trim();
  if (!nick) return alert('닉네임을 입력해주세요!');
  myNickname = nick;
  document.getElementById('lobby-nickname').textContent = nick;
  socket.emit('lobby:join', nick);
  showScreen('lobby-screen');
}

document.getElementById('nick-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') enterLobby();
});

// ── 방 목록 ──
function refreshRooms() { socket.emit('lobby:join', myNickname); }

function renderRoomList(rooms) {
  const el = document.getElementById('room-list');
  if (!rooms.length) {
    el.innerHTML = '<div class="no-rooms">방이 없습니다. 방을 만들어보세요!</div>';
    return;
  }
  el.innerHTML = rooms.map(r => `
    <div class="room-card ${r.status === 'playing' ? 'playing' : ''} ${r.players >= r.maxPlayers ? 'full' : ''}"
         data-rid="${escHtml(r.id)}" data-locked="${r.hasPassword ? '1' : '0'}">
      <div>
        <div class="room-name">${escHtml(r.name)}${r.hasPassword ? ' <span class="lock-hint">🔒</span>' : ''}</div>
        <div class="room-info">${escHtml(r.modeLabel || 'FFA')} · ${r.players}/${r.maxPlayers}명</div>
      </div>
      <div class="room-status ${r.status === 'playing' ? 'status-playing' : 'status-waiting'}">
        ${r.status === 'playing' ? '게임중' : '대기중'}
      </div>
    </div>
  `).join('');
}

document.getElementById('room-list')?.addEventListener('click', (ev) => {
  const card = ev.target.closest('.room-card');
  if (!card || myRoomId) return;
  const rid = card.dataset.rid;
  if (!rid) return;
  if (card.dataset.locked === '1') {
    pendingJoinRoomId = rid;
    document.getElementById('join-pass-input').value = '';
    document.getElementById('join-pass-modal').classList.add('open');
  } else {
    joinRoom(rid, '');
  }
});

// ── 방 만들기 ──
function showCreateRoom() {
  document.getElementById('create-modal').classList.add('open');
  syncCreateModalModeUi();
}
function syncCreateModalModeUi() {
  const modeEl = document.getElementById('room-game-mode');
  const wrap = document.getElementById('max-players-wrap');
  if (!modeEl || !wrap) return;
  const team = modeEl.value === 'team2' || modeEl.value === 'team3';
  wrap.style.display = team ? 'none' : '';
}
document.getElementById('room-game-mode')?.addEventListener('change', syncCreateModalModeUi);
function closeModal() {
  document.getElementById('create-modal').classList.remove('open');
}
function createRoom() {
  const max = parseInt(document.getElementById('max-players-select').value, 10);
  const showGhost = document.getElementById('room-ghost-check').checked;
  const gameMode = document.getElementById('room-game-mode')?.value || 'ffa';
  const roomName = document.getElementById('room-title-input')?.value || '';
  const password = document.getElementById('room-password-input')?.value || '';
  if (typeof gameOptions !== 'undefined') gameOptions.showGhost = showGhost;
  socket.emit('room:create', { maxPlayers: max, showGhost, gameMode, roomName, password });
  closeModal();
}

function joinRoom(roomId, password) {
  if (myRoomId) return;
  socket.emit('room:join', { roomId, password: password || '' });
}

function closeJoinPassModal() {
  document.getElementById('join-pass-modal')?.classList.remove('open');
  pendingJoinRoomId = null;
}

function confirmJoinPass() {
  if (!pendingJoinRoomId) return;
  const pwd = document.getElementById('join-pass-input')?.value || '';
  joinRoom(pendingJoinRoomId, pwd);
  closeJoinPassModal();
}

window.closeJoinPassModal = closeJoinPassModal;
window.confirmJoinPass = confirmJoinPass;

// ── 방 나가기 ──
function leaveRoom() {
  stopHostOnlineBots();
  socket.emit('room:leave');
  myRoomId = null;
  myRoomData = null;
  isReady = false;
  showScreen('lobby-screen');
}

// ── 레디 토글 ──
function toggleReady() {
  isReady = !isReady;
  socket.emit('game:ready');
  const btn = document.getElementById('ready-btn');
  btn.textContent = isReady ? '레디 취소' : '레디';
  btn.style.background = isReady ? 'var(--green)' : '';
  btn.style.color = isReady ? '#000' : '';
}

// 방 쉐도우(고스트) 옵션 — 서버 `room.showGhost` 기준으로 전원 동기화
function syncRoomShowGhost(room) {
  const v = room.showGhost !== false;
  if (typeof gameOptions !== 'undefined') gameOptions.showGhost = v;

  const roomChk = document.getElementById('room-live-ghost-check');
  const gameChk = document.getElementById('game-live-ghost-check');
  const isHost = room.host === socket.id;
  [roomChk, gameChk].forEach(chk => {
    if (!chk) return;
    chk.checked = v;
    chk.disabled = !isHost;
  });

  if (tetris && typeof tetris.setShowGhost === 'function' && tetris.running) {
    tetris.setShowGhost(v);
  }
}

function onRoomGhostToggleChange(e) {
  if (!myRoomData || socket.id !== myRoomData.host) return;
  socket.emit('room:showGhost', e.target.checked);
}

document.getElementById('room-live-ghost-check')?.addEventListener('change', onRoomGhostToggleChange);
document.getElementById('game-live-ghost-check')?.addEventListener('change', onRoomGhostToggleChange);

// ── 방 UI 렌더 ──
function renderRoom(room) {
  myRoomData = room;
  document.getElementById('room-name-display').textContent = room.name;
  const modeLabel = room.gameMode === 'team2' ? '2v2 팀전' : room.gameMode === 'team3' ? '3v3 팀전' : 'FFA';
  document.getElementById('room-name-display').title = modeLabel + (room.hasPassword ? ' · 비밀방' : '');
  const playersEl = document.getElementById('room-players');
  const teams = room.teams;
  const isTeamMode = room.gameMode === 'team2' || room.gameMode === 'team3';
  const hostPanel = document.getElementById('room-host-panel');
  if (hostPanel) {
    const showHost = room.host === socket.id && room.status === 'waiting';
    hostPanel.style.display = showHost ? 'block' : 'none';
    const ffaBtn = hostPanel.querySelector('[data-add-bot-ffa]');
    const teamBtns = hostPanel.querySelectorAll('.host-bot-team-btn');
    if (ffaBtn && teamBtns.length) {
      const ffa = room.gameMode === 'ffa';
      ffaBtn.style.display = ffa ? '' : 'none';
      teamBtns.forEach((b) => { b.style.display = ffa ? 'none' : ''; });
    }
  }

  playersEl.innerHTML = room.players.map(p => {
    const isBot = p.isBot;
    const teamHtml = isTeamMode && teams && teams[p.id] !== undefined
      ? `<div class="player-team-tag ${teams[p.id] === 0 ? 'ta' : 'tb'}">${teams[p.id] === 0 ? '🅰 팀 A' : '🅱 팀 B'}</div>`
      : '';
    const teamClass = isTeamMode && teams && teams[p.id] === 0 ? 'team-a' : isTeamMode && teams && teams[p.id] === 1 ? 'team-b' : '';
    const selfPick = isTeamMode && !isBot && teams && p.id === socket.id && room.status === 'waiting'
      ? `<div class="team-pick-row">
          <button type="button" data-team-set="0" class="${teams[p.id] === 0 ? 'active-a' : ''}">팀 A</button>
          <button type="button" data-team-set="1" class="${teams[p.id] === 1 ? 'active-b' : ''}">팀 B</button>
        </div>`
      : '';
    const botControls = isBot && room.host === socket.id && room.status === 'waiting'
      ? (isTeamMode
        ? `<div class="bot-admin-row">
          <select data-bot-team-select="${escHtml(p.id)}" class="host-bot-select">
            <option value="0" ${teams && teams[p.id] === 0 ? 'selected' : ''}>팀 A</option>
            <option value="1" ${teams && teams[p.id] === 1 ? 'selected' : ''}>팀 B</option>
          </select>
          <button type="button" class="btn btn-danger btn-sm" data-bot-remove="${escHtml(p.id)}">AI 제거</button>
        </div>`
        : `<div class="bot-admin-row">
          <button type="button" class="btn btn-danger btn-sm" data-bot-remove="${escHtml(p.id)}">AI 제거</button>
        </div>`)
      : '';
    return `
    <div class="player-card ${p.ready ? 'ready' : ''} ${p.id === room.host ? 'host' : ''} ${teamClass} ${isBot ? 'is-bot' : ''}">
      <div class="player-avatar">${escHtml((p.nickname || '?').charAt(0).toUpperCase())}</div>
      <div class="player-nick">${escHtml(p.nickname)}${isBot ? ' <small>(AI)</small>' : ''}</div>
      ${teamHtml}
      ${selfPick}
      ${botControls}
      <div class="${p.ready ? 'player-ready-badge' : 'player-waiting-badge'}">
        ${p.ready ? '레디 완료' : '대기중'}
      </div>
    </div>
  `;
  }).join('');
  syncRoomShowGhost(room);
}

document.getElementById('room-players')?.addEventListener('click', (e) => {
  const ts = e.target.closest('[data-team-set]');
  if (ts && myRoomData?.status === 'waiting') {
    socket.emit('room:setTeam', { team: parseInt(ts.dataset.teamSet, 10) });
    return;
  }
  const rm = e.target.closest('[data-bot-remove]');
  if (rm && myRoomData?.host === socket.id) {
    socket.emit('room:removeBot', { botId: rm.dataset.botRemove });
  }
});

document.getElementById('room-players')?.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-bot-team-select]');
  if (!sel || myRoomData?.host !== socket.id) return;
  socket.emit('room:setBotTeam', { botId: sel.dataset.botTeamSelect, team: parseInt(sel.value, 10) });
});

document.getElementById('room-host-panel')?.addEventListener('click', (e) => {
  const ffaAdd = e.target.closest('[data-add-bot-ffa]');
  if (ffaAdd && myRoomData?.host === socket.id) {
    const stage = parseInt(document.getElementById('room-bot-stage')?.value, 10) || 3;
    socket.emit('room:addBot', { team: 0, stage });
    return;
  }
  const add = e.target.closest('[data-add-bot]');
  if (!add || myRoomData?.host !== socket.id) return;
  const team = parseInt(add.dataset.addBot, 10);
  const stage = parseInt(document.getElementById('room-bot-stage')?.value, 10) || 3;
  socket.emit('room:addBot', { team, stage });
});

// ── 랭킹 렌더 ──
function renderRanking(data) {
  const el = document.getElementById('ranking-list');
  if (!data.length) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:8px;">아직 기록 없음</div>';
    return;
  }
  el.innerHTML = data.map((r, i) => `
    <div class="rank-item rank-${i + 1}">
      <div class="rank-num">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
      <div class="rank-nick">${escHtml(r.nickname)}</div>
      <div class="rank-score">${r.score.toLocaleString()}</div>
    </div>
  `).join('');
}

// ── 채팅 ──
function addChat(containerId, nickname, msg, isSystem = false) {
  const el = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isSystem ? ' system' : '');
  div.innerHTML = isSystem
    ? escHtml(msg)
    : `<span class="nick">${escHtml(nickname)}</span> ${escHtml(msg)}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function sendLobbyChat() {
  const input = document.getElementById('lobby-chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat:lobby', msg);
  input.value = '';
}

function sendRoomChat() {
  const input = document.getElementById('room-chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat:room', msg);
  input.value = '';
}

function createOppPanelWrap(p, isMate) {
  const wrap = document.createElement('div');
  wrap.className = 'opponent-panel-wrap' + (isMate ? ' teammate' : '');
  wrap.id = `opp-wrap-${p.id}`;
  const cw = COLS * OPP_BLOCK;
  const ch = ROWS * OPP_BLOCK;
  wrap.innerHTML = `
    <div class="opponent-panel">
      <div class="player-label">${escHtml(p.nickname)}${p.isBot ? ' 🤖' : ''}</div>
      <canvas class="opp-canvas" id="opp-${p.id}" width="${cw}" height="${ch}"></canvas>
    </div>`;
  opponentCanvases[p.id] = wrap.querySelector('canvas');
  return wrap;
}

/** 상대 미니맵: 윗줄 최대 2칸, 아랫줄 나머지(최대 3칸 느낌으로 배치) */
function appendOpponentTwoRowBlock(panel, label, sectionClass, list, isMate) {
  if (!list.length) return;
  const sec = document.createElement('div');
  sec.className = 'opp-section' + (sectionClass ? ' ' + sectionClass : '');
  if (label) {
    const lb = document.createElement('div');
    lb.className = 'opp-section-label';
    lb.textContent = label;
    sec.appendChild(lb);
  }
  const top = document.createElement('div');
  top.className = 'opp-row-top';
  const bot = document.createElement('div');
  bot.className = 'opp-row-btm';
  const topCount = Math.min(2, list.length);
  for (let i = 0; i < topCount; i++) top.appendChild(createOppPanelWrap(list[i], isMate));
  for (let i = topCount; i < list.length; i++) bot.appendChild(createOppPanelWrap(list[i], isMate));
  sec.appendChild(top);
  if (list.length > topCount) sec.appendChild(bot);
  panel.appendChild(sec);
}

// ── 게임 시작 ──
function startGame(players, showGhost) {
  const ghostOpt = showGhost !== false;
  let lastStateEmit = 0;
  const NET_MS = 22;

  showScreen('game-screen');
  document.getElementById('my-label').textContent = myNickname;
  document.getElementById('game-room-name').textContent = myRoomData?.name || '';

  opponentCanvases = {};
  const oppPanel = document.getElementById('opponents-panel');
  oppPanel.innerHTML = '';

  const teams = myRoomData?.teams;
  const myTeam = teams?.[socket.id];
  const gm = myRoomData?.gameMode;
  const isTeamGame = gm === 'team2' || gm === 'team3';
  const others = players.filter((p) => p.id !== socket.id);

  if (isTeamGame && teams && myTeam !== undefined) {
    const enemies = others.filter((p) => teams[p.id] !== myTeam);
    const mates = others.filter((p) => teams[p.id] === myTeam);
    appendOpponentTwoRowBlock(oppPanel, '적 팀', 'opp-section-enemy', enemies, false);
    appendOpponentTwoRowBlock(oppPanel, '아군', 'opp-section-mate', mates, true);
  } else {
    appendOpponentTwoRowBlock(oppPanel, '', '', others, false);
  }

  const myCanvas = document.getElementById('my-canvas');
  const nextCanvas = document.getElementById('next-canvas');

  if (tetris) tetris.stop();
  tetris = new TetrisGame(
    myCanvas,
    nextCanvas,
    (state) => {
      document.getElementById('score-display').textContent = state.score.toLocaleString();
      document.getElementById('lines-display').textContent = state.lines;
      document.getElementById('level-display').textContent = state.level;
      const ms = document.getElementById('online-m-score'); if (ms) ms.textContent = state.score.toLocaleString();
      const ml = document.getElementById('online-m-lines'); if (ml) ml.textContent = state.lines;
      const mv = document.getElementById('online-m-level'); if (mv) mv.textContent = state.level;
      const now = performance.now();
      if (now - lastStateEmit >= NET_MS) {
        socket.emit('game:state', state);
        lastStateEmit = now;
      }
    },
    (lines) => {
      socket.emit('game:attack', { lines });
    },
    (score, lines) => {
      socket.emit('game:myover', { score, lines });
    },
    { showGhost: ghostOpt }
  );
  tetris.start();
  if (myRoomData) syncRoomShowGhost(myRoomData);
  spawnHostAiBots(players);
}

function pulseOppFx(socketId, cls) {
  const el = document.getElementById(`opp-wrap-${socketId}`);
  if (!el) return;
  el.classList.remove('panel-fx-out', 'panel-fx-in');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 450);
}

// ── 게임 오버 처리 ──
function showGameOver(payload) {
  const { winnerId, winnerNick, reason, isTeamGame, winnerTeam } = payload;
  stopHostOnlineBots();
  if (tetris) tetris.stop();
  const overlay = document.getElementById('gameover-overlay');
  const title = document.getElementById('gameover-title');
  const info = document.getElementById('gameover-info');

  const myTeam = myRoomData?.teams?.[socket.id];
  const teamWon = isTeamGame && winnerTeam === myTeam;

  if (teamWon || (!isTeamGame && winnerId === socket.id)) {
    title.textContent = '🏆 WIN!';
    title.style.color = 'var(--gold)';
    info.textContent = isTeamGame ? '팀이 승리했습니다!' : '축하합니다! 게임에서 승리했습니다!';
  } else if (winnerId === null && !isTeamGame) {
    title.textContent = 'DRAW';
    title.style.color = 'var(--text-dim)';
    info.textContent = '무승부';
  } else {
    title.textContent = 'GAME OVER';
    title.style.color = 'var(--accent2)';
    if (isTeamGame) {
      info.textContent = winnerNick + (reason ? ` (${reason})` : '');
    } else {
      info.textContent = `${winnerNick}님이 승리했습니다.` + (reason ? ` (${reason})` : '');
    }
  }
  overlay.classList.add('show');
}

function backToRoom() {
  document.getElementById('gameover-overlay').classList.remove('show');
  isReady = false;
  const btn = document.getElementById('ready-btn');
  if (btn) { btn.textContent = '레디'; btn.style.background = ''; btn.style.color = ''; }
  if (myRoomData) {
    showScreen('room-screen');
    syncRoomShowGhost(myRoomData);
  } else {
    showScreen('lobby-screen');
  }
}

// flashAttack은 index.html 인라인 스크립트에 정의됨

// ── 유틸 ──
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizePenaltyPayload(p) {
  if (!p) return { kind: 'rows', lines: 1 };
  if (p.kind) return p;
  if (p.lines != null) return { kind: 'rows', lines: p.lines };
  return { kind: 'rows', lines: 1 };
}

function penaltyFlashIntensity(pen) {
  if (!pen) return 1;
  const p = pen.power || 1;
  switch (pen.kind) {
    case 'shower':
      return Math.min(12, 4 + Math.floor((pen.blocks || 12) / 4));
    case 'meteor':
      return Math.min(10, 2 + (pen.meteors || 1) * 2);
    case 'columns':
      return Math.min(10, 1 + (pen.cols || 2) * (pen.depth || 3));
    case 'split':
    case 'cheese':
    case 'rows':
    default:
      return Math.max(1, pen.lines || p);
  }
}

function resolveAttackFxAnchor(id) {
  if (id === socket.id) return document.querySelector('#game-screen .board-wrap');
  return document.getElementById('opp-wrap-' + id);
}

function ensureAttackFxRoot() {
  let root = document.getElementById('attack-fx-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'attack-fx-root';
    document.body.appendChild(root);
  }
  return root;
}

function quadAttackPoint(p0, pc, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * pc.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * pc.y + t * t * p1.y,
  };
}

function runAttackTrail(fx) {
  const gs = document.getElementById('game-screen');
  if (!gs?.classList.contains('active')) return;
  const { from, to, lines, kind, fromNick, toNick } = fx;
  const fromEl = resolveAttackFxAnchor(from);
  const toEl = resolveAttackFxAnchor(to);
  if (!fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const cx1 = a.left + a.width / 2;
  const cy1 = a.top + a.height / 2;
  const cx2 = b.left + b.width / 2;
  const cy2 = b.top + b.height / 2;
  const rdx = cx2 - cx1;
  const rdy = cy2 - cy1;
  const dist = Math.max(72, Math.hypot(rdx, rdy));
  const mx = (cx1 + cx2) / 2;
  const my = (cy1 + cy2) / 2;
  const nx = -rdy / dist;
  const ny = rdx / dist;
  const bulge = Math.min(260, dist * 0.5);
  const sideFlip = ((String(from).length + String(to).length + (lines | 0)) % 2 === 0) ? 1 : -1;
  const pc = { x: mx + nx * bulge * sideFlip, y: my + ny * bulge * sideFlip };
  const p0 = { x: cx1, y: cy1 };
  const p1 = { x: cx2, y: cy2 };
  const dPath = `M ${p0.x} ${p0.y} Q ${pc.x} ${pc.y} ${p1.x} ${p1.y}`;

  const root = ensureAttackFxRoot();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'attack-curve-svg');
  const pathGlow = document.createElementNS(ns, 'path');
  pathGlow.setAttribute('d', dPath);
  pathGlow.setAttribute('class', 'attack-curve-glow path-kind-' + (kind || 'rows'));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', dPath);
  path.setAttribute('class', 'attack-curve-path path-kind-' + (kind || 'rows'));
  svg.appendChild(pathGlow);
  svg.appendChild(path);
  root.appendChild(svg);

  const orb = document.createElement('div');
  orb.className = 'attack-orb-wrap orb-kind-' + (kind || 'rows');
  root.appendChild(orb);

  const burst = document.createElement('div');
  burst.className = 'attack-burst';
  burst.style.left = cx2 - 48 + 'px';
  burst.style.top = cy2 - 48 + 'px';
  burst.innerHTML = `<span class="burst-ring"></span><span class="burst-core"></span>
    <span class="burst-label">${escHtml(fromNick || '')} → ${escHtml(toNick || '')}</span>`;
  root.appendChild(burst);

  requestAnimationFrame(() => {
    let pathLen = 0;
    try {
      pathLen = path.getTotalLength();
    } catch (e) {
      pathLen = dist * 1.4;
    }
    path.style.strokeDasharray = String(pathLen);
    path.style.strokeDashoffset = String(pathLen);
    pathGlow.style.strokeDasharray = String(pathLen);
    pathGlow.style.strokeDashoffset = String(pathLen);

    const t0 = performance.now();
    const dur = Math.min(980, 460 + dist * 0.62);
    let lastTrail = 0;
    function step(now) {
      const raw = Math.min(1, (now - t0) / dur);
      const drawT = 1 - Math.pow(1 - raw, 1.22);
      const orbT = 1 - Math.pow(1 - raw, 2.05);
      const off = String(pathLen * (1 - drawT));
      path.style.strokeDashoffset = off;
      pathGlow.style.strokeDashoffset = off;
      const pos = quadAttackPoint(p0, pc, p1, orbT);
      orb.style.left = pos.x + 'px';
      orb.style.top = pos.y + 'px';
      if (raw - lastTrail > 0.035) {
        lastTrail = raw;
        const dot = document.createElement('div');
        dot.className = 'attack-trail-dot';
        dot.style.left = pos.x + 'px';
        dot.style.top = pos.y + 'px';
        root.appendChild(dot);
        setTimeout(() => dot.remove(), 480);
      }
      if (raw < 1) requestAnimationFrame(step);
      else {
        path.style.strokeDashoffset = '0';
        pathGlow.style.strokeDashoffset = '0';
      }
    }
    requestAnimationFrame(step);
  });

  setTimeout(() => {
    svg.remove();
    orb.remove();
    burst.remove();
  }, 1100);
}

function runIncomingPenaltyVfx(penalty) {
  const bw = document.querySelector('#game-screen .board-wrap');
  if (!bw) return;
  bw.classList.remove('penalty-hit-vfx');
  void bw.offsetWidth;
  bw.classList.add('penalty-hit-vfx');
  const k = (penalty && penalty.kind) || 'rows';
  bw.setAttribute('data-pen-kind', k);
  setTimeout(() => {
    bw.classList.remove('penalty-hit-vfx');
    bw.removeAttribute('data-pen-kind');
  }, 950);
}

// ── 소켓 이벤트 ──
socket.on('lobby:rooms', renderRoomList);
socket.on('ranking:update', renderRanking);

socket.on('room:joined', (room) => {
  myRoomId = room.id;
  document.getElementById('join-pass-modal')?.classList.remove('open');
  pendingJoinRoomId = null;
  renderRoom(room);
  // 방마다 채팅 리셋
  document.getElementById('room-chat').innerHTML = '';
  showScreen('room-screen');
  addChat('room-chat', '', '방에 입장했습니다.', true);
});

socket.on('room:update', (room) => {
  myRoomData = room;
  renderRoom(room);
});

socket.on('game:start', ({ players, showGhost, gameMode, teams }) => {
  if (myRoomData) {
    myRoomData.showGhost = showGhost !== false;
    if (gameMode) myRoomData.gameMode = gameMode;
    myRoomData.teams = teams;
  }
  startGame(players, showGhost);
});

socket.on('game:opponent', ({ id, state }) => {
  drawOpponentBoard(opponentCanvases[id], state);
});

socket.on('game:attackFx', (fx) => {
  const { from, to, lines, kind } = fx;
  pulseOppFx(from, 'panel-fx-out');
  pulseOppFx(to, 'panel-fx-in');
  runAttackTrail(fx);
  const gs = document.getElementById('game-screen');
  if (gs?.classList.contains('active')) {
    gs.classList.remove('screen-quake');
    void gs.offsetWidth;
    gs.classList.add('screen-quake');
    setTimeout(() => gs.classList.remove('screen-quake'), 920);
  }
  const bw = document.querySelector('#game-screen .board-wrap');
  if (from === socket.id && bw) {
    bw.classList.remove('board-fx-out');
    void bw.offsetWidth;
    bw.classList.add('board-fx-out');
    setTimeout(() => bw.classList.remove('board-fx-out'), 520);
  }
  if (to === socket.id && bw) {
    bw.classList.remove('board-fx-in-hit');
    void bw.offsetWidth;
    bw.classList.add('board-fx-in-hit');
    setTimeout(() => bw.classList.remove('board-fx-in-hit'), 480);
  }
  if (typeof flashAttack === 'function' && to !== socket.id && from !== socket.id) {
    flashAttack(lines, { subtle: true, kind });
  }
});

socket.on('game:garbage', (payload) => {
  const pen = normalizePenaltyPayload(payload);
  if (tetris && tetris.running) {
    runIncomingPenaltyVfx(pen);
    if (typeof flashAttack === 'function') flashAttack(penaltyFlashIntensity(pen), { kind: pen.kind, incoming: true });
    tetris.applyPenalty(pen);
    const gs = document.getElementById('game-screen');
    if (gs) {
      gs.classList.add('screen-shake');
      gs.classList.add('screen-shake-hard');
      setTimeout(() => {
        gs.classList.remove('screen-shake');
        gs.classList.remove('screen-shake-hard');
      }, 520);
    }
  }
});

socket.on('game:garbageBot', (payload) => {
  if (myRoomData?.host !== socket.id) return;
  const pen = normalizePenaltyPayload(payload);
  const bot = onlineHostBots[payload.botId];
  if (bot && typeof bot.applyPenalty === 'function') {
    runIncomingPenaltyVfx(pen);
    if (typeof flashAttack === 'function') flashAttack(penaltyFlashIntensity(pen), { kind: pen.kind, incoming: true });
    bot.applyPenalty(pen);
  }
});

socket.on('game:over', (payload) => {
  showGameOver(payload);
});

socket.on('chat:lobby', ({ nickname, msg }) => {
  addChat('lobby-chat', nickname, msg);
});

socket.on('chat:room', ({ nickname, msg }) => {
  addChat('room-chat', nickname, msg);
});

socket.on('error', (msg) => {
  alert(msg);
});

// nick-screen은 HTML에서 active 클래스로 초기 표시됨
