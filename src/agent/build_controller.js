import { Vec3 } from 'vec3';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, appendFileSync } from 'fs';
import * as world from './library/world.js';
import * as skills from './library/skills.js';
import * as mc from '../utils/mcdata.js';
import { blockSatisfied, getTypeOfGeneric } from './npc/utils.js';
import { BuildQueue } from './build_queue.js';

const SMELTING_MAP = {
    'sand': 'glass',
    'red_sand': 'red_glass',
    'cobblestone': 'stone',
    'raw_iron': 'iron_ingot',
    'raw_gold': 'gold_ingot',
    'raw_copper': 'copper_ingot',
    'clay_ball': 'brick',
    'netherrack': 'nether_brick',
    'kelp': 'dried_kelp',
    'cactus': 'green_dye',
};

const REVERSE_SMELTING = Object.fromEntries(
    Object.entries(SMELTING_MAP).map(([src, out]) => [out, src])
);

const UTILITY_BLOCKS = ['furnace', 'crafting_table', 'chest', 'barrel'];

const PHASES = ['tools', 'clearing', 'floor', 'walls', 'roof', 'details', 'done'];

export class BuildController {
    constructor(agent) {
        this.agent = agent;
        this.blueprint = null;
        this.buildSite = null;
        this.phase = 'clearing';
        this.phaseIndex = 0;
        this.active = false;
        this.worldId = null;
        this.failCount = 0;
        this.lastAction = null;
        this.queue = new BuildQueue(this);
        this.verifiedBlocks = new Set();
        this.utilityPositions = {};
        this.utilities = [];
    }

    get bot() {
        return this.agent.bot;
    }

    get worldDir() {
        return `./bots/${this.agent.name}/worlds/${this.getWorldId()}`;
    }

    get stateFile() {
        return `${this.worldDir}/build_state.json`;
    }

    get logFile() {
        return `${this.worldDir}/build.log`;
    }

