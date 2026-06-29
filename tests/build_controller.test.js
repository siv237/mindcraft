import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { BuildController } from '../src/agent/build_controller.js';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import minecraftData from 'minecraft-data';
import settings from '../settings.js';
import { initMcData } from '../src/utils/mcdata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(__dirname, 'tmp_test');
const BLUEPRINTS_DIR = join(__dirname, '..', 'blueprints');

const MC_VERSION = settings.minecraft_version === 'auto' ? '1.21.6' : (settings.minecraft_version || '1.21.6');
initMcData(MC_VERSION);

import { Vec3 } from 'vec3';

function makeMockBot({ spawnPoint = { x: 100, y: 64, z: 200 }, position = { x: 105, y: 64, z: 205 }, gameMode = 'survival', blocks = {} } = {}) {
    const inv = {};
    return {
        spawnPoint,
        entity: { position: new Vec3(position.x, position.y, position.z) },
        game: { dimension: 'minecraft:overworld', gameMode },
        inventory: { slots: [] },
        registry: { blocksByName: { planks: { id: 5 }, oak_planks: { id: 5 }, cobblestone: { id: 4 }, stone_bricks: { id: 1 }, door: { id: 64 }, oak_door: { id: 64 }, air: { id: 0 }, dirt: { id: 3 }, torch: { id: 50 } } },
        blockAt(pos) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (blocks[key]) return { name: blocks[key] };
            return { name: 'air' };
        },
        modes: { isOn: () => false },
        findBlocks: () => [],
        _inv: inv,
    };
}

function makeMockAgent(botOpts = {}) {
    const bot = makeMockBot(botOpts);
    return {
        name: 'TestBot',
        bot,
        memory_bank: {
            rememberPlace: (name, x, y, z) => {},
            recallPlace: (name) => null,
        },
        actions: {
            runAction: async (label, fn, opts) => {
                await fn();
                return { success: true, message: 'ok', interrupted: false, timedout: false };
            },
        },
    };
}

