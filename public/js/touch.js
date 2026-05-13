// ── 모바일 터치 컨트롤러 ──────────────────────────────────────
// PC/모바일 자동 감지, 게임 화면에서만 표시
'use strict';

const isMobile = () => /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  || window.matchMedia('(max-width: 600px)').matches;

// 컨트롤러 DOM 삽입
function injectTouchController() {
  if (document.getElementById('touch-ctrl')) return;

  const ctrl = document.createElement('div');
  ctrl.id = 'touch-ctrl';
  ctrl.innerHTML = `
    <div id="tc-left">
      <!-- 조이스틱 영역 -->
      <div id="joystick-wrap">
        <div id="joystick-base">
          <div id="joystick-knob"></div>
          <div class="js-arrow js-up">▲</div>
          <div class="js-arrow js-down">▼</div>
          <div class="js-arrow js-left">◀</div>
          <div class="js-arrow js-right">▶</div>
        </div>
      </div>
    </div>
    <div id="tc-right">
      <button id="tc-rotate" class="tc-btn" ontouchstart="tcRotate(event)">
        <span>↺</span><small>회전</small>
      </button>
      <button id="tc-hard" class="tc-btn tc-hard" ontouchstart="tcHardDrop(event)">
        <span>⬇</span><small>드롭</small>
      </button>
    </div>
  `;
  document.body.appendChild(ctrl);

  // CSS 주입
  const style = document.createElement('style');
  style.textContent = `
    #touch-ctrl {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: 160px;
      background: rgba(10,10,26,0.92);
      border-top: 1px solid rgba(0,229,255,0.2);
      z-index: 500;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 8px 24px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    #touch-ctrl.visible { display: flex; }

    /* 좌측: 조이스틱 */
    #tc-left {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #joystick-wrap {
      width: 130px; height: 130px;
      display: flex; align-items: center; justify-content: center;
    }
    #joystick-base {
      width: 120px; height: 120px;
      border-radius: 50%;
      background: radial-gradient(circle at center, rgba(0,229,255,0.08), rgba(0,0,0,0.5));
      border: 2px solid rgba(0,229,255,0.3);
      position: relative;
      box-shadow: 0 0 20px rgba(0,229,255,0.1), inset 0 0 20px rgba(0,0,0,0.5);
    }
    #joystick-knob {
      position: absolute;
      width: 46px; height: 46px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, rgba(0,229,255,0.9), rgba(0,100,180,0.8));
      box-shadow: 0 0 12px rgba(0,229,255,0.6), 0 4px 8px rgba(0,0,0,0.4);
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      transition: box-shadow 0.1s;
      pointer-events: none;
    }
    #joystick-knob.active {
      box-shadow: 0 0 20px rgba(0,229,255,0.9), 0 4px 8px rgba(0,0,0,0.4);
    }
    /* 방향 화살표 (조이스틱 주변) */
    .js-arrow {
      position: absolute;
      font-size: 11px;
      color: rgba(0,229,255,0.3);
      pointer-events: none;
      line-height: 1;
    }
    .js-up    { top: 4px;  left: 50%; transform: translateX(-50%); }
    .js-down  { bottom: 4px; left: 50%; transform: translateX(-50%); }
    .js-left  { left: 4px; top: 50%; transform: translateY(-50%); }
    .js-right { right: 4px; top: 50%; transform: translateY(-50%); }

    /* 우측: 버튼 */
    #tc-right {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }
    .tc-btn {
      width: 70px; height: 60px;
      border-radius: 14px;
      border: 2px solid rgba(0,229,255,0.4);
      background: rgba(0,229,255,0.08);
      color: #00e5ff;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-family: 'Jua', sans-serif;
      cursor: pointer;
      transition: all 0.1s;
      -webkit-tap-highlight-color: transparent;
      gap: 2px;
    }
    .tc-btn span { font-size: 1.5rem; line-height: 1; }
    .tc-btn small { font-size: 0.6rem; opacity: 0.7; }
    .tc-btn:active, .tc-btn.pressed {
      background: rgba(0,229,255,0.25);
      border-color: rgba(0,229,255,0.8);
      transform: scale(0.93);
      box-shadow: 0 0 12px rgba(0,229,255,0.4);
    }
    .tc-hard {
      border-color: rgba(255,64,129,0.5);
      background: rgba(255,64,129,0.08);
      color: #ff4081;
    }
    .tc-hard:active, .tc-hard.pressed {
      background: rgba(255,64,129,0.25);
      border-color: rgba(255,64,129,0.9);
      box-shadow: 0 0 14px rgba(255,64,129,0.5);
    }

    /* 게임 화면 캔버스가 컨트롤러에 안 가려지도록 */
    .screen.active.has-touch-ctrl .vs-body,
    .screen.active.has-touch-ctrl .solo-body,
    .screen.active.has-touch-ctrl .game-body {
      padding-bottom: 168px;
    }

    /* 모바일일 때 VS 화면 레이아웃 조정 */
    @media (max-width: 600px) {
      .vs-my-stats, .vs-center, .game-stats, .solo-stats { display: none !important; }
      .vs-body, .solo-body, .game-body {
        flex-direction: column !important;
        align-items: center !important;
        gap: 8px !important;
      }
      #vs-my-canvas, #solo-my-canvas, #my-canvas {
        width: 180px !important; height: 360px !important;
      }
      #vs-ai-canvas { width: 120px !important; height: 240px !important; }
      .opponents { flex-direction: row !important; flex-wrap: wrap !important; justify-content: center !important; }
      .vs-player-panel { flex-direction: row !important; align-items: flex-start !important; gap: 12px !important; }
      /* 모바일 미니 스탯바 */
      .mobile-stat-bar {
        display: flex !important;
      }
    }
    .mobile-stat-bar {
      display: none;
      gap: 12px;
      background: rgba(18,18,42,0.95);
      border-bottom: 1px solid rgba(42,42,85,0.8);
      padding: 6px 16px;
      flex-shrink: 0;
      font-family: 'Jua', sans-serif;
    }
    .msb-item { display: flex; flex-direction: column; align-items: center; }
    .msb-label { font-size: 0.6rem; color: var(--text-dim); letter-spacing: 1px; }
    .msb-value { font-size: 1rem; color: var(--accent); }
  `;
  document.head.appendChild(style);

  initJoystick();
}

