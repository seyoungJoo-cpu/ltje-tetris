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
    const wrap = document.createElement('div');
    wrap.className = 'online-bot-board-wrap';
    wrap.dataset.botId = String(p.id);
    wrap.style.cssText = 'position:relative;display:inline-block;line-height:0;';
    wrap.appendChild(c);
    root.appendChild(wrap);
    const ps = parseInt(p.stage, 10);
    const stage = Number.isFinite(ps) && ps >= 1 && ps <= 7 ? ps : (3 + Math.floor(Math.random() * 4));
    const bot = new AIBot(
      c,
      null,
      stage,
      (lines) => { socket.emit('game:botAttack', { botId: p.id, lines }); },
      (score, lines) => {
        socket.emit('game:botOver', { botId: p.id, score, lines });
        if (typeof bot._getState === 'function') {
          const st = bot._getState();
          socket.emit('game:botState', { botId: p.id, state: st });
          if (typeof drawOpponentBoard === 'function' && opponentCanvases[p.id]) {
            drawOpponentBoard(opponentCanvases[p.id], st);
          }
        }
      },
      (state) => {
        const now = performance.now();
        if (!state.over && (now - (lastEmit[p.id] || 0)) < 22) return;
        lastEmit[p.id] = now;
        socket.emit('game:botState', { botId: p.id, state });
        if (typeof drawOpponentBoard === 'function' && opponentCanvases[p.id]) {
          drawOpponentBoard(opponentCanvases[p.id], state);
        }
      },
      { thinkCapMs: 380, onLock: (cleared) => { socket.emit('game:botLock', { botId: p.id, cleared }); } }
    );
    onlineHostBots[p.id] = bot;
    bot.start();
  });
}

function pickBotStageForRoom() {
  const raw = document.getElementById('room-bot-stage')?.value;
  if (raw === 'random' || raw === '' || raw == null) {
    return 3 + Math.floor(Math.random() * 4);
  }
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 7) return n;
  return 3 + Math.floor(Math.random() * 4);
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

// ── 방 나가기 / 로비로 ──
function leaveToLobby() {
  stopHostOnlineBots();
  if (tetris) tetris.stop();
  clearIncomingThreatUi();
  document.getElementById('gameover-overlay')?.classList.remove('show');
  socket.emit('room:leave');
  myRoomId = null;
  myRoomData = null;
  isReady = false;
  const btn = document.getElementById('ready-btn');
  if (btn) {
    btn.textContent = '레디';
    btn.style.background = '';
    btn.style.color = '';
  }
  showScreen('lobby-screen');
}

function leaveRoom() {
  leaveToLobby();
}

window.leaveToLobby = leaveToLobby;

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
    const stage = pickBotStageForRoom();
    socket.emit('room:addBot', { team: 0, stage });
    return;
  }
  const add = e.target.closest('[data-add-bot]');
  if (!add || myRoomData?.host !== socket.id) return;
  const team = parseInt(add.dataset.addBot, 10);
  const stage = pickBotStageForRoom();
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
  if (!el) return;
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

function sendGameLiveChat() {
  const input = document.getElementById('game-live-chat-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat:room', msg);
  input.value = '';
}

function clearGameLiveChat() {
  const el = document.getElementById('game-live-chat');
  if (el) el.innerHTML = '';
}

