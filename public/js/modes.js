// ── 캠페인 & 솔로 모드 ─────────────────────────────────────
'use strict';

// ── 캠페인 스테이지 정의 ──
const CAMPAIGN_STAGES = [
  { stage: 1, name: '튜토리얼',     desc: 'AI를 처음 만나봐요',      goal: 1,  aiStage: 1, bg: '#0a1a0a' },
  { stage: 2, name: '워밍업',       desc: '좀 더 쉬운 적이 나와요',  goal: 1,  aiStage: 2, bg: '#0a1520' },
  { stage: 3, name: '중급 도전',    desc: '이제 제법 강해요',        goal: 1,  aiStage: 3, bg: '#150a20' },
  { stage: 4, name: '강적 등장',    desc: '집중하세요!',             goal: 1,  aiStage: 4, bg: '#200a0a' },
  { stage: 5, name: '고수의 벽',    desc: '룩어헤드 AI 등장',       goal: 1,  aiStage: 5, bg: '#1a0a15' },
  { stage: 6, name: '마스터 급',    desc: '거의 완벽한 AI예요',      goal: 1,  aiStage: 6, bg: '#0a0a20' },
  { stage: 7, name: '최종 보스',    desc: '살아남을 수 있을까요?',   goal: 1,  aiStage: 7, bg: '#200a00' },
];

// ── 상태 ──
let campaignStage = 0;
let campaignWins = 0;
let campaignActive = false;
let aiBot = null;
let soloActive = false;
let currentMode = null; // 'campaign' | 'solo' | 'online'

// ── 게임 옵션 (쉐도우 등) ──
let gameOptions = { showGhost: true };
let _pendingCallback = null; // 옵션 선택 후 실행할 함수

// 옵션 모달 열기
function showGameOptions(title, subtitle, callback) {
  _pendingCallback = callback;
  document.getElementById('go-modal-title').textContent = title;
  document.getElementById('go-modal-subtitle').textContent = subtitle;
  document.getElementById('go-ghost-check').checked = gameOptions.showGhost;
  document.getElementById('game-options-modal').classList.add('open');
}

// 옵션 모달 확인
function confirmGameOptions() {
  gameOptions.showGhost = document.getElementById('go-ghost-check').checked;
  document.getElementById('game-options-modal').classList.remove('open');
  if (_pendingCallback) { _pendingCallback(); _pendingCallback = null; }
}

// 옵션 모달 취소
function cancelGameOptions() {
  document.getElementById('game-options-modal').classList.remove('open');
  _pendingCallback = null;
}

// ── 캠페인 화면 진입 ──
function enterCampaign() {
  campaignStage = 0;
  campaignWins = 0;
  campaignActive = true;
  currentMode = 'campaign';
  showCampaignStageSelect();
}

function showCampaignStageSelect() {
  showScreen('campaign-select-screen');
  renderCampaignStages();
}

function renderCampaignStages() {
  const el = document.getElementById('campaign-stage-list');
  el.innerHTML = CAMPAIGN_STAGES.map((s, i) => {
    const unlocked = i <= campaignWins;
    const cleared  = i < campaignWins;
    const profile  = getAIProfile(s.aiStage);
    return `
      <div class="stage-card ${unlocked ? '' : 'locked'} ${cleared ? 'cleared' : ''}"
           onclick="${unlocked ? `startCampaignStage(${i})` : ''}">
        <div class="stage-num">STAGE ${s.stage}</div>
        <div class="stage-name">${s.name}</div>
        <div class="stage-desc">${s.desc}</div>
        <div class="stage-enemy">${profile.emoji} ${profile.name}</div>
        ${cleared ? '<div class="stage-clear-badge">✓ CLEAR</div>' : ''}
        ${!unlocked ? '<div class="stage-lock">🔒</div>' : ''}
      </div>
    `;
  }).join('');
}

