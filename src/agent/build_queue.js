import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';

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

    addTask(blueprintName, buildSite) {
        const id = `${blueprintName}_${Date.now()}`;
        const task = {
            id,
            blueprintName,
            buildSite: { x: buildSite.x, y: buildSite.y, z: buildSite.z },
            status: 'active',
            addedAt: Date.now(),
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
            msg += `  ${icon} ${t.blueprintName} at (${t.buildSite.x},${t.buildSite.y},${t.buildSite.z}) id=${t.id}\n`;
        }
        const pending = this.getPending().length;
        const done = this.getDone().length;
        msg += `${pending} pending, ${done} done, ${this.tasks.length - pending - done} active.`;
        return msg;
    }
}
