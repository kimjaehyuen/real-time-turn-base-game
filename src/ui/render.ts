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
interface CardHandle {
  root: HTMLElement;
  signature: string;
  hpFill: HTMLElement;
  hpLabel: HTMLElement;
  atbFill: HTMLElement;
  atbLabel: HTMLElement;
  energyFill: HTMLElement;
  energyLabel: HTMLElement;
  ultSlot: HTMLElement;
  statusRemainEls: Map<string, HTMLElement>;
}

const cardCache = new Map<string, CardHandle>();

export function clearCardCache(): void {
  cardCache.clear();
}

function cardSignature(engine: BattleEngine, c: Character, pending: PendingAction | null, selectedActorId: string | null): string {
  const targetable = !!pending && isValidTarget(engine, pending, c);
  const ultReady = c.energy >= c.maxEnergy;
  const statusSig = c.statuses.map((s) => s.id).join(',');
  return [
    c.alive ? 'a' : 'd',
    engine.isReady(c.id) ? 'ready' : 'idle',
    targetable ? 'targetable' : '',
    ultReady ? 'ultready' : '',
    c.id === selectedActorId ? 'selected' : '',
    statusSig,
  ].join('|');
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

function buildCard(
  engine: BattleEngine,
  c: Character,
  pending: PendingAction | null,
  selectedActorId: string | null,
  handlers: UiHandlers,
): CardHandle {
  const isSelected = c.id === selectedActorId;
  const classes = [
    'char-card',
    `team-${c.team}`,
    c.alive ? '' : 'dead',
    engine.isReady(c.id) ? 'active-turn' : '',
    isSelected ? 'selected-for-action' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const root = el('div', classes);

  const targetable = !!pending && isValidTarget(engine, pending, c);
  if (targetable) {
    // 대상 선택 중에는 카드 클릭이 항상 "대상 지정"이다.
    root.classList.add('targetable');
    root.addEventListener('click', () => handlers.onChooseTarget(c.id));
  } else if (!pending && c.team === 'player' && c.alive && engine.isReady(c.id)) {
    // 평소에는 준비된 아군 카드를 클릭해 "행동할 캐릭터"로 선택한다 (다시 클릭하면 선택 해제).
    root.classList.add('selectable');
    root.addEventListener('click', () => handlers.onSelectActor(c.id));
  }

  if (c.team === 'player') {
    const slotIndex = engine.characters.filter((p) => p.team === 'player').indexOf(c);
    if (slotIndex >= 0 && slotIndex < 4) {
      const ultReady = c.energy >= c.maxEnergy;
      const key = el('div', `slot-key${ultReady ? ' ready' : ''}`, String(slotIndex + 1));
      key.title = ultReady ? '지금 이 키로 필살기를 사용할 수 있습니다' : `필살기가 준비되면 ${slotIndex + 1}키로 즉시 사용`;
      root.appendChild(key);
    }
  }

  const head = el('div', 'card-head');
  head.appendChild(el('div', 'portrait', c.portrait));
  const nameCol = el('div', 'name-col');
  nameCol.appendChild(el('div', 'name', c.name));
  nameCol.appendChild(el('div', 'spd-label', `SPD ${Math.round(c.base.spd)}`));
  head.appendChild(nameCol);
  root.appendChild(head);

  if (engine.isReady(c.id)) {
    const label =
      c.team === 'player' ? (isSelected ? '선택됨 — Q 일반공격 / E 스킬' : '내 턴 — 클릭해서 선택') : '공격 준비 중';
    root.appendChild(el('div', 'turn-badge active', label));
  }

  const hp = buildBar('HP', 'hp');
  root.appendChild(hp.wrap);
  const atb = buildBar('ATB', 'atb');
  root.appendChild(atb.wrap);
  const energy = buildBar('필살기', 'energy');
  root.appendChild(energy.wrap);

  const statusRemainEls = new Map<string, HTMLElement>();
  if (c.statuses.length) {
    const row = el('div', 'status-row');
    for (const s of c.statuses) {
      const chip = el('div', `status-chip ${s.kind}`);
      chip.textContent = s.icon;
      const remain = el('span', 'status-remain', statusRemainLabel(s));
      chip.appendChild(remain);
      row.appendChild(chip);
      statusRemainEls.set(s.id, remain);
    }
    root.appendChild(row);
  }

  const ultSlot = el('div', 'ult-slot');
  if (c.alive) {
    if (c.team === 'player') {
      const ready = c.energy >= c.maxEnergy;
      const btn = el('button', `ult-btn${ready ? ' ready' : ''}`);
      btn.title = c.skills.ultimate.description;
      btn.disabled = !ready;
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
    signature: cardSignature(engine, c, pending, selectedActorId),
    hpFill: hp.fill,
    hpLabel: hp.labelEl,
    atbFill: atb.fill,
    atbLabel: atb.labelEl,
    energyFill: energy.fill,
    energyLabel: energy.labelEl,
    ultSlot,
    statusRemainEls,
  };
}

/** 매 프레임 바뀌는 수치들을 캐시된 엘리먼트에 직접 반영한다 (구조는 건드리지 않음) */
function updateCardDynamics(engine: BattleEngine, c: Character, handle: CardHandle): void {
  const hpPct = c.maxHp > 0 ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0;
  handle.hpFill.style.width = `${hpPct}%`;
  handle.hpLabel.textContent = `HP · ${Math.max(0, Math.round(c.hp))} / ${c.maxHp}`;

  const gaugePct = Math.max(0, Math.min(100, (c.gauge / GAUGE_MAX) * 100));
  const gaugeText = engine.isReady(c.id) ? '행동 대기' : '충전 중';
  handle.atbFill.style.width = `${gaugePct}%`;
  handle.atbLabel.textContent = `ATB · ${gaugeText}`;

  const energyPct = Math.max(0, Math.min(100, (c.energy / c.maxEnergy) * 100));
  handle.energyFill.style.width = `${energyPct}%`;
  handle.energyLabel.textContent = `필살기 · ${Math.floor(energyPct)}%`;

  for (const s of c.statuses) {
    const target = handle.statusRemainEls.get(s.id);
    if (target) target.textContent = statusRemainLabel(s);
  }

  if (c.alive && c.team === 'player') {
    const btn = handle.ultSlot.querySelector('.ult-btn') as HTMLButtonElement | null;
    if (btn) {
      const ready = c.energy >= c.maxEnergy;
      btn.textContent = ready ? `💫 필살기: ${c.skills.ultimate.name}` : `필살기 충전 중 (${Math.floor(energyPct)}%)`;
    }
  } else if (c.alive && c.team === 'enemy') {
    const indicator = handle.ultSlot.querySelector('.ult-indicator') as HTMLElement | null;
    if (indicator) {
      const ready = c.energy >= c.maxEnergy;
      indicator.classList.toggle('ready', ready);
      indicator.textContent = ready ? '💫 필살기 준비!' : `필살기 ${Math.floor(energyPct)}%`;
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

  const frag = document.createDocumentFragment();
  for (const c of members) {
    const sig = cardSignature(engine, c, pending, selectedActorId);
    let handle = cardCache.get(c.id);
    if (!handle || handle.signature !== sig) {
      handle = buildCard(engine, c, pending, selectedActorId, handlers);
      cardCache.set(c.id, handle);
    }
    updateCardDynamics(engine, c, handle);
    frag.appendChild(handle.root);
  }

  container.innerHTML = '';
  container.appendChild(frag);
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