// ── 조이스틱 로직 ────────────────────────────────────────────
let joystickActive = false;
let joystickOrigin = { x: 0, y: 0 };
let lastDirection = null;
let repeatTimer = null;
let repeatInterval = null;

const DEAD_ZONE  = 18;   // 픽셀 - 이 이내는 무시
const MAX_DIST   = 50;   // 노브 최대 이동 거리
const REPEAT_DELAY = 160; // 방향키 반복 시작 딜레이 (ms)
const REPEAT_RATE  = 80;  // 반복 속도 (ms)

function initJoystick() {
  const base = document.getElementById('joystick-base');
  const knob = document.getElementById('joystick-knob');
  if (!base || !knob) return;

  function getPos(e) {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  function moveKnob(dx, dy) {
    const dist = Math.sqrt(dx * dx + dy * dy);
    const capped = Math.min(dist, MAX_DIST);
    const angle  = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * capped;
    const ky = Math.sin(angle) * capped;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    knob.classList.add('active');
  }

  function resetKnob() {
    knob.style.transform = 'translate(-50%, -50%)';
    knob.classList.remove('active');
  }

  function getDirection(dx, dy) {
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < DEAD_ZONE) return null;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    // 4방향 분류
    if (angle > -45 && angle <= 45)  return 'right';
    if (angle > 45  && angle <= 135) return 'down';
    if (angle > 135 || angle <= -135) return 'left';
    return 'up';
  }

  function fireDirection(dir) {
    if (!dir) return;
    switch (dir) {
      case 'left':  tcLeft();   break;
      case 'right': tcRight();  break;
      case 'down':  tcDown();   break;
      case 'up':    tcRotate(); break;
    }
  }

  function startRepeat(dir) {
    stopRepeat();
    fireDirection(dir);
    if (dir === 'left' || dir === 'right' || dir === 'down') {
      repeatTimer = setTimeout(() => {
        repeatInterval = setInterval(() => fireDirection(dir), REPEAT_RATE);
      }, REPEAT_DELAY);
    }
  }

  function stopRepeat() {
    clearTimeout(repeatTimer);
    clearInterval(repeatInterval);
    repeatTimer = null;
    repeatInterval = null;
    lastDirection = null;
  }

  base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joystickActive = true;
    const rect = base.getBoundingClientRect();
    joystickOrigin = {
      x: rect.left + rect.width / 2,
      y: rect.top  + rect.height / 2
    };
    const pos = getPos(e);
    const dx = pos.x - joystickOrigin.x;
    const dy = pos.y - joystickOrigin.y;
    moveKnob(dx, dy);
    const dir = getDirection(dx, dy);
    if (dir && dir !== lastDirection) {
      lastDirection = dir;
      startRepeat(dir);
    }
  }, { passive: false });

  base.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!joystickActive) return;
    const pos = getPos(e);
    const dx = pos.x - joystickOrigin.x;
    const dy = pos.y - joystickOrigin.y;
    moveKnob(dx, dy);
    const dir = getDirection(dx, dy);
    if (dir !== lastDirection) {
      lastDirection = dir;
      if (dir) startRepeat(dir);
      else stopRepeat();
    }
  }, { passive: false });

  base.addEventListener('touchend', (e) => {
    e.preventDefault();
    joystickActive = false;
    resetKnob();
    stopRepeat();
  }, { passive: false });

  base.addEventListener('touchcancel', () => {
    joystickActive = false;
    resetKnob();
    stopRepeat();
  });
}