function addGameLiveChatLine(nickname, msg, isSystem) {
  const el = document.getElementById('game-live-chat');
  const gs = document.getElementById('game-screen');
  if (!el || !gs || !gs.classList.contains('active')) return;
  const div = document.createElement('div');
  div.className = 'game-live-chat-msg' + (isSystem ? ' system' : '');
  div.innerHTML = isSystem
    ? escHtml(msg)
    : `<span class="game-live-nick">${escHtml(nickname)}</span><span class="game-live-txt">${escHtml(msg)}</span>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
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
      <div class="opp-threat-chip" style="display:none" title="대기 중인 훼방">
        <span class="oth-pwr">0</span>
        <span class="oth-locks">0/3</span>
      </div>
      <div class="opp-board-wrap">
        <canvas class="opp-canvas" id="opp-${p.id}" width="${cw}" height="${ch}"></canvas>
      </div>
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
  clearIncomingThreatUi();
  clearGameLiveChat();

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
      const oc = document.getElementById('online-combo-display');
      if (oc) oc.textContent = state.combo != null ? String(state.combo) : '0';
      const ms = document.getElementById('online-m-score'); if (ms) ms.textContent = state.score.toLocaleString();
      const ml = document.getElementById('online-m-lines'); if (ml) ml.textContent = state.lines;
      const mv = document.getElementById('online-m-level'); if (mv) mv.textContent = state.level;
      const now = performance.now();
      if (state.over || now - lastStateEmit >= NET_MS) {
        socket.emit('game:state', state);
        lastStateEmit = now;
      }
    },
    (lines) => {
      socket.emit('game:attack', { lines });
    },
    (score, lines) => {
      socket.emit('game:myover', { score, lines });
      if (tetris && typeof tetris._getState === 'function') {
        socket.emit('game:state', tetris._getState());
      }
    },
    { showGhost: ghostOpt, onLock: (cleared) => { socket.emit('game:lock', { cleared }); },
      onLineClear: (p) => {
        if (typeof runLineClearBoardFx === 'function') runLineClearBoardFx(document.getElementById('my-canvas'), p);
      },
    }
  );
  tetris.start();
  if (myRoomData) syncRoomShowGhost(myRoomData);
  spawnHostAiBots(players);
}

function pulseOppFx(socketId, cls, holdMs) {
  const el = document.getElementById(`opp-wrap-${socketId}`);
  if (!el) return;
  el.classList.remove('panel-fx-out', 'panel-fx-in', 'panel-threat-tick', 'panel-defend-glow', 'panel-attack-queued-victim', 'panel-attack-queued-out');
  void el.offsetWidth;
  el.classList.add(cls);
  const ms = holdMs != null && holdMs > 0 ? holdMs : 450;
  setTimeout(() => el.classList.remove(cls), ms);
}

// ── 게임 오버 처리 ──
function showGameOver(payload) {
  const { winnerId, winnerNick, reason, isTeamGame, winnerTeam } = payload;
  stopHostOnlineBots();
  if (tetris) tetris.stop();
  clearIncomingThreatUi();
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
      const tail = reason ? ` (${reason})` : '';
      info.textContent =
        reason === '마지막 1인 생존'
          ? `${winnerNick}님이 마지막 1인으로 승리했습니다.${tail}`
          : `${winnerNick}님이 승리했습니다.${tail}`;
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
  if (p.kind === 'cloud') return { ...p, kind: 'cloud', ms: Math.min(8000, Math.max(1500, parseInt(p.ms, 10) || 4000)) };
  if (p.kind === 'ink') {
    const pow = Math.max(1, Math.min(12, parseInt(p.power, 10) || 1));
    const defInk = Math.min(4800, Math.max(2600, 2400 + pow * 180));
    return { ...p, kind: 'ink', ms: Math.min(8000, Math.max(1500, parseInt(p.ms, 10) || defInk)) };
  }
  if (p.kind) return p;
  if (p.lines != null) return { kind: 'rows', lines: p.lines };
  return { kind: 'rows', lines: 1 };
}

function penaltyFlashIntensity(pen) {
  if (!pen) return 1;
  const p = pen.power || 1;
  switch (pen.kind) {
    case 'cloud':
    case 'ink':
      return Math.min(10, 3 + Math.floor(p / 2));
    case 'meteor':
      return Math.min(10, 2 + (pen.meteors || 1) * 2);
    case 'split':
    case 'cheese':
    case 'rows':
    default:
      return Math.max(1, pen.lines || p);
  }
}

/** 구름·먹물 시야 방해 (보드 래퍼 위 오버레이, pointer-events 없음) */
function runVisionPenaltyFx(pen, boardWrapEl) {
  if (!boardWrapEl || !pen) return;
  const kind = pen.kind;
  if (kind !== 'cloud' && kind !== 'ink') return;
  const ms =
    kind === 'cloud'
      ? Math.min(8000, Math.max(1500, parseInt(pen.ms, 10) || 4000))
      : Math.min(8000, Math.max(1500, parseInt(pen.ms, 10) || 3200));
  if (kind === 'cloud') {
    const el = document.createElement('div');
    el.className = 'board-vision-cloud';
    el.setAttribute('aria-hidden', 'true');
    boardWrapEl.appendChild(el);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('show'));
    });
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 700);
    }, ms);
  } else {
    const el = document.createElement('div');
    el.className = 'board-vision-ink';
    el.setAttribute('aria-hidden', 'true');
    boardWrapEl.appendChild(el);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('show'));
    });
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 550);
    }, ms);
  }
}

function resolveAttackFxAnchor(id) {
  if (id === socket.id) return document.querySelector('#game-screen .board-wrap');
  return document.getElementById('opp-wrap-' + id);
}

function resolveIncomingQueueAnchor(targetId) {
  const gs = document.getElementById('game-screen');
  if (!gs || !gs.classList.contains('active')) return null;
  if (targetId === socket.id) {
    return document.getElementById('incoming-threat-column');
  }
  const wrap = document.getElementById('opp-wrap-' + targetId);
  if (!wrap) return null;
  return wrap.querySelector('.opp-threat-chip') || wrap.querySelector('.opponent-panel') || wrap;
}

/** 훼방 큐(대기열) 위치로 수렴하는 링·불꽃 */
function spawnAttackQueueSurgeRings(targetId) {
  const el = resolveIncomingQueueAnchor(targetId);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + Math.min(r.height * 0.55, r.height * 0.5 + 6);
  const root = ensureAttackFxRoot();
  for (let i = 0; i < 5; i++) {
    const ring = document.createElement('div');
    ring.className = 'attack-queue-surge-ring';
    ring.style.left = `${cx}px`;
    ring.style.top = `${cy}px`;
    ring.style.animationDelay = `${i * 0.07}s`;
    root.appendChild(ring);
    setTimeout(() => ring.remove(), 950);
  }
  const sparks = 18;
  for (let s = 0; s < sparks; s++) {
    const sp = document.createElement('div');
    sp.className = 'attack-queue-ember';
    const ang = (s / sparks) * Math.PI * 2 + Math.random() * 0.4;
    const rad = 18 + Math.random() * 48;
    sp.style.setProperty('--ex', `${(Math.cos(ang) * rad).toFixed(1)}px`);
    sp.style.setProperty('--ey', `${(Math.sin(ang) * rad * 0.65).toFixed(1)}px`);
    sp.style.left = `${cx}px`;
    sp.style.top = `${cy}px`;
    sp.style.animationDelay = `${s * 0.025}s`;
    root.appendChild(sp);
    setTimeout(() => sp.remove(), 720);
  }
}

/** 훼방이 지연 큐에 쌓일 때 — 곡선이 큐 UI로 들어가고 링·불꽃 수렴 */
function runAttackQueuedVfx(data) {
  if (!data || data.targetId == null || data.fromId == null) return;
  const gs = document.getElementById('game-screen');
  const gameActive = gs && gs.classList.contains('active');
  const qEl = resolveIncomingQueueAnchor(data.targetId);
  if (typeof runAttackTrail === 'function' && gameActive) {
    runAttackTrail({
      from: data.fromId,
      to: data.targetId,
      lines: Math.max(1, data.power | 0),
      kind: 'meteor',
      fromNick: `훼방 +${data.power | 0}`,
      toNick: `큐 ${data.queueLen || 1}건`,
      toCustomEl: qEl || undefined,
    });
  }
  spawnAttackQueueSurgeRings(data.targetId);
  if (!gameActive) return;
  if (data.targetId === socket.id) {
    const col = document.getElementById('incoming-threat-column');
    if (col) {
      col.classList.remove('attack-queued-victim-pulse', 'queue-fx-surge-target');
      void col.offsetWidth;
      col.classList.add('attack-queued-victim-pulse', 'queue-fx-surge-target');
      setTimeout(() => {
        col.classList.remove('attack-queued-victim-pulse', 'queue-fx-surge-target');
      }, 1100);
    }
    const bwHit = document.querySelector('#game-screen .board-wrap');
    if (bwHit) {
      bwHit.classList.add('attack-queued-board-hit');
      setTimeout(() => bwHit.classList.remove('attack-queued-board-hit'), 720);
    }
  }
  if (data.fromId === socket.id) {
    const bwOut = document.querySelector('#game-screen .board-wrap');
    if (bwOut) {
      bwOut.classList.remove('attack-queued-outburst');
      void bwOut.offsetWidth;
      bwOut.classList.add('attack-queued-outburst');
      setTimeout(() => bwOut.classList.remove('attack-queued-outburst'), 680);
    }
  }
  pulseOppFx(data.targetId, 'panel-attack-queued-victim');
  pulseOppFx(data.fromId, 'panel-attack-queued-out');
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
  const { from, to, lines, kind, fromNick, toNick, toCustomEl } = fx;
  const fromEl = resolveAttackFxAnchor(from);
  const toEl = (toCustomEl != null && toCustomEl instanceof Element) ? toCustomEl : resolveAttackFxAnchor(to);
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

function runPenaltyLandedVfx() {
  const gs = document.getElementById('game-screen');
  if (!gs?.classList.contains('active')) return;
  gs.classList.remove('screen-shake', 'screen-shake-hard', 'screen-hit-mega');
  void gs.offsetWidth;
  gs.classList.add('screen-hit-mega');
  setTimeout(() => gs.classList.remove('screen-hit-mega'), 1100);

  const row = gs.querySelector('.my-game-board-row');
  if (row) {
    row.classList.remove('penalty-landed-row-rattle');
    void row.offsetWidth;
    row.classList.add('penalty-landed-row-rattle');
    setTimeout(() => row.classList.remove('penalty-landed-row-rattle'), 940);
  }

  const col = document.getElementById('incoming-threat-column');
  if (col) {
    col.classList.remove('threat-column-hit-rattle');
    void col.offsetWidth;
    col.classList.add('threat-column-hit-rattle');
    setTimeout(() => col.classList.remove('threat-column-hit-rattle'), 900);
  }

  let ov = document.getElementById('penalty-hit-fullflash');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'penalty-hit-fullflash';
  ov.setAttribute('aria-hidden', 'true');
  ov.className = 'penalty-hit-fullflash';
  gs.appendChild(ov);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => ov.classList.add('show'));
  });
  setTimeout(() => {
    ov.classList.remove('show');
    ov.classList.add('fade-out');
    setTimeout(() => ov.remove(), 520);
  }, 320);
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
  }, 1100);
}

function clearIncomingThreatUi() {
  const col = document.getElementById('incoming-threat-column');
  const stack = document.getElementById('incoming-threat-stack');
  if (col) {
    col.classList.remove('has-threat', 'threat-danger-flash', 'threat-imminent', 'defend-pulse', 'threat-column-hit-rattle');
  }
  if (stack) stack.innerHTML = '';
  document.querySelectorAll('.opp-threat-chip').forEach((el) => {
    el.style.display = 'none';
  });
}

function renderIncomingThreatUi(payload) {
  if (!payload || payload.targetId == null) return;
  const { targetId, queue, locksMax } = payload;
  const max = locksMax || 3;
  if (targetId === socket.id) {
    const col = document.getElementById('incoming-threat-column');
    const stack = document.getElementById('incoming-threat-stack');
    if (col && stack) {
      col.classList.toggle('has-threat', queue.length > 0);
      stack.innerHTML = queue
        .map((item, idx) => {
          const orbs = Array.from({ length: max }, (_, i) => (
            `<span class="lock-orb ${i < item.locksLeft ? 'lit' : 'dim'}"></span>`
          )).join('');
          return `<div class="threat-card ${idx === 0 ? 'threat-card-head' : ''}" style="--i:${idx}">
          <div class="threat-card-glow"></div>
          <div class="tc-inner">
            <div class="tc-pwr">${item.power}</div>
            <div class="tc-sublabel">한 줄이면 막기</div>
            <div class="tc-lock-orbs">${orbs}</div>
          </div>
        </div>`;
        })
        .join('');
    }
  }
  const wrap = document.getElementById(`opp-wrap-${targetId}`);
  if (wrap) {
    const chip = wrap.querySelector('.opp-threat-chip');
    if (chip) {
      if (!queue.length) chip.style.display = 'none';
      else {
        chip.style.display = 'flex';
        const head = queue[0];
        chip.querySelector('.oth-pwr').textContent = String(head.power);
        chip.querySelector('.oth-locks').textContent = `${head.locksLeft}/${max}`;
      }
    }
  }
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

socket.on('game:incomingUpdate', (p) => {
  renderIncomingThreatUi(p);
});

socket.on('game:attackQueued', (data) => {
  runAttackQueuedVfx(data);
});

socket.on('game:defendFx', (fx) => {
  const bw = document.querySelector('#game-screen .board-wrap');
  if (fx.to === socket.id && bw) {
    bw.classList.remove('defend-shield-burst');
    void bw.offsetWidth;
    bw.classList.add('defend-shield-burst');
    setTimeout(() => bw.classList.remove('defend-shield-burst'), 1100);
    const pop = document.createElement('div');
    pop.className = 'defend-absorb-pop';
    const a = parseInt(fx.absorbed, 10) || 0;
    pop.textContent = a > 0 ? `−${a}` : '방어!';
    bw.appendChild(pop);
    setTimeout(() => pop.remove(), 1000);
    const col = document.getElementById('incoming-threat-column');
    if (col) {
      col.classList.add('defend-pulse');
      setTimeout(() => col.classList.remove('defend-pulse'), 900);
    }
  } else {
    pulseOppFx(fx.to, 'panel-defend-glow', 1020);
    const ow = document.querySelector(`#opp-wrap-${fx.to} .opp-board-wrap`);
    if (ow) {
      ow.classList.remove('defend-shield-burst');
      void ow.offsetWidth;
      ow.classList.add('defend-shield-burst');
      setTimeout(() => ow.classList.remove('defend-shield-burst'), 1100);
      const pop = document.createElement('div');
      pop.className = 'defend-absorb-pop defend-absorb-pop-opp';
      const a = parseInt(fx.absorbed, 10) || 0;
      pop.textContent = a > 0 ? `−${a}` : '방어!';
      ow.appendChild(pop);
      setTimeout(() => pop.remove(), 1000);
    }
  }
});

