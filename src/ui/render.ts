import { BattleEngine, GAUGE_MAX } from '../engine/battle';
import type { Character, StatusEffect } from '../engine/types';
import type { PendingAction, UiHandlers } from './types';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function statusRemainLabel(s: StatusEffect): string {
  return s.durationType === 'turn'
    ? `${Math.max(0, s.remainingTurns)}턴`
    : `${Math.max(0, s.remainingMs / 1000).toFixed(1)}초`;
}

function isValidTarget(engine: BattleEngine, pending: PendingAction, c: Character): boolean {
  if (!c.alive) return false;
  return engine.getValidTargets(pending.actorId, pending.targetType).some((t) => t.id === c.id);
}

// ---------------------------------------------------------------------------
// 컨트롤 바 (일시정지 / 배속 / 재시작) — 정적 버튼의 상태만 동기화
// ---------------------------------------------------------------------------
export function syncControls(engine: BattleEngine): void {
  const pauseBtn = byId('btn-pause');
  pauseBtn.textContent = engine.paused ? '▶ 재개' : '⏸ 일시정지';
  pauseBtn.classList.toggle('active', engine.paused);

  document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
    const speed = Number(btn.dataset.speed);
    btn.classList.toggle('active', speed === engine.timeScale);
  });
}

// ---------------------------------------------------------------------------
// 좌하단(적 -> 아군) / 우상단(아군 -> 적) 피해량 표시 — 숫자만 표시하며,
// 그 편이 새 행동을 시작할 때마다 각각 리셋된다 (engine이 관리).
// ---------------------------------------------------------------------------
function renderDamageIndicators(engine: BattleEngine): void {
  const right = byId('dmg-right'); // 아군 -> 적
  const left = byId('dmg-left'); // 적 -> 아군

  right.hidden = engine.lastPlayerDamage <= 0;
  right.textContent = engine.lastPlayerDamage > 0 ? String(engine.lastPlayerDamage) : '';

  left.hidden = engine.lastEnemyDamage <= 0;
  left.textContent = engine.lastEnemyDamage > 0 ? String(engine.lastEnemyDamage) : '';
}

// ---------------------------------------------------------------------------
// 캐릭터 카드
// 구조(버튼/상태칩/뱃지 등)는 "구조 시그니처"가 바뀔 때만 다시 그리고,
// 매 프레임 바뀌는 수치(HP/게이지/에너지/남은시간)는 캐시된 엘리먼트를 직접 갱신한다.
// 이렇게 하지 않으면 렌더 주기마다 버튼이 통째로 교체되어 클릭 이벤트가 유실되거나
// 리스너가 반복 등록될 수 있다.
// ---------------------------------------------------------------------------
interface StatusChipHandle {
  chip: HTMLElement;
  remain: HTMLElement;
}

interface CardHandle {
  root: HTMLElement;
  /** 이 값이 바뀔 때만 카드를 통째로 다시 만든다 (클릭 리스너의 "종류"가 달라지는 경우만). */
  signature: string;
  hpFill: HTMLElement;
  hpLabel: HTMLElement;
  atbFill: HTMLElement;
  atbLabel: HTMLElement;
  energyFill: HTMLElement;
  energyLabel: HTMLElement;
  ultSlot: HTMLElement;
  slotKeyEl: HTMLElement | null;
  turnBadgeEl: HTMLElement | null;
  statusRow: HTMLElement;
  statusChips: Map<string, StatusChipHandle>;
}

const cardCache = new Map<string, CardHandle>();

export function clearCardCache(): void {
  cardCache.clear();
}

type ClickMode = 'target' | 'select' | 'none';

/** 카드를 클릭했을 때 실제로 무엇이 일어나야 하는지 하나로 결정한다 (리스너를 이 값 하나로만 결정한다). */
function clickMode(engine: BattleEngine, c: Character, pending: PendingAction | null): ClickMode {
  if (pending) return isValidTarget(engine, pending, c) ? 'target' : 'none';
  if (c.team === 'player' && c.alive && engine.isReady(c.id)) return 'select';
  return 'none';
}

