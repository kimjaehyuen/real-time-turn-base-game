import { defineConfig } from 'vite';

// base를 상대경로로 설정한다: 패키징된 Electron 앱은 dist/index.html을 file://로 직접 열기
// 때문에, 기본값인 절대경로(/assets/...)로 빌드하면 에셋을 찾지 못해 빈 화면만 뜬다.
export default defineConfig({
  base: './',
});
