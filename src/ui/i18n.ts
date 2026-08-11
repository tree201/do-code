import type { DoCodeLanguage } from "../config.js"
import { localeDefinition, localeDefinitions } from "../locale-registry.js"

const zh: Record<string, string> = {
  "Show available commands": "查看可用命令",
  "Show workspace, model, and session status": "查看工作区、模型和会话状态",
  "Show or switch model presets": "查看或切换模型预设",
  "View or change language": "查看或切换语言",
  "Show custom commands and skills": "查看自定义命令和 Skills",
  "Capture a bad case and create an error ID": "记录 Bad Case 并生成错误 ID",
  "Show or reload layered AGENTS.md files": "查看或重载分层 AGENTS.md",
  "Restore the latest or a named file checkpoint": "恢复最近或指定的文件检查点",
  "Rewind chat, files, or both": "回退对话、文件或两者",
  "Show token, tool, and session statistics": "查看 Token、工具和会话统计",
  "Compact the current conversation context": "压缩当前对话上下文",
  "Trust the current workspace": "信任当前工作区",
  "Show active permission policy": "查看当前权限策略",
  "Show or switch the approval mode": "查看或切换审批模式",
  "Enter read-only planning or start planning a goal": "进入只读规划模式或开始制定目标计划",
  "Show current Git changes": "查看当前 Git 变更",
  "Clear conversation context": "清空对话上下文",
  "Browse and resume previous sessions": "浏览并恢复历史会话",
  "Rename the current session": "重命名当前会话",
  "Export the current session": "导出当前会话",
  "Show or switch reasoning effort": "查看或切换思考强度",
  "Show or switch thinking mode": "查看或切换思考模式",
  "Save the session and exit": "保存会话并退出",
  "let's do it!": "let's do it!",
  Model: "模型",
  Agent: "Agent",
  Workspace: "工作区",
  Session: "会话",
  resumed: "已恢复",
  Tip: "提示",
  "for commands": "打开命令",
  "to attach files": "添加文件",
  "for help": "查看帮助",
  "Current model": "当前模型",
  "Switch to this model": "切换到此模型",
  "Current reasoning effort": "当前思考强度",
  "Switch reasoning effort": "切换到此思考强度",
  "Current thinking mode": "当前思考模式",
  "Let the model decide when to think": "由模型自动决定是否思考",
  "Force thinking on": "强制开启思考",
  "Turn thinking off": "关闭思考",
  "Set interface and output language to English": "将界面与输出语言切换为英文",
  "Set interface and output language to Chinese": "将界面与输出语言切换为中文",
  "List loaded AGENTS.md instruction files": "列出已加载的 AGENTS.md 指令文件",
  "Show loaded project instructions": "查看已加载的项目指令",
  "Reload instructions from disk": "从磁盘重新加载指令",
  "Rewind conversation and files": "同时回退对话和文件",
  "Rewind conversation only": "仅回退对话",
  "Restore files only": "仅恢复文件",
  "Export the session as Markdown": "将会话导出为 Markdown",
  "Export the session as JSON": "将会话导出为 JSON",
  "Continue browsing this directory": "继续浏览此目录",
  "Add file context": "添加文件到上下文",
  "Current task is running; press Enter to queue a message": "任务正在运行；按 Enter 将消息加入队列",
  "Enter a task or @file path": "输入任务或 @文件路径",
  "Enter Command · Esc Interrupt": "Enter 执行命令 · Esc 中断",
  "Enter Queue · ↑ Recall · Esc Interrupt": "Enter 加入队列 · ↑ 召回 · Esc 中断",
  "Enter Send · Alt+Enter New line": "Enter 发送 · Ctrl+Enter 换行",
  "Thinking": "思考中",
  "Running": "正在执行",
  "Current language": "当前语言",
  "Available languages": "可用语言",
  "Language changed to Chinese.": "语言已切换为中文。",
  "Language changed to English.": "语言已切换为英文。",
  "Language setting failed": "语言设置失败",
  "Invalid language. Usage: /language [en|zh]": "无效语言。用法：/language [en|zh]",
}