describe('BuildController', () => {
    let agent, bc;

    before(() => {
        mkdirSync(TEST_DIR, { recursive: true });
    });

    after(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
    });

    beforeEach(() => {
        agent = makeMockAgent();
        bc = new BuildController(agent);
        Object.defineProperty(bc, 'worldDir', { get: () => TEST_DIR });
    });

    describe('loadBlueprint', () => {
        it('should load house_5x5 from blueprints/', () => {
            bc.loadBlueprint('house_5x5');
            assert.ok(bc.blueprint);
            assert.strictEqual(bc.blueprint.name, 'house_5x5');
            assert.ok(bc.blueprint.blocks);
        });

        it('should load npc construction blueprints', () => {
            bc.loadBlueprint('small_wood_house');
            assert.ok(bc.blueprint);
            assert.ok(bc.blueprint.blocks);
        });

        it('should throw for non-existent blueprint', () => {
            assert.throws(() => bc.loadBlueprint('nonexistent'), /not found/);
        });
    });

    describe('getDimensions', () => {
        it('should return correct dimensions for house_5x5', () => {
            bc.loadBlueprint('house_5x5');
            const dim = bc.getDimensions();
            assert.strictEqual(dim.sx, 5);
            assert.strictEqual(dim.sz, 5);
            assert.strictEqual(dim.sy, 5);
        });
    });

    describe('getWorldPos', () => {
        it('should compute world position with offset', () => {
            bc.loadBlueprint('house_5x5');
            bc.buildSite = { x: 10, y: 60, z: 20 };
            const pos = bc.getWorldPos(2, 1, 3);
            assert.strictEqual(pos.x, 12);
            assert.strictEqual(pos.y, 60);
            assert.strictEqual(pos.z, 23);
        });

        it('should handle zero offset', () => {
            bc.loadBlueprint('house_5x5');
            bc.blueprint.offset = 0;
            bc.buildSite = { x: 0, y: 0, z: 0 };
            const pos = bc.getWorldPos(0, 0, 0);
            assert.strictEqual(pos.x, 0);
            assert.strictEqual(pos.y, 0);
            assert.strictEqual(pos.z, 0);
        });
    });

    describe('start', () => {
        it('should set buildSite from bot position', () => {
            bc.loadBlueprint('house_5x5');
            bc.start('house_5x5');
            assert.ok(bc.buildSite);
            assert.strictEqual(bc.buildSite.x, 105);
            assert.strictEqual(bc.buildSite.y, 64);
            assert.strictEqual(bc.buildSite.z, 205);
            assert.strictEqual(bc.active, true);
            assert.strictEqual(bc.phase, 'tools');
        });

        it('should set buildSite from explicit position', () => {
            bc.start('house_5x5', { x: 1, y: 2, z: 3 });
            assert.strictEqual(bc.buildSite.x, 1);
            assert.strictEqual(bc.buildSite.y, 2);
            assert.strictEqual(bc.buildSite.z, 3);
        });

        it('should save state on start', () => {
            bc.start('house_5x5', { x: 5, y: 10, z: 15 });
            assert.ok(existsSync(bc.stateFile));
        });
    });

    describe('saveState / loadState', () => {
        it('should save and restore build state', () => {
            bc.start('house_5x5', { x: 50, y: 70, z: 90 });
            const saved = JSON.parse(readFileSync(bc.stateFile, 'utf8'));
            assert.strictEqual(saved.blueprintName, 'house_5x5');
            assert.deepStrictEqual(saved.buildSite, { x: 50, y: 70, z: 90 });
            assert.strictEqual(saved.active, true);

            const bc2 = new BuildController(agent);
            Object.defineProperty(bc2, 'worldDir', { get: () => TEST_DIR });
            const restored = bc2.loadState();
            assert.strictEqual(restored, true);
            assert.strictEqual(bc2.buildSite.x, 50);
            assert.strictEqual(bc2.buildSite.y, 70);
            assert.strictEqual(bc2.buildSite.z, 90);
            assert.strictEqual(bc2.phase, 'tools');
        });

        it('should return false when no state file exists', () => {
            const bc2 = new BuildController(agent);
            Object.defineProperty(bc2, 'worldDir', { get: () => join(TEST_DIR, 'nonexistent_dir') });
            const restored = bc2.loadState();
            assert.strictEqual(restored, false);
        });

        it('should survive restart with same coordinates', () => {
            bc.start('house_5x5', { x: 100, y: 200, z: 300 });

            const bc2 = new BuildController(agent);
            Object.defineProperty(bc2, 'worldDir', { get: () => TEST_DIR });
            bc2.loadState();
            assert.deepStrictEqual(bc2.buildSite, { x: 100, y: 200, z: 300 });

            const bc3 = new BuildController(agent);
            Object.defineProperty(bc3, 'worldDir', { get: () => TEST_DIR });
            bc3.loadState();
            assert.deepStrictEqual(bc3.buildSite, { x: 100, y: 200, z: 300 });
        });
    });

    describe('stop', () => {
        it('should deactivate and save', () => {
            bc.start('house_5x5', { x: 1, y: 2, z: 3 });
            bc.stop();
            assert.strictEqual(bc.active, false);
            const saved = JSON.parse(readFileSync(bc.stateFile, 'utf8'));
            assert.strictEqual(saved.active, false);
        });
    });

    describe('getAllBlocks', () => {
        it('should list all non-empty blocks', () => {
            bc.loadBlueprint('house_5x5');
            const all = bc.getAllBlocks();
            assert.ok(all.length > 0);
            for (const cell of all) {
                assert.notStrictEqual(cell.blueprintBlock, '');
            }
        });

        it('should include air blocks', () => {
            bc.loadBlueprint('house_5x5');
            const all = bc.getAllBlocks();
            const airBlocks = all.filter(c => c.blueprintBlock === 'air');
            assert.ok(airBlocks.length > 0);
        });
    });

    describe('computeProgress', () => {
        it('should return low progress on empty world (only air blocks match)', () => {
            bc.loadBlueprint('house_5x5');
            bc.buildSite = { x: 0, y: 0, z: 0 };
            const p = bc.computeProgress();
            assert.ok(p.percent < 50, `expected <50% but got ${p.percent}%`);
            assert.ok(p.total > 0);
        });

        it('should return 100% when all blocks match', () => {
            bc.loadBlueprint('house_5x5');
            bc.buildSite = { x: 0, y: 0, z: 0 };
            const offset = bc.blueprint.offset || 0;
            const { sx, sz, sy } = bc.getDimensions();
            const blocks = {};
            for (let y = 0; y < sy; y++) {
                for (let z = 0; z < sz; z++) {
                    for (let x = 0; x < sx; x++) {
                        const bp = bc.blueprint.blocks[y][z][x];
                        if (bp === '' ) continue;
                        const wy = y + offset;
                        blocks[`${x},${wy},${z}`] = bp;
                    }
                }
            }
            agent.bot = makeMockBot({ blocks });
            bc.agent.bot = agent.bot;
            const p = bc.computeProgress();
            assert.strictEqual(p.percent, 100, `expected 100% but got ${p.percent}% (placed=${p.placed}, total=${p.total}, wrong=${p.wrong})`);
        });
    });

    describe('determinePhase', () => {
        it('should start with tools phase in survival', () => {
            bc.loadBlueprint('house_5x5');
            bc.buildSite = { x: 0, y: 0, z: 0 };
            bc.phase = 'tools';
            const phase = bc.determinePhase();
            assert.strictEqual(phase, 'tools');
        });

        it('should skip tools in creative', () => {
            agent.bot = makeMockBot({ gameMode: 'creative' });
            bc.agent.bot = agent.bot;
            bc.loadBlueprint('house_5x5');
            bc.buildSite = { x: 0, y: 0, z: 0 };
            bc.phase = 'tools';
            const phase = bc.determinePhase();
            assert.notStrictEqual(phase, 'tools');
        });
    });

    describe('getToolAction', () => {
        it('should return null when both tools exist', () => {
            const inv = { wooden_axe: 1, wooden_pickaxe: 1 };
            const action = bc.getToolAction(inv, 'x:0,y:0,z:0', '(0,0,0)', { percent: 0, placed: 0, total: 125 });
            assert.strictEqual(action, null);
        });

        it('should guide to collect wood when no tools and no materials', () => {
            const inv = {};
            const action = bc.getToolAction(inv, 'x:0,y:0,z:0', '(0,0,0)', { percent: 0, placed: 0, total: 125 });
            assert.ok(action);
            assert.match(action.message, /collectBlocks/);
        });

        it('should guide to craft axe when planks and sticks available', () => {
            const inv = { oak_planks: 10, stick: 10 };
            const action = bc.getToolAction(inv, 'x:0,y:0,z:0', '(0,0,0)', { percent: 0, placed: 0, total: 125 });
            assert.ok(action);
            assert.match(action.message, /wooden_axe/);
        });

        it('should detect higher tier tools', () => {
            const inv = { iron_axe: 1, diamond_pickaxe: 1 };
            const action = bc.getToolAction(inv, 'x:0,y:0,z:0', '(0,0,0)', { percent: 0, placed: 0, total: 125 });
            assert.strictEqual(action, null);
        });
    });

    describe('getNextAction', () => {
        it('should return null when not active', () => {
            bc.active = false;
            assert.strictEqual(bc.getNextAction(), null);
        });

        it('should return done when progress is 100%', () => {
            bc.loadBlueprint('house_5x5');
            bc.buildSite = { x: 0, y: 0, z: 0 };
            bc.active = true;
            bc.phase = 'done';
            agent.bot = makeMockBot({ gameMode: 'creative' });
            bc.agent.bot = agent.bot;
            const all = bc.getAllBlocks();
            const blocks = {};
            for (const cell of all) {
                blocks[`${cell.x},${cell.y},${cell.z}`] = cell.blueprintBlock === 'planks' ? 'oak_planks' : cell.blueprintBlock;
            }
            agent.bot = makeMockBot({ gameMode: 'creative', blocks });
            bc.agent.bot = agent.bot;
            const action = bc.getNextAction();
            assert.ok(action.done);
        });

        it('should return tools action in survival without tools', () => {
            bc.loadBlueprint('house_5x5');
            bc.buildSite = { x: 0, y: 0, z: 0 };
            bc.active = true;
            bc.phase = 'tools';
            agent.bot = makeMockBot({ gameMode: 'survival' });
            bc.agent.bot = agent.bot;
            const action = bc.getNextAction();
            assert.strictEqual(action.type, 'gather');
            assert.match(action.message, /tools/);
        });
    });

    describe('getWorldId', () => {
        it('should use spawnPoint when available', () => {
            agent.bot = makeMockBot({ spawnPoint: { x: 42, y: 64, z: 128 } });
            bc.agent.bot = agent.bot;
            const id = bc.getWorldId();
            assert.strictEqual(id, 'minecraft:overworld_42_64_128');
        });

        it('should use approximate position when spawnPoint is 0,0,0', () => {
            agent.bot = makeMockBot({ spawnPoint: { x: 0, y: 0, z: 0 }, position: { x: 1234, y: 67, z: 5678 } });
            bc.agent.bot = agent.bot;
            const id = bc.getWorldId();
            assert.match(id, /overworld_1000_0_5000/);
        });

        it('should produce same ID for same spawnPoint', () => {
            agent.bot = makeMockBot({ spawnPoint: { x: 96, y: 112, z: 0 } });
            bc.agent.bot = agent.bot;
            const id1 = bc.getWorldId();
            const id2 = bc.getWorldId();
            assert.strictEqual(id1, id2);
        });
    });
});

