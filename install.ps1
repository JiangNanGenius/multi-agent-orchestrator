# AGENTORCHESTRATOR · OpenClaw 安装脚本 (Windows)
# PowerShell 版本 — 对应 install.sh
# ══════════════════════════════════════════════════════════════
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$REPO_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$OC_HOME = Join-Path $env:USERPROFILE ".openclaw"
$OC_CFG = Join-Path $OC_HOME "openclaw.json"
$AGENTS = @(
    "control_center",
    "plan_center",
    "review_center",
    "dispatch_center",
    "data_specialist",
    "docs_specialist",
    "code_specialist",
    "audit_specialist",
    "deploy_specialist",
    "admin_specialist",
    "expert_curator",
    "search_specialist"
)

function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Blue
    Write-Host "║  AGENTORCHESTRATOR · OpenClaw 本地对接辅助 (Win)   ║" -ForegroundColor Blue
    Write-Host "║  AI 部署优先，脚本仅用于本地补齐       ║" -ForegroundColor Blue
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Blue
    Write-Host ""
}

function Log   { param($msg) Write-Host "✅ $msg" -ForegroundColor Green }
function Warn  { param($msg) Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Error { param($msg) Write-Host "❌ $msg" -ForegroundColor Red }
function Info  { param($msg) Write-Host "ℹ️  $msg" -ForegroundColor Blue }

function Check-Deps {
    Info "检查依赖..."

    $oc = Get-Command openclaw -ErrorAction SilentlyContinue
    if (-not $oc) {
        Error "未找到 openclaw CLI。请先安装 OpenClaw: https://openclaw.ai"
        exit 1
    }
    Log "OpenClaw CLI: OK"

    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) {
        $py = Get-Command python3 -ErrorAction SilentlyContinue
    }
    if (-not $py) {
        Error "未找到 python3 或 python"
        exit 1
    }
    $global:PYTHON = $py.Source
    Log "Python: $($global:PYTHON)"

    if (-not (Test-Path $OC_CFG)) {
        Error "未找到 openclaw.json。请先运行 openclaw 完成初始化。"
        exit 1
    }
    Log "openclaw.json: $OC_CFG"
}

function Backup-Existing {
    $hasExisting = Get-ChildItem -Path $OC_HOME -Directory -Filter "workspace-*" -ErrorAction SilentlyContinue
    if ($hasExisting) {
        Info "检测到已有 Agent Workspace，自动备份中..."
        $ts = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupDir = Join-Path $OC_HOME "backups\pre-install-$ts"
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

        Get-ChildItem -Path $OC_HOME -Directory -Filter "workspace-*" | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination (Join-Path $backupDir $_.Name) -Recurse
        }

        if (Test-Path $OC_CFG) {
            Copy-Item $OC_CFG (Join-Path $backupDir "openclaw.json")
        }

        if (Test-Path (Join-Path $OC_HOME "agents")) {
            Copy-Item (Join-Path $OC_HOME "agents") (Join-Path $backupDir "agents") -Recurse
        }

        Log "已备份到: $backupDir"
    }
}

function Create-Workspaces {
    Info "创建 Agent Workspace..."

    foreach ($agent in $AGENTS) {
        $ws = Join-Path $OC_HOME "workspace-$agent"
        New-Item -ItemType Directory -Path (Join-Path $ws "skills") -Force | Out-Null

        $soulSrc = Join-Path $REPO_DIR "agents\$agent\SOUL.md"
        $soulDst = Join-Path $ws "SOUL.md"
        if (Test-Path $soulSrc) {
            if (Test-Path $soulDst) {
                $ts = Get-Date -Format "yyyyMMdd-HHmmss"
                Copy-Item $soulDst "$soulDst.bak.$ts"
                Warn "已备份旧 SOUL.md → $soulDst.bak.$ts"
            }
            $content = (Get-Content $soulSrc -Raw) -replace "__REPO_DIR__", $REPO_DIR
            Set-Content -Path $soulDst -Value $content -Encoding UTF8
        }
        Log "Workspace 已创建: $ws"
    }

    foreach ($agent in $AGENTS) {
        $ws = Join-Path $OC_HOME "workspace-$agent"
        $agentsMd = @"
# AGENTS.md · 工作协议

1. 接到任务先回复“已接收任务”。
2. 输出必须包含：任务 ID、结果、证据或文件路径、阻塞项。
3. 需要协作时，通过统一调度方请求转派，不直接跨角色并行写入。
4. 涉及删除、外发或高风险动作时，必须明确标注并等待批准。
"@
        Set-Content -Path (Join-Path $ws "AGENTS.md") -Value $agentsMd -Encoding UTF8
    }
}

