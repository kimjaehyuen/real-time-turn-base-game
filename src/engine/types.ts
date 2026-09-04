// 핵심 타입 정의

export type Team = 'player' | 'enemy';

export type DurationType = 'turn' | 'time';

/** 피해 종류: 물리 / 마법. 지속피해(도트)는 이 구분에 속하지 않고 별도로("dot") 취급된다. */
export type DamageType = 'physical' | 'magical';

/** 속성 7종 */
export type Element = 'fire' | 'ice' | 'lightning' | 'wind' | 'earth' | 'dark' | 'light';

/** 스탯에 곱연산으로 적용되는 보정치 (0.2 = +20%, -0.2 = -20%) */
export interface StatModifiers {
  atk?: number;
  def?: number;
  spd?: number;
  /** 받는 피해 전체 증가/감소 (기존 필드, 공식의 "받는 피해증가" 그룹에 합연산으로 편입됨) */
  dmgTakenMult?: number;
  /** 가하는 피해 전체 증가/감소 (기존 필드, 공식의 "전체피해증가" 그룹에 합연산으로 편입됨) */
  dmgDealtMult?: number;
  /** 가하는 물리/마법 피해 증가 */
  physDmgDealtIncrease?: number;
  magicDmgDealtIncrease?: number;
  /** 받는 물리/마법 피해 증가 */
  physDmgTakenIncrease?: number;
  magicDmgTakenIncrease?: number;
  /** 가하는/받는 속성별 피해 증가 (속성마다 따로 지정, 여러 상태이상에 걸쳐 합연산) */
  elementDmgDealtIncrease?: Partial<Record<Element, number>>;
  elementDmgTakenIncrease?: Partial<Record<Element, number>>;
  /** 최종 피해 증가 — 공식의 가장 바깥쪽에서 곱해지는 배율 */
  finalDmgIncrease?: number;
  /** 치명타 확률/배율 보정치 (캐릭터 기본값에 더해짐) */
  critRateAdd?: number;
  critDmgAdd?: number;
}

/** 버프/디버프 하나의 설계도 (인스턴스 생성용 템플릿) */
export interface StatusTemplate {
  defId: string;
  name: string;
  icon: string;
  kind: 'buff' | 'debuff';
  durationType: DurationType;
  /** durationType === 'turn' 일 때: 소유자의 턴이 끝날 때마다 1씩 감소 */
  turns?: number;
  /** durationType === 'time' 일 때: 실제 경과 시간(ms)에 따라 감소 */
  ms?: number;
  modifiers?: StatModifiers;
  /** 시간 기반 상태에서 주기적으로 피해/회복을 발생시키는 도트(DOT/HOT) 효과 */
  tick?: {
    intervalMs: number;
    /** attacker 기준 atk 계수. 양수면 피해, 음수면 회복 취급 */
    atkMultiplier: number;
    isHeal?: boolean;
    /** isHeal이 아닐 때 필수: 이 지속피해의 고정 속성 (예: 화상 -> fire). 물리/마법 구분은 없다. */
    element?: Element;
  };
}

/** 전투 중 캐릭터에게 실제로 붙어있는 상태 효과 인스턴스 */
export interface StatusEffect extends StatusTemplate {
  id: string;
  remainingTurns: number;
  remainingMs: number;
  msSinceLastTick: number;
  sourceId: string;
  sourceName: string;
}

export type TargetType =
  | 'singleEnemy'
  | 'areaEnemy'
  | 'allEnemies'
  | 'singleAlly'
  | 'areaAlly'
  | 'allAllies'
  | 'self';

/** 물리/마법/속성 내성 (%, 0.2 = 20% 경감). 물리|마법 내성과 속성 내성은 합연산으로 더해진다. */
export interface Resistances {
  physical: number;
  magical: number;
  elements: Partial<Record<Element, number>>;
}

export interface Character {
  id: string;
  name: string;
  team: Team;
  portrait: string;
  base: { hp: number; atk: number; def: number; spd: number; critRate: number; critDamage: number };
  /** 이 캐릭터가 가하는 모든 피해에 고정으로 붙는 속성 */
  element: Element;
  /** 이 캐릭터가 받는 피해에 대한 내성 */
  resistances: Resistances;
  hp: number;
  maxHp: number;
  gauge: number;
  energy: number;
  maxEnergy: number;
  alive: boolean;
  statuses: StatusEffect[];
  skills: {
    normal: SkillDef;
    skill: SkillDef;
    ultimate: SkillDef;
  };
}

export interface SkillDef {
  id: string;
  name: string;
  type: 'normal' | 'skill' | 'ultimate';
  description: string;
  targetType: TargetType;
  energyGain: number;
  /** 아군 전체가 공유하는 SP 중 이 행동을 사용하는 데 필요한 양 (기본 0). 주로 skill 타입에 쓰인다. */
  spCost?: number;
  /** 이 행동을 사용하면 공유 SP를 이만큼 회복한다 (기본 0). 일반공격은 보통 1, 일부 캐릭터는 필살기로도 회복한다. */
  spGain?: number;
  execute: (ctx: ExecuteContext) => void;
}

export interface ExecuteContext {
  battle: BattleApi;
  actor: Character;
  targets: Character[];
}

/** 스킬 execute() 함수가 사용할 수 있는 전투 엔진 헬퍼 인터페이스 */
export interface BattleApi {
  /** 공격자의 속성(Character.element)을 자동으로 사용하며, 물리/마법 구분만 인자로 받는다. */
  dealDamage(attacker: Character, target: Character, atkMultiplier: number, damageType: DamageType): number;
  heal(caster: Character, target: Character, amount: number): number;
  applyStatus(target: Character, template: StatusTemplate, source: Character): void;
  livingAllies(of: Character): Character[];
  livingEnemies(of: Character): Character[];
  rng(): number;
}