function startCampaignStage(idx) {
  campaignStage = idx;
  const stageData = CAMPAIGN_STAGES[idx];
  const profile = getAIProfile(stageData.aiStage);
  showGameOptions(
    `STAGE ${stageData.stage} - ${stageData.name}`,
    `상대: ${profile.emoji} ${profile.name}`,
    () => {
      showScreen('vs-game-screen');
      document.getElementById('vs-stage-label').textContent = `STAGE ${stageData.stage} - ${stageData.name}`;
      document.getElementById('vs-ai-label').textContent = `${profile.emoji} ${profile.name}`;
      document.getElementById('vs-ai-desc').textContent = stageData.desc;
      document.getElementById('vs-my-label').textContent = myNickname;
      startVsGame(stageData.aiStage);
    }
  );
}

function startVsGame(aiStageNum) {
  if (tetris) tetris.stop();
  if (aiBot) aiBot.stop();

  document.getElementById('vs-gameover-overlay').classList.remove('show');
  document.getElementById('vs-score-display').textContent = '0';
  document.getElementById('vs-lines-display').textContent = '0';
  document.getElementById('vs-level-display').textContent = '1';
  document.getElementById('vs-ai-score-display').textContent = '0';
  document.getElementById('vs-ai-lines-display').textContent = '0';

  const myCanvas   = document.getElementById('vs-my-canvas');
  const nextCanvas = document.getElementById('vs-next-canvas');
  const aiCanvas   = document.getElementById('vs-ai-canvas');

  // 내 게임
  tetris = new TetrisGame(
    myCanvas, nextCanvas,
    (state) => {
      document.getElementById('vs-score-display').textContent = state.score.toLocaleString();
      document.getElementById('vs-lines-display').textContent = state.lines;
      document.getElementById('vs-level-display').textContent = state.level;
      // 모바일 미니 스탯바
      const ms = document.getElementById('vs-m-score'); if (ms) ms.textContent = state.score.toLocaleString();
      const ml = document.getElementById('vs-m-lines'); if (ml) ml.textContent = state.lines;
      const mv = document.getElementById('vs-m-level'); if (mv) mv.textContent = state.level;
    },
    (lines) => {
      // 내가 공격 → AI에게 훼방
      if (aiBot && aiBot.running) aiBot.addGarbage(lines);
    },
    (score, lines) => {
      // 내가 게임오버
      endVsGame(false, score);
    },
    { showGhost: gameOptions.showGhost }
  );

  // AI 봇
  aiBot = new AIBot(
    aiCanvas, null, aiStageNum,
    (lines) => {
      // AI가 공격 → 내게 훼방
      if (tetris && tetris.running) {
        tetris.addGarbage(lines);
        flashAttack();
      }
    },
    (score, lines) => {
      // AI 게임오버 = 내가 이김
      endVsGame(true, tetris ? tetris.score : 0);
    },
    (state) => {
      document.getElementById('vs-ai-score-display').textContent = state.score.toLocaleString();
      document.getElementById('vs-ai-lines-display').textContent = state.lines;
      // 모바일 미니 스탯바
      const ma = document.getElementById('vs-m-ai-score'); if (ma) ma.textContent = state.score.toLocaleString();
    }
  );

  tetris.start();
  aiBot.start();
}

function endVsGame(playerWon, playerScore) {
  if (tetris) tetris.stop();
  if (aiBot) aiBot.stop();

  const overlay = document.getElementById('vs-gameover-overlay');
  const title   = document.getElementById('vs-gameover-title');
  const info    = document.getElementById('vs-gameover-info');
  const nextBtn = document.getElementById('vs-next-btn');

  if (playerWon) {
    title.textContent = '🏆 WIN!';
    title.style.color = 'var(--gold)';
    info.textContent  = `점수: ${playerScore.toLocaleString()}`;
    if (currentMode === 'campaign') {
      campaignWins = Math.max(campaignWins, campaignStage + 1);
      const isLast = campaignStage >= CAMPAIGN_STAGES.length - 1;
      nextBtn.style.display = isLast ? 'none' : '';
      nextBtn.textContent   = '다음 스테이지 →';
      nextBtn.onclick       = () => {
        overlay.classList.remove('show');
        startCampaignStage(campaignStage + 1);
      };
      if (isLast) {
        title.textContent = '🎉 모든 스테이지 클리어!';
        info.textContent  = '당신은 테트리스 마스터입니다!';
      }
    } else {
      nextBtn.style.display = 'none';
    }
  } else {
    title.textContent = '💀 GAME OVER';
    title.style.color = 'var(--accent2)';
    const stageData   = CAMPAIGN_STAGES[campaignStage] || {};
    const profile     = getAIProfile(stageData.aiStage || 1);
    info.textContent  = `${profile.emoji} ${profile.name}에게 패배했습니다.`;
    nextBtn.style.display = 'none';
  }
  overlay.classList.add('show');
}

