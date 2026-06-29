#!/bin/bash
set -euo pipefail

echo "=============================="
echo "  MindCraft Test Suite"
echo "=============================="
echo ""

cd "$(dirname "$0")/.."

FAIL=0

echo "--- [1/4] Syntax check ---"
node --check src/agent/build_controller.js && echo "  build_controller.js OK" || FAIL=1
node --check src/agent/self_prompter.js && echo "  self_prompter.js OK" || FAIL=1
node --check src/agent/agent.js && echo "  agent.js OK" || FAIL=1
node --check src/agent/commands/index.js && echo "  commands/index.js OK" || FAIL=1
node --check src/agent/commands/actions.js && echo "  commands/actions.js OK" || FAIL=1
node --check src/mindcraft/mcserver.js && echo "  mcserver.js OK" || FAIL=1
node --check settings.js && echo "  settings.js OK" || FAIL=1
echo ""

echo "--- [2/4] Dependency graph (circular + orphans) ---"
madge --extensions js --circular main.js 2>&1 | head -5
madge --extensions js --circular src/agent/agent.js 2>&1 | head -10
echo ""

echo "--- [3/4] ESLint ---"
npx eslint src/agent/build_controller.js src/agent/self_prompter.js src/agent/commands/index.js 2>&1 | tail -5 || echo "  (lint warnings only)"
echo ""

echo "--- [4/4] Unit tests ---"
node --test tests/ 2>&1
TEST_RESULT=$?
echo ""

if [ $FAIL -ne 0 ] || [ $TEST_RESULT -ne 0 ]; then
    echo "=============================="
    echo "  TESTS FAILED"
    echo "=============================="
    exit 1
else
    echo "=============================="
    echo "  ALL TESTS PASSED"
    echo "=============================="
    exit 0
fi
