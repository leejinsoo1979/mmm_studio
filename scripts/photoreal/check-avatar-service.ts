// AI 인물 확인 스크립트: 사장님 맥에서 진짜 키로 실행해, 실제 서비스의 답이
// 앱이 기대한 것과 어디가 다른지 알려 줘요. 키·토큰은 출력에 나오지 않아요.
//
//   bun --env-file=.env.local scripts/photoreal/check-avatar-service.ts
//       3D 서비스 확인만 (토큰, 플레이어, 요금제, 고를 수 있는 옷·헤어). 비용 없음.
//   bun --env-file=.env.local scripts/photoreal/check-avatar-service.ts portrait --yes --out ~/Desktop/ai-person.jpg
//       AI 인물 사진 1장 만들기 (사진 1장 비용). gemini면 --probe-person-generation 도 붙여 보세요.
//   bun --env-file=.env.local scripts/photoreal/check-avatar-service.ts service --yes --portrait ~/Desktop/ai-person.jpg [--sex male] [--out ~/Desktop/check.glb] [--keep]
//       그 사진으로 3D 아바타 1개 만들기 (요금제 사용량 1개). 끝나면 서비스의 사본을 지워요 (--keep 이면 남김).
//
// 저장소 루트에서 실행하고, 출력 전체를 그대로 보내 주세요. 사진은 이 앱이 만든
// 가상의 성인 사진만 쓰세요 (실제 사람 사진 금지).

import { readFile, writeFile } from 'node:fs/promises'
import { runAvatarServiceCheck } from '../../apps/editor/lib/photoreal-ai/service-check'

const code = await runAvatarServiceCheck({
  env: process.env,
  fetch: (input, init) => fetch(input, init),
  args: process.argv.slice(2),
  log: (line) => console.log(line),
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: (path, bytes) => writeFile(path, bytes),
})
process.exit(code)
