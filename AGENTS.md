# Repository Guidelines

## Project Structure & Module Organization
This repository is currently minimal, with only `README.md` and `LICENSE` at the root. There is no established `src/`, `tests/`, or `assets/` directory yet. When adding code, prefer a clear top-level layout such as:
- `src/` for implementation code
- `tests/` for automated tests
- `scripts/` for developer utilities
- `assets/` for non-code artifacts

## Build, Test, and Development Commands
No build, test, or run scripts are configured yet. If you add tooling, document the primary commands here (for example: `npm run build`, `npm test`, or `make dev`) and keep the list short and actionable.

## Coding Style & Naming Conventions
No formatting or linting rules are defined. If you introduce a language or framework, also add:
- Indentation rules (e.g., 2 spaces for JS/TS, 4 spaces for Python).
- Naming patterns (e.g., `camelCase` for variables, `PascalCase` for types).
- Formatting/linting tools (e.g., `prettier`, `eslint`, `ruff`) and how to run them.

## Testing Guidelines
No test framework is configured. When tests are added, include:
- The framework name (e.g., `jest`, `pytest`).
- Naming conventions (e.g., `*.spec.ts`, `test_*.py`).
- How to run the suite (e.g., `npm test`, `pytest`).

## Commit & Pull Request Guidelines
The git history currently contains only an initial commit, so no commit message convention is established. Keep messages clear and imperative (e.g., "Add README section").

For pull requests, include:
- A concise description of changes and motivation.
- Links to related issues (if any).
- Notes on testing performed (commands and results).

## Configuration & Security Notes
No runtime configuration or secrets are defined. If you add configuration files, document where they live (for example, `.env.example`) and how to manage sensitive values safely.