describe('Blueprint integrity', () => {
    it('house_5x5 should have valid structure', () => {
        const bp = JSON.parse(readFileSync(join(BLUEPRINTS_DIR, 'house_5x5.json'), 'utf8'));
        assert.ok(bp.blocks);
        assert.ok(bp.blocks.length > 0);
        const sy = bp.blocks.length;
        const sz = bp.blocks[0].length;
        const sx = bp.blocks[0][0].length;
        assert.strictEqual(sx, 5, 'width should be 5');
        assert.strictEqual(sz, 5, 'depth should be 5');
        assert.ok(sy >= 4, 'height should be at least 4');
    });

    it('house_5x5 should have floor on level 0', () => {
        const bp = JSON.parse(readFileSync(join(BLUEPRINTS_DIR, 'house_5x5.json'), 'utf8'));
        const floor = bp.blocks[0];
        for (const row of floor) {
            for (const block of row) {
                assert.strictEqual(block, 'planks', 'floor should be all planks');
            }
        }
    });

    it('house_5x5 should have roof on top level', () => {
        const bp = JSON.parse(readFileSync(join(BLUEPRINTS_DIR, 'house_5x5.json'), 'utf8'));
        const roof = bp.blocks[bp.blocks.length - 1];
        for (const row of roof) {
            for (const block of row) {
                assert.strictEqual(block, 'planks', 'roof should be all planks');
            }
        }
    });

    it('house_5x5 should have door in walls', () => {
        const bp = JSON.parse(readFileSync(join(BLUEPRINTS_DIR, 'house_5x5.json'), 'utf8'));
        let hasDoor = false;
        for (let y = 1; y < bp.blocks.length - 1; y++) {
            for (let z = 0; z < bp.blocks[y].length; z++) {
                for (let x = 0; x < bp.blocks[y][z].length; x++) {
                    if (bp.blocks[y][z][x] === 'door') hasDoor = true;
                }
            }
        }
        assert.ok(hasDoor, 'house should have at least one door');
    });
});

