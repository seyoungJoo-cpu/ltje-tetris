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
// 닉네임별 솔로 모드 최고 점수만 유지
const soloBestByNick = {};

let roomCounter = 1;
let botIdCounter = 1;

function normalizeGameMode(mode) {
  if (mode === 'team2') return 'team2';
  if (mode === 'team3') return 'team3';
  return 'ffa';
}

function isBotId(id) {
  return typeof id === 'string' && id.startsWith('bot_');
}

function allSlotIds(room) {
  return [...room.players, ...(room.bots || []).map((b) => b.id)];
}

function countTeam(room, team) {
  let n = 0;
  for (const id of room.players) {
    if ((room.playerTeams[id] ?? 0) === team) n++;
  }
  for (const b of room.bots || []) {
    if (b.team === team) n++;
  }
  return n;
}

function teamCountsPair(room) {
  return [countTeam(room, 0), countTeam(room, 1)];
}

function buildTeamMap(room) {
  if (room.gameMode === 'ffa') return undefined;
  const m = {};
  for (const id of room.players) m[id] = room.playerTeams[id] ?? 0;
  for (const b of room.bots || []) m[b.id] = b.team;
  return m;
}

function roomOccupancy(room) {
  return room.players.length + (room.bots || []).length;
}

function removeAllBots(room) {
  if (!room.bots?.length) return;
  for (const b of room.bots) {
    delete room.playerTeams[b.id];
    delete room.gameStates[b.id];
  }
  room.bots = [];
}

function createRoom(hostId, hostNick, maxPlayers, showGhost = true, gameMode = 'ffa', roomName, password) {
  const mode = normalizeGameMode(gameMode);
  const max =
    mode === 'team2' ? 4
    : mode === 'team3' ? 6
    : Math.min(Math.max(parseInt(maxPlayers, 10) || 2, 2), 6);
  const roomId = `room_${roomCounter++}`;
  const rawName = roomName != null ? String(roomName).trim().slice(0, 32) : '';
  const name = rawName || `${hostNick}의 방`;
  const pwdRaw = password != null ? String(password).trim().slice(0, 24) : '';
  const pwd = pwdRaw.length ? pwdRaw : null;
  rooms[roomId] = {
    id: roomId,
    name,
    password: pwd,
    host: hostId,
    maxPlayers: max,
    players: [hostId],
    bots: [],
    status: 'waiting',
    gameStates: {},
    readySet: new Set(),
    showGhost: showGhost !== false,
    gameMode: mode,
    playerTeams: mode !== 'ffa' ? { [hostId]: 0 } : {},
  };
  return roomId;
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
    players: roomOccupancy(r),
    maxPlayers: r.maxPlayers,
    status: r.status,
    gameMode: r.gameMode || 'ffa',
    modeLabel: roomModeLabel(r.gameMode || 'ffa'),
    hasPassword: !!r.password,
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
  if (room.incomingGarbage) delete room.incomingGarbage[socketId];

  if (room.players.length === 0) {
    delete rooms[p.roomId];
  } else {
    if (room.host === socketId) {
      room.host = room.players[0];
      removeAllBots(room);
    }

    // 게임 중이었으면 남은 사람/팀 승리처리
    if (room.status === 'playing') {
      const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';
      if (isTeam) {
        const alive0 = allSlotIds(room).filter(
          id => (room.playerTeams[id] ?? 0) === 0 && !room.gameStates[id]?.over
        );
        const alive1 = allSlotIds(room).filter(
          id => (room.playerTeams[id] ?? 0) === 1 && !room.gameStates[id]?.over
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
          room.incomingGarbage = {};
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
          room.incomingGarbage = {};
        } else if (room.players.length === 1 && !room.bots?.length) {
          const winnerId = room.players[0];
          const winnerNick = players[winnerId]?.nickname || '?';
          io.to(p.roomId).emit('game:over', { winnerId, winnerNick, reason: '상대방 접속 종료' });
          room.status = 'waiting';
          room.readySet.clear();
          room.gameStates = {};
          room.incomingGarbage = {};
        }
      } else if (room.players.length === 1 && !room.bots?.length) {
        const winnerId = room.players[0];
        const winnerNick = players[winnerId]?.nickname || '?';
        io.to(p.roomId).emit('game:over', { winnerId, winnerNick, reason: '상대방 접속 종료' });
        room.status = 'waiting';
        room.readySet.clear();
        room.gameStates = {};
        room.incomingGarbage = {};
      }
    }
    io.to(p.roomId).emit('room:update', sanitizeRoom(room));
  }
  p.roomId = null;
  io.emit('lobby:rooms', getRoomList());
}

