// ── 클라이언트 로직 ────────────────────────────────────────
'use strict';

const socket = io();

// ── 상태 ──
let myNickname = '';
let myRoomId = null;
let myRoomData = null;
let isReady = false;
let tetris = null;
let opponentCanvases = {};  // socketId → canvas

// showScreen은 index.html 인라인 스크립트에 정의됨

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
         onclick="joinRoom('${r.id}')">
      <div>
        <div class="room-name">${escHtml(r.name)}</div>
        <div class="room-info">${r.players}/${r.maxPlayers}명</div>
      </div>
      <div class="room-status ${r.status === 'playing' ? 'status-playing' : 'status-waiting'}">
        ${r.status === 'playing' ? '게임중' : '대기중'}
      </div>
    </div>
  `).join('');
}

// ── 방 만들기 ──
function showCreateRoom() {
  document.getElementById('create-modal').classList.add('open');
}
function closeModal() {
  document.getElementById('create-modal').classList.remove('open');
}
function createRoom() {
  const max = parseInt(document.getElementById('max-players-select').value);
  if (typeof gameOptions !== 'undefined') {
    gameOptions.showGhost = document.getElementById('room-ghost-check').checked;
  }
  socket.emit('room:create', { maxPlayers: max });
  closeModal();
}

// ── 방 참가 ──
function joinRoom(roomId) {
  if (myRoomId) return;
  socket.emit('room:join', roomId);
}

// ── 방 나가기 ──
function leaveRoom() {
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

// ── 방 UI 렌더 ──
function renderRoom(room) {
  myRoomData = room;
  document.getElementById('room-name-display').textContent = room.name;
  const playersEl = document.getElementById('room-players');
  playersEl.innerHTML = room.players.map(p => `
    <div class="player-card ${p.ready ? 'ready' : ''} ${p.id === room.host ? 'host' : ''}">
      <div class="player-avatar">${escHtml(p.nickname.charAt(0).toUpperCase())}</div>
      <div class="player-nick">${escHtml(p.nickname)}</div>
      <div class="${p.ready ? 'player-ready-badge' : 'player-waiting-badge'}">
        ${p.ready ? '레디 완료' : '대기중'}
      </div>
    </div>
  `).join('');
}

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

// ── 게임 시작 ──
function startGame(players) {
  showScreen('game-screen');
  document.getElementById('my-label').textContent = myNickname;
  document.getElementById('game-room-name').textContent = myRoomData?.name || '';

  opponentCanvases = {};
  const oppPanel = document.getElementById('opponents-panel');
  oppPanel.innerHTML = '';

  players.forEach(p => {
    if (p.id === socket.id) return;
    const wrap = document.createElement('div');
    wrap.className = 'opponent-panel';
    wrap.innerHTML = `
      <div class="player-label">${escHtml(p.nickname)}</div>
      <canvas class="opp-canvas" id="opp-${p.id}" width="${10 * 10}" height="${20 * 10}"></canvas>
    `;
    oppPanel.appendChild(wrap);
    opponentCanvases[p.id] = document.getElementById(`opp-${p.id}`);
  });

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
      // 모바일 미니 스탯바
      const ms = document.getElementById('online-m-score'); if (ms) ms.textContent = state.score.toLocaleString();
      const ml = document.getElementById('online-m-lines'); if (ml) ml.textContent = state.lines;
      const mv = document.getElementById('online-m-level'); if (mv) mv.textContent = state.level;
      socket.emit('game:state', state);
    },
    (lines) => {
      socket.emit('game:attack', { lines });
    },
    (score, lines) => {
      socket.emit('game:myover', { score, lines });
    },
    { showGhost: typeof gameOptions !== 'undefined' ? gameOptions.showGhost : true }
  );
  tetris.start();
}

// ── 게임 오버 처리 ──
function showGameOver(winnerId, winnerNick, reason) {
  if (tetris) tetris.stop();
  const overlay = document.getElementById('gameover-overlay');
  const title = document.getElementById('gameover-title');
  const info = document.getElementById('gameover-info');

  if (winnerId === socket.id) {
    title.textContent = '🏆 WIN!';
    title.style.color = 'var(--gold)';
    info.textContent = '축하합니다! 게임에서 승리했습니다!';
  } else if (winnerId === null) {
    title.textContent = 'DRAW';
    title.style.color = 'var(--text-dim)';
    info.textContent = '무승부';
  } else {
    title.textContent = 'GAME OVER';
    title.style.color = 'var(--accent2)';
    info.textContent = `${winnerNick}님이 승리했습니다.`;
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

// ── 소켓 이벤트 ──
socket.on('lobby:rooms', renderRoomList);
socket.on('ranking:update', renderRanking);

socket.on('room:joined', (room) => {
  myRoomId = room.id;
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

socket.on('game:start', ({ players }) => {
  startGame(players);
});

socket.on('game:opponent', ({ id, state }) => {
  drawOpponentBoard(opponentCanvases[id], state);
});

socket.on('game:garbage', ({ from, lines }) => {
  if (tetris && tetris.running) {
    tetris.addGarbage(lines);
    flashAttack();
  }
});

socket.on('game:over', ({ winnerId, winnerNick, reason }) => {
  showGameOver(winnerId, winnerNick, reason);
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