const ja: Record<string, string> = {
  "Show available commands": "利用可能なコマンドを表示",
  "View or change language": "言語を表示または変更",
  "Show custom commands and skills": "カスタムコマンドとスキルを表示",
  "let's do it!": "始めましょう！",
  Model: "モデル", Workspace: "ワークスペース", Session: "セッション", resumed: "再開済み", Tip: "ヒント",
  "for commands": "でコマンド", "to attach files": "でファイルを添付", "for help": "でヘルプ",
  "Current model": "現在のモデル", "Switch to this model": "このモデルに切り替える",
  "Current reasoning effort": "現在の推論レベル", "Switch reasoning effort": "この推論レベルに切り替える",
  "Current thinking mode": "現在の思考モード", "Let the model decide when to think": "思考の要否をモデルに任せる", "Force thinking on": "思考を強制的に有効化", "Turn thinking off": "思考を無効化",
  "Set interface and output language to Japanese": "インターフェースと出力言語を日本語に設定",
  "Current task is running; press Enter to queue a message": "タスク実行中です。Enter でメッセージをキューに追加します",
  "Enter a task or @file path": "タスクまたは @ファイルパスを入力", "Enter Command · Esc Interrupt": "Enter で実行 · Esc で中断", "Enter Queue · ↑ Recall · Esc Interrupt": "Enter でキュー追加 · ↑ で呼び出し · Esc で中断", "Enter Send · Alt+Enter New line": "Enter で送信 · Ctrl+Enter で改行",
  Thinking: "思考中", Running: "実行中", "Current language": "現在の言語", "Available languages": "利用可能な言語", "Language setting failed": "言語設定に失敗しました",
}

const ko: Record<string, string> = {
  "Show available commands": "사용 가능한 명령 보기",
  "View or change language": "언어 보기 또는 변경",
  "Show custom commands and skills": "사용자 지정 명령과 스킬 보기",
  "let's do it!": "시작해 봅시다!",
  Model: "모델", Workspace: "작업 공간", Session: "세션", resumed: "복원됨", Tip: "팁",
  "for commands": "명령", "to attach files": "파일 첨부", "for help": "도움말",
  "Current model": "현재 모델", "Switch to this model": "이 모델로 전환",
  "Current reasoning effort": "현재 추론 수준", "Switch reasoning effort": "이 추론 수준으로 전환",
  "Current thinking mode": "현재 사고 모드", "Let the model decide when to think": "모델이 사고 여부를 결정", "Force thinking on": "사고 강제 사용", "Turn thinking off": "사고 끄기",
  "Set interface and output language to Korean": "인터페이스와 출력 언어를 한국어로 설정",
  "Current task is running; press Enter to queue a message": "작업이 실행 중입니다. Enter를 눌러 메시지를 대기열에 추가하세요",
  "Enter a task or @file path": "작업 또는 @파일 경로 입력", "Enter Command · Esc Interrupt": "Enter 실행 · Esc 중단", "Enter Queue · ↑ Recall · Esc Interrupt": "Enter 대기열 추가 · ↑ 불러오기 · Esc 중단", "Enter Send · Alt+Enter New line": "Enter 전송 · Ctrl+Enter 줄 바꿈",
  Thinking: "생각 중", Running: "실행 중", "Current language": "현재 언어", "Available languages": "사용 가능한 언어", "Language setting failed": "언어 설정에 실패했습니다",
}