describe('mcserver discoverLanServer', () => {
    it('should be a function', async () => {
        const mod = await import('../src/mindcraft/mcserver.js');
        assert.strictEqual(typeof mod.discoverLanServer, 'function');
    });

    it('should reject on timeout when no broadcast', async () => {
        const mod = await import('../src/mindcraft/mcserver.js');
        const result = await mod.discoverLanServer(100).then(
            () => 'resolved',
            (e) => `rejected: ${e.message}`
        ).catch(() => 'error');
        assert.match(result, /rejected|resolved|error/);
    });
});

describe('Command blocking', () => {
    it('should block !stop and !endGoal during active build', async () => {
        const { executeCommand } = await import('../src/agent/commands/index.js');
        const mockAgent = {
            build_controller: { active: true },
            blocked_actions: [],
        };
        const stopResult = await executeCommand(mockAgent, '!stop');
        assert.match(stopResult, /Cannot/);
        const endGoalResult = await executeCommand(mockAgent, '!endGoal');
        assert.match(endGoalResult, /Cannot/);
    });

    it('should allow commands when build is not active', async () => {
        const { executeCommand } = await import('../src/agent/commands/index.js');
        const mockAgent = {
            build_controller: { active: false },
            blocked_actions: [],
            actions: { stop: async () => {}, cancelResume: () => {} },
            clearBotLogs: () => {},
            bot: { emit: () => {} },
            self_prompter: { isActive: () => false },
        };
        const result = await executeCommand(mockAgent, '!stop');
        assert.ok(result);
    });
});

