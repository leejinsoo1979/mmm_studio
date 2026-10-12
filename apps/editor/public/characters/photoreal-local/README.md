# 내 실사 캐릭터 폴더 (photoreal-local)

라이선스 때문에 공개 저장소에 올릴 수 없는 실사 캐릭터를 넣는 폴더예요.
이 폴더의 파일은 git에 올라가지 않아요 (`.gitignore`). 이 README만 올라가요.

## 넣는 방법

1. 사람 뼈대(humanoid rig)가 있는 **GLB** 파일을 이 폴더에 넣어요:
   `apps/editor/public/characters/photoreal-local/<이름>.glb`
2. `bun dev`로 띄운 편집기를 새로고침하면 캐릭터 스튜디오와 게임 로비의
   **실사** 목록에 나와요.
3. 이름과 성별을 정하려면 같은 폴더에 `characters.json`을 둬요 (없어도 돼요.
   없으면 파일 이름이 이름이 되고, 파일 이름에 `female`/`woman`/`여`가 있으면
   여성 동작, 아니면 남성 동작을 써요):

```json
{
  "ada.glb": { "name": "에이다", "gender": "female" },
  "minjun.glb": { "name": "민준", "gender": "male" }
}
```

## 파일 조건

- 뼈 이름: Mixamo (`Hips`, `LeftArm`, `mixamorig:…`), Character Creator
  (`CC_Base_…`), Unreal/MetaHuman (`pelvis`, `spine_01`, `upperarm_l`…) 또는
  Rocketbox (`Bip01 …`) 이름이면 걷기·달리기·점프·앉기·감정 동작이 그대로
  옮겨져요. 알아볼 수 없는 뼈대면 움직이지 않고 파일의 자세로 서 있어요.
- 단위는 미터, 위쪽이 +Y, 얼굴이 +Z(glTF 기본)를 보는 파일.
- 눈 깜빡임: `eyeBlinkLeft` / `eyeBlinkRight` 블렌드셰이프가 있으면 깜빡여요.
- 웹에서 빠르게 쓰려면 텍스처 2K 이하, WebP + meshopt로 줄이세요:
  `node scripts/characters/build-photoreal-character.mjs in.glb out.glb`
  (스크립트 맨 위 설명 참고).
- 얼굴·몸 슬라이더, 메이크업, 얼굴 사진, 맨발, 머리색 바꾸기는 기본(Rocketbox)
  캐릭터 전용이라 실사 캐릭터에는 꺼져 있어요.

## 어디서 구하나 (라이선스 확인 필수)

- **MetaHuman** (UE 5.7+, macOS에서도 MetaHuman Creator 가능): DCC Export/FBX →
  Blender에서 GLB로. 얼굴 리그는 ARKit 블렌드셰이프로 구워야 해요.
- **Avaturn / Avatar SDK (MetaPerson)**: 셀카로 만든 GLB를 바로 쓸 수 있어요.
  상업적으로 공개 웹에 내보내려면 각 서비스의 유료/별도 약관이 필요해요.
- **Character Creator + Headshot**: 내보낸 파일을 공개 다운로드할 수 없게 하는
  조건이 있어요 — 웹 GLB는 다운로드가 가능하니 Reallusion의 서면 허락이 필요해요.

이 폴더의 파일은 로컬 개발(`bun dev`)에서만 보여요. 공개 배포에는 들어가지
않아요.
