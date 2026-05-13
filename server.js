const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── 인메모리 상태 ──────────────────────────────────────────
const players = {};   // socketId → { nickname, roomId }
const rooms   = {};   // roomId  → Room 객체
const ranking = [];   // [{ nickname, score, lines, date }]

let roomCounter = 1;

function normalizeGameMode(mode) {
  if (mode === 'team2') return 'team2';
  if (mode === 'team3') return 'team3';
  return 'ffa';
}

function createRoom(hostId, hostNick, maxPlayers, showGhost = true, gameMode = 'ffa') {
  const mode = normalizeGameMode(gameMode);
  const max =
    mode === 'team2' ? 4
    : mode === 'team3' ? 6
    : Math.min(Math.max(parseInt(maxPlayers, 10) || 2, 2), 6);
  const roomId = `room_${roomCounter++}`;
  rooms[roomId] = {
    id: roomId,
    name: `${hostNick}의 방`,
    host: hostId,
    maxPlayers: max,
    players: [hostId],
    status: 'waiting',   // waiting | playing | finished
    gameStates: {},      // socketId → board/score state
    readySet: new Set(),
    showGhost: showGhost !== false,
    gameMode: mode,
    playerTeams: {},     // socketId → 0 | 1 (팀전)
  };
  return roomId;
}

function recomputeTeams(room) {
  room.playerTeams = {};
  if (room.gameMode !== 'team2' && room.gameMode !== 'team3') return;
  const ordered = [...room.players];
  const half = room.gameMode === 'team2' ? 2 : 3;
  ordered.forEach((id, i) => {
    room.playerTeams[id] = i < half ? 0 : 1;
  });
}

function roomModeLabel(mode) {
  if (mode === 'team2') return '2v2';
  if (mode === 'team3') return '3v3';
  return 'FFA';
}

function getRoomList() {
  return Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    players: r.players.length,
    maxPlayers: r.maxPlayers,
    status: r.status,
    gameMode: r.gameMode || 'ffa',
    modeLabel: roomModeLabel(r.gameMode || 'ffa'),
  }));
}

function removePlayerFromRoom(socketId) {
  const p = players[socketId];
  if (!p || !p.roomId) return;
  const room = rooms[p.roomId];
  if (!room) return;

  room.players = room.players.filter(id => id !== socketId);
  room.readySet.delete(socketId);
  delete room.gameStates[socketId];

  if (room.players.length === 0) {
    delete rooms[p.roomId];
  } else {
    // 방장 교체
    if (room.host === socketId) room.host = room.players[0];

    // 게임 중이었으면 남은 사람/팀 승리처리
    if (room.status === 'playing') {
      recomputeTeams(room);
      const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';
      if (isTeam) {
        const alive0 = room.players.filter(
          id => room.playerTeams[id] === 0 && !room.gameStates[id]?.over
        );
        const alive1 = room.players.filter(
          id => room.playerTeams[id] === 1 && !room.gameStates[id]?.over
        );
        if (alive0.length === 0 && alive1.length > 0) {
          const rep = alive1[0];
          io.to(p.roomId).emit('game:over', {
            winnerId: rep,
            winnerNick: '🅱 팀 B 승리!',
            winnerTeam: 1,
            isTeamGame: true,
            reason: '상대방 접속 종료',
          });
          room.status = 'waiting';
          room.readySet.clear();
          room.gameStates = {};
        } else if (alive1.length === 0 && alive0.length > 0) {
          const rep = alive0[0];
          io.to(p.roomId).emit('game:over', {
            winnerId: rep,
            winnerNick: '🅰 팀 A 승리!',
            winnerTeam: 0,
            isTeamGame: true,
            reason: '상대방 접속 종료',
          });
          room.status = 'waiting';
          room.readySet.clear();
          room.gameStates = {};
        } else if (room.players.length === 1) {
          const winnerId = room.players[0];
          const winnerNick = players[winnerId]?.nickname || '?';
          io.to(p.roomId).emit('game:over', { winnerId, winnerNick, reason: '상대방 접속 종료' });
          room.status = 'waiting';
          room.readySet.clear();
          room.gameStates = {};
        }
      } else if (room.players.length === 1) {
        const winnerId = room.players[0];
        const winnerNick = players[winnerId]?.nickname || '?';
        io.to(p.roomId).emit('game:over', { winnerId, winnerNick, reason: '상대방 접속 종료' });
        room.status = 'waiting';
        room.readySet.clear();
        room.gameStates = {};
      }
    }
    io.to(p.roomId).emit('room:update', sanitizeRoom(room));
  }
  p.roomId = null;
  io.emit('lobby:rooms', getRoomList());
}