/**
 * 카드를 통째로 다시 만들어야 하는 경우만 구분한다: 죽음/부활, 준비 상태, 그리고 클릭 모드처럼
 * "카드 클릭이 무엇을 하는지"(대상 선택 vs 캐릭터 선택 vs 아무것도 안 함)가 바뀔 때뿐이다.
 * (클릭 리스너는 buildCard 시점에 이 값으로만 결정되므로, pending의 유무 자체도 반드시 여기 포함해야
 * 한다 — 그렇지 않으면 다른 캐릭터의 대상 선택이 진행 중인 동안에도 이 카드에는 "평소" 리스너가
 * 그대로 남아있어 클릭이 엉뚱하게 동작할 수 있다.)
 * 필살기 충전 상태, 선택 여부, 상태이상 목록처럼 자주 바뀌는 값은 여기 포함하지 않고
 * updateCardDynamics()가 노드를 바꾸지 않은 채 그 자리에서 갱신한다 — 그렇지 않으면 사용자가
 * 마우스 버튼을 누르고 있는 그 짧은 순간에 카드가 재생성되어 클릭이 씹힐 수 있다.
 */
function cardSignature(engine: BattleEngine, c: Character, pending: PendingAction | null): string {
  return [c.alive ? 'a' : 'd', engine.isReady(c.id) ? 'ready' : 'idle', clickMode(engine, c, pending)].join('|');
}

function buildBar(label: string, kind: string): { wrap: HTMLElement; fill: HTMLElement; labelEl: HTMLElement } {
  const wrap = el('div', `bar-wrap ${kind}-wrap`);
  const labelEl = el('div', 'bar-label-row', label);
  const track = el('div', `bar-track ${kind}-track`);
  const fill = el('div', `bar-fill ${kind}-fill`);
  track.appendChild(fill);
  wrap.appendChild(labelEl);
  wrap.appendChild(track);
  return { wrap, fill, labelEl };
}

function buildCard(engine: BattleEngine, c: Character, pending: PendingAction | null, handlers: UiHandlers): CardHandle {
  const classes = ['char-card', `team-${c.team}`, c.alive ? '' : 'dead', engine.isReady(c.id) ? 'active-turn' : '']
    .filter(Boolean)
    .join(' ');
  const root = el('div', classes);

  const mode = clickMode(engine, c, pending);
  if (mode === 'target') {
    // 대상 선택 중에는 카드 클릭이 항상 "대상 지정"이다.
    root.classList.add('targetable');
    root.addEventListener('click', () => handlers.onChooseTarget(c.id));
  } else if (mode === 'select') {
    // 평소에는 준비된 아군 카드를 클릭해 "행동할 캐릭터"로 선택한다 (다시 클릭하면 선택 해제).
    root.classList.add('selectable');
    root.addEventListener('click', () => handlers.onSelectActor(c.id));
  }

  let slotKeyEl: HTMLElement | null = null;
  if (c.team === 'player') {
    const slotIndex = engine.characters.filter((p) => p.team === 'player').indexOf(c);
    if (slotIndex >= 0 && slotIndex < 4) {
      slotKeyEl = el('div', 'slot-key', String(slotIndex + 1));
      root.appendChild(slotKeyEl);
    }
  }

  const head = el('div', 'card-head');
  head.appendChild(el('div', 'portrait', c.portrait));
  const nameCol = el('div', 'name-col');
  nameCol.appendChild(el('div', 'name', c.name));
  nameCol.appendChild(el('div', 'spd-label', `SPD ${Math.round(c.base.spd)}`));
  head.appendChild(nameCol);
  root.appendChild(head);

  // 뱃지는 "활성 상태가 아닐 때도" 항상 자리를 차지하도록 만들어 둔다 (visibility로만 감춤).
  // 그렇지 않으면 다른 카드가 준비 상태로 바뀔 때마다 그 카드의 높이가 바뀌어 같은 행/아래 행의
  // 카드들이 화면에서 위아래로 밀리고, 그 순간 다른 카드를 클릭 중이던 사용자의 클릭이 빗나갈 수 있다.
  const turnBadgeEl = el('div', 'turn-badge');
  root.appendChild(turnBadgeEl);

  const hp = buildBar('HP', 'hp');
  root.appendChild(hp.wrap);
  const atb = buildBar('ATB', 'atb');
  root.appendChild(atb.wrap);
  const energy = buildBar('필살기', 'energy');
  root.appendChild(energy.wrap);

  // 상태 표시줄은 비어 있어도 항상 만들어 둔다: 상태이상이 붙고 떨어질 때마다 이 칸이
  // 나타났다 사라지면 같은 줄의 다른 카드들 높이가 흔들려, 그 순간 클릭 중이던 카드가
  // 화면에서 살짝 밀려나며 클릭이 빗나갈 수 있다.
  const statusRow = el('div', 'status-row');
  root.appendChild(statusRow);

  const ultSlot = el('div', 'ult-slot');
  if (c.alive) {
    if (c.team === 'player') {
      const btn = el('button', 'ult-btn');
      btn.title = c.skills.ultimate.description;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onChooseAction(c.id, 'ultimate');
      });
      ultSlot.appendChild(btn);
    } else {
      ultSlot.appendChild(el('div', 'ult-indicator'));
    }
  }
  root.appendChild(ultSlot);

  return {
    root,
    signature: cardSignature(engine, c, pending),
    hpFill: hp.fill,
    hpLabel: hp.labelEl,
    atbFill: atb.fill,
    atbLabel: atb.labelEl,
    energyFill: energy.fill,
    energyLabel: energy.labelEl,
    ultSlot,
    slotKeyEl,
    turnBadgeEl,
    statusRow,
    statusChips: new Map(),
  };
}

