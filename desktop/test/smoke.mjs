// PC 판 모의 검증 — 확장의 모의 화면(isTrusted 검사 포함)을 PC 앱에 그대로 통과시킨다.
//
//   node desktop/test/smoke.mjs <mock.html> <mode> [timeoutMs]
//   (리눅스 root 환경: CC_NO_SANDBOX=1 xvfb-run -a node desktop/test/smoke.mjs ...)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electron = require('electron'); // 실행 파일 경로

const [mock, mode = 'recall', timeout = '120000'] = process.argv.slice(2);
if (!mock) {
  console.error('사용법: node desktop/test/smoke.mjs <mock.html> <mode> [timeoutMs]');
  process.exit(2);
}

// root 로 도는 검증 환경(CI/xvfb)에서는 크로미움이 샌드박스를 거부한다 — 명령줄 인자로 넘겨야 먹는다.
const extra = process.env.CC_NO_SANDBOX ? ['--no-sandbox'] : [];
const child = spawn(electron, [resolve(HERE, '..'), ...extra], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CC_SMOKE_MOCK: resolve(mock),
    CC_SMOKE_MODE: mode,
    CC_SMOKE_TIMEOUT: timeout,
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING || '',
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
