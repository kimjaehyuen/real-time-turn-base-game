import type { TargetType } from '../engine/types';

export type ActionKey = 'normal' | 'skill' | 'ultimate';

/** 대상 선택 대기 중인 행동 (일반공격/스킬/필살기가 단일 대상을 요구할 때) */
export interface PendingAction {
  actorId: string;
  key: ActionKey;
  targetType: TargetType;
}

export interface UiHandlers {
  onChooseAction: (actorId: string, key: ActionKey) => void;
  onChooseTarget: (targetId: string) => void;
  onCancelPending: () => void;
  onReset: () => void;
}
