<div align="center">

# do-code

**오픈 소스 코딩 에이전트.**

터미널과 워크스페이스에서 코드를 읽고, 파일을 편집하고, 명령을 실행하고, 결과를 검증합니다.

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Español](README.es-ES.md) | [Français](README.fr-FR.md)

[빠른 시작](#installation) · [문서](docs/README.md) · [기여](CONTRIBUTING.md) · [보안](SECURITY.md)

</div>

<p align="center">
  <img src="assets/terminal-preview.png" alt="do-code 터미널 미리보기" width="100%">
</p>

---

## 설치

Node.js `20.19+` 또는 `22.12+`가 필요합니다.

소스에서 실행:

```bash
git clone https://github.com/tree201/do-code.git
cd do-code
npm install
npm run build:agent
npm link
```

그런 다음 기존 프로젝트에서 시작합니다.

```bash
cd /path/to/your-project
do-code auth
do-code
```

`do-code auth`가 프로바이더 설정을 안내합니다. API 키는 로컬 사용자 설정에만 저장되며, 환경 변수는 저장된 값을 재정의합니다.

> [!NOTE]
> npm 패키지는 `npm install -g @tree201/do-code`로 설치하세요. 처음 사용할 때는 Git 저장소에서 시작하고 기본 권한 모드를 사용하세요.

## 기능

- **실제 저장소에서 작업** — 파일을 읽고 첨부하고, 코드를 편집하고, 셸 명령을 실행하고, Git diff를 확인하고, 테스트를 실행합니다.
- **사용자의 모델 프로바이더 사용** — Volcengine Ark, Alibaba ModelStudio, DeepSeek, MiniMax, Z.AI, ModelScope를 위한 내장 설정을 제공합니다. Custom Provider는 OpenAI 호환, Anthropic, Gemini API를 지원합니다.
- **제어된 실행 유지** — 계획 모드와 권한 모드는 독립적이며, 기본 제공 파일 편집과 패치에는 검토 또는 복구를 위한 로컬 체크포인트가 생성됩니다.

`/`를 입력해 명령을 찾아보고 `@`로 워크스페이스 파일을 첨부하세요.

```text
/plan · /permissions · /model · /resume
/status · /stats · /compact · /diff
/memory · /rewind · /export · /language
@src/app.ts           현재 컨텍스트에 파일 추가
!npm test             현재 권한 모드로 명령 실행
```

세션 중 추론은 `/thinking`과 `/effort`로 조정할 수 있습니다. `--persist`를 추가하면 향후 세션의 기본값으로 저장됩니다. `--language` 또는 `/language`를 통해 영어, 중국어 간체, 일본어, 한국어, 스페인어, 프랑스어 인터페이스를 지원합니다.

## 이번 개선 사항

- **작업 실행 중에도 계속 작업** — 대기 중인 프롬프트가 작성창 바로 위에 표시되어 확인하거나 `↑`로 다시 불러올 수 있습니다.
- **긴 붙여넣기 안전 처리** — 긴 붙여넣기 텍스트는 작성창 안에서 간결한 미리 보기로 접혀 입력 영역을 밀어내지 않습니다.
- **터미널 Markdown 안정 표시** — 긴 인라인 코드, URL, 공백 없는 CJK 텍스트, 이모지를 내용 손실 없이 터미널 표시 폭에 맞춰 줄바꿈합니다.
- **승인 설정을 세션에 유지** — 각 세션이 승인 모드를 기억하며, 작업 중 왼손용 `Ctrl+G` 단축키로 변경할 수 있습니다.

## 원하는 방식으로 실행

### 대화형 터미널

```bash
do-code
do-code --continue
do-code resume <session-id>
```

### 세션 및 컨텍스트

`do-code --continue`로 최신 프로젝트 세션을 계속하거나 `resume`과 `/resume`으로 하나를 선택합니다.

```bash
do-code sessions list
do-code sessions search "authentication"
do-code sessions rename <session-id> "Auth cleanup"
do-code sessions delete <session-id>
do-code sessions export <session-id> md ./session.md
```

`/stats`로 컨텍스트 사용량을 확인하고 `/compact`로 필요할 때 압축하세요. 컨텍스트 한도에 가까워지면 do-code가 중요한 경로, 명령, 결정, 검증 상태를 유지하면서 자동으로 압축합니다.

### 프로젝트 지침 및 격리

계층화된 `AGENTS.md` 지침은 워크스페이스 계층을 따릅니다. `/memory`로 확인하거나 다시 불러올 수 있습니다. `do-code --worktree` 또는 `do-code --worktree=<name>`으로 격리된 Git worktree를 시작하고 `do-code worktrees`로 do-code worktree를 확인하세요.

### 프로필 및 확장 기능

에이전트 프로필은 모델, 승인 모드, 지침, 단계 제한, 도구 허용/차단 목록을 선택할 수 있습니다. `do-code agents`로 확인하고 `do-code --agent <name>`으로 선택하세요. Markdown 명령과 스킬은 `/extensions`에서 찾아볼 수 있으며, `do-code extensions`로 명령, 스킬, 구성된 MCP 서버의 요약을 확인할 수 있습니다.

### 스크립트 및 CI

`run`은 자동화를 위해 안정적인 JSON 또는 JSONL 출력을 생성합니다. 작업은 인수 또는 `--task-file`에서 가져올 수 있으며, `--max-steps`와 `--timeout`으로 실행 예산을 설정합니다. `--artifact-dir`에는 고정된 구성, 이벤트 스트림, 결과, 패치 아티팩트가 저장됩니다.

```bash
do-code run --yes --output-format stream-json \
  --task-file task.txt --artifact-dir ./artifacts \
  --max-steps 40 --timeout 600
```

ACP 표준 입출력 프로토콜에는 `do-code acp`를 사용하세요. 지원되는 자동화 계약은 [Headless / JSONL 프로토콜](docs/headless-protocol.md)을 참조하세요.

### 이미지 입력

헤드리스 모드에서 `--image`를 반복해 최대 4개의 PNG, JPEG, GIF 또는 WebP 이미지를 첨부할 수 있습니다. 선택한 모델은 이미지 입력을 지원해야 합니다.

```bash
do-code run --image screenshots/bug.png --image screenshots/diagram.webp "Describe these images"
```

대화형 TUI에서는 Ctrl+V로 시스템 클립보드의 이미지를 붙여넣거나 `@path/to/image.png`를 입력해 이미지를 추가합니다. 첨부를 제거하려면 편집기에서 이미지 태그/token에 커서를 놓고 Backspace를 누르세요. 각 이미지는 10 MB, 프롬프트 전체는 20 MB로 제한됩니다. 가져온 파일은 `~/.local/share/do-code/projects/<project-key>/sessions/<session-id>/attachments/`에 복사됩니다. 저장된 메시지에는 `attachments/image_xxx.png`와 같은 상대 참조만 포함되며 Base64 데이터나 원래 절대 경로는 포함되지 않습니다. 전역 데이터 루트를 재정의하려면 `DO_CODE_DATA_DIR`을 설정하세요. 기존 프로젝트 로컬 `.do-code` 데이터는 다음에 프로젝트에 접근할 때 사용자 관리 프로젝트 디렉터리로 마이그레이션됩니다.

### 유용한 CLI 명령

```bash
do-code config show          # 유효한 모델 구성 확인
do-code doctor               # 모델, 워크스페이스, 로컬 도구 확인
do-code sessions list        # 프로젝트 세션 나열
do-code extensions           # 명령, 스킬, MCP 구성 확인
do-code agents               # 에이전트 프로필 나열
do-code worktrees            # 격리된 worktree 나열
do-code errors list          # 최근 오류 보고서 나열
```

## 안전 및 데이터

기본 **Ask** 모드는 고위험 작업에 확인을 요청합니다. **Auto**는 일반적인 워크스페이스 변경을 자동으로 처리합니다. **Full Access**는 신뢰할 수 있는 워크스페이스 또는 CI에서만 사용해야 합니다.

구성은 `~/.config/do-code/` 아래에 저장되고, 프로젝트 세션, 첨부, 체크포인트, 오류 보고서는 `~/.local/share/do-code/projects/<project-key>/` 아래에 저장됩니다. `DO_CODE_DATA_DIR`은 데이터 루트를 재정의합니다. 자격 증명과 프로젝트 데이터는 기본적으로 컴퓨터에만 보관됩니다.

샌드박스 설정은 구성과 호스트 지원에 따라 로컬 실행, macOS Seatbelt 또는 컨테이너를 사용할 수 있습니다. 권한 모드와 샌드박스 구성은 서로 독립적인 제어입니다.

실패를 확인하려면:

```bash
do-code errors list
do-code errors show <error-id>
```

## 문서

- [문서 색인](docs/README.md)
- [불량 사례 피드백 및 진단](docs/bad-case-feedback.md)
- [Headless / JSONL 프로토콜](docs/headless-protocol.md)
- [아키텍처](docs/architecture.md)
- [로컬 개발](docs/local-development.md)
- [개인 릴리스 프로세스](docs/releasing.md)

## 기여

이슈와 풀 리퀘스트를 환영합니다. 변경 사항을 제출하기 전에 [기여 가이드](CONTRIBUTING.md)와 [보안 정책](SECURITY.md)을 읽어 주세요.

```bash
npm run verify:local
npm run build:agent
```

## 라이선스

[Apache-2.0](LICENSE)