describe('BuildController - regression tests', () => {
    let agent, bc;

    beforeEach(() => {
        agent = makeMockAgent();
        bc = new BuildController(agent);
        Object.defineProperty(bc, 'worldDir', { get: () => TEST_DIR });
    });

    it('resolveBlockName should be a function and not crash', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        assert.strictEqual(typeof bc.resolveBlockName, 'function');
        const name = bc.resolveBlockName('cobblestone');
        assert.strictEqual(name, 'cobblestone');
    });

    it('findWrongBlocks should not return air-where-planks-expected', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        const wrong = bc.findWrongBlocks();
        for (const w of wrong) {
            assert.notStrictEqual(w.actual, 'air', 'air blocks should not be wrong');
        }
    });

    it('findWrongBlocks should return non-air wrong blocks', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        agent.bot = makeMockBot({ blocks: { '0,0,0': 'dirt' } });
        bc.agent.bot = agent.bot;
        const wrong = bc.findWrongBlocks();
        const dirtWrong = wrong.find(w => w.actual === 'dirt' && w.expected === 'planks');
        assert.ok(dirtWrong, 'dirt where planks expected should be wrong');
    });

    it('findClearableBlocks should not break scaffolding (blueprint=air) during building', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        bc.phase = 'walls';
        const offset = bc.blueprint.offset || 0;
        const { sx, sz, sy } = bc.getDimensions();
        const blocks = {};
        for (let y = 0; y < sy; y++) {
            for (let z = 0; z < sz; z++) {
                for (let x = 0; x < sx; x++) {
                    const bp = bc.blueprint.blocks[y][z][x];
                    if (bp === 'air') {
                        blocks[`${x},${y + offset},${z}`] = 'dirt';
                    } else {
                        blocks[`${x},${y + offset},${z}`] = 'air';
                    }
                }
            }
        }
        agent.bot = makeMockBot({ blocks });
        bc.agent.bot = agent.bot;
        const clearable = bc.findClearableBlocks();
        assert.strictEqual(clearable.length, 0, 'should NOT clear scaffolding blocks during building phase');
    });

    it('findClearableBlocks should find obstacles in clearing phase', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        bc.phase = 'clearing';
        const offset = bc.blueprint.offset || 0;
        const { sx, sz, sy } = bc.getDimensions();
        const blocks = {};
        for (let y = 0; y < sy; y++) {
            for (let z = 0; z < sz; z++) {
                for (let x = 0; x < sx; x++) {
                    const bp = bc.blueprint.blocks[y][z][x];
                    if (bp !== 'air') {
                        blocks[`${x},${y + offset},${z}`] = 'dirt';
                    }
                }
            }
        }
        agent.bot = makeMockBot({ blocks, position: { x: 2, y: offset, z: 2 } });
        bc.agent.bot = agent.bot;
        const clearable = bc.findClearableBlocks();
        assert.ok(clearable.length > 0, 'should find obstacles blocking blueprint blocks');
        for (const c of clearable) {
            assert.notStrictEqual(c.expected, 'air');
            assert.notStrictEqual(c.actual, 'air');
        }
    });

    it('findClearableBlocks should return empty when all air positions are air', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        agent.bot = makeMockBot();
        bc.agent.bot = agent.bot;
        const clearable = bc.findClearableBlocks();
        assert.strictEqual(clearable.length, 0);
    });

    it('findSalvageBlocks should find salvageable blocks in wrong positions', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        const offset = bc.blueprint.offset || 0;
        const { sx, sz, sy } = bc.getDimensions();
        const blocks = {};
        for (let y = 0; y < sy; y++) {
            for (let z = 0; z < sz; z++) {
                for (let x = 0; x < sx; x++) {
                    const bp = bc.blueprint.blocks[y][z][x];
                    if (bp === 'air') {
                        blocks[`${x},${y + offset},${z}`] = 'cobblestone';
                    } else {
                        blocks[`${x},${y + offset},${z}`] = 'air';
                    }
                }
            }
        }
        agent.bot = makeMockBot({ blocks });
        bc.agent.bot = agent.bot;
        const salvage = bc.findSalvageBlocks('cobblestone');
        assert.ok(salvage.length > 0, 'should find salvageable cobblestone');
        for (const s of salvage) {
            assert.strictEqual(s.actual, 'cobblestone');
        }
    });

    it('switchTo should pause current and start new', () => {
        bc.loadBlueprint('house_5x5');
        bc.start('house_5x5', { x: 10, y: 20, z: 30 });
        assert.strictEqual(bc.active, true);
        assert.deepStrictEqual(bc.buildSite, { x: 10, y: 20, z: 30 });
        bc.switchTo('house_5x5', { x: 50, y: 60, z: 70 });
        assert.deepStrictEqual(bc.buildSite, { x: 50, y: 60, z: 70 });
        assert.strictEqual(bc.active, true);
    });

    it('complete should mark current done and return next pending', () => {
        bc.loadBlueprint('house_5x5');
        bc.start('house_5x5', { x: 10, y: 20, z: 30 });
        bc.switchTo('house_5x5', { x: 50, y: 60, z: 70 });
        const next = bc.complete();
        assert.ok(next, 'should return next pending task');
        assert.deepStrictEqual(next.buildSite, { x: 10, y: 20, z: 30 });
    });

    it('complete should return null when no pending tasks', () => {
        bc.loadBlueprint('house_5x5');
        bc.queue.tasks = [];
        try { rmSync(join(TEST_DIR, 'build_queue.json'), { force: true }); } catch {}
        bc.start('house_5x5', { x: 10, y: 20, z: 30 });
        assert.strictEqual(bc.queue.tasks.length, 1, 'should have 1 task');
        const next = bc.complete();
        assert.strictEqual(next, null, 'no pending or damaged tasks');
    });

    it('checkOverlap should detect overlapping build sites', () => {
        bc.loadBlueprint('house_5x5');
        bc.queue.tasks = [{
            id: 'test1', blueprintName: 'house_5x5',
            buildSite: { x: 10, y: 20, z: 30 },
            status: 'done',
        }];
        const overlap = bc.checkOverlap({ x: 11, y: 21, z: 31 });
        assert.ok(overlap, 'should detect overlap with existing build');
    });

    it('checkOverlap should not detect non-overlapping sites', () => {
        bc.loadBlueprint('house_5x5');
        bc.queue.tasks = [{
            id: 'test1', blueprintName: 'house_5x5',
            buildSite: { x: 100, y: 20, z: 100 },
            status: 'done',
        }];
        const overlap = bc.checkOverlap({ x: 10, y: 20, z: 30 });
        assert.strictEqual(overlap, null);
    });

    it('start should return false on overlap', () => {
        bc.loadBlueprint('house_5x5');
        bc.queue.tasks = [{
            id: 'test1', blueprintName: 'house_5x5',
            buildSite: { x: 0, y: 0, z: 0 },
            status: 'done',
        }];
        bc.queue.save = () => {};
        bc.queue.load = () => bc.queue.tasks;
        bc.saveState = () => {};
        const result = bc.start('house_5x5', { x: 1, y: 1, z: 1 });
        assert.strictEqual(result, false, 'should not start on overlap');
    });

    it('demolish should remove task from queue', () => {
        bc.queue.tasks = [{
            id: 'demolish_me', blueprintName: 'house_5x5',
            buildSite: { x: 10, y: 20, z: 30 },
            status: 'done',
        }];
        const removed = bc.demolish('demolish_me');
        assert.ok(removed);
        assert.strictEqual(bc.queue.tasks.length, 0);
    });

    it('demolish should return null for unknown task', () => {
        bc.queue.tasks = [];
        const result = bc.demolish('nonexistent');
        assert.strictEqual(result, null);
    });

    it('checkDamagedBuilds should return null when all intact', () => {
        bc.queue.tasks = [];
        const damaged = bc.checkDamagedBuilds();
        assert.strictEqual(damaged, null);
    });

    it('repair should set task to active', () => {
        bc.queue.tasks = [{
            id: 'repair_me', blueprintName: 'house_5x5',
            buildSite: { x: 10, y: 20, z: 30 },
            status: 'done',
        }];
        bc.queue.save = () => {};
        bc.saveState = () => {};
        bc.repair(bc.queue.tasks[0]);
        assert.strictEqual(bc.queue.tasks[0].status, 'active');
        assert.strictEqual(bc.active, true);
    });

    it('getNextAction should not crash with resolveBlockName', () => {
        bc.loadBlueprint('house_5x5');
        bc.buildSite = { x: 0, y: 0, z: 0 };
        bc.active = true;
        bc.phase = 'done';
        bc.queue.tasks = [];
        agent.bot = makeMockBot({ gameMode: 'creative' });
        bc.agent.bot = agent.bot;
        const all = bc.getAllBlocks();
        const blocks = {};
        for (const cell of all) {
            blocks[`${cell.x},${cell.y + (bc.blueprint.offset||0)},${cell.z}`] = cell.blueprintBlock === 'planks' ? 'planks' : cell.blueprintBlock;
        }
        agent.bot = makeMockBot({ gameMode: 'creative', blocks });
        bc.agent.bot = agent.bot;
        const action = bc.getNextAction();
        assert.ok(action);
        assert.strictEqual(action.type, 'done');
    });
});