    get utilitiesFile() {
        return `${this.worldDir}/utilities.json`;
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}`;
        console.log(`[BC] ${msg}`);
        try {
            mkdirSync(this.worldDir, { recursive: true });
            appendFileSync(this.logFile, line + '\n');
        } catch {}
    }

    getWorldId() {
        const spawn = this.bot.spawnPoint;
        const dim = this.bot.game?.dimension || 'minecraft:overworld';
        if (spawn && (spawn.x !== 0 || spawn.y !== 0 || spawn.z !== 0)) {
            this.worldId = `${dim}_${Math.floor(spawn.x)}_${Math.floor(spawn.y)}_${Math.floor(spawn.z)}`;
        } else if (this.bot.entity?.position) {
            const pos = this.bot.entity.position;
            this.worldId = `${dim}_${Math.floor(pos.x / 1000) * 1000}_${Math.floor(pos.y / 100) * 100}_${Math.floor(pos.z / 1000) * 1000}`;
        } else {
            this.worldId = `${dim}_unknown`;
        }
        return this.worldId;
    }

    loadBlueprint(name) {
        const paths = [
            `./blueprints/${name}.json`,
            `./src/agent/npc/construction/${name}.json`,
        ];
        for (const p of paths) {
            if (existsSync(p)) {
                const data = JSON.parse(readFileSync(p, 'utf8'));
                this.blueprint = data;
                console.log(`Loaded blueprint: ${data.name || name} from ${p}`);
                return data;
            }
        }
        throw new Error(`Blueprint '${name}' not found in blueprints/ or npc/construction/`);
    }

    listBlueprints() {
        const result = [];
        const dirs = ['./blueprints', './src/agent/npc/construction'];
        for (const dir of dirs) {
            if (!existsSync(dir)) continue;
            const files = readdirSync(dir).filter(f => f.endsWith('.json'));
            for (const f of files) {
                try {
                    const data = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
                    const name = data.name || f.replace('.json', '');
                    const blocks = data.blocks;
                    const sy = blocks.length;
                    const sz = blocks[0].length;
                    const sx = blocks[0][0].length;
                    const desc = data.description || '';
                    const counts = {};
                    for (let y = 0; y < sy; y++)
                        for (let z = 0; z < sz; z++)
                            for (let x = 0; x < sx; x++) {
                                const b = blocks[y][z][x];
                                if (b && b !== '' && b !== 'air') {
                                    counts[b] = (counts[b] || 0) + 1;
                                }
                            }
                    const mats = Object.entries(counts).map(([k, v]) => `${v}x ${k}`).join(', ');
                    result.push({ name, size: `${sx}x${sz}x${sy}`, description: desc, materials: mats });
                } catch {}
            }
        }
        return result;
    }

    start(name, position = null) {
        this.loadBlueprint(name);
        if (position) {
            this.buildSite = position;
        } else {
            const pos = this.bot.entity.position;
            let x = Math.floor(pos.x);
            let y = Math.floor(pos.y);
            let z = Math.floor(pos.z);
            const groundY = this.findGroundLevel(x, y, z);
            if (groundY !== null) {
                y = groundY;
                this.log(`GROUND found at (${x},${y},${z}) — building from surface`);
            }
            this.buildSite = { x, y, z };
        }
        this.queue.load();
        const overlap = this.checkOverlap(this.buildSite);
        if (overlap) {
            this.log(`OVERLAP: build site (${this.buildSite.x},${this.buildSite.y},${this.buildSite.z}) overlaps with existing '${overlap.blueprintName}' at (${overlap.buildSite.x},${overlap.buildSite.y},${overlap.buildSite.z}). Aborting.`);
            return false;
        }
        this.phase = 'tools';
        this.phaseIndex = 0;
        this.active = true;
        this.failCount = 0;
        this.verifiedBlocks = new Set();
        this.queue.addTask(name, this.buildSite);
        this.saveState();
        this.agent.memory_bank.rememberPlace('build_site',
            this.buildSite.x, this.buildSite.y, this.buildSite.z);
        this.log(`START build '${name}' at (${this.buildSite.x}, ${this.buildSite.y}, ${this.buildSite.z}) world=${this.getWorldId()}`);
        return true;
    }

    checkOverlap(site) {
        const { sx, sz, sy } = this.getDimensions();
        const offset = this.blueprint.offset || 0;
        for (const task of this.queue.tasks) {
            if (task.status === 'done' || task.status === 'active' || task.status === 'paused') {
                const dx = Math.abs(site.x - task.buildSite.x);
                const dz = Math.abs(site.z - task.buildSite.z);
                const dy = Math.abs(site.y - task.buildSite.y);
                if (dx < sx && dz < sz && dy < sy + 5) {
                    return task;
                }
            }
        }
        return null;
    }

    getBuildBounds(site) {
        const { sx, sz, sy } = this.getDimensions();
        const offset = this.blueprint.offset || 0;
        return {
            minX: site.x, maxX: site.x + sx - 1,
            minY: site.y + offset, maxY: site.y + sy - 1 + offset,
            minZ: site.z, maxZ: site.z + sz - 1,
        };
    }

    checkDamagedBuilds() {
        const doneBuilds = this.queue.getDone();
        const recentlyCompleted = this.queue.tasks.find(t => t.status === 'done' && t.completedAt && (Date.now() - t.completedAt < 5000));
        for (const task of doneBuilds) {
            if (recentlyCompleted && task.id === recentlyCompleted.id) continue;
            const savedBlueprint = this.blueprint;
            const savedSite = this.buildSite;
            try {
                this.loadBlueprint(task.blueprintName);
                this.buildSite = task.buildSite;
                const progress = this.computeProgress();
                if (progress.percent < 100) {
                    this.log(`DAMAGE DETECTED: '${task.blueprintName}' at (${task.buildSite.x},${task.buildSite.y},${task.buildSite.z}) was ${progress.percent}% (was 100%). Needs repair.`);
                    this.blueprint = savedBlueprint;
                    this.buildSite = savedSite;
                    return task;
                }
            } catch (e) {
            }
            this.blueprint = savedBlueprint;
            this.buildSite = savedSite;
        }
        return null;
    }

    repair(task) {
        this.log(`REPAIR: starting repair of '${task.blueprintName}' at (${task.buildSite.x},${task.buildSite.y},${task.buildSite.z})`);
        this.loadBlueprint(task.blueprintName);
        this.buildSite = task.buildSite;
        this.phase = 'tools';
        this.active = true;
        this.failCount = 0;
        this.verifiedBlocks = new Set();
        task.status = 'active';
        this.queue.save();
        this.saveState();
    }

    demolish(taskId) {
        const task = this.queue.tasks.find(t => t.id === taskId);
        if (!task) return null;
        this.log(`DEMOLISH: removing '${task.blueprintName}' at (${task.buildSite.x},${task.buildSite.y},${task.buildSite.z})`);
        this.queue.removeTask(taskId);
        return task;
    }

    findGroundLevel(x, y, z) {
        for (let dy = 0; dy <= 20; dy++) {
            const checkY = y - dy;
            if (checkY < -64) break;
            const block = this.bot.blockAt(new Vec3(x, checkY, z));
            if (block && block.name !== 'air' && block.name !== 'void_air') {
                return checkY + 1;
            }
        }
        for (let dy = 0; dy <= 10; dy++) {
            const checkY = y + dy;
            const block = this.bot.blockAt(new Vec3(x, checkY, z));
            if (block && block.name !== 'air' && block.name !== 'void_air') {
                return checkY + 1;
            }
        }
        return null;
    }

    switchTo(blueprintName, position = null) {
        if (this.active && this.blueprint && this.buildSite) {
            this.log(`SWITCH: pausing '${this.blueprint.name}' to start '${blueprintName}'`);
            this.queue.load();
            const existing = this.queue.tasks.find(t =>
                t.blueprintName === this.blueprint.name &&
                t.buildSite.x === this.buildSite.x &&
                t.buildSite.y === this.buildSite.y &&
                t.buildSite.z === this.buildSite.z
            );
            if (!existing) {
                this.queue.addTask(this.blueprint.name, this.buildSite);
                const justAdded = this.queue.getCurrent();
                if (justAdded) justAdded.status = 'paused';
                this.queue.save();
            } else {
                existing.status = 'paused';
                this.queue.save();
            }
            this.active = false;
            this.saveState();
        }
        const result = this.start(blueprintName, position);
        return result;
    }

    complete() {
        const completed = this.blueprint?.name || 'unknown';
        this.log(`COMPLETE: '${completed}' finished`);
        this.active = false;
        this.saveState();
        const damaged = this.checkDamagedBuilds();
        if (damaged) {
            this.log(`AUTO-REPAIR: switching to repair '${damaged.blueprintName}'`);
            this.repair(damaged);
            return damaged;
        }
        const next = this.queue.completeCurrent();
        if (next) {
            this.log(`AUTO-RESUME: starting next task '${next.blueprintName}'`);
            this.loadBlueprint(next.blueprintName);
            this.buildSite = next.buildSite;
            this.phase = 'tools';
            this.active = true;
            this.failCount = 0;
            this.verifiedBlocks = new Set();
            this.saveState();
            return next;
        }
        const damagedAfter = this.checkDamagedBuilds();
        if (damagedAfter) {
            this.log(`AUTO-REPAIR: switching to repair '${damagedAfter.blueprintName}'`);
            this.repair(damagedAfter);
            return damagedAfter;
        }
        return null;
    }

    stop() {
        this.active = false;
        this.saveState();
        this.log(`STOP build. Phase was: ${this.phase}`);
    }

    getDimensions() {
        const b = this.blueprint.blocks;
        return {
            sy: b.length,
            sz: b[0].length,
            sx: b[0][0].length,
        };
    }

    getWorldPos(x, y, z) {
        const offset = this.blueprint.offset || 0;
        return new Vec3(
            this.buildSite.x + x,
            this.buildSite.y + y + offset,
            this.buildSite.z + z
        );
    }

    scanBlock(x, y, z) {
        const wp = this.getWorldPos(x, y, z);
        const current = this.bot.blockAt(wp);
        return { worldPos: wp, current };
    }

    getAllBlocks() {
        const { sy, sz, sx } = this.getDimensions();
        const result = [];
        for (let y = 0; y < sy; y++) {
            for (let z = 0; z < sz; z++) {
                for (let x = 0; x < sx; x++) {
                    const blockName = this.blueprint.blocks[y][z][x];
                    if (blockName === '' ) continue;
                    result.push({ x, y, z, blueprintBlock: blockName });
                }
            }
        }
        return result;
    }

    computeProgress() {
        const all = this.getAllBlocks();
        let placed = 0;
        let total = 0;
        let wrong = 0;
        for (const cell of all) {
            if (cell.blueprintBlock === 'air') {
                total++;
                const { current } = this.scanBlock(cell.x, cell.y, cell.z);
                if (current && current.name === 'air') placed++;
                else if (current && current.name !== 'air') wrong++;
            } else {
                total++;
                const { current } = this.scanBlock(cell.x, cell.y, cell.z);
                if (current && blockSatisfied(cell.blueprintBlock, current)) placed++;
                else if (current && current.name !== 'air') wrong++;
            }
        }
        return { placed, total, wrong, percent: Math.round(placed / total * 100) };
    }

    determinePhase() {
        const { sy, sz, sx } = this.getDimensions();
        const progress = this.computeProgress();
        const oldPhase = this.phase;

        if (progress.percent >= 100) {
            this.phase = 'done';
            if (oldPhase !== 'done') this.log(`PHASE: ${oldPhase}→done progress=${progress.percent}%`);
            return 'done';
        }

        const inv = this.getInventoryCounts();
        const isCreative = this.bot.game?.gameMode === 'creative';

        if (!isCreative) {
            const hasAxe = inv['wooden_axe'] || inv['stone_axe'] || inv['iron_axe'] || inv['diamond_axe'] || inv['golden_axe'];
            const hasPickaxe = inv['wooden_pickaxe'] || inv['stone_pickaxe'] || inv['iron_pickaxe'] || inv['diamond_pickaxe'] || inv['golden_pickaxe'];
            if (!hasAxe || !hasPickaxe) {
                this.phase = 'tools';
                if (oldPhase !== 'tools') this.log(`PHASE: ${oldPhase}→tools (no axe/pickaxe) progress=${progress.percent}%`);
                return 'tools';
            }
        }

        if (this.phase === 'tools' && !isCreative) {
            const hasAxe = inv['wooden_axe'] || inv['stone_axe'] || inv['iron_axe'] || inv['diamond_axe'] || inv['golden_axe'];
            const hasPickaxe = inv['wooden_pickaxe'] || inv['stone_pickaxe'] || inv['iron_pickaxe'] || inv['diamond_pickaxe'] || inv['golden_pickaxe'];
            if (!hasAxe || !hasPickaxe) {
                return 'tools';
            }
            this.phase = 'clearing';
            this.log(`PHASE: tools→clearing (tools ready)`);
        }

        if (this.phase === 'tools' && isCreative) {
            this.phase = 'clearing';
            this.log(`PHASE: tools→clearing (creative, skip tools)`);
        }

        if (this.phase === 'clearing') {
            const wrong = this.findWrongBlocks();
            const floorComplete = this.isLevelComplete(0);
            if (wrong.length > 0 && !floorComplete) {
                this.phase = 'clearing';
            } else if (!floorComplete) {
                if (oldPhase !== 'floor') this.log(`PHASE: ${oldPhase}→floor progress=${progress.percent}%`);
                this.phase = 'floor';
            } else if (wrong.length > 0) {
                this.phase = 'clearing';
            } else {
                this.log(`PHASE: ${oldPhase}→walls progress=${progress.percent}%`);
                this.phase = 'walls';
            }
        }

        if (this.phase === 'floor') {
            if (this.isLevelComplete(0)) {
                this.log(`PHASE: floor→walls progress=${progress.percent}%`);
                this.phase = 'walls';
            }
        }

        if (this.phase === 'walls') {
            let wallsComplete = true;
            for (let y = 1; y < sy - 1; y++) {
                if (!this.isLevelComplete(y)) {
                    wallsComplete = false;
                    break;
                }
            }
            if (wallsComplete) {
                this.log(`PHASE: walls→roof progress=${progress.percent}%`);
                this.phase = 'roof';
            }
        }

        if (this.phase === 'roof') {
            if (this.isLevelComplete(sy - 1)) {
                this.log(`PHASE: roof→details progress=${progress.percent}%`);
                this.phase = 'details';
            }
        }

        if (this.phase === 'details') {
            const wrong = this.findWrongBlocks();
            if (wrong.length === 0) {
                this.log(`PHASE: details→done progress=${progress.percent}%`);
                this.phase = 'done';
            }
        }

        return this.phase;
    }

    isLevelComplete(y) {
        const { sz, sx } = this.getDimensions();
        const blocks = this.blueprint.blocks[y];
        for (let z = 0; z < sz; z++) {
            for (let x = 0; x < sx; x++) {
                const expected = blocks[z][x];
                if (expected === '') continue;
                const { current } = this.scanBlock(x, y, z);
                if (!current || !blockSatisfied(expected, current)) {
                    return false;
                }
            }
        }
        return true;
    }

    findWrongBlocks() {
        const all = this.getAllBlocks();
        const wrong = [];
        for (const cell of all) {
            const { current } = this.scanBlock(cell.x, cell.y, cell.z);
            if (!current) continue;
            if (current.name === 'air' && cell.blueprintBlock !== 'air') continue;
            if (UTILITY_BLOCKS.includes(current.name)) continue;
            if (!blockSatisfied(cell.blueprintBlock, current)) {
                wrong.push({
                    x: cell.x, y: cell.y, z: cell.z,
                    expected: cell.blueprintBlock,
                    actual: current.name,
                    worldPos: this.getWorldPos(cell.x, cell.y, cell.z),
                });
            }
        }
        return wrong;
    }

    findMissingBlocks(limit = 5) {
        const all = this.getAllBlocks();
        const missing = [];
        for (const cell of all) {
            if (cell.blueprintBlock === 'air') continue;
            const wp = this.getWorldPos(cell.x, cell.y, cell.z);
            const wpKey = `${wp.x},${wp.y},${wp.z}`;
            if (this.verifiedBlocks.has(wpKey)) continue;
            if (cell.blueprintBlock === 'door') {
                const below = this.bot.blockAt(new Vec3(wp.x, wp.y - 1, wp.z));
                if (below && below.name.includes('door')) {
                    this.verifiedBlocks.add(wpKey);
                    continue;
                }
            }
            const { current } = this.scanBlock(cell.x, cell.y, cell.z);
            if (!current || !blockSatisfied(cell.blueprintBlock, current)) {
                if (current && current.name !== 'air' && current.name !== 'void_air') continue;
                const dist = this.bot.entity.position.distanceTo(wp);
                if (dist > 32) continue;
                missing.push({
                    x: cell.x, y: cell.y, z: cell.z,
                    blueprintBlock: cell.blueprintBlock,
                    worldPos: wp,
                });
                if (missing.length >= limit) break;
            }
        }
        return missing;
    }

    getInventoryCounts() {
        return world.getInventoryCounts(this.bot);
    }

    getToolAction(inv, posStr, siteStr, progress) {
        const axes = ['diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'];
        const pickaxes = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
        const hasAxe = axes.find(a => inv[a] > 0);
        const hasPickaxe = pickaxes.find(p => inv[p] > 0);

        if (hasAxe && hasPickaxe) return null;

        const haveLogs = inv['oak_log'] || 0;
        const havePlanks = inv['oak_planks'] || 0;
        const haveSticks = inv['stick'] || 0;
        const haveCobblestone = inv['cobblestone'] || 0;

        let needAxe = !hasAxe;
        let needPickaxe = !hasPickaxe;

        let steps = [];
        let invSummary = `oak_log:${haveLogs}, oak_planks:${havePlanks}, sticks:${haveSticks}, cobblestone:${haveCobblestone}`;

        if (needAxe) {
            if (haveCobblestone > 0 && havePlanks >= 3 && haveSticks >= 2 && hasPickaxe) {
                steps.push(`Craft stone axe: !craftRecipe("stone_axe", 1)`);
            } else if (havePlanks >= 3 && haveSticks >= 2) {
                steps.push(`Craft wooden axe: !craftRecipe("wooden_axe", 1)`);
            } else if (haveLogs >= 1) {
                steps.push(`Craft planks: !craftRecipe("oak_planks", 2)`);
                steps.push(`Craft sticks: !craftRecipe("stick", 4)`);
                steps.push(`Craft wooden axe: !craftRecipe("wooden_axe", 1)`);
            } else {
                steps.push(`Collect wood: !collectBlocks("oak_log", 5)`);
            }
        }
        if (needPickaxe) {
            if (haveCobblestone > 0 && havePlanks >= 3 && haveSticks >= 2 && hasAxe) {
                steps.push(`Craft stone pickaxe: !craftRecipe("stone_pickaxe", 1)`);
            } else if (havePlanks >= 3 && haveSticks >= 2) {
                steps.push(`Craft wooden pickaxe: !craftRecipe("wooden_pickaxe", 1)`);
            } else if (haveLogs >= 1) {
                steps.push(`Craft planks: !craftRecipe("oak_planks", 2)`);
                steps.push(`Craft sticks: !craftRecipe("stick", 4)`);
                steps.push(`Craft wooden pickaxe: !craftRecipe("wooden_pickaxe", 1)`);
            } else {
                steps.push(`Collect wood: !collectBlocks("oak_log", 5)`);
            }
        }

        const currentStep = steps[0];
        const toolList = [];
        if (needAxe) toolList.push('axe');
        if (needPickaxe) toolList.push('pickaxe');
        return {
            type: 'gather',
            done: false,
            message: `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
                `Phase: tools. Build site: ${siteStr}. Your position: ${posStr}.\n` +
                `You need: ${toolList.join(' and ')}. You can gather by hand but tools are much faster.\n` +
                `Inventory: ${invSummary}.\n` +
                `NEXT STEP: ${currentStep}\n` +
                `IMPORTANT: Do NOT use !placeHere or !newAction. Only gather and craft. Respond:`,
        };
    }

    findClearableBlocks() {
        if (this.phase !== 'clearing') return [];
        const all = this.getAllBlocks();
        const clearable = [];
        for (const cell of all) {
            if (cell.blueprintBlock === 'air') continue;
            const { current } = this.scanBlock(cell.x, cell.y, cell.z);
            if (!current || current.name === 'air') continue;
            if (UTILITY_BLOCKS.includes(current.name)) continue;
            if (blockSatisfied(cell.blueprintBlock, current)) continue;
            const wp = this.getWorldPos(cell.x, cell.y, cell.z);
            const wpKey = `${wp.x},${wp.y},${wp.z}`;
            if (this.verifiedBlocks.has(wpKey)) continue;
            const dist = this.bot.entity.position.distanceTo(wp);
            if (dist > 32) continue;
            clearable.push({
                x: cell.x, y: cell.y, z: cell.z,
                expected: cell.blueprintBlock,
                actual: current.name,
                worldPos: wp,
            });
            if (clearable.length >= 5) break;
        }
        return clearable;
    }

    resolveBlockName(blueprintName) {
        return getTypeOfGeneric(this.bot, blueprintName);
    }

    findSalvageBlocks(targetBlock) {
        const resolvedTarget = this.resolveBlockName(targetBlock);
        const all = this.getAllBlocks();
        const salvage = [];
        for (const cell of all) {
            const { current } = this.scanBlock(cell.x, cell.y, cell.z);
            if (!current || current.name === 'air') continue;
            if (blockSatisfied(cell.blueprintBlock, current)) continue;
            if (current.name === resolvedTarget ||
                (resolvedTarget === 'oak_planks' && current.name === 'oak_planks') ||
                (resolvedTarget === 'cobblestone' && current.name === 'cobblestone') ||
                (resolvedTarget === 'stone_bricks' && current.name === 'stone_bricks')) {
                salvage.push({
                    x: cell.x, y: cell.y, z: cell.z,
                    blueprintBlock: cell.blueprintBlock,
                    actual: current.name,
                    worldPos: this.getWorldPos(cell.x, cell.y, cell.z),
                });
            }
        }
        return salvage;
    }

    countNeededMaterials() {
        const all = this.getAllBlocks();
        const counts = {};
        for (const cell of all) {
            if (cell.blueprintBlock === 'air' || cell.blueprintBlock === '') continue;
            const name = cell.blueprintBlock;
            if (!counts[name]) counts[name] = 0;
            counts[name]++;
        }
        return counts;
    }

    countMissingMaterials() {
        const missing = this.findMissingBlocks(999);
        const counts = {};
        for (const m of missing) {
            const name = this.resolveBlockName(m.blueprintBlock);
            if (!counts[name]) counts[name] = 0;
            counts[name]++;
        }
        return counts;
    }

    getNextAction() {
        if (!this.active || !this.blueprint || !this.buildSite) {
            return null;
        }

        const phase = this.determinePhase();
        const pos = this.bot.entity.position;
        const posStr = `x:${Math.floor(pos.x)}, y:${Math.floor(pos.y)}, z:${Math.floor(pos.z)}`;
        const progress = this.computeProgress();
        const siteStr = `(${this.buildSite.x}, ${this.buildSite.y}, ${this.buildSite.z})`;
        const inv = this.getInventoryCounts();
        const gameMode = this.bot.game?.gameMode;
        const isCreative = gameMode === 'creative';

        if (phase === 'done') {
            this.active = false;
            this.saveState();
            return {
                type: 'done',
                done: true,
                message: `HOUSE COMPLETE! Progress: ${progress.percent}%. Build site: ${siteStr}. ` +
                    `The house is fully built. You can relax now.`,
            };
        }

        if (phase === 'tools') {
            const toolAction = this.getToolAction(inv, posStr, siteStr, progress);
            if (toolAction) return toolAction;
        }

        if (phase === 'clearing') {
            const wrong = this.findWrongBlocks();
            if (wrong.length > 0) {
                const w = wrong[0];
                return {
                    type: 'break',
                    done: false,
                    worldPos: w.worldPos,
                    expected: w.expected,
                    actual: w.actual,
                    message: this.formatClearAction(w, progress, posStr, siteStr),
                };
            }
        }

        const missing = this.findMissingBlocks(10);
        if (missing.length > 0) {
            const m = missing[0];
            const resolvedName = this.resolveBlockName(m.blueprintBlock);
            const haveCount = inv[resolvedName] || 0;

            if (isCreative || haveCount > 0) {
                const batch = missing.filter(mb => {
                    const rn = this.resolveBlockName(mb.blueprintBlock);
                    return rn === resolvedName && (inv[rn] || 0) > 0;
                }).slice(0, isCreative ? 10 : Math.min(haveCount, 10));
                if (batch.length > 0) {
                    return {
                        type: 'placeBatch',
                        done: false,
                        blocks: batch.map(mb => ({
                            worldPos: mb.worldPos,
                            blockType: resolvedName,
                            blueprintBlock: mb.blueprintBlock,
                        })),
                        message: this.formatPlaceAction(m, resolvedName, progress, posStr, siteStr),
                    };
                }
                return {
                    type: 'place',
                    done: false,
                    worldPos: m.worldPos,
                    blockType: resolvedName,
                    blueprintBlock: m.blueprintBlock,
                    message: this.formatPlaceAction(m, resolvedName, progress, posStr, siteStr),
                };
            } else {
                if (!isCreative) {
                    const hasAxe = inv['wooden_axe'] || inv['stone_axe'] || inv['iron_axe'] || inv['diamond_axe'] || inv['golden_axe'];
                    const hasPickaxe = inv['wooden_pickaxe'] || inv['stone_pickaxe'] || inv['iron_pickaxe'] || inv['diamond_pickaxe'] || inv['golden_pickaxe'];
                    if (!hasAxe || !hasPickaxe) {
                        this.phase = 'tools';
                        return this.getToolAction(inv, posStr, siteStr, progress);
                    }
                }
                const salvage = this.findSalvageBlocks(m.blueprintBlock);
                if (salvage.length > 0) {
                    const s = salvage[0];
                    this.log(`SALVAGE: breaking ${s.actual} at (${s.worldPos.x},${s.worldPos.y},${s.worldPos.z}) to get materials for ${resolvedName}`);
                    return {
                        type: 'break',
                        done: false,
                        worldPos: s.worldPos,
                        expected: s.blueprintBlock,
                        actual: s.actual,
                        message: this.formatSalvageAction(s, resolvedName, progress, posStr, siteStr),
                    };
                }

                const smeltSource = REVERSE_SMELTING[resolvedName];
                const furnaceBlock = world.getNearestBlock(this.bot, 'furnace', 32);
                const hasFurnace = (inv['furnace'] || 0) > 0 || furnaceBlock !== null;
                if (furnaceBlock) this.utilityPositions.furnace = { x: furnaceBlock.position.x, y: furnaceBlock.position.y, z: furnaceBlock.position.z };
                const fuelCount = (inv['coal'] || 0) * 8 + (inv['charcoal'] || 0) * 8 +
                    (inv['oak_log'] || 0) * 1 + (inv['oak_planks'] || 0) * 1 +
                    Math.floor((inv['stick'] || 0) / 2) * 1;
                const missing = this.countMissingMaterials();
                const needCount = missing[resolvedName] || 1;

                return {
                    type: 'gather',
                    done: false,
                    blockType: resolvedName,
                    message: this.formatGatherAction(m, resolvedName, progress, posStr, siteStr),
                };
            }
        }

        if (progress.percent < 100) {
            const sitePos = new Vec3(this.buildSite.x, this.buildSite.y, this.buildSite.z);
            const distToSite = this.bot.entity.position.distanceTo(sitePos);
            if (distToSite > 16) {
                this.log(`GO TO build site — bot is ${Math.floor(distToSite)} blocks away from (${this.buildSite.x},${this.buildSite.y},${this.buildSite.z})`);
                return {
                    type: 'goto',
                    done: false,
                    worldPos: sitePos,
                    message: `BUILD PROGRESS: ${progress.percent}%. You are too far from build site ${siteStr} (${Math.floor(distToSite)} blocks). Go there first. Respond:`,
                };
            }
        }

        const clearable = this.findClearableBlocks();
        if (clearable.length > 0 && !isCreative) {
            const c = clearable[0];
            this.log(`CLEAR: breaking ${c.actual} at (${c.worldPos.x},${c.worldPos.y},${c.worldPos.z}) — expected air`);
            return {
                type: 'break',
                done: false,
                worldPos: c.worldPos,
                expected: 'air',
                actual: c.actual,
                message: this.formatClearAction(c, progress, posStr, siteStr),
            };
        }

        const wrong = this.findWrongBlocks();
        if (wrong.length > 0) {
            const w = wrong[0];
            return {
                type: 'break',
                done: false,
                worldPos: w.worldPos,
                expected: w.expected,
                actual: w.actual,
                message: this.formatClearAction(w, progress, posStr, siteStr),
            };
        }

        this.phase = 'done';
        this.saveState();
        return {
            type: 'done',
            done: true,
            message: `HOUSE COMPLETE! Progress: ${progress.percent}%. Build site: ${siteStr}.`,
        };
    }

    verifyPlacement(wp, blockType) {
        const offsets = [
            [0, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1],
            [1, 0, 0],
            [-1, 0, 0],
        ];
        let verified = 0;
        for (const [dx, dy, dz] of offsets) {
            const pos = new Vec3(wp.x + dx, wp.y + dy, wp.z + dz);
            const block = this.bot.blockAt(pos);
            if (!block) continue;
            const key = `${pos.x},${pos.y},${pos.z}`;
            for (const cell of this.getAllBlocks()) {
                if (this.verifiedBlocks.has(key)) continue;
                const cellWp = this.getWorldPos(cell.x, cell.y, cell.z);
                if (cellWp.x === pos.x && cellWp.y === pos.y && cellWp.z === pos.z) {
                    if (blockSatisfied(cell.blueprintBlock, block)) {
                        this.verifiedBlocks.add(key);
                        verified++;
                    }
                }
            }
        }
        if (verified > 0) {
            this.log(`VERIFY: ${verified} blocks verified around (${wp.x},${wp.y},${wp.z})`);
        }
    }

    async executeDirect(action) {
        if (action.type === 'placeBatch') {
            let placed = 0;
            let failed = 0;
            for (const blk of action.blocks) {
                const wp = blk.worldPos;
                const wpKey = `${wp.x},${wp.y},${wp.z}`;
                if (this.verifiedBlocks.has(wpKey)) continue;
                const actionFn = async () => {
                    await skills.goToPosition(this.bot, wp.x, wp.y, wp.z, 4);
                    await skills.placeBlock(this.bot, blk.blockType, wp.x, wp.y, wp.z);
                };
                const res = await this.agent.actions.runAction('build:place', actionFn, { timeout: 30 });
                if (res.message && (res.message.includes('Failed to place') || res.success === false)) {
                    failed++;
                    this.failCount++;
                    this.log(`BATCH PLACE FAILED ${blk.blockType} at (${wp.x},${wp.y},${wp.z}): ${res.message?.substring(0, 80)}`);
                    if (this.failCount >= 3) {
                        this.log(`BATCH SKIP ${blk.blockType} at (${wp.x},${wp.y},${wp.z}) after ${this.failCount} failures`);
                        this.verifiedBlocks.add(wpKey);
                        this.verifyPlacement(wp, blk.blockType);
                        this.failCount = 0;
                        continue;
                    }
                } else {
                    placed++;
                    this.failCount = 0;
                    this.verifiedBlocks.add(wpKey);
                    this.verifyPlacement(wp, blk.blockType);
                }
            }
            this.log(`BATCH: placed ${placed} blocks, ${failed} failed`);
            this.saveState();
            return { success: failed === 0, message: `Placed ${placed} blocks in batch`, interrupted: false, timedout: false };
        }
        if (action.type === 'goto') {
            const wp = action.worldPos;
            this.log(`GOTO build site at (${wp.x},${wp.y},${wp.z})`);
            const actionFn = async () => {
                await skills.goToPosition(this.bot, wp.x, wp.y, wp.z, 8);
            };
            const res = await this.agent.actions.runAction('build:goto', actionFn, { timeout: 60 });
            this.log(`GOTO result: ${res.message?.substring(0, 100)}`);
            return res;
        }
        if (action.type === 'place') {
            const wp = action.worldPos;
            this.log(`PLACE ${action.blockType} at (${wp.x},${wp.y},${wp.z})`);
            const actionFn = async () => {
                await skills.goToPosition(this.bot, wp.x, wp.y, wp.z, 3);
                await skills.placeBlock(this.bot, action.blockType, wp.x, wp.y, wp.z);
            };
            let res = await this.agent.actions.runAction('build:place', actionFn, { timeout: 30 });
            const wpKey = `${wp.x},${wp.y},${wp.z}`;
            if (res.message && (res.message.includes('Failed to place') || res.success === false)) {
                this.failCount++;
                this.log(`PLACE FAILED #${this.failCount} at (${wp.x},${wp.y},${wp.z}): ${res.message.substring(0, 100)}`);
                if (this.failCount >= 3) {
                    this.log(`SKIP block at (${wp.x},${wp.y},${wp.z}) after ${this.failCount} failures`);
                    this.failCount = 0;
                    this.verifiedBlocks.add(wpKey);
                    this.verifyPlacement(wp, action.blockType);
                    return res;
                }
                const actionFn2 = async () => {
                    await skills.goToPosition(this.bot, wp.x + 1, wp.y, wp.z + 1, 2);
                    await skills.placeBlock(this.bot, action.blockType, wp.x, wp.y, wp.z);
                };
                res = await this.agent.actions.runAction('build:place', actionFn2, { timeout: 30 });
                if (res.message && res.message.includes('Failed to place')) {
                    this.failCount++;
                    this.log(`PLACE RETRY FAILED at (${wp.x},${wp.y},${wp.z})`);
                } else {
                    this.failCount = 0;
                    this.verifiedBlocks.add(wpKey);
                    this.verifyPlacement(wp, action.blockType);
                    this.log(`PLACE OK at (${wp.x},${wp.y},${wp.z})`);
                }
            } else {
                this.failCount = 0;
                this.verifiedBlocks.add(wpKey);
                this.verifyPlacement(wp, action.blockType);
                this.log(`PLACE OK at (${wp.x},${wp.y},${wp.z})`);
            }
            this.saveState();
            return res;
        }
        if (action.type === 'break') {
            const wp = action.worldPos;
            this.log(`BREAK ${action.actual} at (${wp.x},${wp.y},${wp.z}) expected=${action.expected}`);
            const actionFn = async () => {
                await skills.goToPosition(this.bot, wp.x, wp.y, wp.z, 3);
                await skills.breakBlockAt(this.bot, wp.x, wp.y, wp.z);
            };
            const res = await this.agent.actions.runAction('build:break', actionFn, { timeout: 30 });
            if (res.success === false) {
                this.log(`BREAK FAILED at (${wp.x},${wp.y},${wp.z}): ${res.message?.substring(0, 100)}`);
            } else {
                this.log(`BREAK OK at (${wp.x},${wp.y},${wp.z})`);
            }
            return res;
        }
        return null;
    }

    formatClearAction(w, progress, posStr, siteStr) {
        const wp = w.worldPos;
        return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
            `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
            `WARNING: Wrong block found at (${wp.x}, ${wp.y}, ${wp.z}). ` +
            `Expected: ${w.expected}, found: ${w.actual}.\n` +
            `Remove it with !newAction("Break the block at ${wp.x} ${wp.y} ${wp.z} using skills.breakBlockAt"). ` +
            `Respond:`;
    }

    formatSalvageAction(s, resolvedName, progress, posStr, siteStr) {
        const wp = s.worldPos;
        return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
            `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
            `SALVAGE: You need ${resolvedName} but have 0 in inventory. ` +
            `Found ${s.actual} block at (${wp.x}, ${wp.y}, ${wp.z}) that is in the way of the build. ` +
            `Break it to clear the site and collect materials. ` +
            `The build controller will break it automatically. Respond:`;
    }

    formatPlaceAction(m, resolvedName, progress, posStr, siteStr) {
        const wp = m.worldPos;
        return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
            `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
            `NEXT BLOCK: Place ${resolvedName} at (${wp.x}, ${wp.y}, ${wp.z}). ` +
            `You have ${this.getInventoryCounts()[resolvedName] || 0} ${resolvedName} in inventory.\n` +
            `Use !newAction("Place ${resolvedName} block at ${wp.x} ${wp.y} ${wp.z} using skills.placeBlock"). ` +
            `Respond:`;
    }

    getMaterialPlan(itemName, count, inv, _depth = 0) {
        if (_depth > 6) return { collect: {}, steps: [], have: 0 };

        inv = inv || this.getInventoryCounts();
        const have = inv[itemName] || 0;
        const need = Math.max(0, count - have);
        if (need === 0) return { collect: {}, steps: [], have };

        const result = { collect: {}, steps: [], have };

        const recipes = mc.getItemCraftingRecipes(itemName);
        if (recipes && recipes.length > 0) {
            const [ingredients, craftResult] = recipes[0];
            const craftedPerRecipe = craftResult.craftedCount;
            const batchCount = Math.ceil(need / craftedPerRecipe);
            const totalProduced = batchCount * craftedPerRecipe;

            const stepParts = [];
            for (const [ingName, ingCount] of Object.entries(ingredients)) {
                const totalIng = ingCount * batchCount;
                const subPlan = this.getMaterialPlan(ingName, totalIng, inv, _depth + 1);
                Object.entries(subPlan.collect).forEach(([k, v]) => {
                    result.collect[k] = (result.collect[k] || 0) + v;
                });
                result.steps.push(...subPlan.steps);
                stepParts.push(`${totalIng} ${ingName}`);
            }
            result.steps.push(`!craftRecipe("${itemName}", ${batchCount})  [${stepParts.join(' + ')} → ${totalProduced} ${itemName}]`);
            return result;
        }

        const smeltSource = REVERSE_SMELTING[itemName];
        if (smeltSource) {
            const subPlan = this.getMaterialPlan(smeltSource, need, inv, _depth + 1);
            Object.entries(subPlan.collect).forEach(([k, v]) => {
                result.collect[k] = (result.collect[k] || 0) + v;
            });
            result.steps.push(...subPlan.steps);
            const smeltBatch = Math.min(need, 8);
            result.steps.push(`!smeltItem("${smeltSource}", ${smeltBatch})  [${smeltBatch} ${smeltSource} → ${smeltBatch} ${itemName} in furnace, repeat ${Math.ceil(need / 8)}x]`);
            if (!inv['furnace']) result.collect['furnace'] = (result.collect['furnace'] || 0) + 1;
            return result;
        }

        if (itemName === 'cobblestone') {
            result.collect['stone'] = (result.collect['stone'] || 0) + need;
            result.steps.push(`!collectBlocks("stone", ${need})  [mine stone with pickaxe → drops cobblestone]`);
            return result;
        }

        if (itemName === 'coal') {
            result.collect['coal_ore'] = (result.collect['coal_ore'] || 0) + need;
            result.steps.push(`!collectBlocks("coal_ore", ${need})  [mine coal_ore with pickaxe → drops coal]`);
            return result;
        }

        if (itemName === 'stick') {
            const subPlan = this.getMaterialPlan('oak_planks', Math.ceil(need / 4), inv, _depth + 1);
            Object.entries(subPlan.collect).forEach(([k, v]) => {
                result.collect[k] = (result.collect[k] || 0) + v;
            });
            result.steps.push(...subPlan.steps);
            result.steps.push(`!craftRecipe("stick", ${Math.ceil(need / 4)})  [planks → sticks]`);
            return result;
        }

        if (itemName === 'torch') {
            const coalPlan = this.getMaterialPlan('coal', Math.ceil(need / 4), inv, _depth + 1);
            const stickPlan = this.getMaterialPlan('stick', Math.ceil(need / 4), inv, _depth + 1);
            Object.entries(coalPlan.collect).forEach(([k, v]) => { result.collect[k] = (result.collect[k] || 0) + v; });
            Object.entries(stickPlan.collect).forEach(([k, v]) => { result.collect[k] = (result.collect[k] || 0) + v; });
            result.steps.push(...coalPlan.steps, ...stickPlan.steps);
            result.steps.push(`!craftRecipe("torch", ${Math.ceil(need / 4)})  [coal + sticks → torches]`);
            return result;
        }

        result.collect[itemName] = (result.collect[itemName] || 0) + need;
        result.steps.push(`!collectBlocks("${itemName}", ${need})  [gather from world]`);
        return result;
    }

    formatMaterialPlan(itemName, count) {
        const inv = this.getInventoryCounts();
        const plan = this.getMaterialPlan(itemName, count, inv);
        const haveStr = plan.have > 0 ? ` (already have ${plan.have})` : '';
        const collectStr = Object.keys(plan.collect).length > 0
            ? `RAW MATERIALS TO GATHER: ${Object.entries(plan.collect).map(([k, v]) => `${v}x ${k}`).join(', ')}.`
            : `All raw materials already in inventory.`;
        const stepsStr = plan.steps.length > 0
            ? `STEPS:\n${plan.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`
            : `Nothing to do — you have enough.`;
        return `MATERIAL PLAN for ${count}x ${itemName}${haveStr}:\n${collectStr}\n${stepsStr}`;
    }

    formatGatherAction(m, resolvedName, progress, posStr, siteStr) {
        const inv = this.getInventoryCounts();
        const isCreative = this.bot.game?.gameMode === 'creative';
        if (isCreative) {
            const wp = m.worldPos;
            return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
                `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
                `You are in CREATIVE mode. You have infinite blocks. ` +
                `Place ${resolvedName} at (${wp.x}, ${wp.y}, ${wp.z}). Respond:`;
        }
        const needed = this.countMissingMaterials();
        const neededStr = Object.entries(needed).map(([k, v]) => `${v}x ${k}`).join(', ');
        const totalNeeded = needed[resolvedName] || 1;

        const plan = this.getMaterialPlan(resolvedName, totalNeeded, inv);
        const haveStr = plan.have > 0 ? ` (already have ${plan.have})` : '';

        const smeltSource = REVERSE_SMELTING[resolvedName];
        const furnaceBlock = world.getNearestBlock(this.bot, 'furnace', 32);
        const hasFurnace = (inv['furnace'] || 0) > 0 || furnaceBlock !== null;
        if (furnaceBlock) this.utilityPositions.furnace = { x: furnaceBlock.position.x, y: furnaceBlock.position.y, z: furnaceBlock.position.z };
        const fuelCount = (inv['coal'] || 0) * 8 + (inv['charcoal'] || 0) * 8 +
            (inv['oak_log'] || 0) * 1 + (inv['oak_planks'] || 0) * 1 +
            Math.floor((inv['stick'] || 0) / 2) * 1;

        let extraSteps = [];
        const smeltFailed = (this.smeltFailCount || 0) > 0;
        if (smeltSource && (inv[smeltSource] || 0) > 0 && !hasFurnace) {
            if ((inv['cobblestone'] || 0) >= 8) {
                extraSteps.push(`!craftRecipe("furnace", 1)  [craft furnace from 8 cobblestone]`);
            } else {
                extraSteps.push(`!collectBlocks("stone", 8)  [mine stone → cobblestone for furnace]`);
                extraSteps.push(`!craftRecipe("furnace", 1)  [craft furnace from 8 cobblestone]`);
            }
        }
        if (smeltSource && (inv[smeltSource] || 0) > 0 && (fuelCount < totalNeeded || smeltFailed)) {
            const needFuel = Math.max(totalNeeded - fuelCount, 5);
            extraSteps.push(`!collectBlocks("oak_log", ${Math.ceil(needFuel)})  [need ${needFuel} fuel for furnace]`);
        }

        const allSteps = [...extraSteps, ...plan.steps];
        const firstCollectStep = allSteps.find(s => s.includes('collectBlocks'));
        const firstSmeltStep = smeltFailed ? null : allSteps.find(s => s.includes('smeltItem'));
        const firstCraftStep = allSteps.find(s => s.includes('craftRecipe'));

        let nextStep = '';
        if (firstCollectStep) {
            nextStep = `NEXT ACTION: ${firstCollectStep}`;
        } else if (firstCraftStep && extraSteps.length > 0) {
            nextStep = `NEXT ACTION: ${firstCraftStep}`;
        } else if (firstSmeltStep) {
            nextStep = `NEXT ACTION: ${firstSmeltStep}`;
        } else if (firstCraftStep) {
            nextStep = `NEXT ACTION: ${firstCraftStep}`;
        } else {
            nextStep = `You have all materials. Wait for the build controller to place blocks.`;
        }

        const collectStr = Object.keys(plan.collect).length > 0
            ? `Still need: ${Object.entries(plan.collect).map(([k, v]) => `${v}x ${k}`).join(', ')}.`
            : `All materials gathered.`;

        const axes = ['diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'];
        const pickaxes = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
        const hasAxe = axes.find(a => inv[a] > 0);
        const hasPickaxe = pickaxes.find(p => inv[p] > 0);
        let toolHint = '';
        if (!hasAxe) toolHint += `You have NO axe. `;
        if (!hasPickaxe) toolHint += `You have NO pickaxe. `;

        return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
            `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
            `MATERIALS NEEDED: ${neededStr}.\n` +
            `You need ${totalNeeded}x ${resolvedName}${haveStr}. ${collectStr}\n` +
            `${nextStep}\n` +
            `${toolHint}` +
            `IMPORTANT: Do the NEXT ACTION above. Do NOT use !placeHere, !newAction, or !discard. ` +
            `Do NOT try to craft items that have no recipe (glass, sand). ` +
            `The build controller will place blocks automatically. Respond:`;
    }

    scanUtilityBlocks() {
        const found = [];
        for (const type of UTILITY_BLOCKS) {
            const blocks = this.bot.findBlocks({ matching: this.bot.registry.blocksByName[type]?.id, maxDistance: 64, count: 10 });
            for (const pos of blocks) {
                const existing = this.utilities.find(u => u.x === pos.x && u.y === pos.y && u.z === pos.z);
                if (!existing) {
                    const entry = {
                        type,
                        x: pos.x, y: pos.y, z: pos.z,
                        contents: [],
                        lastChecked: 0,
                        status: 'unknown',
                    };
                    this.utilities.push(entry);
                    found.push(entry);
                }
            }
        }
        if (found.length > 0) {
            this.log(`SCAN UTILITIES: found ${found.length} new utility blocks (${found.map(f => `${f.type}@${f.x},${f.y},${f.z}`).join(', ')})`);
            this.saveUtilities();
        }
        return found;
    }

    registerUtility(type, x, y, z, contents = []) {
        const existing = this.utilities.find(u => u.x === x && u.y === y && u.z === z);
        if (existing) {
            existing.contents = contents;
            existing.lastChecked = Date.now();
            existing.status = contents.length > 0 ? 'has_items' : 'empty';
        } else {
            this.utilities.push({
                type, x, y, z,
                contents,
                lastChecked: Date.now(),
                status: contents.length > 0 ? 'has_items' : 'empty',
            });
        }
        this.utilityPositions[type] = { x, y, z };
        this.log(`REGISTER ${type} at (${x},${y},${z}) — ${contents.length} items, status: ${contents.length > 0 ? 'has_items' : 'empty'}`);
        this.saveUtilities();
    }

    updateUtilityContents(x, y, z, contents) {
        const u = this.utilities.find(u => u.x === x && u.y === y && u.z === z);
        if (u) {
            u.contents = contents;
            u.lastChecked = Date.now();
            u.status = contents.length > 0 ? 'has_items' : 'empty';
            this.saveUtilities();
            this.log(`UPDATE ${u.type} at (${x},${y},${z}) — ${contents.length} items recorded`);
        }
    }

    findUtility(type, status = null) {
        this.scanUtilityBlocks();
        let candidates = this.utilities.filter(u => u.type === type);
        if (status) candidates = candidates.filter(u => u.status === status);
        if (candidates.length === 0) return null;
        const botPos = this.bot.entity.position;
        candidates.sort((a, b) => {
            const da = botPos.distanceTo(new Vec3(a.x, a.y, a.z));
            const db = botPos.distanceTo(new Vec3(b.x, b.y, b.z));
            return da - db;
        });
        return candidates[0];
    }

    getPendingSmeltResults() {
        const now = Date.now();
        return this.utilities.filter(u =>
            u.type === 'furnace' &&
            u.status === 'smelting' &&
            u.readyAt && u.readyAt <= now
        );
    }

    saveUtilities() {
        try {
            mkdirSync(this.worldDir, { recursive: true });
            writeFileSync(this.utilitiesFile, JSON.stringify(this.utilities, null, 2));
        } catch (e) {
            console.error('Failed to save utilities:', e);
        }
    }

    loadUtilities() {
        try {
            if (existsSync(this.utilitiesFile)) {
                this.utilities = JSON.parse(readFileSync(this.utilitiesFile, 'utf8'));
                this.log(`LOADED ${this.utilities.length} utility blocks from file`);
                for (const u of this.utilities) {
                    this.utilityPositions[u.type] = { x: u.x, y: u.y, z: u.z };
                }
            }
        } catch (e) {
            console.error('Failed to load utilities:', e);
            this.utilities = [];
        }
    }

    saveState() {
        try {
            mkdirSync(this.worldDir, { recursive: true });
            const data = {
                worldId: this.getWorldId(),
                blueprintName: this.blueprint?.name || null,
                buildSite: this.buildSite,
                phase: this.phase,
                active: this.active,
                verifiedBlocks: [...this.verifiedBlocks],
                utilityPositions: this.utilityPositions,
                utilities: this.utilities,
            };
            writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Failed to save build state:', e);
        }
    }

    loadState() {
        try {
            mkdirSync(this.worldDir, { recursive: true });
            const file = this.stateFile;
            if (!existsSync(file)) {
                this.log(`No build state for world ${this.getWorldId()}. Starting fresh.`);
                return false;
            }
            const data = JSON.parse(readFileSync(file, 'utf8'));
            if (!data.blueprintName || !data.buildSite) return false;
            this.loadBlueprint(data.blueprintName);
            this.buildSite = data.buildSite;
            this.phase = data.phase || 'clearing';
            this.active = data.active || false;
            this.verifiedBlocks = new Set(data.verifiedBlocks || []);
            this.utilityPositions = data.utilityPositions || {};
            this.utilities = data.utilities || [];
            this.smeltFailCount = 0;
            this.loadUtilities();
            this.scanUtilityBlocks();
            this.log(`RESTORE build '${data.blueprintName}' at (${data.buildSite.x}, ${data.buildSite.y}, ${data.buildSite.z}), phase: ${this.phase}, verified: ${this.verifiedBlocks.size} blocks`);
            return this.active;
        } catch (e) {
            console.error('Failed to load build state:', e);
            return false;
        }
    }
}