function sanitizeRoom(room) {
  const teams = buildTeamMap(room);
  const humanPlayers = room.players.map((id) => ({
    id,
    nickname: players[id]?.nickname || '?',
    ready: room.readySet.has(id),
    isBot: false,
  }));
  const botPlayers = (room.bots || []).map((b) => ({
    id: b.id,
    nickname: b.nickname,
    ready: true,
    isBot: true,
    stage: b.stage,
  }));
  return {
    id: room.id,
    name: room.name,
    hasPassword: !!room.password,
    host: room.host,
    maxPlayers: room.maxPlayers,
    players: [...humanPlayers, ...botPlayers],
    status: room.status,
    showGhost: !!room.showGhost,
    gameMode: room.gameMode || 'ffa',
    teams,
  };
}

function submitSoloScore(nickname, score, lines) {
  const nick = String(nickname || '?').trim().slice(0, 12) || '?';
  const sc = Math.max(0, parseInt(score, 10) || 0);
  const ln = Math.max(0, parseInt(lines, 10) || 0);
  const prev = soloBestByNick[nick];
  if (!prev || sc > prev.score) {
    soloBestByNick[nick] = {
      nickname: nick,
      score: sc,
      lines: ln,
      date: new Date().toLocaleDateString('ko-KR'),
    };
  }
}