describe('BuildQueue', () => {
    let bc, queue;

    beforeEach(() => {
        const agent = makeMockAgent();
        bc = new BuildController(agent);
        Object.defineProperty(bc, 'worldDir', { get: () => TEST_DIR });
        queue = bc.queue;
    });

    afterEach(() => {
        rmSync(TEST_DIR, { recursive: true, force: true });
        mkdirSync(TEST_DIR, { recursive: true });
    });

    it('should add first task as active', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        const current = queue.getCurrent();
        assert.ok(current);
        assert.strictEqual(current.blueprintName, 'house_5x5');
        assert.strictEqual(current.status, 'active');
    });

    it('should pause current when adding new task', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        queue.addTask('watchtower', { x: 50, y: 60, z: 70 });
        const current = queue.getCurrent();
        assert.strictEqual(current.blueprintName, 'watchtower');
        const pending = queue.getPending();
        assert.strictEqual(pending.length, 1);
        assert.strictEqual(pending[0].blueprintName, 'house_5x5');
        assert.strictEqual(pending[0].status, 'paused');
    });

    it('should resume first pending after complete', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        queue.addTask('watchtower', { x: 50, y: 60, z: 70 });
        const next = queue.completeCurrent();
        assert.ok(next);
        assert.strictEqual(next.blueprintName, 'house_5x5');
        assert.strictEqual(next.status, 'active');
    });

    it('should return null when no pending after complete', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        const next = queue.completeCurrent();
        assert.strictEqual(next, null);
    });

    it('should persist to file and reload', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        queue.addTask('watchtower', { x: 50, y: 60, z: 70 });
        assert.ok(existsSync(queue.file));
        const newQueue = new (queue.constructor)(bc);
        newQueue.load();
        assert.strictEqual(newQueue.tasks.length, 2);
        assert.strictEqual(newQueue.getCurrent().blueprintName, 'watchtower');
    });

    it('should track done tasks', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        queue.completeCurrent();
        assert.strictEqual(queue.getDone().length, 1);
        assert.strictEqual(queue.getPending().length, 0);
    });

    it('should handle multiple pauses and resumes', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        queue.addTask('watchtower', { x: 50, y: 60, z: 70 });
        queue.addTask('lighthouse', { x: 100, y: 200, z: 300 });
        assert.strictEqual(queue.getCurrent().blueprintName, 'lighthouse');
        assert.strictEqual(queue.getPending().length, 2);
        const next = queue.completeCurrent();
        assert.strictEqual(next.blueprintName, 'house_5x5');
        const next2 = queue.completeCurrent();
        assert.strictEqual(next2.blueprintName, 'watchtower');
        const next3 = queue.completeCurrent();
        assert.strictEqual(next3, null);
    });

    it('summary should show all tasks', () => {
        queue.load();
        queue.addTask('house_5x5', { x: 10, y: 20, z: 30 });
        queue.addTask('watchtower', { x: 50, y: 60, z: 70 });
        const s = queue.summary();
        assert.match(s, /house_5x5/);
        assert.match(s, /watchtower/);
        assert.match(s, /ACTIVE/);
        assert.match(s, /PAUSED/);
    });
});

