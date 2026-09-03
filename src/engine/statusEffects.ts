import type { Character, StatModifiers, StatusTemplate } from './types';

// ---- 버프/디버프 템플릿 모음 ----
// durationType: 'turn'  -> 소유자의 턴이 끝날 때마다 1씩 감소
// durationType: 'time'  -> 실시간(ms)으로 계속 감소 (턴과 무관하게 흐름)

export const IronWall: StatusTemplate = {
  defId: 'iron_wall',
  name: '철벽',
  icon: '🛡️',
  kind: 'buff',
  durationType: 'turn',
  turns: 2,
  modifiers: { dmgTakenMult: -0.2 },
};

export const ArmorBreak: StatusTemplate = {
  defId: 'armor_break',
  name: '방어 파괴',
  icon: '💥',
  kind: 'debuff',
  durationType: 'turn',
  turns: 2,
  modifiers: { def: -0.2 },
};

export const Curse: StatusTemplate = {
  defId: 'curse',
  name: '저주',
  icon: '☠️',
  kind: 'debuff',
  durationType: 'turn',
  turns: 3,
  modifiers: { def: -0.25 },
};

export const Rage: StatusTemplate = {
  defId: 'rage',
  name: '분노',
  icon: '😡',
  kind: 'buff',
  durationType: 'turn',
  turns: 2,
  modifiers: { atk: 0.2 },
};

export const Blessing: StatusTemplate = {
  defId: 'blessing',
  name: '가호',
  icon: '✨',
  kind: 'buff',
  durationType: 'turn',
  turns: 2,
  modifiers: { dmgTakenMult: -0.15 },
};

export const Burn: StatusTemplate = {
  defId: 'burn',
  name: '화상',
  icon: '🔥',
  kind: 'debuff',
  durationType: 'time',
  ms: 4000,
  tick: { intervalMs: 1000, atkMultiplier: 0.12 },
};

export const Poison: StatusTemplate = {
  defId: 'poison',
  name: '중독',
  icon: '🐍',
  kind: 'debuff',
  durationType: 'time',
  ms: 5000,
  tick: { intervalMs: 1000, atkMultiplier: 0.1 },
};

export const Sprint: StatusTemplate = {
  defId: 'sprint',
  name: '질주',
  icon: '💨',
  kind: 'buff',
  durationType: 'turn',
  turns: 2,
  modifiers: { spd: 0.25 },
};

export const Bulwark: StatusTemplate = {
  defId: 'bulwark',
  name: '방벽',
  icon: '🧱',
  kind: 'buff',
  durationType: 'turn',
  turns: 2,
  modifiers: { def: 0.3 },
};

export const Regen: StatusTemplate = {
  defId: 'regen',
  name: '재생',
  icon: '💚',
  kind: 'buff',
  durationType: 'time',
  ms: 4000,
  tick: { intervalMs: 1000, atkMultiplier: 0.12, isHeal: true },
};

/** 스탯 보정치들을 합산해 배율을 만든다 (여러 상태 중첩 가능) */
function sumModifier(statuses: Character['statuses'], key: keyof StatModifiers): number {
  return statuses.reduce((sum, s) => sum + (s.modifiers?.[key] ?? 0), 0);
}

export function effectiveAtk(c: Character): number {
  return Math.max(1, c.base.atk * (1 + sumModifier(c.statuses, 'atk')));
}

export function effectiveDef(c: Character): number {
  return Math.max(0, c.base.def * (1 + sumModifier(c.statuses, 'def')));
}

export function effectiveSpd(c: Character): number {
  return Math.max(1, c.base.spd * (1 + sumModifier(c.statuses, 'spd')));
}

export function dmgDealtMult(c: Character): number {
  return Math.max(0, 1 + sumModifier(c.statuses, 'dmgDealtMult'));
}

export function dmgTakenMult(c: Character): number {
  return Math.max(0, 1 + sumModifier(c.statuses, 'dmgTakenMult'));
}
