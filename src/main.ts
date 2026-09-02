import './style.css';
import { BattleEngine } from './engine/battle';
import { renderApp, resetUiCaches } from './ui/render';
import type { ActionKey, PendingAction, UiHandlers } from './ui/types';

const engine = new BattleEngine();
let pending: PendingAction | null = null;

function execute(actorId: string, key: ActionKey, targetId?: string): void {
  if (key === 'ultimate') engine.performUltimate(actorId, targetId);
  else engine.performAction(actorId, key, targetId);
  pending = null;
}

function chooseAction(actorId: string, key: ActionKey): void {
  const actor = engine.findById(actorId);
  if (!actor) return;
  const skillDef = key === 'ultimate' ? actor.skills.ultimate : actor.skills[key];
  const { targetType } = skillDef;

  // 전체/자신 대상 스킬은 대상 선택 없이 즉시 실행, 단일 대상 스킬은 선택 모드로 전환
  if (targetType === 'allEnemies' || targetType === 'allAllies' || targetType === 'self') {
    execute(actorId, key);
    return;
  }
  pending = { actorId, key, targetType };
  renderApp(engine, pending, handlers);
}

const handlers: UiHandlers = {
  onChooseAction: chooseAction,
  onChooseTarget: (targetId) => {
    if (!pending) return;
    execute(pending.actorId, pending.key, targetId);
  },
  onCancelPending: () => {
    pending = null;
    renderApp(engine, pending, handlers);
  },
  onReset: () => {
    engine.reset();
    pending = null;
    resetUiCaches();
    renderApp(engine, pending, handlers);
  },
};

// 정적 컨트롤 버튼은 한 번만 연결한다
document.getElementById('btn-pause')!.addEventListener('click', () => {
  engine.setPaused(!engine.paused);
});
document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    engine.setTimeScale(Number(btn.dataset.speed));
  });
});
document.getElementById('btn-reset')!.addEventListener('click', () => {
  engine.reset();
  pending = null;
  resetUiCaches();
});

// 시뮬레이션은 매 프레임 갱신하되, 렌더링은 살짝 스로틀링해 부드러운 CSS 전환과 함께 사용한다
const RENDER_INTERVAL_MS = 90;
let last = performance.now();
let renderAcc = 0;

function frame(now: number): void {
  const dt = Math.min(now - last, 100);
  last = now;
  engine.update(dt);

  renderAcc += dt;
  if (renderAcc >= RENDER_INTERVAL_MS) {
    renderAcc = 0;
    renderApp(engine, pending, handlers);
  }
  requestAnimationFrame(frame);
}

renderApp(engine, pending, handlers);
requestAnimationFrame(frame);
