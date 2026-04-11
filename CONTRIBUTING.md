# Contributing to Multi-Agent Orchestrator

Thank you for your interest in contributing to **Multi-Agent Orchestrator**. This repository is maintained as a public, sanitized release of a production-oriented multi-agent orchestration system. Contributions that improve clarity, reliability, developer experience, documentation quality, and public usability are all welcome.

This guide explains how to report issues, propose changes, prepare pull requests, and keep contributions aligned with the repository's public-release standards.

---

## Contribution Scope

We welcome contributions across both documentation and code. In particular, high-value contributions usually fall into one of the following categories.

| Area | What is welcome |
| --- | --- |
| Documentation | README improvements, architecture clarification, onboarding guides, translations, screenshots, and examples |
| Dashboard | UI polish, accessibility, filtering, state presentation, and monitoring improvements |
| Backend orchestration | Task models, dispatch logic, validation rules, service structure, and testability improvements |
| Developer tooling | Local setup, scripts, build flow, release hygiene, and automation support |
| Testing | Regression checks, frontend build verification, API tests, and task-flow validation |
| Sanitized release quality | Removal of legacy references, sensitive material checks, and public-repo consistency improvements |

If you are unsure whether a change fits the project direction, open an issue first and describe the motivation, expected behavior, and impact.

---

## Before You Start

Please read the repository documentation before opening a pull request. The following files are especially useful for understanding project intent and public-release boundaries.

| File | Purpose |
| --- | --- |
| `README.md` | Project overview, architecture positioning, and public release notes |
| `README_EN.md` | English overview for external readers |
| `docs/current_architecture_overview.md` | Core orchestration architecture and task lifecycle |
| `docs/getting-started.md` | Local setup and development orientation |
| `SECURITY.md` | Security reporting expectations |

Because this is a **public sanitized repository**, contributors must not commit secrets, local runtime data, machine-side logs, webhook credentials, or private review notes.

---

## Reporting Bugs

If you find a bug, please open an issue with enough context to reproduce it. Clear bug reports help maintainers verify whether the problem belongs to frontend behavior, dashboard services, backend orchestration, data assumptions, or local environment differences.

A strong bug report should include the following information.

| Item | Description |
| --- | --- |
| Environment | OS, Python version, Node version if relevant |
| Component | Dashboard, frontend, backend, scripts, or docs |
| Reproduction steps | A minimal sequence that triggers the issue |
| Expected behavior | What should have happened |
| Actual behavior | What actually happened |
| Logs or screenshots | Only if they do not expose secrets or private data |

When reporting UI bugs, screenshots are welcome, but please make sure they do not reveal tokens, private endpoints, runtime data, or local machine identifiers.

---

## Proposing Features

Feature requests are welcome, especially when they improve orchestration clarity, governance, observability, developer experience, or public usability. A good feature proposal should explain the problem first, then the proposed solution, and finally the expected trade-offs.

We recommend describing feature requests through the following structure.

| Section | What to include |
| --- | --- |
| Problem | What limitation exists today |
| Proposal | What change you want to introduce |
| Value | Why the change is useful |
| Scope | Which modules are affected |
| Risks | What complexity or compatibility cost may be introduced |

This makes it easier to review whether a feature should be handled as a documentation improvement, UI enhancement, architectural change, or optional extension.

---

## Pull Request Workflow

For most contributions, the standard fork-and-pull workflow is recommended.

```bash
# 1. Fork the repository on GitHub

# 2. Clone your fork
git clone https://github.com/<your-username>/multi-agent-orchestrator.git
cd multi-agent-orchestrator

# 3. Create a feature branch
git checkout -b feat/my-change

# 4. Make your changes

# 5. Run the relevant checks
python3 -m py_compile dashboard/server.py

# 6. Commit
git add .
git commit -m "feat: improve orchestration runtime behavior"

# 7. Push and open a pull request
git push origin feat/my-change
```

If your contribution changes user-facing behavior, please explain the previous behavior, the new behavior, and how reviewers can verify the difference.

---

## Local Development

The repository can be explored in more than one way depending on whether you want to inspect the dashboard, work on frontend code, or extend backend orchestration.

### Recommended local run

```bash
./agentorchestrator.sh start
```

Then open:

```text
http://127.0.0.1:8000
```

If you need the legacy dashboard only for compatibility verification, enable it explicitly:

```bash
AGENTORCHESTRATOR_ENABLE_LEGACY_DASHBOARD=1 ./agentorchestrator.sh start
```