// ── 액션 함수 ──────────────────────────────────────────────
function getActiveTetris() {
  return (typeof tetris !== 'undefined' && tetris && tetris.running) ? tetris : null;
}

function tcLeft() {
  const t = getActiveTetris();
  if (!t) return;
  if (!t._collides(t.current.shape, t.current.x - 1, t.current.y)) t.current.x--;
}

function tcRight() {
  const t = getActiveTetris();
  if (!t) return;
  if (!t._collides(t.current.shape, t.current.x + 1, t.current.y)) t.current.x++;
}

function tcDown() {
  const t = getActiveTetris();
  if (!t) return;
  if (!t._collides(t.current.shape, t.current.x, t.current.y + 1)) {
    t.current.y++;
    t.score += 1;
  }
}

function tcRotate(e) {
  if (e) e.preventDefault();
  const t = getActiveTetris();
  if (!t) return;
  t._tryRotate();
  const btn = document.getElementById('tc-rotate');
  if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
}

function tcHardDrop(e) {
  if (e) e.preventDefault();
  const t = getActiveTetris();
  if (!t) return;
  t.hardDrop();
  const btn = document.getElementById('tc-hard');
  if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
}

// ── 화면 전환 감지 → 컨트롤러 표시/숨김 ─────────────────────
const GAME_SCREENS = ['vs-game-screen', 'solo-game-screen', 'game-screen'];

function updateTouchCtrl() {
  if (!isMobile()) return;
  const ctrl = document.getElementById('touch-ctrl');
  if (!ctrl) return;
  const activeScreen = document.querySelector('.screen.active');
  const isGameScreen = activeScreen && GAME_SCREENS.includes(activeScreen.id);
  ctrl.classList.toggle('visible', isGameScreen);
  // 패딩 처리
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('has-touch-ctrl'));
  if (isGameScreen && activeScreen) activeScreen.classList.add('has-touch-ctrl');
}

// showScreen 래핑해서 컨트롤러 업데이트
(function patchShowScreen() {
  // 원본 showScreen이 정의된 후 실행되도록 DOMContentLoaded 이후에 패치
  document.addEventListener('DOMContentLoaded', () => {
    if (!isMobile()) return;
    injectTouchController();

    // MutationObserver로 active 클래스 변화 감지
    const observer = new MutationObserver(() => updateTouchCtrl());
    document.querySelectorAll('.screen').forEach(s => {
      observer.observe(s, { attributes: true, attributeFilter: ['class'] });
    });
    updateTouchCtrl();
  });
})();

// 모바일 확인 후 즉시도 실행 (DOMContentLoaded 이미 지났을 경우 대비)
if (document.readyState !== 'loading') {
  if (isMobile()) {
    injectTouchController();
    setTimeout(() => {
      const observer = new MutationObserver(() => updateTouchCtrl());
      document.querySelectorAll('.screen').forEach(s => {
        observer.observe(s, { attributes: true, attributeFilter: ['class'] });
      });
      updateTouchCtrl();
    }, 100);
  }
}