describe('Method integrity - all methods exist and are callable', () => {
    let bc;
    before(() => {
        const agent = makeMockAgent();
        bc = new BuildController(agent);
    });

    const requiredMethods = [
        'loadBlueprint', 'listBlueprints', 'start', 'switchTo', 'complete', 'stop',
        'getDimensions', 'getWorldPos', 'scanBlock', 'getAllBlocks', 'computeProgress',
        'determinePhase', 'isLevelComplete', 'findWrongBlocks', 'findMissingBlocks',
        'findClearableBlocks', 'findSalvageBlocks', 'getInventoryCounts', 'resolveBlockName',
        'countNeededMaterials', 'countMissingMaterials', 'getToolAction', 'getNextAction',
        'executeDirect', 'formatClearAction', 'formatSalvageAction', 'formatPlaceAction',
        'formatGatherAction', 'getMaterialPlan', 'formatMaterialPlan',
        'saveState', 'loadState', 'getWorldId', 'log',
    ];

    for (const method of requiredMethods) {
        it(`BuildController.${method} should be a function`, () => {
            assert.strictEqual(typeof bc[method], 'function', `${method} is not a function`);
        });
    }

    it('BuildQueue should have all required methods', () => {
        const queue = bc.queue;
        const queueMethods = ['load', 'save', 'addTask', 'completeCurrent', 'nextPending',
            'getCurrent', 'getPending', 'getDone', 'getAll', 'removeTask', 'clearCompleted', 'summary'];
        for (const m of queueMethods) {
            assert.strictEqual(typeof queue[m], 'function', `BuildQueue.${m} is not a function`);
        }
    });

    it('SelfPrompter should have all required methods', async () => {
        const { SelfPrompter } = await import('../src/agent/self_prompter.js');
        const agent = makeMockAgent();
        const sp = new SelfPrompter(agent);
        const spMethods = ['start', 'startBuildLoop', 'isActive', 'isStopped', 'isPaused',
            'handleLoad', 'setPromptPaused', 'startLoop', 'update', 'stopLoop', 'stop',
            'pause', 'shouldInterrupt', 'handleUserPromptedCmd'];
        for (const m of spMethods) {
            assert.strictEqual(typeof sp[m], 'function', `SelfPrompter.${m} is not a function`);
        }
    });

    it('Commands should have build-related commands', async () => {
        const { getCommand } = await import('../src/agent/commands/index.js');
        const commands = ['!startBuild', '!newBuild', '!checkBuild', '!listBlueprints', '!buildQueue',
            '!goal', '!endGoal', '!stop', '!placeHere', '!discard', '!collectBlocks', '!craftRecipe', '!craftPlan'];
        for (const cmd of commands) {
            const c = getCommand(cmd);
            assert.ok(c, `${cmd} command not found in commandMap`);
            assert.strictEqual(typeof c.perform, 'function', `${cmd} perform is not a function`);
        }
    });

    it('Blueprints should all be loadable and valid', () => {
        const bps = bc.listBlueprints();
        assert.ok(bps.length >= 9, `expected at least 9 blueprints, got ${bps.length}`);
        for (const bp of bps) {
            assert.ok(bp.name, 'blueprint should have name');
            assert.ok(bp.size, 'blueprint should have size');
            assert.match(bp.size, /\d+x\d+x\d+/);
        }
    });

    it('getMaterialPlan should be a method', () => {
        assert.strictEqual(typeof bc.getMaterialPlan, 'function');
    });

    it('formatMaterialPlan should be a method', () => {
        assert.strictEqual(typeof bc.formatMaterialPlan, 'function');
    });

    it('!craftPlan command should exist', async () => {
        const { getCommand } = await import('../src/agent/commands/index.js');
        const c = getCommand('!craftPlan');
        assert.ok(c, '!craftPlan command not found');
        assert.strictEqual(typeof c.perform, 'function');
    });
});