Then open `http://127.0.0.1:7891`. This port is optional compatibility UI only, not the primary runtime entry.

### Module-level development

| Module | Suggested action |
| --- | --- |
| Unified local stack | `./agentorchestrator.sh start` |
| Legacy dashboard compatibility | `python3 dashboard/server.py` or enable the compatibility mode above |
| Frontend | Work inside `agentorchestrator/frontend/` and run the local build flow |
| Backend | Extend services and orchestration logic in `agentorchestrator/backend/` |
| Scripts | Run task-refresh or sync scripts inside `scripts/` as needed |

If you add new developer instructions, please update the relevant documentation so that public users can follow the same workflow.

---

## Public Repository Hygiene

This repository is published publicly, so every contribution must respect the public-release boundary. The most important rule is simple: **do not commit private or sensitive material**.

The following table summarizes what must be excluded from pull requests.

| Must not be committed | Why |
| --- | --- |
| `.env` files with real values | They may contain secrets or private endpoints |
| Local runtime data | They may reveal private tasks, logs, or state |
| Machine-side logs | They may expose tokens, paths, or operational traces |
| Real webhooks or credentials | They are security-sensitive |
| Internal audit or review notes | They are not part of the public release |

If you need to demonstrate a configuration pattern, use placeholders or example values instead.

---

## Testing Expectations

The project does not require the exact same checks for every change, but contributions should be validated proportionally to their scope.

| Change type | Recommended validation |
| --- | --- |
| Documentation-only | Check links, headings, formatting, and consistency |
| Dashboard change | Run the unified local stack and verify the affected UI; use legacy dashboard mode only when compatibility behavior is involved |
| Backend change | Run syntax checks and relevant local behavior verification |
| Script change | Execute the script safely with test or placeholder inputs |
| Release hygiene change | Re-scan for legacy references, sensitive material, and broken links |

Typical examples:

```bash
python3 -m py_compile dashboard/server.py
python3 -m py_compile agentorchestrator/backend/app/main.py
python3 -m py_compile scripts/task_db.py
python3 tests/test_e2e_kanban.py
```

If a check cannot be run in your environment, mention that clearly in the pull request description.

---

## Commit Message Convention

This repository follows **Conventional Commits**.

| Type | Meaning |
| --- | --- |
| `feat` | New functionality |
| `fix` | Bug fix |
| `docs` | Documentation update |
| `refactor` | Internal restructuring without behavior change |
| `test` | Test-related change |
| `chore` | Maintenance work |
| `ci` | CI or automation change |

Examples:

```text
feat: add archive view filters
fix: correct task status normalization in dashboard
/docs: rewrite public attribution section
refactor: simplify dispatch role mapping
```

Please keep commit messages concise, specific, and review-friendly.

---

## Code Style

Use clear, maintainable, and minimal changes whenever possible. Contributions should preserve the current codebase style rather than introducing unnecessary formatting churn.

| Language / Area | Style expectation |
| --- | --- |
| Python | Follow PEP 8 and prefer readable, explicit logic |
| TypeScript / React | Prefer functional components and predictable state handling |
| CSS | Keep naming and variables consistent with the existing UI layer |
| Markdown | Use clear headings, readable tables, and accurate links |

For larger refactors, explain the rationale in the pull request so reviewers can separate behavior changes from structural cleanup.

---

## Documentation and Source Notes

This repository is now presented primarily as **JiangNanGenius**'s maintained project. When editing README files, public metadata, or other user-facing materials, keep the outward wording focused on the current project name and current authorship.

If historical references or source notes need to be mentioned, keep them brief, accurate, and limited to the minimum necessary scope. Do not let public-facing documents drift back into a repository-lineage narrative that overwhelms the current project description.

---

## Code of Conduct

By participating in this project, you agree to follow the repository's [Code of Conduct](CODE_OF_CONDUCT.md). Please keep discussions respectful, constructive, and focused on improving the project.

---

## Security

If you discover a security issue, please **do not** report it publicly in an issue. Follow the instructions in [SECURITY.md](SECURITY.md).

---

## Contact and Project Links

For public collaboration, please use the current repository links rather than historical project links.

| Channel | Link |
| --- | --- |
| Issues | https://github.com/JiangNanGenius/multi-agent-orchestrator/issues |
| Repository | https://github.com/JiangNanGenius/multi-agent-orchestrator |

Thank you for helping improve **Multi-Agent Orchestrator** in a way that is cleaner, safer, and more useful for public users.
