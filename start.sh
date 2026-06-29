#!/bin/bash
set -euo pipefail

# ========== CONFIG ==========
MINDCRAFT_DIR="/root/mindcraft"
OLLAMA_URL="http://192.168.237.187:11434"
LOG_FILE="$MINDCRAFT_DIR/mindcraft.log"
NODE_MIN_MAJOR=20
LAN_DISCOVERY_TIMEOUT=15  # seconds to wait for Minecraft LAN broadcast

# ========== COLORS ==========
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] OK   $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN $*${NC}"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] FAIL $*${NC}"; exit 1; }

# ========== PRE-FLIGHT CHECKS ==========

log "MindCraft startup — pre-flight checks"

# 1. Node.js
NODE_VER=$(node -v 2>/dev/null | sed 's/v//') || fail "Node.js not found"
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
[[ "$NODE_MAJOR" -ge "$NODE_MIN_MAJOR" ]] || fail "Node.js $NODE_VER too old (need >= v$NODE_MIN_MAJOR)"
ok "Node.js v$NODE_VER"

# 2. Dependencies
if [[ ! -d "$MINDCRAFT_DIR/node_modules" ]]; then
    log "Installing npm dependencies..."
    npm install --prefix "$MINDCRAFT_DIR" 2>&1 | tail -5
    [[ -d "$MINDCRAFT_DIR/node_modules" ]] || fail "npm install failed"
fi
ok "Dependencies installed"

# 3. Ollama
OLLAMA_OK=$(curl -s --max-time 5 "$OLLAMA_URL/api/tags" | grep -c '"name"' || true)
if [[ "$OLLAMA_OK" -eq 0 ]]; then
    warn "Ollama not reachable at $OLLAMA_URL — bot will fail on LLM calls"
else
    MODEL_COUNT=$(curl -s "$OLLAMA_URL/api/tags" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "?")
    ok "Ollama reachable ($MODEL_COUNT models)"
fi

# 4. Minecraft LAN server discovery
log "Searching for Minecraft LAN server (multicast 224.0.2.60:4445)..."
MC_RESULT=$(timeout "$LAN_DISCOVERY_TIMEOUT" python3 -c "
import socket, struct, sys
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('', 4445))
mreq = struct.pack('4sl', socket.inet_aton('224.0.2.60'), socket.INADDR_ANY)
sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
sock.settimeout($LAN_DISCOVERY_TIMEOUT)
try:
    data, addr = sock.recvfrom(4096)
    text = data.decode('utf-8', errors='replace')
    import re
    port_m = re.search(r'\[AD\](\d+)\[/AD\]', text)
    motd_m = re.search(r'\[MOTD\](.*?)\[/MOTD\]', text)
    port = port_m.group(1) if port_m else '?'
    motd = motd_m.group(1) if motd_m else '?'
    print(f'{addr[0]}:{port}|{motd}')
except socket.timeout:
    print('NOT_FOUND')
finally:
    sock.close()
" 2>&1) || MC_RESULT="NOT_FOUND"

if [[ "$MC_RESULT" == "NOT_FOUND" ]]; then
    warn "Minecraft LAN server not found — bot will retry via auto-discovery on start"
else
    MC_HOST=$(echo "$MC_RESULT" | cut -d: -f1)
    MC_PORT=$(echo "$MC_RESULT" | cut -d: -f2 | cut -d'|' -f1)
    MC_MOTD=$(echo "$MC_RESULT" | cut -d'|' -f2)
    ok "Minecraft server: $MC_HOST:$MC_PORT ($MC_MOTD)"
fi

# 5. Settings sanity
[[ -f "$MINDCRAFT_DIR/settings.js" ]] || fail "settings.js not found"
[[ -f "$MINDCRAFT_DIR/profiles/ollama-andy4.json" ]] || fail "Profile ollama-andy4.json not found"
ok "Config files present"

# 6. Port 8080 (MindServer)
if ss -tlnp | grep -q ':8080 ' 2>/dev/null; then
    warn "Port 8080 already in use — MindServer may conflict"
else
    ok "Port 8080 free"
fi

# ========== LOG ROTATION ==========
LOG_FILE="$MINDCRAFT_DIR/mindcraft.log"
OLD_LOG="$MINDCRAFT_DIR/mindcraft.old.log"
if [[ -f "$LOG_FILE" ]]; then
    if [[ -f "$OLD_LOG" ]]; then
        cat "$LOG_FILE" >> "$OLD_LOG"
    else
        cp "$LOG_FILE" "$OLD_LOG"
    fi
    : > "$LOG_FILE"
    log "Log rotated — previous log appended to mindcraft.old.log"
fi

# ========== START ==========

log "All checks passed. Starting MindCraft..."
echo "========================================"

cd "$MINDCRAFT_DIR"
exec /usr/bin/node main.js