const es: Record<string, string> = {
  "Show available commands": "Mostrar los comandos disponibles",
  "View or change language": "Ver o cambiar el idioma",
  "Show custom commands and skills": "Mostrar comandos y habilidades personalizados",
  "let's do it!": "¡manos a la obra!",
  Model: "Modelo", Workspace: "Espacio de trabajo", Session: "Sesión", resumed: "reanuda", Tip: "Consejo",
  "for commands": "para comandos", "to attach files": "para adjuntar archivos", "for help": "para ayuda",
  "Current model": "Modelo actual", "Switch to this model": "Cambiar a este modelo",
  "Current reasoning effort": "Nivel de razonamiento actual", "Switch reasoning effort": "Cambiar a este nivel de razonamiento",
  "Current thinking mode": "Modo de razonamiento actual", "Let the model decide when to think": "Dejar que el modelo decida cuándo razonar", "Force thinking on": "Forzar el razonamiento", "Turn thinking off": "Desactivar el razonamiento",
  "Set interface and output language to Spanish": "Establecer el idioma de la interfaz y la salida en español",
  "Current task is running; press Enter to queue a message": "Hay una tarea en ejecución; pulsa Enter para poner un mensaje en cola",
  "Enter a task or @file path": "Introduce una tarea o una ruta @archivo", "Enter Command · Esc Interrupt": "Enter ejecutar · Esc interrumpir", "Enter Queue · ↑ Recall · Esc Interrupt": "Enter encolar · ↑ recuperar · Esc interrumpir", "Enter Send · Alt+Enter New line": "Enter enviar · Ctrl+Enter nueva línea",
  Thinking: "Razonando", Running: "En ejecución", "Current language": "Idioma actual", "Available languages": "Idiomas disponibles", "Language setting failed": "No se pudo configurar el idioma",
}

const fr: Record<string, string> = {
  "Show available commands": "Afficher les commandes disponibles",
  "View or change language": "Afficher ou modifier la langue",
  "Show custom commands and skills": "Afficher les commandes et compétences personnalisées",
  "let's do it!": "au travail !",
  Model: "Modèle", Workspace: "Espace de travail", Session: "Session", resumed: "reprise", Tip: "Astuce",
  "for commands": "pour les commandes", "to attach files": "pour joindre des fichiers", "for help": "pour l’aide",
  "Current model": "Modèle actuel", "Switch to this model": "Passer à ce modèle",
  "Current reasoning effort": "Niveau de raisonnement actuel", "Switch reasoning effort": "Passer à ce niveau de raisonnement",
  "Current thinking mode": "Mode de réflexion actuel", "Let the model decide when to think": "Laisser le modèle décider quand réfléchir", "Force thinking on": "Forcer la réflexion", "Turn thinking off": "Désactiver la réflexion",
  "Set interface and output language to French": "Définir le français comme langue de l’interface et de sortie",
  "Current task is running; press Enter to queue a message": "Une tâche est en cours ; appuyez sur Entrée pour mettre un message en file d’attente",
  "Enter a task or @file path": "Saisissez une tâche ou un chemin @fichier", "Enter Command · Esc Interrupt": "Entrée exécuter · Échap interrompre", "Enter Queue · ↑ Recall · Esc Interrupt": "Entrée mettre en file · ↑ rappeler · Échap interrompre", "Enter Send · Alt+Enter New line": "Entrée envoyer · Ctrl+Entrée nouvelle ligne",
  Thinking: "Réflexion", Running: "En cours", "Current language": "Langue actuelle", "Available languages": "Langues disponibles", "Language setting failed": "Échec de la configuration de la langue",
}

