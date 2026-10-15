// 플레이어 설정: 하드 모드 여부 + 행동 단축키. localStorage에 저장해 다음 실행에도 유지한다.

export interface GameSettings {
  /** 하드 모드: 켜져 있으면 행동/대상을 준비하는 동안에도 게임이 멈추지 않는다. */
  hardMode: boolean;
  /** 일반 공격 단축키 (소문자로 저장, 기본 'w') */
  keyNormal: string;
  /** 스킬 단축키 (기본 'e') */
  keySkill: string;
  /** 필살기 단축키 (기본 'q') */
  keyUltimate: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  hardMode: false,
  keyNormal: 'w',
  keySkill: 'e',
  keyUltimate: 'q',
};

const STORAGE_KEY = 'rttb.settings.v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 저장 실패(프라이빗 모드 등)는 무시 — 이번 실행 동안만 설정이 적용된다.
  }
}