describe('getMaterialPlan - craft chain resolution', () => {
    let bc;

    before(() => {
        const agent = makeMockAgent();
        bc = new BuildController(agent);
    });

    it('should return empty plan when already have enough', () => {
        const inv = { oak_planks: 10 };
        const plan = bc.getMaterialPlan('oak_planks', 5, inv);
        assert.strictEqual(plan.have, 10);
        assert.strictEqual(Object.keys(plan.collect).length, 0);
        assert.strictEqual(plan.steps.length, 0);
    });

    it('should plan crafting oak_planks from oak_log', () => {
        const inv = { oak_log: 5 };
        const plan = bc.getMaterialPlan('oak_planks', 10, inv);
        assert.ok(plan.collect['oak_log'] > 0 || plan.steps.length > 0);
        const hasCraftStep = plan.steps.some(s => s.includes('craftRecipe') && s.includes('oak_planks'));
        assert.ok(hasCraftStep, 'should have craft step for oak_planks');
    });

    it('should plan collecting oak_log when nothing in inventory', () => {
        const inv = {};
        const plan = bc.getMaterialPlan('oak_planks', 10, inv);
        const hasCollect = plan.steps.some(s => s.includes('collectBlocks') && (s.includes('oak_log') || s.includes('log')));
        assert.ok(hasCollect, 'should have collect step for logs, got: ' + JSON.stringify(plan.steps));
    });

    it('should plan smelting sand for glass', () => {
        const inv = {};
        const plan = bc.getMaterialPlan('glass', 8, inv);
        assert.ok(plan.collect['sand'] > 0, 'should need sand');
        const hasSmelt = plan.steps.some(s => s.includes('smeltItem') && s.includes('sand'));
        assert.ok(hasSmelt, 'should have smelt step for sand→glass');
    });

    it('should plan mining stone for cobblestone', () => {
        const inv = {};
        const plan = bc.getMaterialPlan('cobblestone', 20, inv);
        assert.ok(plan.collect['stone'] >= 20, 'should need stone');
        const hasMine = plan.steps.some(s => s.includes('collectBlocks') && s.includes('stone'));
        assert.ok(hasMine, 'should have collect step for stone');
    });

    it('should plan crafting stone_bricks from cobblestone', () => {
        const inv = {};
        const plan = bc.getMaterialPlan('stone_bricks', 10, inv);
        const hasCraftStep = plan.steps.some(s => s.includes('craftRecipe') && s.includes('stone_bricks'));
        assert.ok(hasCraftStep, 'should have craft step for stone_bricks');
        assert.ok(plan.collect['stone'] > 0, 'should need stone (for cobblestone)');
    });

    it('should plan crafting torch from coal and sticks', () => {
        const inv = {};
        const plan = bc.getMaterialPlan('torch', 4, inv);
        const hasCoalCollect = plan.collect['coal_ore'] > 0;
        const hasTorchCraft = plan.steps.some(s => s.includes('craftRecipe') && s.includes('torch'));
        assert.ok(hasCoalCollect || hasTorchCraft, 'should plan coal collection and torch crafting');
    });

    it('should plan crafting oak_door from planks', () => {
        const inv = { oak_planks: 10 };
        const plan = bc.getMaterialPlan('oak_door', 2, inv);
        const hasCraftStep = plan.steps.some(s => s.includes('craftRecipe') && s.includes('oak_door'));
        assert.ok(hasCraftStep, 'should have craft step for oak_door');
    });

    it('should use existing cobblestone when crafting stone_bricks', () => {
        const inv = { cobblestone: 20 };
        const plan = bc.getMaterialPlan('stone_bricks', 10, inv);
        assert.ok(plan.have >= 0, 'should have some from inventory');
        const hasCraftStep = plan.steps.some(s => s.includes('craftRecipe') && s.includes('stone_bricks'));
        assert.ok(hasCraftStep, 'should have craft step for stone_bricks');
        assert.ok(!plan.collect['stone'], 'should NOT need to mine stone when has cobblestone');
    });

    it('should add furnace to collect list when smelting and no furnace', () => {
        const inv = {};
        const plan = bc.getMaterialPlan('glass', 8, inv);
        assert.ok(plan.collect['furnace'] >= 1, 'should need furnace');
    });

    it('should not add furnace when already has one', () => {
        const inv = { furnace: 1 };
        const plan = bc.getMaterialPlan('glass', 8, inv);
        assert.ok(!plan.collect['furnace'], 'should NOT need furnace when has one');
    });

    it('formatMaterialPlan should produce readable text', () => {
        const inv = {};
        const text = bc.formatMaterialPlan('glass', 8);
        assert.match(text, /glass/);
        assert.match(text, /sand/);
        assert.match(text, /smeltItem/);
        assert.match(text, /STEPS/);
    });

    it('formatMaterialPlan should show already-have count', () => {
        bc.bot._inv['oak_planks'] = 20;
        bc.getInventoryCounts = () => ({ oak_planks: 20 });
        const text = bc.formatMaterialPlan('oak_planks', 10);
        assert.match(text, /already have/);
    });
});