/** 매 프레임 바뀌는 수치/상태를 캐시된 엘리먼트에 직접 반영한다 (카드 루트 노드는 절대 건드리지 않음) */
function updateCardDynamics(engine: BattleEngine, c: Character, handle: CardHandle, selectedActorId: string | null): void {
  const hpPct = c.maxHp > 0 ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0;
  handle.hpFill.style.width = `${hpPct}%`;
  handle.hpLabel.textContent = `HP · ${Math.max(0, Math.round(c.hp))} / ${c.maxHp}`;

  const gaugePct = Math.max(0, Math.min(100, (c.gauge / GAUGE_MAX) * 100));
  const gaugeText = engine.isReady(c.id) ? '행동 대기' : '충전 중';
  handle.atbFill.style.width = `${gaugePct}%`;
  handle.atbLabel.textContent = `ATB · ${gaugeText}`;

  const energyPct = Math.max(0, Math.min(100, (c.energy / c.maxEnergy) * 100));
  const ultReady = c.energy >= c.maxEnergy;
  handle.energyFill.style.width = `${energyPct}%`;
  handle.energyLabel.textContent = `필살기 · ${Math.floor(energyPct)}%`;

  // 상태이상 칩을 diff한다: 사라진 것만 지우고, 새로 생긴 것만 추가하고, 나머지는 남은시간만 갱신한다.
  const currentIds = new Set(c.statuses.map((s) => s.id));
  for (const [id, chipHandle] of handle.statusChips) {
    if (!currentIds.has(id)) {
      chipHandle.chip.remove();
      handle.statusChips.delete(id);
    }
  }
  for (const s of c.statuses) {
    let chipHandle = handle.statusChips.get(s.id);
    if (!chipHandle) {
      const chip = el('div', `status-chip ${s.kind}`, s.icon);
      chip.title = s.name;
      const remain = el('span', 'status-remain');
      chip.appendChild(remain);
      handle.statusRow.appendChild(chip);
      chipHandle = { chip, remain };
      handle.statusChips.set(s.id, chipHandle);
    }
    chipHandle.remain.textContent = statusRemainLabel(s);
  }

  handle.root.classList.toggle('selected-for-action', c.id === selectedActorId);

  if (handle.turnBadgeEl) {
    const ready = engine.isReady(c.id);
    handle.turnBadgeEl.classList.toggle('active', ready);
    if (!ready) {
      handle.turnBadgeEl.textContent = '';
    } else if (c.team === 'player') {
      handle.turnBadgeEl.textContent = c.id === selectedActorId ? '선택됨 — Q 일반공격 / E 스킬' : '내 턴 — 클릭해서 선택';
    } else {
      handle.turnBadgeEl.textContent = '공격 준비 중';
    }
  }

  if (handle.slotKeyEl) {
    handle.slotKeyEl.classList.toggle('ready', ultReady);
    handle.slotKeyEl.title = ultReady
      ? '지금 이 키로 필살기를 사용할 수 있습니다'
      : `필살기가 준비되면 ${handle.slotKeyEl.textContent}키로 즉시 사용`;
  }

  if (c.alive && c.team === 'player') {
    const btn = handle.ultSlot.querySelector('.ult-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.classList.toggle('ready', ultReady);
      btn.disabled = !ultReady;
      btn.textContent = ultReady ? `💫 필살기: ${c.skills.ultimate.name}` : `필살기 충전 중 (${Math.floor(energyPct)}%)`;
    }
  } else if (c.alive && c.team === 'enemy') {
    const indicator = handle.ultSlot.querySelector('.ult-indicator') as HTMLElement | null;
    if (indicator) {
      indicator.classList.toggle('ready', ultReady);
      indicator.textContent = ultReady ? '💫 필살기 준비!' : `필살기 ${Math.floor(energyPct)}%`;
    }
  }
}