socket.on('game:threatTick', (t) => {
  if (t.targetId === socket.id) {
    const col = document.getElementById('incoming-threat-column');
    if (col) {
      col.classList.add('threat-danger-flash');
      if (t.imminent) col.classList.add('threat-imminent');
      setTimeout(() => {
        col.classList.remove('threat-danger-flash', 'threat-imminent');
      }, 520);
    }
  }
  pulseOppFx(t.targetId, 'panel-threat-tick');
});

socket.on('game:attackFx', (fx) => {
  const { from, to, lines, kind } = fx;
  pulseOppFx(from, 'panel-fx-out');
  pulseOppFx(to, 'panel-fx-in');
  const bw = document.querySelector('#game-screen .board-wrap');
  if (from === socket.id && bw) {
    bw.classList.remove('board-fx-out');
    void bw.offsetWidth;
    bw.classList.add('board-fx-out');
    setTimeout(() => bw.classList.remove('board-fx-out'), 520);
  }
  if (typeof flashAttack === 'function' && to !== socket.id && from !== socket.id) {
    flashAttack(lines, { subtle: true, kind });
  }
});

socket.on('game:garbage', (payload) => {
  const pen = normalizePenaltyPayload(payload);
  if (tetris && tetris.running) {
    runPenaltyLandedVfx();
    const bw = document.querySelector('#game-screen .board-wrap');
    if (pen.kind === 'cloud' || pen.kind === 'ink') runVisionPenaltyFx(pen, bw);
    runIncomingPenaltyVfx(pen);
    if (typeof flashAttack === 'function') flashAttack(penaltyFlashIntensity(pen), { kind: pen.kind, incoming: true });
    tetris.applyPenalty(pen);
  }
});

socket.on('game:garbageBot', (payload) => {
  if (myRoomData?.host !== socket.id) return;
  const pen = normalizePenaltyPayload(payload);
  const bot = onlineHostBots[payload.botId];
  if (bot && typeof bot.applyPenalty === 'function') {
    runPenaltyLandedVfx();
    const bid = String(payload.botId || '');
    let botWrap = null;
    if (bid) {
      try {
        botWrap = document.querySelector(`#online-bot-root .online-bot-board-wrap[data-bot-id="${CSS.escape(bid)}"]`);
      } catch (e) {
        botWrap = document.querySelector(`#online-bot-root .online-bot-board-wrap[data-bot-id="${bid.replace(/["'\\]/g, '')}"]`);
      }
    }
    if (pen.kind === 'cloud' || pen.kind === 'ink') runVisionPenaltyFx(pen, botWrap);
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
  addGameLiveChatLine(nickname, msg, false);
});

socket.on('error', (msg) => {
  alert(msg);
});

// nick-screen은 HTML에서 active 클래스로 초기 표시됨
