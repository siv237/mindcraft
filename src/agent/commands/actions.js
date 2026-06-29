import * as skills from '../library/skills.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { BuildController } from '../build_controller.js';


function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                skills.log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num) => {
            await skills.collectBlock(agent.bot, type, num);
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            return success ? `Smelted ${num} ${item_name}.` : `Failed to smelt ${item_name}.`;
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            let pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!listBlueprints',
        description: 'List all available building blueprints with their sizes and materials.',
        perform: function (agent) {
            if (!agent.build_controller) {
                agent.build_controller = new BuildController(agent);
            }
            const list = agent.build_controller.listBlueprints();
            if (list.length === 0) return 'No blueprints available.';
            let msg = `Available blueprints (${list.length}):\n`;
            for (const bp of list) {
                msg += `  ${bp.name} (${bp.size}) — ${bp.description}\n`;
                msg += `    Materials: ${bp.materials}\n`;
            }
            msg += `Use !startBuild("name") to build one.`;
            return msg;
        }
    },
    {
        name: '!startBuild',
        description: 'Start building a structure from a blueprint. The bot will continuously scan, gather materials, and place blocks until the structure is complete.',
        params: {
            'blueprint_name': { type: 'string', description: 'Name of the blueprint file (e.g. house_5x5, watchtower, lighthouse).' },
            'near_player': { type: 'string', description: 'Player name to build near. Bot will build at that player position. Optional.', optional: true },
        },
        perform: async function (agent, blueprint_name, near_player) {
            if (!agent.build_controller) {
                agent.build_controller = new BuildController(agent);
            }
            const existing = agent.build_controller.loadState();
            if (existing && agent.build_controller.active && agent.build_controller.blueprint?.name === blueprint_name) {
                const progress = agent.build_controller.computeProgress();
                const site = agent.build_controller.buildSite;
                let msg = `Already building '${blueprint_name}' at (${site.x}, ${site.y}, ${site.z}). `;
                msg += `Progress: ${progress.percent}%. Resuming.`;
                if (!agent.self_prompter.isActive()) {
                    agent.self_prompter.startBuildLoop(agent.build_controller);
                }
                return msg;
            }
            if (!near_player && agent.last_sender && agent.last_sender !== 'system') {
                near_player = agent.last_sender;
            }
            let position = null;
            if (near_player) {
                const player = agent.bot.players[near_player];
                if (player && player.entity) {
                    const pos = player.entity.position;
                    position = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
                    agent.openChat(`Building '${blueprint_name}' near ${near_player} at (${position.x}, ${position.y}, ${position.z}).`);
                } else {
                    return `Player '${near_player}' not found or too far away. Ask them to come closer.`;
                }
            }
            const result = agent.build_controller.switchTo(blueprint_name, position);
            if (result === false) {
                return `Cannot build '${blueprint_name}' here — overlaps with an existing structure. Use !buildQueue to see existing builds, or !demolish to remove one.`;
            }
            const progress = agent.build_controller.computeProgress();
            const site = agent.build_controller.buildSite;
            const queueLen = agent.build_controller.queue.tasks.length;
            let msg = `Started building '${blueprint_name}' at (${site.x}, ${site.y}, ${site.z}). `;
            msg += `Progress: ${progress.percent}%. Queue: ${queueLen} tasks.`;
            if (agent.self_prompter.isActive()) {
                await agent.self_prompter.stop(false);
            }
            agent.self_prompter.startBuildLoop(agent.build_controller);
            return msg;
        }
    },
    {
        name: '!newBuild',
        description: 'Start a NEW building at current position or near a player, abandoning any previous build.',
        params: {
            'blueprint_name': { type: 'string', description: 'Name of the blueprint file (e.g. house_5x5, watchtower, lighthouse).' },
            'near_player': { type: 'string', description: 'Player name to build near. Bot will build at that player position. Optional.', optional: true },
        },
        perform: async function (agent, blueprint_name, near_player) {
            if (!agent.build_controller) {
                agent.build_controller = new BuildController(agent);
            }
            if (agent.build_controller.active) {
                agent.build_controller.stop();
            }
            agent.build_controller.queue.tasks = [];
            agent.build_controller.queue.save();
            if (!near_player && agent.last_sender && agent.last_sender !== 'system') {
                near_player = agent.last_sender;
            }
            let position = null;
            if (near_player) {
                const player = agent.bot.players[near_player];
                if (player && player.entity) {
                    const pos = player.entity.position;
                    position = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
                    agent.openChat(`Building NEW '${blueprint_name}' near ${near_player} at (${position.x}, ${position.y}, ${position.z}).`);
                } else {
                    return `Player '${near_player}' not found or too far away. Ask them to come closer.`;
                }
            }
            agent.build_controller.start(blueprint_name, position);
            const progress = agent.build_controller.computeProgress();
            const site = agent.build_controller.buildSite;
            let msg = `Started NEW build '${blueprint_name}' at (${site.x}, ${site.y}, ${site.z}). `;
            msg += `Progress: ${progress.percent}%.`;
            if (agent.self_prompter.isActive()) {
                await agent.self_prompter.stop();
            }
            agent.self_prompter.startBuildLoop(agent.build_controller);
            return msg;
        }
    },
    {
        name: '!demolish',
        description: 'Demolish a completed building so a new one can be built in its place. Use !buildQueue to find the task ID.',
        params: {
            'task_id': { type: 'string', description: 'The task ID from !buildQueue.' },
        },
        perform: async function (agent, task_id) {
            if (!agent.build_controller) return 'No build controller.';
            const task = agent.build_controller.demolish(task_id);
            if (task) {
                return `Demolished '${task.blueprintName}' at (${task.buildSite.x},${task.buildSite.y},${task.buildSite.z}). You can now build something new there.`;
            }
            return `Task '${task_id}' not found. Use !buildQueue to see task IDs.`;
        }
    },
    {
        name: '!repairAll',
        description: 'Check all completed builds for damage and repair any that are broken.',
        perform: async function (agent) {
            if (!agent.build_controller) return 'No build controller.';
            agent.build_controller.queue.load();
            const damaged = agent.build_controller.checkDamagedBuilds();
            if (damaged) {
                agent.build_controller.repair(damaged);
                if (!agent.self_prompter.isActive()) {
                    agent.self_prompter.startBuildLoop(agent.build_controller);
                }
                return `Found damaged '${damaged.blueprintName}' at (${damaged.buildSite.x},${damaged.buildSite.y},${damaged.buildSite.z}). Starting repair.`;
            }
            return 'All completed builds are intact. No repairs needed.';
        }
    },
    {
        name: '!buildQueue',
        description: 'Show all build tasks in the queue with their status and coordinates.',
        perform: function (agent) {
            if (!agent.build_controller) return 'No build controller.';
            const queue = agent.build_controller.queue;
            queue.load();
            return queue.summary();
        }
    },
    {
        name: '!checkBuild',
        description: 'Check the current build progress and see what needs to be done next.',
        perform: function (agent) {
            if (!agent.build_controller || !agent.build_controller.active) {
                return 'No active build. Use !startBuild to begin.';
            }
            const progress = agent.build_controller.computeProgress();
            const phase = agent.build_controller.determinePhase();
            const missing = agent.build_controller.findMissingBlocks(10);
            const wrong = agent.build_controller.findWrongBlocks();
            const inv = agent.build_controller.getInventoryCounts();
            const bpName = agent.build_controller.blueprint?.name || 'unknown';
            const site = agent.build_controller.buildSite;
            let msg = `Building '${bpName}' at (${site.x},${site.y},${site.z}). `;
            msg += `Progress: ${progress.percent}% (${progress.placed}/${progress.total}). `;
            msg += `Phase: ${phase}. Wrong blocks: ${wrong.length}. `;
            if (missing.length > 0) {
                msg += `Next: `;
                msg += missing.slice(0, 5).map(m => {
                    const wp = m.worldPos;
                    return `${m.blueprintBlock} at (${wp.x},${wp.y},${wp.z})`;
                }).join(', ');
            }
            return msg;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
    {
        name: '!craftPlan',
        description: 'Get a step-by-step plan for obtaining an item: crafting, smelting, or gathering raw materials. Shows what you already have and what to collect.',
        params: {
            'item_name': { type: 'ItemName', description: 'The item you want to obtain.' },
            'num': { type: 'int', description: 'How many you need.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: async function(agent, item_name, num) {
            if (!agent.build_controller || !agent.build_controller.active) {
                return `No active build. !craftPlan is only available during construction.`;
            }
            const plan = agent.build_controller.formatMaterialPlan(item_name, num || 1);
            agent.build_controller.log(`CRAFTPLAN: ${item_name} x${num}`);
            return plan;
        }
    },
];
