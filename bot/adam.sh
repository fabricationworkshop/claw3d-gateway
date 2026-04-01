#!/bin/bash
# Adam Bot Control Script
# Usage: ./adam.sh start | stop | status | logs | deploy

RAILWAY_TOKEN="af77c934-8ee3-4438-8820-f89f71c2eaf2"
BROWSERLESS_TOKEN="2UEs5o6f1T8eqe28653789cac720063e2f404ea30d2b47018"
SERVICE="topia-bot"
BOT_URL="https://topia-bot-production.up.railway.app"
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADAPTER_DIR="$(dirname "$BOT_DIR")"

export RAILWAY_TOKEN

case "$1" in
  start)
    echo "=== Waking Adam ==="
    RESP=$(curl -s "$BOT_URL/start")
    echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Status: {d[\"status\"]}')" 2>/dev/null || echo "$RESP"
    echo "Adam will enter the world and auto-sleep after 3min idle."
    ;;

  stop)
    echo "=== Stopping Adam ==="
    RESP=$(curl -s "$BOT_URL/stop")
    echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Status: {d[\"status\"]}')" 2>/dev/null || echo "$RESP"
    # Also kill any lingering Browserless sessions
    curl -s "https://chrome.browserless.io/kill/all?token=${BROWSERLESS_TOKEN}" > /dev/null 2>&1
    echo "Adam stopped + Browserless sessions cleared."
    ;;

  status)
    echo "=== Adam Status ==="
    RESP=$(curl -s "$BOT_URL/" 2>/dev/null)
    if [ -z "$RESP" ]; then
      echo "Bot service is offline (Railway not running)"
    else
      echo "$RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
idle = f', idle {d[\"idleSeconds\"]}s' if d.get('idleSeconds') else ''
print(f'Agent: {d[\"agent\"]}  Status: {d[\"status\"]}  Uptime: {int(d[\"uptime\"])}s{idle}')
" 2>/dev/null || echo "$RESP"
    fi
    ;;

  logs)
    railway logs --service "$SERVICE" 2>&1 | grep -v "Unable to parse"
    ;;

  debug)
    echo "=== Adam Debug ==="
    curl -s "$BOT_URL/debug" | sed 's/<img[^>]*>/\n[Screenshot at \/debug]\n/'
    ;;

  deploy)
    echo "=== Deploying Adam to Railway ==="
    curl -s "https://chrome.browserless.io/kill/all?token=${BROWSERLESS_TOKEN}" > /dev/null 2>&1
    cd "$ADAPTER_DIR"
    railway up --service "$SERVICE" --detach 2>&1 | grep -v "Unable to parse"
    echo "Deployed. Bot starts idle — use ./adam.sh start to activate."
    ;;

  kill-sessions)
    echo "=== Killing all Browserless sessions ==="
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" "https://chrome.browserless.io/kill/all?token=${BROWSERLESS_TOKEN}")
    echo "Browserless kill: HTTP $HTTP"
    ;;

  *)
    echo "Adam Bot Control"
    echo "Usage: ./adam.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start          - Wake Adam (connect to Browserless, enter Topia)"
    echo "  stop           - Put Adam to sleep (disconnect, kill sessions)"
    echo "  status         - Check if Adam is active or idle"
    echo "  logs           - Show Railway deployment logs"
    echo "  debug          - Show what Adam's browser sees"
    echo "  deploy         - Push new code to Railway"
    echo "  kill-sessions  - Emergency: kill all Browserless sessions"
    echo ""
    echo "Adam auto-sleeps after 3 minutes with no conversation."
    echo "In Topia, clicking the activation object hits /start to wake him."
    ;;
esac
