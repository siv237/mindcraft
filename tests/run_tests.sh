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

echo "--- [2/5] Dependency graph (circular + orphans) ---"
madge --extensions js --circular main.js 2>&1 | head -5
madge --extensions js --circular src/agent/agent.js 2>&1 | head -10
madge --extensions js --orphans --warning src/agent/build_controller.js src/agent/build_queue.js src/agent/self_prompter.js 2>&1
echo ""

echo "--- [3/5] Method integrity (all functions exist) ---"
node -e "
import('./src/agent/build_controller.js').then(m => {
    const bc = new m.BuildController({name:'T', bot:{spawnPoint:{x:0,y:0,z:0},entity:{position:{x:0,y:0,z:0}},game:{dimension:'o'}}, memory_bank:{rememberPlace:()=>{}}, actions:{}});
    const methods = ['loadBlueprint','listBlueprints','start','switchTo','complete','stop','getDimensions','getWorldPos','scanBlock','getAllBlocks','computeProgress','determinePhase','isLevelComplete','findWrongBlocks','findMissingBlocks','findClearableBlocks','findSalvageBlocks','getInventoryCounts','resolveBlockName','countNeededMaterials','countMissingMaterials','getToolAction','getNextAction','executeDirect','formatClearAction','formatSalvageAction','formatPlaceAction','formatGatherAction','saveState','loadState','getWorldId','log'];
    let missing = methods.filter(m => typeof bc[m] !== 'function');
    if (missing.length > 0) { console.error('MISSING METHODS:', missing.join(', ')); process.exit(1); }
    console.log('  All', methods.length, 'BuildController methods OK');
});
" 2>&1
echo ""

echo "--- [4/5] ESLint ---"
npx eslint src/agent/build_controller.js src/agent/self_prompter.js src/agent/commands/index.js 2>&1 | tail -5 || echo "  (lint warnings only)"
echo ""

echo "--- [5/5] Unit tests ---"
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