function sanitizeRoom(room) {
  recomputeTeams(room);
  const teams =
    room.gameMode === 'ffa'
      ? undefined
      : Object.fromEntries(room.players.map((id) => [id, room.playerTeams[id] ?? 0]));
  return {
    id: room.id,
    name: room.name,
    host: room.host,
    maxPlayers: room.maxPlayers,
    players: room.players.map(id => ({
      id,
      nickname: players[id]?.nickname || '?',
      ready: room.readySet.has(id),
    })),
    status: room.status,
    showGhost: !!room.showGhost,
    gameMode: room.gameMode || 'ffa',
    teams,
  };
}

function addRanking(nickname, score, lines) {
  ranking.push({ nickname, score, lines, date: new Date().toLocaleDateString('ko-KR') });
  ranking.sort((a, b) => b.score - a.score);
  if (ranking.length > 50) ranking.length = 50;
}

function pickGarbageTarget(room, attackerId) {
  const others = room.players.filter((id) => id !== attackerId);
  let pool;
  if (room.gameMode === 'team2' || room.gameMode === 'team3') {
    const myTeam = room.playerTeams[attackerId];
    pool = others.filter(
      (id) =>
        room.playerTeams[id] !== myTeam &&
        !room.gameStates[id]?.over
    );
  } else {
    pool = others.filter((id) => !room.gameStates[id]?.over);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Socket.io ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('연결:', socket.id);
  players[socket.id] = { nickname: null, roomId: null };

  // 로비 입장 시 닉네임 등록
  socket.on('lobby:join', (nickname) => {
    players[socket.id].nickname = nickname.trim().slice(0, 12);
    socket.emit('lobby:rooms', getRoomList());
    socket.emit('ranking:update', ranking.slice(0, 20));
  });

  // 방 만들기
  socket.on('room:create', ({ maxPlayers, showGhost, gameMode }) => {
    if (players[socket.id].roomId) return;
    const nick = players[socket.id].nickname;
    const mode = normalizeGameMode(gameMode);
    const maxReq = mode === 'ffa' ? Math.min(Math.max(parseInt(maxPlayers, 10) || 2, 2), 6) : (mode === 'team2' ? 4 : 6);
    const ghostOpt = showGhost === false ? false : true;
    const roomId = createRoom(socket.id, nick, maxReq, ghostOpt, mode);
    players[socket.id].roomId = roomId;
    socket.join(roomId);
    socket.emit('room:joined', sanitizeRoom(rooms[roomId]));
    io.emit('lobby:rooms', getRoomList());
  });

  // 방장 전용: 쉐도우(고스트) 모드 — 방 전원 동기화
  socket.on('room:showGhost', (showGhost) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.host !== socket.id) return;
    room.showGhost = !!showGhost;
    io.to(p.roomId).emit('room:update', sanitizeRoom(room));
  });

  // 방 참가
  socket.on('room:join', (roomId) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', '방이 없습니다.');
    if (room.status !== 'waiting') return socket.emit('error', '이미 게임 중입니다.');
    if (room.players.length >= room.maxPlayers) return socket.emit('error', '방이 꽉 찼습니다.');
    if (players[socket.id].roomId) return;

    room.players.push(socket.id);
    players[socket.id].roomId = roomId;
    socket.join(roomId);
    socket.emit('room:joined', sanitizeRoom(room));
    io.to(roomId).emit('room:update', sanitizeRoom(room));
    io.emit('lobby:rooms', getRoomList());
  });

  // 방 나가기
  socket.on('room:leave', () => {
    removePlayerFromRoom(socket.id);
    socket.emit('lobby:rooms', getRoomList());
  });

  // 레디
  socket.on('game:ready', () => {
    const p = players[socket.id];
    if (!p.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'waiting') return;

    room.readySet.has(socket.id)
      ? room.readySet.delete(socket.id)
      : room.readySet.add(socket.id);

    io.to(p.roomId).emit('room:update', sanitizeRoom(room));

    recomputeTeams(room);
    const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';
    const needFull = isTeam ? room.players.length === room.maxPlayers : room.players.length >= 2;
    const allReady = needFull &&
      room.players.every(id => room.readySet.has(id));

    if (allReady) {
      room.status = 'playing';
      room.gameStates = {};
      io.to(p.roomId).emit('game:start', {
        showGhost: !!room.showGhost,
        gameMode: room.gameMode || 'ffa',
        teams: isTeam ? { ...room.playerTeams } : undefined,
        players: room.players.map(id => ({
          id,
          nickname: players[id]?.nickname || '?',
        }))
      });
      io.emit('lobby:rooms', getRoomList());
    }
  });

  // 게임 상태 브로드캐스트 (보드, 점수 등)
  socket.on('game:state', (state) => {
    const p = players[socket.id];
    if (!p.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'playing') return;
    room.gameStates[socket.id] = state;
    socket.to(p.roomId).emit('game:opponent', { id: socket.id, state });
  });

  // 훼방 블록 — 1:1은 상대 1명, 그 외·팀전은 랜덤 1명(적 팀만)
  socket.on('game:attack', ({ lines }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'playing') return;
    const n = Math.max(1, Math.min(12, parseInt(lines, 10) || 1));
    const targetId = pickGarbageTarget(room, socket.id);
    if (!targetId) return;
    const fromNick = players[socket.id]?.nickname || '?';
    const toNick = players[targetId]?.nickname || '?';
    io.to(targetId).emit('game:garbage', { from: socket.id, lines: n });
    io.to(p.roomId).emit('game:attackFx', {
      from: socket.id,
      to: targetId,
      lines: n,
      fromNick,
      toNick,
    });
  });

  // 게임 오버 (본인)
  socket.on('game:myover', ({ score, lines }) => {
    const p = players[socket.id];
    if (!p.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'playing') return;

    const nick = p.nickname || '?';
    addRanking(nick, score, lines);
    io.emit('ranking:update', ranking.slice(0, 20));

    room.gameStates[socket.id] = Object.assign({}, room.gameStates[socket.id], { over: true });

    recomputeTeams(room);
    const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';

    if (isTeam) {
      const alive0 = room.players.filter(
        (id) => room.playerTeams[id] === 0 && !room.gameStates[id]?.over
      );
      const alive1 = room.players.filter(
        (id) => room.playerTeams[id] === 1 && !room.gameStates[id]?.over
      );
      if (alive0.length === 0 && alive1.length > 0) {
        const rep = alive1[0];
        io.to(p.roomId).emit('game:over', {
          winnerId: rep,
          winnerNick: '🅱 팀 B 승리!',
          winnerTeam: 1,
          isTeamGame: true,
          reason: '게임 종료',
        });
        room.status = 'waiting';
        room.readySet.clear();
        room.gameStates = {};
        io.emit('lobby:rooms', getRoomList());
        io.to(p.roomId).emit('room:update', sanitizeRoom(room));
        return;
      }
      if (alive1.length === 0 && alive0.length > 0) {
        const rep = alive0[0];
        io.to(p.roomId).emit('game:over', {
          winnerId: rep,
          winnerNick: '🅰 팀 A 승리!',
          winnerTeam: 0,
          isTeamGame: true,
          reason: '게임 종료',
        });
        room.status = 'waiting';
        room.readySet.clear();
        room.gameStates = {};
        io.emit('lobby:rooms', getRoomList());
        io.to(p.roomId).emit('room:update', sanitizeRoom(room));
        return;
      }
      return;
    }

    // FFA: 살아남은 한명이면 게임 종료
    const aliveAll = room.players.filter(id => !room.gameStates[id]?.over);
    if (aliveAll.length <= 1) {
      const winnerId = aliveAll[0] || null;
      const winnerNick = winnerId ? players[winnerId]?.nickname : '없음';
      io.to(p.roomId).emit('game:over', { winnerId, winnerNick, reason: '게임 종료' });
      room.status = 'waiting';
      room.readySet.clear();
      room.gameStates = {};
      io.emit('lobby:rooms', getRoomList());
      io.to(p.roomId).emit('room:update', sanitizeRoom(room));
    }
  });

  // 채팅
  socket.on('chat:lobby', (msg) => {
    const nick = players[socket.id]?.nickname || '?';
    io.emit('chat:lobby', { nickname: nick, msg: msg.slice(0, 100) });
  });

  socket.on('chat:room', (msg) => {
    const p = players[socket.id];
    if (!p.roomId) return;
    const nick = p.nickname || '?';
    io.to(p.roomId).emit('chat:room', { nickname: nick, msg: msg.slice(0, 100) });
  });

  // 랭킹 요청
  socket.on('ranking:get', () => {
    socket.emit('ranking:update', ranking.slice(0, 20));
  });

  // 연결 해제
  socket.on('disconnect', () => {
    removePlayerFromRoom(socket.id);
    delete players[socket.id];
    console.log('연결해제:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
