#!/usr/bin/env bash
# setup-home-machine.sh
#
# Setup en máquina nueva (casa, otro WSL, etc).
# Auto-detecta user, crea paths correctos, extrae memoria.
#
# Uso:
#   1. Bajá sso-memory.tgz a esta máquina (ej. /tmp/ o Downloads de Windows)
#   2. Bajá este script (o clonalo desde el repo)
#   3. bash setup-home-machine.sh /ruta/a/sso-memory.tgz [repo-ssh-url]
#
# Ejemplo:
#   bash setup-home-machine.sh /mnt/c/Users/ness/Downloads/sso-memory.tgz

set -euo pipefail

TARBALL="${1:?Uso: bash setup-home-machine.sh <tarball.tgz> [repo-url]}"
REPO_URL="${2:-git@github.com:DrawNess/SINGLE_SIGN-ON.git}"

USER_NAME="$(whoami)"
HOME_DIR="$HOME"
PROJECT_DIR="$HOME_DIR/Pages/Single_Sign_On-GEMMATEX"

# Memory key = path con / reemplazado por -
MEMORY_KEY="$(echo "$PROJECT_DIR" | sed 's|/|-|g')"
MEMORY_BASE="$HOME_DIR/.claude/projects"
MEMORY_DIR="$MEMORY_BASE/$MEMORY_KEY"

echo "=========================================="
echo "Setup SSO GEMMATEX (máquina nueva)"
echo "=========================================="
echo "User:       $USER_NAME"
echo "Home:       $HOME_DIR"
echo "Project:    $PROJECT_DIR"
echo "Memory key: $MEMORY_KEY"
echo "Tarball:    $TARBALL"
echo "Repo:       $REPO_URL"
echo "=========================================="
echo

if [[ ! -f "$TARBALL" ]]; then
  echo "ERROR: tarball no existe en $TARBALL"
  exit 1
fi

# 1. Clonar repo si no existe
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "[1/3] Clonando repo en $PROJECT_DIR..."
  mkdir -p "$(dirname "$PROJECT_DIR")"
  git clone "$REPO_URL" "$PROJECT_DIR"
else
  echo "[1/3] Repo ya existe en $PROJECT_DIR. git pull..."
  git -C "$PROJECT_DIR" pull --ff-only || echo "  (pull falló, continúa de todos modos)"
fi

# 2. Extraer tarball
echo "[2/3] Extrayendo memoria..."
mkdir -p "$MEMORY_BASE"
TMP_EXTRACT="$(mktemp -d)"
tar xzf "$TARBALL" -C "$TMP_EXTRACT"

# Tarball contiene una sola carpeta: -home-draw-Pages-...
SRC_DIR="$(find "$TMP_EXTRACT" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [[ -z "$SRC_DIR" ]]; then
  echo "ERROR: tarball no contiene carpeta de memoria"
  exit 1
fi

# Renombrar al key correcto para esta máquina
if [[ -d "$MEMORY_DIR" ]]; then
  BACKUP="${MEMORY_DIR}.backup.$(date +%s)"
  echo "  Memoria existente. Backup → $BACKUP"
  mv "$MEMORY_DIR" "$BACKUP"
fi
mv "$SRC_DIR" "$MEMORY_DIR"
rm -rf "$TMP_EXTRACT"

echo "  Memoria extraída en $MEMORY_DIR"
echo "  Archivos:"
ls -1 "$MEMORY_DIR/memory/" | sed 's/^/    /'

# 3. Smoke test
echo "[3/3] Smoke test..."
test -f "$PROJECT_DIR/package.json" && echo "  ✓ Repo OK"
test -f "$MEMORY_DIR/memory/MEMORY.md" && echo "  ✓ Memoria OK"

echo
echo "=========================================="
echo "LISTO. Próximos pasos:"
echo "  cd $PROJECT_DIR"
echo "  npm ci"
echo "  claude     # abrí Claude Code aquí"
echo "=========================================="