function renderParty(
  engine: BattleEngine,
  team: 'player' | 'enemy',
  pending: PendingAction | null,
  selectedActorId: string | null,
  handlers: UiHandlers,
): void {
  const container = byId(team === 'player' ? 'player-party' : 'enemy-party');
  const members = engine.characters.filter((c) => c.team === team);
  const keepNodes = new Set<Element>();

  // 카드가 바뀌지 않았다면 DOM에 손대지 않는다. 매 프레임 innerHTML을 통째로 비우고 다시 채우면,
  // 사용자가 마우스 버튼을 누르고 떼는 그 짧은 순간에 렌더 틱이 끼어들어 카드가 문서에서
  // 떨어져나갔다 다시 붙는 바람에 클릭(대상 선택/캐릭터 선택)이 씹힐 수 있다.
  for (const c of members) {
    const sig = cardSignature(engine, c, pending);
    const cached = cardCache.get(c.id);
    let handle: CardHandle;
    if (!cached || cached.signature !== sig) {
      handle = buildCard(engine, c, pending, handlers);
      cardCache.set(c.id, handle);
      if (cached && cached.root.isConnected) {
        cached.root.replaceWith(handle.root);
      }
    } else {
      handle = cached;
    }
    updateCardDynamics(engine, c, handle, selectedActorId);
    if (!handle.root.isConnected) {
      container.appendChild(handle.root);
    }
    keepNodes.add(handle.root);
  }

  // 전투 재시작 등으로 더 이상 유효하지 않은(이전 전투의) 카드가 남아있다면 정리한다.
  for (const child of [...container.children]) {
    if (!keepNodes.has(child)) child.remove();
  }
}

// ---------------------------------------------------------------------------
// 공유 SP 바 — 아군 전체가 공유하는 스킬 포인트. 매 프레임 값만 갱신한다.
// ---------------------------------------------------------------------------
function renderSpBar(engine: BattleEngine): void {
  const container = byId('sp-bar');
  if (!container.childElementCount) {
    container.appendChild(el('span', 'sp-bar-label', 'SP'));
    const pips = el('div', 'sp-pips');
    for (let i = 0; i < engine.maxSp; i++) {
      pips.appendChild(el('div', 'sp-pip'));
    }
    container.appendChild(pips);
    container.appendChild(el('span', 'sp-bar-value', ''));
  }

  const pipEls = container.querySelectorAll<HTMLElement>('.sp-pip');
  pipEls.forEach((pip, i) => pip.classList.toggle('filled', i < engine.sp));
  const valueEl = container.querySelector('.sp-bar-value');
  if (valueEl) valueEl.textContent = `${engine.sp} / ${engine.maxSp}`;
}

// ---------------------------------------------------------------------------
// 하단 액션 패널: 클릭으로 선택된 "그 한 캐릭터"의 일반공격(Q)/스킬(E) 선택.
// 준비된 캐릭터가 여럿이어도 한 번에 한 명만 선택되며, 다른 준비된 카드를 클릭하면
// 선택이 바뀐다 (적은 각자 독립적인 타이밍에 따로 행동한다).
// (필살기는 각 캐릭터 카드의 버튼 — 또는 키보드 1~4 — 로 언제든 별도 사용, 여기 포함되지 않음)
// 상태가 바뀔 때만 다시 그린다.
// ---------------------------------------------------------------------------
let lastPanelSignature = '';

