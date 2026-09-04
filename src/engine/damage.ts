import type { Character, DamageType, Element } from './types';
import {
  critDamage,
  critRate,
  dmgDealtMult,
  dmgTakenMult,
  effectiveAtk,
  effectiveDef,
  elementDmgDealtIncrease,
  elementDmgTakenIncrease,
  finalDmgIncrease,
  magicDmgDealtIncrease,
  magicDmgTakenIncrease,
  physDmgDealtIncrease,
  physDmgTakenIncrease,
} from './statusEffects';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * "적 방어력 계수": DEF가 100이면 절반, DEF가 오를수록 0에 가까워지지만 완전히 0이 되지는 않는
 * 체감형 곡선(100/(100+DEF))을 기본값으로 채택했다. 상수 100은 이 데모의 DEF 스탯 범위(약 45~130)에서
 * 기존 밸런스와 비슷한 경감폭이 나오도록 고른 값이라 나중에 얼마든지 조정 가능하다.
 */
function defenseCoefficient(target: Character): number {
  return 100 / (100 + effectiveDef(target));
}

/** 물리|마법 내성과 속성 내성은 합연산으로 더해진다. 도트(dot)는 물리/마법 구분이 없다. */
function resistanceFraction(target: Character, damageType: DamageType | 'dot', element: Element): number {
  const typeResist = damageType === 'physical' ? target.resistances.physical : damageType === 'magical' ? target.resistances.magical : 0;
  const elementResist = target.resistances.elements[element] ?? 0;
  return typeResist + elementResist;
}

export interface DamageParams {
  attacker: Character;
  target: Character;
  atkMultiplier: number;
  /** 일반 피해는 물리/마법 구분이 있고, 지속피해(도트)는 구분 없이 'dot'으로 취급한다 (속성만 적용). */
  damageType: DamageType | 'dot';
  element: Element;
  /** 피해량 증가(고정치) — 장비 등으로 확장 예정, 기본 0 */
  flatBonus?: number;
}

export interface DamageResult {
  amount: number;
  isCrit: boolean;
}

/**
 * 최종 피해 공식 (사용자 정의):
 *   ((공격력 * 계수) + 피해량증가)
 *   * (1 + 물리|마법 피해증가 + 속성 피해증가 + 전체 피해증가)
 *   * (최종 피해증가)
 *   * (1 - (적 물리|마법 내성 + 적 속성 내성))
 *   * (1 + 적이 받는 물리|마법 피해증가 + 받는 속성 피해증가 + 받는 피해증가)
 *   * (치명타)
 *   * (적 방어력 계수)
 *
 * 참고: 원 설계에는 "최종피해증가" 항이 공식 양 끝에 두 번 등장하는데, 같은 배율을 두 번 곱하면
 * 사실상 제곱이 되어 의도한 동작으로 보기 어려워 한 번만 곱하도록 정리했다. 두 곳에 서로 다른
 * 배율(예: 하나는 시전자 버프용, 하나는 별도 시스템용)을 두고 싶다면 finalDmgIncrease를 두 개의
 * 필드로 나누면 된다.
 * 지속피해(도트)는 물리/마법 내성·피해증가 항이 적용되지 않고(구분이 없으므로 0 취급), 치명타도
 * 발생하지 않으며, 방어력 계수도 무시한다(도트는 갑옷을 관통하는 "순수 피해"로 취급) — 속성 관련
 * 항과 전체/최종 피해증가, 방어측 내성/받는 피해증가만 적용된다.
 */
export function computeDamage(params: DamageParams): DamageResult {
  const { attacker, target, atkMultiplier, damageType, element, flatBonus = 0 } = params;
  const isDot = damageType === 'dot';

  const base = effectiveAtk(attacker) * atkMultiplier + flatBonus;

  const dealtIncrease = Math.max(
    0,
    1 +
      (damageType === 'physical' ? physDmgDealtIncrease(attacker) : 0) +
      (damageType === 'magical' ? magicDmgDealtIncrease(attacker) : 0) +
      elementDmgDealtIncrease(attacker, element) +
      (dmgDealtMult(attacker) - 1),
  );

  const finalMult = Math.max(0, 1 + finalDmgIncrease(attacker));

  const resistFraction = clamp(resistanceFraction(target, damageType, element), -1, 0.95);
  const mitigationMult = 1 - resistFraction;

  const takenIncrease = Math.max(
    0,
    1 +
      (damageType === 'physical' ? physDmgTakenIncrease(target) : 0) +
      (damageType === 'magical' ? magicDmgTakenIncrease(target) : 0) +
      elementDmgTakenIncrease(target, element) +
      (dmgTakenMult(target) - 1),
  );

  const isCrit = !isDot && Math.random() < critRate(attacker);
  const critMult = isCrit ? critDamage(attacker) : 1;

  const defMult = isDot ? 1 : defenseCoefficient(target);

  const raw = base * dealtIncrease * finalMult * mitigationMult * takenIncrease * critMult * defMult;
  return { amount: Math.max(1, Math.round(raw)), isCrit };
}
