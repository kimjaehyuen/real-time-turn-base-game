// 핵심 타입 정의

export type Team = 'player' | 'enemy';

export type DurationType = 'turn' | 'time';

export type LogKind =
  | 'info'
  | 'ready'
  | 'action'
  | 'damage'
  | 'heal'
  | 'buff'
  | 'debuff'
  | 'ultimate'
  | 'defeat';

/** 스탯에 곱연산으로 적용되는 보정치 (0.2 = +20%, -0.2 = -20%) */
export interface StatModifiers {
  atk?: number;
  def?: number;
  spd?: number;
  dmgTakenMult?: number;
  dmgDealtMult?: number;
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
  | 'allEnemies'
  | 'singleAlly'
  | 'allAllies'
  | 'self';

export interface Character {
  id: string;
  name: string;
  team: Team;
  portrait: string;
  base: { hp: number; atk: number; def: number; spd: number };
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
  dealDamage(attacker: Character, target: Character, atkMultiplier: number): number;
  heal(caster: Character, target: Character, amount: number): number;
  applyStatus(target: Character, template: StatusTemplate, source: Character): void;
  log(message: string, kind: LogKind): void;
  livingAllies(of: Character): Character[];
  livingEnemies(of: Character): Character[];
  rng(): number;
}
