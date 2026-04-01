#!/bin/bash
# Adam Bot Control Script
# Usage: ./adam.sh start | stop | status | logs

RAILWAY_TOKEN="af77c934-8ee3-4438-8820-f89f71c2eaf2"
BROWSERLESS_TOKEN="2UEs5o6f1T8eqe28653789cac720063e2f404ea30d2b47018"
SERVICE="topia-bot"
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADAPTER_DIR="$(dirname "$BOT_DIR")"

export RAILWAY_TOKEN

case "$1" in
  start)
    echo "=== Starting Adam ==="
    # Kill any leftover Browserless sessions first
    curl -s "https://chrome.browserless.io/kill/all?token=${BROWSERLESS_TOKEN}" > /dev/null 2>&1
    echo "Cleared Browserless sessions"
    # Deploy from gateway-adapter directory (Railway expects bot/ subdirectory)
    cd "$ADAPTER_DIR"
    railway up --service "$SERVICE" --detach 2>&1 | grep -v "Unable to parse"
    echo "Deployed. Check logs with: ./adam.sh logs"
    ;;

  stop)
    echo "=== Stopping Adam ==="
    # Kill Browserless sessions
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" "https://chrome.browserless.io/kill/all?token=${BROWSERLESS_TOKEN}")
    echo "Browserless kill: $HTTP"
    # Remove Railway deployment
    railway down --service "$SERVICE" -y 2>&1 | grep -v "Unable to parse"
    echo "Adam stopped."
    ;;

  status)
    echo "=== Adam Status ==="
    STATUS=$(curl -s "https://topia-bot-production.up.railway.app/" 2>/dev/null)
    if [ -z "$STATUS" ]; then
      echo "Bot is offline (no response from health endpoint)"
    else
      echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Agent: {d[\"agent\"]}  Status: {d[\"status\"]}  Uptime: {int(d[\"uptime\"])}s')" 2>/dev/null || echo "$STATUS"
    fi
    # Check Browserless sessions
    echo ""
    echo "Browserless account:"
    curl -s "https://chrome.browserless.io/json/version?token=${BROWSERLESS_TOKEN}" -o /dev/null -w "  Reachable: HTTP %{http_code}\n" 2>/dev/null
    ;;

  logs)
    railway logs --service "$SERVICE" 2>&1 | grep -v "Unable to parse"
    ;;

  debug)
    echo "=== Adam Debug (screenshot + page state) ==="
    curl -s "https://topia-bot-production.up.railway.app/debug" | sed 's/<img[^>]*>/\n[Screenshot available at \/debug endpoint]\n/'
    ;;

  *)
    echo "Adam Bot Control"
    echo "Usage: ./adam.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start   - Deploy Adam to Railway + clear old Browserless sessions"
    echo "  stop    - Kill Browserless sessions + remove Railway deployment"
    echo "  status  - Check if Adam is running and Browserless health"
    echo "  logs    - Show Railway deployment logs"
    echo "  debug   - Show what Adam's browser sees (page state + screenshot)"
    ;;
esac