function Register-Agents {
    Info "检查 OpenClaw 运行时 Agent 注册情况（只读模式）..."

    $env:REPO_DIR = $REPO_DIR
    $pyScript = @"
import json, pathlib, os, datetime

cfg_path = pathlib.Path(os.environ['USERPROFILE']) / '.openclaw' / 'openclaw.json'
cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
required = [
    {'id': 'control_center', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-control_center'), 'subagents': {'allowAgents': ['plan_center']}},
    {'id': 'plan_center', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-plan_center'), 'subagents': {'allowAgents': ['review_center', 'dispatch_center']}},
    {'id': 'review_center', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-review_center'), 'subagents': {'allowAgents': ['dispatch_center', 'plan_center']}},
    {'id': 'dispatch_center', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-dispatch_center'), 'subagents': {'allowAgents': ['plan_center', 'review_center', 'data_specialist', 'docs_specialist', 'code_specialist', 'audit_specialist', 'deploy_specialist', 'admin_specialist', 'expert_curator', 'search_specialist']}},
    {'id': 'data_specialist', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-data_specialist'), 'subagents': {'allowAgents': ['dispatch_center']}},
    {'id': 'docs_specialist', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-docs_specialist'), 'subagents': {'allowAgents': ['dispatch_center']}},
    {'id': 'code_specialist', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-code_specialist'), 'subagents': {'allowAgents': ['dispatch_center']}},
    {'id': 'audit_specialist', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-audit_specialist'), 'subagents': {'allowAgents': ['dispatch_center']}},
    {'id': 'deploy_specialist', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-deploy_specialist'), 'subagents': {'allowAgents': ['dispatch_center']}},
    {'id': 'admin_specialist', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-admin_specialist'), 'subagents': {'allowAgents': ['dispatch_center']}},
    {'id': 'expert_curator', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-expert_curator'), 'subagents': {'allowAgents': ['dispatch_center']}},
    {'id': 'search_specialist', 'workspace': str(pathlib.Path(os.environ['USERPROFILE']) / '.openclaw/workspace-search_specialist'), 'subagents': {'allowAgents': ['dispatch_center']}},
]
existing = {item.get('id') for item in cfg.get('agents', {}).get('list', []) if item.get('id')}
missing = [item for item in required if item['id'] not in existing]

suggestions_path = pathlib.Path(os.environ['REPO_DIR']) / 'data' / 'openclaw_registry_suggestions.json'
suggestions_path.parent.mkdir(parents=True, exist_ok=True)
suggestions_path.write_text(json.dumps({
    'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'mode': 'readonly_reference',
    'message': '本文件仅输出建议注册项，install.ps1 不再直接改写 openclaw.json。',
    'missingAgents': missing,
}, ensure_ascii=False, indent=2), encoding='utf-8')

print(f'已注册 Agent: {len(existing)}')
if missing:
    print('缺少的 Agent 注册项（未自动写回 openclaw.json）:')
    for item in missing:
        print(f"  - {item['id']} -> {item['workspace']}")
    print(f'建议清单已写入: {suggestions_path}')
else:
    print('运行时 Agent 注册已齐全，无需额外建议。')
"@
    & $global:PYTHON -c $pyScript

    $suggestions = Join-Path $REPO_DIR "data\openclaw_registry_suggestions.json"
    if (Test-Path $suggestions) {
        Warn "install.ps1 当前仅提供本地只读对接辅助：不会直接改写 openclaw.json。"
        Info "推荐优先使用 AI 部署；如需本地补齐运行时注册，请参考 data/openclaw_registry_suggestions.json 中的建议项手动处理。"
    }

    Log "运行时 Agent 注册检查完成"
}

function Init-Data {
    Info "初始化数据目录..."
    $dataDir = Join-Path $REPO_DIR "data"
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

    foreach ($f in @("live_status.json","agent_config.json","model_change_log.json")) {
        $fp = Join-Path $dataDir $f
        if (-not (Test-Path $fp)) {
            Set-Content $fp "{}" -Encoding UTF8
        }
    }
    Set-Content (Join-Path $dataDir "pending_model_changes.json") "[]" -Encoding UTF8

    $tasksSource = Join-Path $dataDir "tasks_source.json"
    if (-not (Test-Path $tasksSource)) {
        $env:REPO_DIR = $REPO_DIR
        $pyScript = @"
import json, pathlib, os

tasks = [{
    'id': 'JJC-DEMO-001',
    'title': '🎉 系统初始化完成',
    'owner': '系统看板',
    'org': 'AGENTORCHESTRATOR',
    'state': 'Done',
    'now': 'AGENTORCHESTRATOR 系统已就绪',
    'eta': '-',
    'block': '无',
    'output': '',
    'ac': '系统正常运行',
    'flow_log': [
        {'at': '2024-01-01T00:00:00Z', 'from': 'system', 'to': 'control_center', 'remark': '初始化 AGENTORCHESTRATOR 系统'},
        {'at': '2024-01-01T00:01:00Z', 'from': 'control_center', 'to': 'plan_center', 'remark': '提交初始化方案规划'},
        {'at': '2024-01-01T00:02:00Z', 'from': 'plan_center', 'to': 'review_center', 'remark': '提交初始化方案审核'},
        {'at': '2024-01-01T00:03:00Z', 'from': 'review_center', 'to': 'dispatch_center', 'remark': '✅ 审核通过并进入派发'},
        {'at': '2024-01-01T00:04:00Z', 'from': 'dispatch_center', 'to': 'code_specialist', 'remark': '✅ 完成系统初始化'},
    ]
}]

data_dir = pathlib.Path(os.environ['REPO_DIR']) / 'data'
data_dir.mkdir(exist_ok=True)
(data_dir / 'tasks_source.json').write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding='utf-8')
print('tasks_source.json 已初始化')
"@
        & $global:PYTHON -c $pyScript
    }

    Log "数据目录初始化完成: $dataDir"
}

function Link-Resources {
    Info "创建 data/scripts 目录连接..."
    $linked = 0
    foreach ($agent in $AGENTS) {
        $ws = Join-Path $OC_HOME "workspace-$agent"
        New-Item -ItemType Directory -Path $ws -Force | Out-Null

        $wsData = Join-Path $ws "data"
        $srcData = Join-Path $REPO_DIR "data"
        if (-not (Test-Path $wsData)) {
            cmd /c mklink /J "$wsData" "$srcData" | Out-Null
            $linked++
        } elseif (-not ((Get-Item $wsData).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $ts = Get-Date -Format "yyyyMMdd-HHmmss"
            Rename-Item $wsData "$wsData.bak.$ts"
            cmd /c mklink /J "$wsData" "$srcData" | Out-Null
            $linked++
        }

        $wsScripts = Join-Path $ws "scripts"
        $srcScripts = Join-Path $REPO_DIR "scripts"
        if (-not (Test-Path $wsScripts)) {
            cmd /c mklink /J "$wsScripts" "$srcScripts" | Out-Null
            $linked++
        } elseif (-not ((Get-Item $wsScripts).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $ts = Get-Date -Format "yyyyMMdd-HHmmss"
            Rename-Item $wsScripts "$wsScripts.bak.$ts"
            cmd /c mklink /J "$wsScripts" "$srcScripts" | Out-Null
            $linked++
        }
    }
    Log "已创建 $linked 个目录连接 (data/scripts → 项目目录)"
}

function Setup-Visibility {
    Info "配置 Agent 间消息可见性..."
    try {
        openclaw config set tools.sessions.visibility all 2>$null
        Log "已设置 tools.sessions.visibility=all"
    } catch {
        Warn "设置 visibility 失败，请手动执行: openclaw config set tools.sessions.visibility all"
    }
}

function Sync-Auth {
    Info "同步 API Key 到所有 Agent..."

    $mainAuth = $null
    $authFilename = $null
    $agentBase = Join-Path $OC_HOME "agents\control_center\agent"

    foreach ($candidate in @("models.json", "auth-profiles.json")) {
        $candidatePath = Join-Path $agentBase $candidate
        if (Test-Path $candidatePath) {
            $mainAuth = $candidatePath
            $authFilename = $candidate
            break
        }
    }

    if (-not $mainAuth) {
        foreach ($candidate in @("models.json", "auth-profiles.json")) {
            $found = Get-ChildItem -Path (Join-Path $OC_HOME "agents") -Filter $candidate -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) {
                $mainAuth = $found.FullName
                $authFilename = $candidate
                break
            }
        }
    }

    if (-not $mainAuth -or -not (Test-Path $mainAuth)) {
        Warn "未找到已有的 models.json 或 auth-profiles.json"
        Warn "请先为任意 Agent 配置 API Key:"
        Write-Host "    openclaw agents add control_center"
        Write-Host "  然后重新运行 install.ps1，或手动执行整个安装流程。"
        return
    }

    try {
        & $global:PYTHON -c "import json; d=json.load(open(r'$mainAuth', encoding='utf-8')); assert d"
    } catch {
        Warn "$authFilename 为空或无效，请先配置 API Key:"
        Write-Host "    openclaw agents add control_center"
        return
    }

    $synced = 0
    foreach ($agent in $AGENTS) {
        $agentDir = Join-Path $OC_HOME "agents\$agent\agent"
        New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
        Copy-Item $mainAuth (Join-Path $agentDir $authFilename) -Force
        $synced++
    }

    Log "API Key 已同步到 $synced 个 Agent"
    Info "来源: $mainAuth"
}

function Build-Frontend {
    Info "构建 React 前端..."
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Warn "未找到 node，跳过前端构建。看板将使用预构建版本（如果存在）"
        Warn "请安装 Node.js 18+ 后运行: cd agentorchestrator\frontend && npm install && npm run build"
        return
    }

    $pkgJson = Join-Path $REPO_DIR "agentorchestrator\frontend\package.json"
    if (Test-Path $pkgJson) {
        Push-Location (Join-Path $REPO_DIR "agentorchestrator\frontend")
        $pnpmLock = Join-Path (Get-Location) "pnpm-lock.yaml"
        if (Get-Command pnpm -ErrorAction SilentlyContinue -and (Test-Path $pnpmLock)) {
            pnpm install --silent
            pnpm build
        } else {
            npm install --silent 2>$null
            npm run build 2>$null
        }
        Pop-Location

        $frontendDist = Join-Path $REPO_DIR "agentorchestrator\frontend\dist"
        $dashboardDist = Join-Path $REPO_DIR "dashboard\dist"
        $indexHtml = Join-Path $dashboardDist "index.html"
        if (Test-Path $frontendDist) {
            if (Test-Path $dashboardDist) {
                Remove-Item $dashboardDist -Recurse -Force
            }
            New-Item -ItemType Directory -Path (Join-Path $REPO_DIR "dashboard") -Force | Out-Null
            Copy-Item $frontendDist $dashboardDist -Recurse
            Log "前端构建并同步完成: dashboard\dist\"
        } elseif (Test-Path $indexHtml) {
            Warn "未检测到 agentorchestrator\frontend\dist，继续使用现有 dashboard\dist"
        } else {
            Warn "前端构建失败：未找到可部署的 dist 产物，请手动检查"
        }
    } else {
        Warn "未找到 agentorchestrator\frontend\package.json，跳过前端构建"
    }
}

function First-Sync {
    Info "执行首次数据同步..."
    Push-Location $REPO_DIR
    $env:REPO_DIR = $REPO_DIR
    try { & $global:PYTHON scripts/sync_agent_config.py } catch { Warn "sync_agent_config 有警告" }
    try { & $global:PYTHON scripts/sync_agents_overview.py } catch { Warn "sync_agents_overview 有警告" }
    try { & $global:PYTHON scripts/refresh_live_data.py } catch { Warn "refresh_live_data 有警告" }
    Pop-Location
    Log "首次同步完成"
}

function Restart-Gateway {
    Info "重启 OpenClaw Gateway..."
    try {
        openclaw gateway restart 2>$null
        Log "Gateway 重启成功"
    } catch {
        Warn "Gateway 重启失败，请手动重启: openclaw gateway restart"
    }
}

Write-Banner
Check-Deps
Backup-Existing
Create-Workspaces
Register-Agents
Init-Data
Link-Resources
Setup-Visibility
Sync-Auth
Build-Frontend
First-Sync
Restart-Gateway

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  AGENTORCHESTRATOR 安装完成！                               ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "下一步："
Write-Host "  1. 推荐方案：优先使用 AI 部署完成环境接入与编排。"
Write-Host "  2. 如需本地补齐 API Key（可选）:"
Write-Host "     openclaw agents add control_center     # 按提示输入模型密钥"
Write-Host "     .\install.ps1                          # 重新运行以同步到所有 Agent"
Write-Host "  3. 本地运行数据刷新循环:  bash scripts/run_loop.sh"
Write-Host "  4. 本地启动看板服务器:    python dashboard/server.py"
Write-Host "  5. 打开看板:              http://127.0.0.1:7891"
Write-Host ""
Warn "若采用本地脚本模式，首次运行前仍需先配置可用模型密钥"
Info "当前安装流程不会直接改写 openclaw.json；如需补齐运行时 Agent 注册，请查看 data/openclaw_registry_suggestions.json"
Info "文档口径已调整为优先推荐 AI 部署，详情见 docs/getting-started.md"
