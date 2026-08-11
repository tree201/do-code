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