function renderActionPanel(engine: BattleEngine, pending: PendingAction | null, selectedActorId: string | null, handlers: UiHandlers): void {
  const selected = selectedActorId ? engine.findById(selectedActorId) : undefined;
  const signature = `${engine.status}|${selected?.id ?? ''}|${pending ? `${pending.actorId}:${pending.key}` : ''}|sp${engine.sp}`;
  if (signature === lastPanelSignature) return;
  lastPanelSignature = signature;

  const container = byId('action-panel');
  const panel = el('div', 'action-panel-inner');

  if (engine.status !== 'ongoing') {
    container.innerHTML = '';
    container.appendChild(panel);
    return;
  }

  if (!selected || !selected.alive || !engine.isReady(selected.id)) {
    panel.appendChild(el('div', 'hint', '턴이 활성화된 아군 카드를 클릭해 선택하세요.'));
    container.innerHTML = '';
    container.appendChild(panel);
    return;
  }

  if (pending && pending.actorId === selected.id) {
    const kindLabel = pending.key === 'skill' ? '스킬' : pending.key === 'ultimate' ? '필살기' : '일반 공격';
    panel.appendChild(el('div', 'hint', `${kindLabel} 대상을 선택하세요 (강조된 대상을 클릭)`));
    const cancelBtn = el('button', 'ctrl-btn cancel', '취소');
    cancelBtn.addEventListener('click', () => handlers.onCancelPending());
    panel.appendChild(cancelBtn);
    container.innerHTML = '';
    container.appendChild(panel);
    return;
  }

  panel.appendChild(el('div', 'ready-actor-name', `${selected.portrait} ${selected.name}`));
  const btnRow = el('div', 'action-buttons');
  const normalBtn = el('button', 'action-btn', `${selected.skills.normal.name} (Q)`);
  normalBtn.title = selected.skills.normal.description;
  normalBtn.addEventListener('click', () => handlers.onChooseAction(selected.id, 'normal'));

  const spCost = selected.skills.skill.spCost ?? 0;
  const canAffordSkill = engine.sp >= spCost;
  const skillBtn = el(
    'button',
    `action-btn skill${canAffordSkill ? '' : ' disabled'}`,
    `${selected.skills.skill.name} (E · SP ${spCost})`,
  );
  skillBtn.title = selected.skills.skill.description;
  skillBtn.disabled = !canAffordSkill;
  skillBtn.addEventListener('click', () => handlers.onChooseAction(selected.id, 'skill'));

  btnRow.appendChild(normalBtn);
  btnRow.appendChild(skillBtn);
  panel.appendChild(btnRow);
  container.innerHTML = '';
  container.appendChild(panel);
}

export function resetActionPanelCache(): void {
  lastPanelSignature = '';
}

// ---------------------------------------------------------------------------
// 승패 오버레이
// ---------------------------------------------------------------------------
function renderOverlay(engine: BattleEngine, handlers: UiHandlers): void {
  const overlay = byId('overlay');
  const title = byId('overlay-title');
  const resetBtn = byId('overlay-reset') as HTMLButtonElement;

  if (engine.status === 'ongoing') {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  title.textContent = engine.status === 'player_win' ? '🎉 승리했습니다!' : '💀 패배했습니다...';
  resetBtn.onclick = () => handlers.onReset();
}

export function renderApp(
  engine: BattleEngine,
  pending: PendingAction | null,
  selectedActorId: string | null,
  handlers: UiHandlers,
): void {
  syncControls(engine);
  renderSpBar(engine);
  renderDamageIndicators(engine);
  renderParty(engine, 'enemy', pending, selectedActorId, handlers);
  renderParty(engine, 'player', pending, selectedActorId, handlers);
  renderActionPanel(engine, pending, selectedActorId, handlers);
  renderOverlay(engine, handlers);
}

export function resetUiCaches(): void {
  clearCardCache();
  resetActionPanelCache();
}