Object.assign(zh, {
  "Agent needs your input": "需要你的输入", "Type an answer · Enter Send · Esc Back": "输入回答 · Enter 发送 · Esc 返回选项", "↑↓ Select · Enter Answer · Esc Cancel": "↑↓ 选择 · Enter 确认 · Esc 取消", "Proposed Plan": "建议计划", Execute: "执行", Revise: "修改", Cancel: "取消", "↑↓ Select · Enter Confirm · Esc Cancel": "↑↓ 选择 · Enter 确认 · Esc 取消", "Allow once": "允许一次", "Allow for this session": "本次会话允许", "Always allow this action": "始终允许此操作", Deny: "拒绝", "↑↓ Select · Enter Confirm · Esc Deny": "↑↓ 选择 · Enter 确认 · Esc 拒绝", "Update Model Permissions": "更新模型权限", "Ask for approval": "请求批准", "Approve for me": "自动批准安全操作", "Full Access": "完全访问", "(current)": "（当前）",
  "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.": "可读取和编辑当前工作区并运行普通命令；访问网络或工作区外文件时请求确认。", "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.": "自动执行普通编辑、命令和联网操作；仅对检测为可能不安全的操作请求确认。", "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.": "可编辑工作区外文件并访问网络，不再请求普通审批。请谨慎使用。",
})
Object.assign(ja, {
  "Agent needs your input": "入力が必要です", "Type an answer · Enter Send · Esc Back": "回答を入力 · Enter で送信 · Esc で戻る", "↑↓ Select · Enter Answer · Esc Cancel": "↑↓ 選択 · Enter で回答 · Esc でキャンセル", "Proposed Plan": "提案された計画", Execute: "実行", Revise: "修正", Cancel: "キャンセル", "↑↓ Select · Enter Confirm · Esc Cancel": "↑↓ 選択 · Enter で確認 · Esc でキャンセル", "Allow once": "今回のみ許可", "Allow for this session": "このセッションで許可", "Always allow this action": "この操作を常に許可", Deny: "拒否", "↑↓ Select · Enter Confirm · Esc Deny": "↑↓ 選択 · Enter で確認 · Esc で拒否", "Update Model Permissions": "モデル権限を更新", "Ask for approval": "承認を求める", "Approve for me": "安全な操作を自動承認", "Full Access": "フルアクセス", "(current)": "（現在）",
  "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.": "現在のワークスペースの読み書きと通常コマンドを許可し、ネットワークまたは外部ワークスペースへのアクセス前に確認します。", "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.": "通常の編集、コマンド、ネットワークアクセスを自動実行し、危険な可能性がある操作のみ確認します。", "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.": "通常の承認なしでワークスペース外のファイル編集とネットワークアクセスを許可します。注意して使用してください。",
})
Object.assign(ko, {
  "Agent needs your input": "입력이 필요합니다", "Type an answer · Enter Send · Esc Back": "답변 입력 · Enter 전송 · Esc 뒤로", "↑↓ Select · Enter Answer · Esc Cancel": "↑↓ 선택 · Enter 답변 · Esc 취소", "Proposed Plan": "제안된 계획", Execute: "실행", Revise: "수정", Cancel: "취소", "↑↓ Select · Enter Confirm · Esc Cancel": "↑↓ 선택 · Enter 확인 · Esc 취소", "Allow once": "한 번 허용", "Allow for this session": "이 세션에서 허용", "Always allow this action": "이 작업 항상 허용", Deny: "거부", "↑↓ Select · Enter Confirm · Esc Deny": "↑↓ 선택 · Enter 확인 · Esc 거부", "Update Model Permissions": "모델 권한 업데이트", "Ask for approval": "승인 요청", "Approve for me": "안전한 작업 자동 승인", "Full Access": "전체 액세스", "(current)": "(현재)",
  "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.": "현재 작업 공간을 읽고 편집하며 일반 명령을 실행합니다. 네트워크 또는 작업 공간 외부 접근 전에는 확인합니다.", "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.": "일반 편집, 명령 및 네트워크 접근을 자동 실행하고 잠재적으로 안전하지 않은 작업만 확인합니다.", "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.": "일반 승인 없이 작업 공간 외부 파일을 편집하고 네트워크에 접근합니다. 주의해서 사용하세요.",
})
Object.assign(es, {
  "Agent needs your input": "El agente necesita tu respuesta", "Type an answer · Enter Send · Esc Back": "Escribe una respuesta · Enter enviar · Esc volver", "↑↓ Select · Enter Answer · Esc Cancel": "↑↓ seleccionar · Enter responder · Esc cancelar", "Proposed Plan": "Plan propuesto", Execute: "Ejecutar", Revise: "Modificar", Cancel: "Cancelar", "↑↓ Select · Enter Confirm · Esc Cancel": "↑↓ seleccionar · Enter confirmar · Esc cancelar", "Allow once": "Permitir una vez", "Allow for this session": "Permitir durante esta sesión", "Always allow this action": "Permitir siempre esta acción", Deny: "Denegar", "↑↓ Select · Enter Confirm · Esc Deny": "↑↓ seleccionar · Enter confirmar · Esc denegar", "Update Model Permissions": "Actualizar permisos del modelo", "Ask for approval": "Pedir aprobación", "Approve for me": "Aprobar operaciones seguras", "Full Access": "Acceso total", "(current)": "(actual)",
  "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.": "Lee y edita el espacio de trabajo actual y ejecuta comandos normales; pide confirmación antes de acceder a la red o fuera del espacio de trabajo.", "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.": "Ejecuta automáticamente ediciones, comandos y acceso a la red; pide confirmación solo para operaciones potencialmente inseguras.", "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.": "Edita archivos fuera del espacio de trabajo y accede a la red sin solicitudes de aprobación normales. Úsalo con cuidado.",
})
Object.assign(fr, {
  "Agent needs your input": "L’agent a besoin de votre réponse", "Type an answer · Enter Send · Esc Back": "Saisissez une réponse · Entrée envoyer · Échap retour", "↑↓ Select · Enter Answer · Esc Cancel": "↑↓ sélectionner · Entrée répondre · Échap annuler", "Proposed Plan": "Plan proposé", Execute: "Exécuter", Revise: "Modifier", Cancel: "Annuler", "↑↓ Select · Enter Confirm · Esc Cancel": "↑↓ sélectionner · Entrée confirmer · Échap annuler", "Allow once": "Autoriser une fois", "Allow for this session": "Autoriser pour cette session", "Always allow this action": "Toujours autoriser cette action", Deny: "Refuser", "↑↓ Select · Enter Confirm · Esc Deny": "↑↓ sélectionner · Entrée confirmer · Échap refuser", "Update Model Permissions": "Mettre à jour les autorisations du modèle", "Ask for approval": "Demander l’autorisation", "Approve for me": "Approuver les opérations sûres", "Full Access": "Accès complet", "(current)": "(actuel)",
  "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.": "Lire et modifier l’espace de travail actuel et exécuter les commandes ordinaires ; demander avant l’accès réseau ou hors de l’espace de travail.", "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.": "Exécuter automatiquement les modifications, commandes et accès réseau ; demander uniquement pour les opérations potentiellement dangereuses.", "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.": "Modifier des fichiers hors de l’espace de travail et accéder au réseau sans demandes d’autorisation ordinaires. À utiliser avec prudence.",
})

const catalogs: Record<string, Record<string, string>> = { zh, ja, ko, es, fr }

export function t(language: DoCodeLanguage, value: string) {
  return catalogs[language]?.[value] ?? value
}

export function languageDisplay(language: DoCodeLanguage, locale: DoCodeLanguage = language) {
  const definition = localeDefinition(language)
  return `${locale === "zh" ? definition.nativeName : definition.englishName} [${definition.bcp47}]`
}

export function availableLanguagesText(locale: DoCodeLanguage) {
  return localeDefinitions.map((language) => languageDisplay(language.id, locale)).join(", ")
}

export function languageUsageText() {
  return `/language [${localeDefinitions.map((language) => language.id).join("|")}]`
}

export function invalidLanguageText(locale: DoCodeLanguage) {
  return `${locale === "zh" ? "无效语言。用法" : "Invalid language. Usage"}: ${languageUsageText()}`
}
