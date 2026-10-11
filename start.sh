#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# Cloud Shell keeps its supported Node install outside the login PATH.
if ! command -v node >/dev/null 2>&1 && [[ -x /usr/local/nvm/versions/node/v24.21.0/bin/node ]]; then
  export PATH="/usr/local/nvm/versions/node/v24.21.0/bin:$PATH"
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
while (($#)); do
  case "$1" in
    -p|--port)
      if (($# < 2)); then echo "Missing value for $1" >&2; exit 2; fi
      PORT="$2"
      shift 2
      ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --host)
      if (($# < 2)); then echo "Missing value for --host" >&2; exit 2; fi
      HOST="$2"
      shift 2
      ;;
    --host=*) HOST="${1#*=}"; shift ;;
    -h|--help)
      echo "Usage: ./start.sh [--port PORT] [--host HOST]"
      echo "Examples: ./start.sh --port 3001  |  ./start.sh -p 8080"
      echo "Defaults: port ${PORT}, host ${HOST} (overridable with PORT and HOST)."
      exit 0
      ;;
    *) echo "Unknown option: $1. Use ./start.sh --help for usage." >&2; exit 2 ;;
  esac
done

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  echo "Invalid port: $PORT. Choose a number from 1 to 65535." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Install Node.js 20.19+ or 22.12+, then run this script again." >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22 ? 0 : 1)'; then
  echo "Unsupported Node.js version: $(node --version). Install Node.js 20.19+ or 22.12+, then run this script again." >&2
  exit 1
fi

if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example. Set DATABASE_URL, Paystack, and admin credentials, then run ./start.sh again." >&2
  exit 1
fi

# Keep repeat starts quick, while reinstalling whenever package-lock.json changes.
LOCK_HASH="$(node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync('package-lock.json')).digest('hex'))")"
LOCK_MARKER="node_modules/.restaurant-package-lock.sha256"
if [[ ! -x node_modules/.bin/next ]]; then
  echo "Installing project dependencies…"
  npm ci --prefer-offline --no-audit --no-fund
elif [[ ! -f "$LOCK_MARKER" ]]; then
  echo "Checking project dependencies…"
  npm install --prefer-offline --no-audit --no-fund
elif [[ "$(<"$LOCK_MARKER")" != "$LOCK_HASH" ]]; then
  echo "Updating project dependencies from package-lock.json…"
  npm ci --prefer-offline --no-audit --no-fund
fi
mkdir -p node_modules
printf '%s' "$LOCK_HASH" > "$LOCK_MARKER"

# Start the local PostgreSQL cluster when this project is configured for one.
DB_TARGET="$(node -e "require('dotenv').config({path:'.env.local',quiet:true});try{const u=new URL(process.env.DATABASE_URL);process.stdout.write(u.hostname+' '+(u.port||'5432'))}catch{}")"
if [[ -n "$DB_TARGET" ]] && command -v pg_isready >/dev/null 2>&1; then
  read -r DB_HOST DB_PORT <<< "$DB_TARGET"
  case "$DB_HOST" in
    localhost|127.0.0.1|::1)
      if ! pg_isready -q -h "$DB_HOST" -p "$DB_PORT"; then
        echo "Starting local PostgreSQL…"
        if command -v sudo >/dev/null 2>&1; then sudo -n pg_ctlcluster 16 main start 2>/dev/null || true; fi
      fi
      if ! pg_isready -q -h "$DB_HOST" -p "$DB_PORT"; then
        echo "PostgreSQL is not accepting connections at ${DB_HOST}:${DB_PORT}. Start the database and retry." >&2
        exit 1
      fi
      ;;
  esac
fi

echo "Initializing the restaurant database…"
if ! npm run db:init; then
  echo "Database setup failed. Check that PostgreSQL is running and DATABASE_URL in .env.local is correct." >&2
  exit 1
fi

echo "Starting the website at http://localhost:${PORT} (host ${HOST})…"
exec npm run dev -- --hostname "$HOST" --port "$PORT"