function getSoloRankingSlice(n) {
  return Object.values(soloBestByNick)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function pickGarbageTarget(room, attackerId) {
  const others = allSlotIds(room).filter((id) => id !== attackerId);
  const myTeam = room.playerTeams[attackerId] ?? 0;
  let pool;
  if (room.gameMode === 'team2' || room.gameMode === 'team3') {
    pool = others.filter(
      (id) =>
        (room.playerTeams[id] ?? 0) !== myTeam &&
        !room.gameStates[id]?.over
    );
  } else {
    pool = others.filter((id) => !room.gameStates[id]?.over);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function resolveSlotNickname(room, id) {
  if (isBotId(id)) {
    const b = room.bots?.find((x) => x.id === id);
    return b?.nickname || 'AI';
  }
  return players[id]?.nickname || '?';
}

function rollPenaltyPayload(power) {
  const p = Math.max(1, Math.min(12, parseInt(power, 10) || 1));
  const r = Math.random();
  if (r < 0.28) return { kind: 'rows', lines: p };
  if (r < 0.48) return { kind: 'cheese', lines: Math.min(8, Math.max(2, p)) };
  if (r < 0.64) return { kind: 'split', lines: p };
  if (r < 0.78) return { kind: 'meteor', meteors: Math.min(6, Math.max(1, Math.ceil(p / 2))) };
  if (r < 0.90) {
    return {
      kind: 'columns',
      cols: Math.min(4, Math.max(2, 1 + Math.floor(p / 4))),
      depth: Math.min(6, Math.max(2, 2 + (p % 4))),
    };
  }
  return { kind: 'shower', blocks: Math.min(18, 5 + p * 2) };
}

function emitGarbageToTarget(io, room, roomId, fromId, targetId, n) {
  queueGarbageAttack(io, room, roomId, fromId, targetId, n);
}

/** 맨 앞 훼방이 떨어지기 전, 이 횟수만큼 블록을 내려놓을 기회(줄 안 지우면 1씩 감소) */
const GARBAGE_LOCKS_BEFORE_DROP = 3;

function deliverGarbageWithPenalty(io, room, roomId, fromId, targetId, n, penalty) {
  const fromNick = resolveSlotNickname(room, fromId);
  const toNick = resolveSlotNickname(room, targetId);
  const payload = { from: fromId, power: n, ...penalty };
  if (isBotId(targetId)) {
    io.to(room.host).emit('game:garbageBot', { botId: targetId, ...payload });
  } else {
    io.to(targetId).emit('game:garbage', payload);
  }
  io.to(roomId).emit('game:attackFx', {
    from: fromId,
    to: targetId,
    lines: n,
    kind: penalty.kind,
    fromNick,
    toNick,
  });
}

function serializeIncomingQueue(room, targetId) {
  const locksMax = GARBAGE_LOCKS_BEFORE_DROP;
  const q = room.incomingGarbage?.[targetId] || [];
  return q.map((x) => ({
    power: Math.max(1, x.power | 0),
    locksLeft: Math.max(0, x.locksLeft != null ? x.locksLeft : locksMax),
    fromId: x.fromId,
  }));
}

function emitIncomingQueueUpdate(io, room, roomId, targetId) {
  const locksMax = GARBAGE_LOCKS_BEFORE_DROP;
  const queue = serializeIncomingQueue(room, targetId);
  io.to(roomId).emit('game:incomingUpdate', { targetId, queue, locksMax });
}

function queueGarbageAttack(io, room, roomId, fromId, targetId, n) {
  const p = Math.max(1, Math.min(12, parseInt(n, 10) || 1));
  if (!room.incomingGarbage) room.incomingGarbage = {};
  if (!room.incomingGarbage[targetId]) room.incomingGarbage[targetId] = [];
  room.incomingGarbage[targetId].push({
    fromId,
    targetId,
    power: p,
    locksLeft: GARBAGE_LOCKS_BEFORE_DROP,
  });
  emitIncomingQueueUpdate(io, room, roomId, targetId);
  io.to(roomId).emit('game:attackQueued', {
    targetId,
    fromId,
    power: p,
    queueLen: room.incomingGarbage[targetId].length,
  });
}

function processGameLock(io, room, roomId, targetId, clearedRaw) {
  const q = room.incomingGarbage?.[targetId];
  if (!q?.length) return;
  const cleared = Math.max(0, Math.min(8, parseInt(clearedRaw, 10) || 0));

  if (cleared > 0) {
    const powerBefore = q.reduce((s, x) => s + Math.max(1, x.power | 0), 0);
    reduceIncomingGarbage(room, targetId, cleared);
    const qAfter = room.incomingGarbage?.[targetId];
    const powerAfter = (qAfter || []).reduce((s, x) => s + Math.max(1, x.power | 0), 0);
    const absorbed = Math.max(0, powerBefore - powerAfter);
    if (qAfter?.length) {
      qAfter[0].locksLeft = GARBAGE_LOCKS_BEFORE_DROP;
    }
    io.to(roomId).emit('game:defendFx', {
      to: targetId,
      linesCleared: cleared,
      absorbed,
    });
    emitIncomingQueueUpdate(io, room, roomId, targetId);
    return;
  }

  const head = q[0];
  const prevLeft = head.locksLeft != null ? head.locksLeft : GARBAGE_LOCKS_BEFORE_DROP;
  head.locksLeft = Math.max(0, prevLeft - 1);
  io.to(roomId).emit('game:threatTick', {
    targetId,
    locksLeft: head.locksLeft,
    power: Math.max(1, head.power | 0),
    imminent: head.locksLeft === 0,
  });

  if (head.locksLeft > 0) {
    emitIncomingQueueUpdate(io, room, roomId, targetId);
    return;
  }

  const item = q.shift();
  const penalty = rollPenaltyPayload(item.power);
  deliverGarbageWithPenalty(io, room, roomId, item.fromId, targetId, item.power, penalty);
  if (!q.length) delete room.incomingGarbage[targetId];
  emitIncomingQueueUpdate(io, room, roomId, targetId);
}

function reduceIncomingGarbage(room, targetId, defendLines) {
  const rem0 = Math.max(0, Math.min(8, parseInt(defendLines, 10) || 0));
  if (rem0 <= 0) return;
  let rem = rem0;
  const q = room.incomingGarbage?.[targetId];
  if (!q?.length) return;
  while (rem > 0 && q.length) {
    const head = q[0];
    const p = Math.max(1, head.power | 0);
    if (p <= rem) {
      rem -= p;
      q.shift();
    } else {
      head.power -= rem;
      rem = 0;
    }
  }
  if (!q.length) delete room.incomingGarbage[targetId];
}

function endRoundAndReset(room, roomId) {
  room.status = 'waiting';
  room.readySet.clear();
  room.gameStates = {};
  room.incomingGarbage = {};
  io.emit('lobby:rooms', getRoomList());
  io.to(roomId).emit('room:update', sanitizeRoom(room));
}

function maybeTeamOrFfaWin(room, roomId) {
  if (!room || room.status !== 'playing') return false;
  const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';
  if (isTeam) {
    const alive0 = allSlotIds(room).filter(
      (id) => (room.playerTeams[id] ?? 0) === 0 && !room.gameStates[id]?.over
    );
    const alive1 = allSlotIds(room).filter(
      (id) => (room.playerTeams[id] ?? 0) === 1 && !room.gameStates[id]?.over
    );
    if (alive0.length === 0 && alive1.length > 0) {
      const rep = alive1[0];
      io.to(roomId).emit('game:over', {
        winnerId: rep,
        winnerNick: '🅱 팀 B 승리!',
        winnerTeam: 1,
        isTeamGame: true,
        reason: '게임 종료',
      });
      endRoundAndReset(room, roomId);
      return true;
    }
    if (alive1.length === 0 && alive0.length > 0) {
      const rep = alive0[0];
      io.to(roomId).emit('game:over', {
        winnerId: rep,
        winnerNick: '🅰 팀 A 승리!',
        winnerTeam: 0,
        isTeamGame: true,
        reason: '게임 종료',
      });
      endRoundAndReset(room, roomId);
      return true;
    }
    return false;
  }
  const aliveAll = allSlotIds(room).filter((id) => !room.gameStates[id]?.over);
  if (aliveAll.length <= 1) {
    const winnerId = aliveAll[0] || null;
    const winnerNick = winnerId ? resolveSlotNickname(room, winnerId) : '없음';
    io.to(roomId).emit('game:over', { winnerId, winnerNick, reason: '게임 종료' });
    endRoundAndReset(room, roomId);
    return true;
  }
  return false;
}

function canStartGame(room) {
  if (!room.players.every((id) => room.readySet.has(id))) return false;
  const occ = roomOccupancy(room);
  const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';
  if (isTeam) {
    if (occ !== room.maxPlayers) return false;
    const [c0, c1] = teamCountsPair(room);
    return c0 === room.maxPlayers / 2 && c1 === room.maxPlayers / 2;
  }
  return occ >= 2;
}

// ── Socket.io ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('연결:', socket.id);
  players[socket.id] = { nickname: null, roomId: null };

  // 로비 입장 시 닉네임 등록
  socket.on('lobby:join', (nickname) => {
    players[socket.id].nickname = nickname.trim().slice(0, 12);
    socket.emit('lobby:rooms', getRoomList());
    socket.emit('ranking:update', getSoloRankingSlice(20));
  });

  // 방 만들기
  socket.on('room:create', ({ maxPlayers, showGhost, gameMode, roomName, password }) => {
    if (players[socket.id].roomId) return;
    const nick = players[socket.id].nickname;
    const mode = normalizeGameMode(gameMode);
    const maxReq = mode === 'ffa' ? Math.min(Math.max(parseInt(maxPlayers, 10) || 2, 2), 6) : (mode === 'team2' ? 4 : 6);
    const ghostOpt = showGhost === false ? false : true;
    const roomId = createRoom(socket.id, nick, maxReq, ghostOpt, mode, roomName, password);
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

  // 팀 선택 (팀전 대기 중)
  socket.on('room:setTeam', ({ team }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'waiting') return;
    if (room.gameMode !== 'team2' && room.gameMode !== 'team3') return;
    const t = team === 1 ? 1 : 0;
    room.playerTeams[socket.id] = t;
    io.to(p.roomId).emit('room:update', sanitizeRoom(room));
  });

  // 방장: AI 추가
  socket.on('room:addBot', ({ team, stage }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.host !== socket.id || room.status !== 'waiting') return;
    if (roomOccupancy(room) >= room.maxPlayers) return socket.emit('error', '방이 꽉 찼습니다.');
    const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';
    const t = isTeam ? (team === 1 ? 1 : 0) : 0;
    const parsed = parseInt(stage, 10);
    const st = Number.isFinite(parsed) && parsed >= 1 && parsed <= 7
      ? Math.min(7, Math.max(1, parsed))
      : 3 + Math.floor(Math.random() * 4);
    const botId = `bot_${room.id}_${botIdCounter++}`;
    const n = (room.bots?.length || 0) + 1;
    const bot = { id: botId, nickname: `AI-${n}`, team: t, stage: st };
    room.bots.push(bot);
    room.playerTeams[botId] = t;
    io.to(p.roomId).emit('room:update', sanitizeRoom(room));
    io.emit('lobby:rooms', getRoomList());
  });

  // 방장: AI 제거
  socket.on('room:removeBot', ({ botId }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.host !== socket.id || room.status !== 'waiting') return;
    if (!isBotId(botId)) return;
    room.bots = (room.bots || []).filter((b) => b.id !== botId);
    delete room.playerTeams[botId];
    io.to(p.roomId).emit('room:update', sanitizeRoom(room));
    io.emit('lobby:rooms', getRoomList());
  });

  // 방장: 봇 팀 변경
  socket.on('room:setBotTeam', ({ botId, team }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.host !== socket.id || room.status !== 'waiting') return;
    const b = room.bots?.find((x) => x.id === botId);
    if (!b) return;
    b.team = team === 1 ? 1 : 0;
    room.playerTeams[botId] = b.team;
    io.to(p.roomId).emit('room:update', sanitizeRoom(room));
  });

  // 방 참가
  socket.on('room:join', (payload) => {
    const roomId = typeof payload === 'string' ? payload : payload?.roomId;
    const password = typeof payload === 'string' ? '' : String(payload?.password || '');
    const room = rooms[roomId];
    if (!room) return socket.emit('error', '방이 없습니다.');
    if (room.status !== 'waiting') return socket.emit('error', '이미 게임 중입니다.');
    if (roomOccupancy(room) >= room.maxPlayers) return socket.emit('error', '방이 꽉 찼습니다.');
    if (players[socket.id].roomId) return;
    if (room.password && room.password !== password.trim()) {
      return socket.emit('error', '비밀번호가 올바르지 않습니다.');
    }

    const c0 = countTeam(room, 0);
    const c1 = countTeam(room, 1);
    room.players.push(socket.id);
    if (room.gameMode === 'team2' || room.gameMode === 'team3') {
      room.playerTeams[socket.id] = c0 <= c1 ? 0 : 1;
    }
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

    if (canStartGame(room)) {
      room.status = 'playing';
      room.gameStates = {};
      room.incomingGarbage = {};
      const isTeam = room.gameMode === 'team2' || room.gameMode === 'team3';
      const teamsMap = buildTeamMap(room);
      const playersPayload = [
        ...room.players.map((id) => ({
          id,
          nickname: players[id]?.nickname || '?',
          isBot: false,
        })),
        ...(room.bots || []).map((b) => ({
          id: b.id,
          nickname: b.nickname,
          isBot: true,
        })),
      ];
      io.to(p.roomId).emit('game:start', {
        showGhost: !!room.showGhost,
        gameMode: room.gameMode || 'ffa',
        teams: isTeam ? teamsMap : undefined,
        players: playersPayload,
      });
      io.emit('lobby:rooms', getRoomList());
    }
  });

  socket.on('game:lock', ({ cleared }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'playing') return;
    processGameLock(io, room, p.roomId, socket.id, cleared);
  });

  socket.on('game:botLock', ({ botId, cleared }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'playing' || room.host !== socket.id) return;
    if (!isBotId(botId) || !room.bots?.some((b) => b.id === botId)) return;
    processGameLock(io, room, p.roomId, botId, cleared);
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
    emitGarbageToTarget(io, room, p.roomId, socket.id, targetId, n);
  });

  // 방장이 돌리는 AI 봇 — 상태 중계
  socket.on('game:botState', ({ botId, state }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.host !== socket.id || room.status !== 'playing') return;
    if (!room.bots?.some((b) => b.id === botId)) return;
    room.gameStates[botId] = state;
    if (state && state.over) {
      room.gameStates[botId] = Object.assign({}, room.gameStates[botId], { over: true });
      maybeTeamOrFfaWin(room, p.roomId);
    }
    socket.to(p.roomId).emit('game:opponent', { id: botId, state });
  });

  socket.on('game:botAttack', ({ botId, lines }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.host !== socket.id || room.status !== 'playing') return;
    if (!room.bots?.some((b) => b.id === botId)) return;
    const n = Math.max(1, Math.min(12, parseInt(lines, 10) || 1));
    const targetId = pickGarbageTarget(room, botId);
    if (!targetId) return;
    emitGarbageToTarget(io, room, p.roomId, botId, targetId, n);
  });

  socket.on('game:botOver', ({ botId, score, lines }) => {
    const p = players[socket.id];
    if (!p?.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.host !== socket.id || room.status !== 'playing') return;
    if (!room.bots?.some((b) => b.id === botId)) return;
    room.gameStates[botId] = Object.assign({}, room.gameStates[botId], { over: true });
    maybeTeamOrFfaWin(room, p.roomId);
  });

  // 게임 오버 (온라인) — 랭킹에는 반영하지 않음 (솔로 전용 랭킹)
  socket.on('game:myover', ({ score, lines }) => {
    const p = players[socket.id];
    if (!p.roomId) return;
    const room = rooms[p.roomId];
    if (!room || room.status !== 'playing') return;

    room.gameStates[socket.id] = Object.assign({}, room.gameStates[socket.id], { over: true });

    maybeTeamOrFfaWin(room, p.roomId);
  });

  // 솔로 모드 최고 점수 랭킹
  socket.on('solo:submit', ({ score, lines }) => {
    const nick = players[socket.id]?.nickname || '?';
    submitSoloScore(nick, score, lines);
    io.emit('ranking:update', getSoloRankingSlice(20));
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
    socket.emit('ranking:update', getSoloRankingSlice(20));
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
