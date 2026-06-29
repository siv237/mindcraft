import { Vec3 } from 'vec3';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as world from './library/world.js';
import * as skills from './library/skills.js';
import { blockSatisfied, getTypeOfGeneric } from './npc/utils.js';

const PHASES = ['clearing', 'floor', 'walls', 'roof', 'details', 'done'];

export class BuildController {
    constructor(agent) {
        this.agent = agent;
        this.blueprint = null;
        this.buildSite = null; // {x, y, z}
        this.phase = 'clearing';
        this.phaseIndex = 0;
        this.active = false;
        this.stateFile = `./bots/${agent.name}/build_state.json`;
    }

    get bot() {
        return this.agent.bot;
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

    start(name, position = null) {
        this.loadBlueprint(name);
        if (position) {
            this.buildSite = position;
        } else {
            const pos = this.bot.entity.position;
            this.buildSite = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
        }
        this.phase = 'clearing';
        this.phaseIndex = 0;
        this.active = true;
        this.saveState();
        this.agent.memory_bank.rememberPlace('build_site',
            this.buildSite.x, this.buildSite.y, this.buildSite.z);
        console.log(`BuildController started: ${name} at (${this.buildSite.x}, ${this.buildSite.y}, ${this.buildSite.z})`);
    }

    stop() {
        this.active = false;
        this.saveState();
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

        if (progress.percent >= 100) {
            this.phase = 'done';
            return 'done';
        }

        if (this.phase === 'clearing') {
            const hasWrongBlocks = this.findWrongBlocks().length > 0;
            const floorComplete = this.isLevelComplete(0);
            if (!floorComplete) {
                this.phase = 'floor';
            } else if (hasWrongBlocks) {
                this.phase = 'clearing';
            } else {
                this.phase = 'walls';
            }
        }

        if (this.phase === 'floor') {
            if (this.isLevelComplete(0)) {
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
                this.phase = 'roof';
            }
        }

        if (this.phase === 'roof') {
            if (this.isLevelComplete(sy - 1)) {
                this.phase = 'details';
            }
        }

        if (this.phase === 'details') {
            const wrong = this.findWrongBlocks();
            if (wrong.length === 0) {
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
            if (current && !blockSatisfied(cell.blueprintBlock, current)) {
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
            const { current } = this.scanBlock(cell.x, cell.y, cell.z);
            if (!current || !blockSatisfied(cell.blueprintBlock, current)) {
                if (current && current.name !== 'air') continue;
                missing.push({
                    x: cell.x, y: cell.y, z: cell.z,
                    blueprintBlock: cell.blueprintBlock,
                    worldPos: this.getWorldPos(cell.x, cell.y, cell.z),
                });
                if (missing.length >= limit) break;
            }
        }
        return missing;
    }

    getInventoryCounts() {
        return world.getInventoryCounts(this.bot);
    }

    resolveBlockName(blueprintName) {
        return getTypeOfGeneric(this.bot, blueprintName);
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

        const missing = this.findMissingBlocks(1);
        if (missing.length > 0) {
            const m = missing[0];
            const resolvedName = this.resolveBlockName(m.blueprintBlock);
            const inv = this.getInventoryCounts();
            const haveCount = inv[resolvedName] || 0;
            const isCreative = this.bot.game.gameMode === 'creative';

            if (isCreative || haveCount > 0) {
                return {
                    type: 'place',
                    done: false,
                    worldPos: m.worldPos,
                    blockType: resolvedName,
                    blueprintBlock: m.blueprintBlock,
                    message: this.formatPlaceAction(m, resolvedName, progress, posStr, siteStr),
                };
            } else {
                return {
                    type: 'gather',
                    done: false,
                    blockType: resolvedName,
                    message: this.formatGatherAction(m, resolvedName, progress, posStr, siteStr),
                };
            }
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

    async executeDirect(action) {
        if (action.type === 'place') {
            const wp = action.worldPos;
            console.log(`BuildController: directly placing ${action.blockType} at (${wp.x}, ${wp.y}, ${wp.z})`);
            const isCheat = this.bot.modes.isOn('cheat');
            const actionFn = async () => {
                if (!isCheat) {
                    await skills.goToPosition(this.bot, wp.x, wp.y, wp.z, 4);
                }
                await skills.placeBlock(this.bot, action.blockType, wp.x, wp.y, wp.z);
            };
            const res = await this.agent.actions.runAction('build:place', actionFn, { timeout: 30 });
            if (!isCheat && res.message && res.message.includes('Failed to place')) {
                console.log('BuildController: place failed, retrying closer...');
                const actionFn2 = async () => {
                    await skills.goToPosition(this.bot, wp.x, wp.y, wp.z, 2);
                    await skills.placeBlock(this.bot, action.blockType, wp.x, wp.y, wp.z);
                };
                return await this.agent.actions.runAction('build:place', actionFn2, { timeout: 30 });
            }
            return res;
        }
        if (action.type === 'break') {
            const wp = action.worldPos;
            console.log(`BuildController: directly breaking ${action.actual} at (${wp.x}, ${wp.y}, ${wp.z})`);
            const actionFn = async () => {
                await skills.goToPosition(this.bot, wp.x, wp.y, wp.z, 4);
                await skills.breakBlockAt(this.bot, wp.x, wp.y, wp.z);
            };
            const res = await this.agent.actions.runAction('build:break', actionFn, { timeout: 30 });
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

    formatPlaceAction(m, resolvedName, progress, posStr, siteStr) {
        const wp = m.worldPos;
        return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
            `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
            `NEXT BLOCK: Place ${resolvedName} at (${wp.x}, ${wp.y}, ${wp.z}). ` +
            `You have ${this.getInventoryCounts()[resolvedName] || 0} ${resolvedName} in inventory.\n` +
            `Use !newAction("Place ${resolvedName} block at ${wp.x} ${wp.y} ${wp.z} using skills.placeBlock"). ` +
            `Respond:`;
    }

    formatGatherAction(m, resolvedName, progress, posStr, siteStr) {
        const inv = this.getInventoryCounts();
        const isCreative = this.bot.game.gameMode === 'creative';
        if (isCreative) {
            const wp = m.worldPos;
            return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
                `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
                `You are in CREATIVE mode. You have infinite blocks. ` +
                `Place ${resolvedName} at (${wp.x}, ${wp.y}, ${wp.z}). Respond:`;
        }
        const needed = this.countMissingMaterials();
        const neededStr = Object.entries(needed).map(([k, v]) => `${v}x ${k}`).join(', ');
        const haveLogs = inv['oak_log'] || 0;
        const havePlanks = inv['oak_planks'] || 0;
        let gatherHint;
        if (havePlanks > 0) {
            gatherHint = `You already have ${havePlanks} oak_planks. Try crafting what you need: !craftRecipe("${resolvedName}", 1).`;
        } else if (haveLogs > 0) {
            gatherHint = `You already have ${haveLogs} oak_log. Craft planks first: !craftRecipe("oak_planks", 2). Then craft: !craftRecipe("${resolvedName}", 1).`;
        } else {
            gatherHint = `Gather materials: !collectBlocks("oak_log", 5). Then craft: !craftRecipe("oak_planks", 2).`;
        }
        return `BUILD PROGRESS: ${progress.percent}% (${progress.placed}/${progress.total}). ` +
            `Phase: ${this.phase}. Build site: ${siteStr}. Your position: ${posStr}.\n` +
            `MATERIALS NEEDED: ${neededStr}.\n` +
            `You need ${resolvedName}. ${gatherHint} ` +
            `Do NOT stockpile — gather just enough and return to build. Respond:`;
    }

    saveState() {
        try {
            mkdirSync(`./bots/${this.agent.name}`, { recursive: true });
            const data = {
                blueprintName: this.blueprint?.name || null,
                buildSite: this.buildSite,
                phase: this.phase,
                active: this.active,
            };
            writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Failed to save build state:', e);
        }
    }

    loadState() {
        try {
            if (!existsSync(this.stateFile)) return false;
            const data = JSON.parse(readFileSync(this.stateFile, 'utf8'));
            if (!data.blueprintName || !data.buildSite) return false;
            this.loadBlueprint(data.blueprintName);
            this.buildSite = data.buildSite;
            this.phase = data.phase || 'clearing';
            this.active = data.active || false;
            console.log(`Restored build state: ${data.blueprintName} at (${data.buildSite.x}, ${data.buildSite.y}, ${data.buildSite.z}), phase: ${this.phase}`);
            return this.active;
        } catch (e) {
            console.error('Failed to load build state:', e);
            return false;
        }
    }
}
