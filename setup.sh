#!/usr/bin/env bash
# One-time setup for Maqet. Idempotent. Review before running.
#   ./setup.sh [path-or-git-url-of-mme]     default: ../mme (sibling folder from the kit zip)
set -euo pipefail
cd "$(dirname "$0")"
MME_SRC="${1:-../mme}"

echo "==> Prerequisites"
for cmd in node git python3 claude docker rg; do
  command -v "$cmd" >/dev/null && echo "  ok  $cmd" || echo "  MISSING $cmd"
done

echo "==> Python env + MME"
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
if [ -d "$MME_SRC" ]; then pip install -q -e "$MME_SRC"; else pip install -q "$MME_SRC"; fi
pip install -q ezdxf shapely pydantic fastapi "uvicorn[standard]" pytest ruff

[ -f .env ] || cp .env.example .env

echo "==> ECC rule packs (project-local; plugins can't ship rules)"
if [ ! -d .cache/ECC ]; then git clone -q --depth 1 https://github.com/affaan-m/ECC.git .cache/ECC; fi
mkdir -p .claude/rules/ecc
cp -R .cache/ECC/rules/common .cache/ECC/rules/python .cache/ECC/rules/typescript .claude/rules/ecc/
grep -q "^.cache/" .gitignore || echo ".cache/" >> .gitignore

echo "==> MME project files (never overwrites your edits)"
mme init --start 2026-10-26 >/dev/null
mme doctor || true

git add -A && git commit -qm "chore: Maqet workspace (MME + ECC rules)" 2>/dev/null || true

cat <<'EOF'

==> Next
1) ECC plugin, ONCE, official source:   npx ecc-universal@2.2.3 setup     (scope: project, hooks: Standard)
2) Shell integration (add to ~/.zshrc or ~/.bashrc):   eval "$(mme shell-init)"
3) Fill .env (LITELLM_MASTER_KEY sk-..., POSTGRES_PASSWORD; MODEL_API_KEY on kickoff day)
4) This weekend, $0:   mme gateway drill
5) Kickoff:   mme smoke --image  ->  mme gateway up  ->  mme gateway check  ->  mme policy <per rules>
6) Every day: see docs/PLAN.md ("Rutina diaria")
Always start claude from a shell where .venv is active (the hooks call `mme`).
EOF
