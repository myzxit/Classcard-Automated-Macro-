# tools

## gen_reference.py

`app/src/test/resources/reference.json` 을 만드는 스크립트입니다.

**원본 파이썬 구현을 실제로 import 해서 실행**하고, 그 출력을 기준값으로 저장합니다.
코틀린 이식본이 같은 입력에 같은 출력을 내는지 `PortParityTest` 가 이 파일로 검증합니다.

원본 파이썬 파일(`Classcard-Automation/`)은 안드로이드 이식 이전 커밋에 있습니다.
다시 돌리려면:

```sh
git worktree add /tmp/py <이식 이전 커밋>
PYTHONPATH=android/tools/pyref:/tmp/py/Classcard-Automation \
    python3 android/tools/gen_reference.py
```

`pyref/selenium/` 은 원본 모듈이 import 하는 selenium API의 최소 스텁입니다
(순수 로직 함수만 호출하므로 실제 브라우저는 필요 없습니다).