function vsRetry() {
  const stageData = CAMPAIGN_STAGES[campaignStage];
  document.getElementById('vs-gameover-overlay').classList.remove('show');
  startVsGame(stageData.aiStage);
}

function vsBackToSelect() {
  if (tetris) tetris.stop();
  if (aiBot) aiBot.stop();
  document.getElementById('vs-gameover-overlay').classList.remove('show');
  if (currentMode === 'campaign') {
    showCampaignStageSelect();
  } else {
    showScreen('lobby-screen');
  }
}

// AI 대전 (단독 - 로비에서 바로) ──────────────────────────────
function enterAIBattle() {
  currentMode = 'ai-battle';
  showScreen('ai-select-screen');
}

function startAIBattle(aiStageNum) {
  campaignStage = aiStageNum - 1;
  const profile = getAIProfile(aiStageNum);
  showGameOptions(
    `AI 대전 — 난이도 ${aiStageNum}`,
    `상대: ${profile.emoji} ${profile.name}`,
    () => {
      showScreen('vs-game-screen');
      document.getElementById('vs-stage-label').textContent = `AI 대전`;
      document.getElementById('vs-ai-label').textContent = `${profile.emoji} ${profile.name}`;
      document.getElementById('vs-ai-desc').textContent   = `난이도 ${aiStageNum}`;
      document.getElementById('vs-my-label').textContent   = myNickname;
      startVsGame(aiStageNum);
    }
  );
}

// ── 솔로 모드 ─────────────────────────────────────────────────
function enterSolo() {
  currentMode = 'solo';
  showGameOptions(
    '솔로 모드',
    '혼자서 최고 점수에 도전!',
    () => {
      soloActive = true;
      showScreen('solo-game-screen');
      document.getElementById('solo-my-label').textContent = myNickname;
      startSoloGame();
    }
  );
}

function startSoloGame() {
  if (tetris) tetris.stop();
  document.getElementById('solo-gameover-overlay').classList.remove('show');
  document.getElementById('solo-score-display').textContent = '0';
  document.getElementById('solo-lines-display').textContent = '0';
  document.getElementById('solo-level-display').textContent = '1';

  const myCanvas   = document.getElementById('solo-my-canvas');
  const nextCanvas = document.getElementById('solo-next-canvas');

  tetris = new TetrisGame(
    myCanvas, nextCanvas,
    (state) => {
      document.getElementById('solo-score-display').textContent = state.score.toLocaleString();
      document.getElementById('solo-lines-display').textContent = state.lines;
      document.getElementById('solo-level-display').textContent = state.level;
      // 모바일 미니 스탯바
      const ms = document.getElementById('solo-m-score'); if (ms) ms.textContent = state.score.toLocaleString();
      const ml = document.getElementById('solo-m-lines'); if (ml) ml.textContent = state.lines;
      const mv = document.getElementById('solo-m-level'); if (mv) mv.textContent = state.level;
    },
    () => {}, // 솔로는 공격 없음
    (score, lines) => {
      endSoloGame(score, lines);
    },
    { showGhost: gameOptions.showGhost }
  );
  tetris.start();
}

function endSoloGame(score, lines) {
  const overlay = document.getElementById('solo-gameover-overlay');
  document.getElementById('solo-final-score').textContent = score.toLocaleString();
  document.getElementById('solo-final-lines').textContent = lines;

  // 랭킹 등록
  socket.emit('game:myover', { score, lines });

  overlay.classList.add('show');
}

function soloRetry() {
  document.getElementById('solo-gameover-overlay').classList.remove('show');
  startSoloGame();
}

function soloBackToLobby() {
  if (tetris) tetris.stop();
  soloActive = false;
  document.getElementById('solo-gameover-overlay').classList.remove('show');
  showScreen('lobby-screen');
}

function vsBackToLobby() {
  if (tetris) tetris.stop();
  if (aiBot) aiBot.stop();
  showScreen('lobby-screen');
}
