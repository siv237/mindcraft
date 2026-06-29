import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import { BLUEPRINT_TYPE_NAMES } from './build_names.js';

export class BuildQueue {
    constructor(buildController) {
        this.bc = buildController;
        this.tasks = [];
    }

    get file() {
        return `${this.bc.worldDir}/build_queue.json`;
    }

    log(msg) {
        this.bc.log(`[QUEUE] ${msg}`);
    }

    load() {
        try {
            if (!existsSync(this.file)) return [];
            const data = JSON.parse(readFileSync(this.file, 'utf8'));
            this.tasks = data.tasks || [];
            return this.tasks;
        } catch (e) {
            console.error('Failed to load build queue:', e);
            this.tasks = [];
            return [];
        }
    }

    save() {
        try {
            mkdirSync(this.bc.worldDir, { recursive: true });
            writeFileSync(this.file, JSON.stringify({ tasks: this.tasks }, null, 2));
        } catch (e) {
            console.error('Failed to save build queue:', e);
        }
    }

    addTask(blueprintName, buildSite, orderedBy = null, buildName = null) {
        const id = `${blueprintName}_${Date.now()}`;
        const task = {
            id,
            blueprintName,
            buildName: buildName || blueprintName,
            buildSite: { x: buildSite.x, y: buildSite.y, z: buildSite.z },
            status: 'active',
            addedAt: Date.now(),
            orderedBy: orderedBy,
        };
        for (const t of this.tasks) {
            if (t.status === 'active') {
                t.status = 'paused';
                this.log(`PAUSED task ${t.blueprintName} at (${t.buildSite.x},${t.buildSite.y},${t.buildSite.z})`);
            }
        }
        this.tasks.push(task);
        this.log(`ADDED task ${blueprintName} at (${buildSite.x},${buildSite.y},${buildSite.z}) — ${this.tasks.length} total`);
        this.save();
        return task;
    }

    completeCurrent() {
        for (const t of this.tasks) {
            if (t.status === 'active') {
                t.status = 'done';
                t.completedAt = Date.now();
                this.log(`DONE task ${t.blueprintName} at (${t.buildSite.x},${t.buildSite.y},${t.buildSite.z})`);
            }
        }
        this.save();
        return this.nextPending();
    }

    nextPending() {
        const pending = this.tasks.filter(t => t.status === 'paused');
        if (pending.length === 0) {
            this.log(`No pending tasks. Queue empty.`);
            return null;
        }
        pending.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        const next = pending[0];
        next.status = 'active';
        this.log(`RESUMING task ${next.blueprintName} at (${next.buildSite.x},${next.buildSite.y},${next.buildSite.z})`);
        this.save();
        return next;
    }

    getCurrent() {
        return this.tasks.find(t => t.status === 'active') || null;
    }

    getPending() {
        return this.tasks.filter(t => t.status === 'paused');
    }

    getDone() {
        return this.tasks.filter(t => t.status === 'done');
    }

    getAll() {
        return this.tasks;
    }

    findByName(query) {
        const lower = query.toLowerCase();
        let match = this.tasks.find(t => t.buildName?.toLowerCase() === lower);
        if (match) return match;
        match = this.tasks.find(t => t.buildName?.toLowerCase().includes(lower));
        if (match) return match;
        match = this.tasks.find(t => lower.includes(t.buildName?.toLowerCase() || ''));
        if (match) return match;
        const bpName = BLUEPRINT_TYPE_NAMES[lower] || lower;
        match = this.tasks.find(t => t.blueprintName === bpName || t.blueprintName.includes(lower));
        return match || null;
    }

    removeTask(id) {
        const idx = this.tasks.findIndex(t => t.id === id);
        if (idx >= 0) {
            const removed = this.tasks.splice(idx, 1)[0];
            this.log(`REMOVED task ${removed.blueprintName}`);
            this.save();
            return removed;
        }
        return null;
    }

    clearCompleted() {
        const before = this.tasks.length;
        this.tasks = this.tasks.filter(t => t.status !== 'done');
        if (this.tasks.length < before) {
            this.log(`Cleared ${before - this.tasks.length} completed tasks`);
        }
        this.save();
    }

    summary() {
        if (this.tasks.length === 0) return 'Build queue is empty.';
        let msg = `Build queue (${this.tasks.length} tasks):\n`;
        for (const t of this.tasks) {
            const icon = t.status === 'active' ? '[ACTIVE]' : t.status === 'paused' ? '[PAUSED]' : '[DONE]';
            let progressStr = '';
            if (t.status !== 'done') {
                try {
                    const savedBp = this.bc.blueprint;
                    const savedSite = this.bc.buildSite;
                    this.bc.loadBlueprint(t.blueprintName);
                    this.bc.buildSite = t.buildSite;
                    const p = this.bc.computeProgress();
                    progressStr = ` ${p.percent}% (${p.placed}/${p.total})`;
                    this.bc.blueprint = savedBp;
                    this.bc.buildSite = savedSite;
                } catch {}
            }
            const by = t.orderedBy ? ` (by ${t.orderedBy})` : '';
            const name = t.buildName ? `"${t.buildName}" ` : '';
            msg += `  ${icon} ${name}${t.blueprintName} at (${t.buildSite.x},${t.buildSite.y},${t.buildSite.z})${progressStr}${by} id=${t.id}\n`;
        }
        const pending = this.getPending().length;
        const done = this.getDone().length;
        const active = this.tasks.length - pending - done;
        msg += `${active} active, ${pending} pending, ${done} done.`;
        return msg;
    }

    summaryAllWorlds(agentName) {
        const worldsDir = `./bots/${agentName}/worlds`;
        if (!existsSync(worldsDir)) return 'No worlds found.';
        const worlds = readdirSync(worldsDir).filter(f => existsSync(`${worldsDir}/${f}/build_queue.json`));
        if (worlds.length === 0) return 'No build queues found in any world.';
        let msg = `All builds across ${worlds.length} world(s):\n`;
        let totalActive = 0, totalPending = 0, totalDone = 0;
        for (const world of worlds) {
            try {
                const data = JSON.parse(readFileSync(`${worldsDir}/${world}/build_queue.json`, 'utf8'));
                const tasks = data.tasks || [];
                if (tasks.length === 0) continue;
                msg += `\n[${world}]\n`;
                for (const t of tasks) {
                    const icon = t.status === 'active' ? '[ACTIVE]' : t.status === 'paused' ? '[PAUSED]' : '[DONE]';
                    let progressStr = '';
                    if (t.status !== 'done') {
                        try {
                            const stateFile = `${worldsDir}/${world}/build_state.json`;
                            if (existsSync(stateFile)) {
                                const state = JSON.parse(readFileSync(stateFile, 'utf8'));
                                if (state.verifiedBlocks) progressStr = ` ${state.verifiedBlocks.length} blocks verified, phase: ${state.phase || '?'}`;
                            }
                        } catch {}
                    }
                    const by = t.orderedBy ? ` (by ${t.orderedBy})` : '';
                    const name = t.buildName ? `"${t.buildName}" ` : '';
                    msg += `  ${icon} ${name}${t.blueprintName} at (${t.buildSite.x},${t.buildSite.y},${t.buildSite.z})${progressStr}${by}\n`;
                    if (t.status === 'active') totalActive++;
                    else if (t.status === 'paused') totalPending++;
                    else totalDone++;
                }
            } catch {}
        }
        msg += `\nTotal: ${totalActive} active, ${totalPending} pending, ${totalDone} done.`;
        return msg;
    }
}
