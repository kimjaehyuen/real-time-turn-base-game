import './style.css';
import { BattleEngine } from './engine/battle';
import { renderApp, resetUiCaches } from './ui/render';
import type { Character } from './engine/types';
import type { ActionKey, PendingAction, UiHandlers } from './ui/types';

const engine = new BattleEngine();
let pending: PendingAction | null = null;
/** 키보드 1~4로 선택된 아군 캐릭터 (Q/E/Space가 이 캐릭터에게 적용된다) */
let selectedActorId: string | null = null;

/** 대상 선택 상태를 바꿀 때는 항상 이 함수로: 엔진에도 함께 알려 게이지 충전을 멈추거나 재개한다. */
function setPending(next: PendingAction | null): void {
  pending = next;
  engine.setTargetSelectionPaused(pending !== null);
}

function execute(actorId: string, key: ActionKey, targetId?: string): void {
  if (key === 'ultimate') engine.performUltimate(actorId, targetId);
  else engine.performAction(actorId, key, targetId);
  setPending(null);
}

function chooseAction(actorId: string, key: ActionKey): void {
  const actor = engine.findById(actorId);
  if (!actor) return;
  const skillDef = key === 'ultimate' ? actor.skills.ultimate : actor.skills[key];
  const { targetType } = skillDef;

  // 전체/자신 대상 스킬은 대상 선택 없이 즉시 실행, 단일 대상 스킬은 선택 모드로 전환
  if (targetType === 'allEnemies' || targetType === 'allAllies' || targetType === 'self') {
    execute(actorId, key);
    render();
    return;
  }
  setPending({ actorId, key, targetType });
  render();
}

const handlers: UiHandlers = {
  onChooseAction: chooseAction,
  onChooseTarget: (targetId) => {
    if (!pending) return;
    execute(pending.actorId, pending.key, targetId);
    render();
  },
  onCancelPending: () => {
    setPending(null);
    render();
  },
  onReset: () => {
    engine.reset();
    setPending(null);
    selectedActorId = null;
    resetUiCaches();
    render();
  },
};

function render(): void {
  renderApp(engine, pending, selectedActorId, handlers);
}

// -------------------------------------------------------------------------
// 키보드 조작: 1~4 캐릭터 선택, Q 일반공격, E 스킬, Space 필살기
// -------------------------------------------------------------------------
function playerSlot(index: number): Character | undefined {
  return engine.characters.filter((c) => c.team === 'player')[index];
}

function canAct(actor: Character, key: ActionKey): boolean {
  if (!actor.alive) return false;
  if (key === 'ultimate') return actor.energy >= actor.maxEnergy;
  if (!engine.isReady(actor.id)) return false;
  if (key === 'skill') {
    const cost = actor.skills.skill.spCost ?? 0;
    return engine.sp >= cost;
  }
  return true;
}

function triggerSelected(key: ActionKey): void {
  if (!selectedActorId) return;
  const actor = engine.findById(selectedActorId);
  if (!actor || !canAct(actor, key)) return;
  chooseAction(actor.id, key);
}

window.addEventListener('keydown', (e) => {
  if (engine.status !== 'ongoing') return;
  if (e.repeat) return;

  if (e.key >= '1' && e.key <= '4') {
    const actor = playerSlot(Number(e.key) - 1);
    if (actor) {
      selectedActorId = actor.id;
      render();
    }
    return;
  }
  if (e.key === 'q' || e.key === 'Q') {
    triggerSelected('normal');
    return;
  }
  if (e.key === 'e' || e.key === 'E') {
    triggerSelected('skill');
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    triggerSelected('ultimate');
  }
});

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
  setPending(null);
  selectedActorId = null;
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
    render();
  }
  requestAnimationFrame(frame);
}

render();
requestAnimationFrame(frame);
