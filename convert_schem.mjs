import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { Schematic } from 'prismarine-schematic';
import { Vec3 } from 'vec3';
import { dirname, join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VERSION = '1.21.5';

function blockNameToGeneric(name) {
    const genericMap = {
        'oak_planks': 'planks',
        'oak_log': 'log',
        'oak_door': 'door',
        'oak_stairs': 'stairs',
        'oak_slab': 'slab',
        'oak_fence': 'fence',
        'oak_leaves': 'leaves',
        'stone_bricks': 'stone_bricks',
        'cobblestone': 'cobblestone',
        'dirt': 'dirt',
        'glass': 'glass',
        'torch': 'torch',
        'crafting_table': 'crafting_table',
        'furnace': 'furnace',
        'chest': 'chest',
        'bed': 'bed',
        'bookshelf': 'bookshelf',
        'water': 'water',
        'lava': 'lava',
        'sand': 'sand',
        'gravel': 'gravel',
        'brick': 'brick',
        'nether_bricks': 'nether_bricks',
        'spruce_planks': 'planks',
        'birch_planks': 'planks',
        'dark_oak_planks': 'planks',
        'acacia_planks': 'planks',
        'jungle_planks': 'planks',
        'spruce_log': 'log',
        'birch_log': 'log',
        'dark_oak_log': 'log',
        'spruce_door': 'door',
        'birch_door': 'door',
        'wall_torch': 'torch',
        'redstone_torch': 'torch',
        'redstone_wire': 'redstone_wire',
        'repeater': 'repeater',
        'comparator': 'comparator',
        'observer': 'observer',
        'dispenser': 'dispenser',
        'dropper': 'dropper',
        'hopper': 'hopper',
        'mossy_cobblestone': 'mossy_cobblestone',
        'smooth_stone': 'smooth_stone',
        'smooth_quartz': 'smooth_quartz',
        'quartz_block': 'quartz_block',
        'quartz_pillar': 'quartz_pillar',
        'chiseled_quartz_block': 'chiseled_quartz_block',
        'sea_lantern': 'sea_lantern',
        'glowstone': 'glowstone',
        'lantern': 'lantern',
        'campfire': 'campfire',
        'fire': 'fire',
        'netherrack': 'netherrack',
        'farmland': 'farmland',
        'composter': 'composter',
        'carrots': 'carrots',
        'wheat': 'wheat',
        'potatoes': 'potatoes',
        'beetroots': 'beetroots',
        'melon_stem': 'melon_stem',
        'pumpkin_stem': 'pumpkin_stem',
        'brewing_stand': 'brewing_stand',
        'cauldron': 'cauldron',
        'anvil': 'anvil',
        'enchanting_table': 'enchanting_table',
        'bookshelf': 'bookshelf',
        'loom': 'loom',
        'blast_furnace': 'blast_furnace',
        'smoker': 'smoker',
        'grindstone': 'grindstone',
        'stonecutter': 'stonecutter',
        'barrel': 'barrel',
        'ladder': 'ladder',
        'scaffolding': 'scaffolding',
        'rail': 'rail',
        'powered_rail': 'powered_rail',
        'detector_rail': 'detector_rail',
        'activator_rail': 'activator_rail',
        'redstone_lamp': 'redstone_lamp',
        'lever': 'lever',
        'stone_button': 'stone_button',
        'oak_button': 'oak_button',
        'oak_pressure_plate': 'oak_pressure_plate',
        'stone_pressure_plate': 'stone_pressure_plate',
        'tripwire_hook': 'tripwire_hook',
        'tripwire': 'tripwire',
        'daylight_detector': 'daylight_detector',
        'note_block': 'note_block',
        'jukebox': 'jukebox',
        'crafting_table': 'crafting_table',
        'cartography_table': 'cartography_table',
        'fletching_table': 'fletching_table',
        'smithing_table': 'smithing_table',
        'loom': 'loom',
        'grindstone': 'grindstone',
        'stonecutter': 'stonecutter',
        'anvil': 'anvil',
        'chipped_anvil': 'anvil',
        'damaged_anvil': 'anvil',
        'white_bed': 'bed',
        'red_bed': 'bed',
        'blue_bed': 'bed',
        'green_bed': 'bed',
        'yellow_bed': 'bed',
        'orange_bed': 'bed',
        'pink_bed': 'bed',
        'gray_bed': 'bed',
        'light_blue_bed': 'bed',
        'lime_bed': 'bed',
        'cyan_bed': 'bed',
        'purple_bed': 'bed',
        'magenta_bed': 'bed',
        'brown_bed': 'bed',
        'black_bed': 'bed',
        'light_gray_bed': 'bed',
        'white_stained_glass': 'glass',
        'orange_stained_glass': 'glass',
        'magenta_stained_glass': 'glass',
        'light_blue_stained_glass': 'glass',
        'yellow_stained_glass': 'glass',
        'lime_stained_glass': 'glass',
        'pink_stained_glass': 'glass',
        'gray_stained_glass': 'glass',
        'light_gray_stained_glass': 'glass',
        'cyan_stained_glass': 'glass',
        'purple_stained_glass': 'glass',
        'blue_stained_glass': 'glass',
        'brown_stained_glass': 'glass',
        'green_stained_glass': 'glass',
        'red_stained_glass': 'glass',
        'black_stained_glass': 'glass',
        'white_stained_glass_pane': 'glass_pane',
        'orange_stained_glass_pane': 'glass_pane',
        'magenta_stained_glass_pane': 'glass_pane',
        'light_blue_stained_glass_pane': 'glass_pane',
        'yellow_stained_glass_pane': 'glass_pane',
        'lime_stained_glass_pane': 'glass_pane',
        'pink_stained_glass_pane': 'glass_pane',
        'gray_stained_glass_pane': 'glass_pane',
        'light_gray_stained_glass_pane': 'glass_pane',
        'cyan_stained_glass_pane': 'glass_pane',
        'purple_stained_glass_pane': 'glass_pane',
        'blue_stained_glass_pane': 'glass_pane',
        'brown_stained_glass_pane': 'glass_pane',
        'green_stained_glass_pane': 'glass_pane',
        'red_stained_glass_pane': 'glass_pane',
        'black_stained_glass_pane': 'glass_pane',
        'white_concrete': 'concrete',
        'orange_concrete': 'concrete',
        'magenta_concrete': 'concrete',
        'light_blue_concrete': 'concrete',
        'yellow_concrete': 'concrete',
        'lime_concrete': 'concrete',
        'pink_concrete': 'concrete',
        'gray_concrete': 'concrete',
        'light_gray_concrete': 'concrete',
        'cyan_concrete': 'concrete',
        'purple_concrete': 'concrete',
        'blue_concrete': 'concrete',
        'brown_concrete': 'concrete',
        'green_concrete': 'concrete',
        'red_concrete': 'concrete',
        'black_concrete': 'concrete',
        'white_carpet': 'carpet',
        'red_carpet': 'carpet',
        'blue_carpet': 'carpet',
        'green_carpet': 'carpet',
        'yellow_carpet': 'carpet',
        'cobblestone_stairs': 'cobblestone_stairs',
        'cobblestone_slab': 'cobblestone_slab',
        'cobblestone_wall': 'cobblestone_wall',
        'stone_brick_stairs': 'stone_brick_stairs',
        'stone_brick_wall': 'stone_brick_wall',
        'mossy_cobblestone_wall': 'mossy_cobblestone_wall',
        'birch_stairs': 'birch_stairs',
        'spruce_stairs': 'spruce_stairs',
        'oak_stairs': 'oak_stairs',
        'dark_oak_stairs': 'dark_oak_stairs',
        'jungle_stairs': 'jungle_stairs',
        'acacia_stairs': 'acacia_stairs',
        'oak_slab': 'oak_slab',
        'spruce_slab': 'spruce_slab',
        'birch_slab': 'birch_slab',
        'dark_oak_slab': 'dark_oak_slab',
        'oak_trapdoor': 'oak_trapdoor',
        'spruce_trapdoor': 'spruce_trapdoor',
        'birch_trapdoor': 'birch_trapdoor',
        'dark_oak_trapdoor': 'dark_oak_trapdoor',
        'oak_fence': 'oak_fence',
        'spruce_fence': 'spruce_fence',
        'birch_fence': 'birch_fence',
        'dark_oak_fence': 'dark_oak_fence',
        'oak_fence_gate': 'oak_fence_gate',
        'spruce_fence_gate': 'spruce_fence_gate',
        'birch_fence_gate': 'birch_fence_gate',
        'dark_oak_fence_gate': 'dark_oak_fence_gate',
        'stripped_oak_log': 'stripped_oak_log',
        'stripped_birch_log': 'stripped_birch_log',
        'stripped_spruce_log': 'stripped_spruce_log',
        'stripped_dark_oak_log': 'stripped_dark_oak_log',
        'stripped_oak_wood': 'stripped_oak_wood',
        'stripped_birch_wood': 'stripped_birch_wood',
        'stripped_spruce_wood': 'stripped_spruce_wood',
        'stripped_dark_oak_wood': 'stripped_dark_oak_wood',
        'oak_leaves': 'oak_leaves',
        'spruce_leaves': 'spruce_leaves',
        'birch_leaves': 'birch_leaves',
        'dark_oak_leaves': 'dark_oak_leaves',
        'jungle_leaves': 'jungle_leaves',
        'acacia_leaves': 'acacia_leaves',
        'grass_block': 'grass_block',
        'coarse_dirt': 'coarse_dirt',
        'podzol': 'podzol',
        'mycelium': 'mycelium',
        'snow_block': 'snow_block',
        'ice': 'ice',
        'packed_ice': 'packed_ice',
        'blue_ice': 'blue_ice',
        'sandstone': 'sandstone',
        'red_sandstone': 'red_sandstone',
        'terracotta': 'terracotta',
        'white_terracotta': 'terracotta',
        'orange_terracotta': 'terracotta',
        'magenta_terracotta': 'terracotta',
        'light_blue_terracotta': 'terracotta',
        'yellow_terracotta': 'terracotta',
        'lime_terracotta': 'terracotta',
        'pink_terracotta': 'terracotta',
        'gray_terracotta': 'terracotta',
        'light_gray_terracotta': 'terracotta',
        'cyan_terracotta': 'terracotta',
        'purple_terracotta': 'terracotta',
        'blue_terracotta': 'terracotta',
        'brown_terracotta': 'terracotta',
        'green_terracotta': 'terracotta',
        'red_terracotta': 'terracotta',
        'black_terracotta': 'terracotta',
        'gold_block': 'gold_block',
        'iron_block': 'iron_block',
        'diamond_block': 'diamond_block',
        'emerald_block': 'emerald_block',
        'lapis_block': 'lapis_block',
        'redstone_block': 'redstone_block',
        'netherite_block': 'netherite_block',
        'coal_block': 'coal_block',
        'command_block': 'command_block',
        'repeating_command_block': 'command_block',
        'chain_command_block': 'command_block',
        'structure_block': 'structure_block',
        'jigsaw': 'jigsaw',
        'spawner': 'spawner',
        'oak_sign': 'oak_sign',
        'oak_wall_sign': 'oak_sign',
        'spruce_sign': 'spruce_sign',
        'spruce_wall_sign': 'spruce_sign',
        'birch_sign': 'birch_sign',
        'birch_wall_sign': 'birch_sign',
        'white_banner': 'white_banner',
        'white_wall_banner': 'white_banner',
        'flower_pot': 'flower_pot',
        'lilac': 'lilac',
        'dandelion': 'dandelion',
        'poppy': 'poppy',
        'rose_bush': 'rose_bush',
        'peony': 'peony',
        'cornflower': 'cornflower',
        'lily_of_the_valley': 'lily_of_the_valley',
        'wither_rose': 'wither_rose',
        'oak_sapling': 'oak_sapling',
        'spruce_sapling': 'spruce_sapling',
        'birch_sapling': 'birch_sapling',
    };
    if (genericMap[name]) return genericMap[name];
    if (name === 'air' || !name) return 'air';
    return name;
}

async function convertSchem(schemPath, outDir) {
    const buf = readFileSync(schemPath);
    const schem = await Schematic.read(buf, VERSION);

    const sx = schem.size.x;
    const sy = schem.size.y;
    const sz = schem.size.z;
    const offset = schem.offset;

    console.log(`Converting ${basename(schemPath)}: ${sx}x${sy}x${sz}, offset=${offset.x},${offset.y},${offset.z}`);

    const blocks = [];
    const blockTypes = new Set();

    for (let y = 0; y < sy; y++) {
        const zArr = [];
        for (let z = 0; z < sz; z++) {
            const xArr = [];
            for (let x = 0; x < sx; x++) {
                const pos = new Vec3(x + offset.x, y + offset.y, z + offset.z);
                const block = schem.getBlock(pos);
                const name = block ? (block.name || 'air') : 'air';
                const generic = blockNameToGeneric(name);
                xArr.push(generic);
                blockTypes.add(generic);
            }
            zArr.push(xArr);
        }
        blocks.push(zArr);
    }

    const name = basename(schemPath, '.schem');
    const out = {
        name,
        description: `Converted from ${basename(schemPath)} (${sx}x${sy}x${sz})`,
        offset: offset.y,
        blocks,
    };

    const outPath = join(outDir, `${name}.json`);
    writeFileSync(outPath, JSON.stringify(out, null, 4));
    console.log(`  → ${outPath} (${blockTypes.size} block types: ${[...blockTypes].join(', ')})`);
    return out;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: node convert_schem.mjs <input.schem|input_dir> [output_dir]');
        console.log('  Converts .schem/.schematic files to mindcraft blueprint JSON format.');
        console.log('  Output defaults to ./blueprints/');
        process.exit(1);
    }

    const input = resolve(args[0]);
    const outDir = resolve(args[1] || join(__dirname, 'blueprints'));

    let files = [];
    let isDir = false;
    try {
        isDir = statSync(input).isDirectory();
    } catch {
        isDir = false;
    }

    if (isDir) {
        files = readdirSync(input)
            .filter(f => f.endsWith('.schem') || f.endsWith('.schematic'))
            .map(f => join(input, f));
    } else {
        files = [input];
    }

    if (files.length === 0) {
        console.log('No .schem or .schematic files found.');
        process.exit(1);
    }

    console.log(`Found ${files.length} schematic file(s). Converting...`);
    for (const f of files) {
        try {
            await convertSchem(f, outDir);
        } catch (e) {
            console.error(`Failed to convert ${basename(f)}: ${e.message}`);
        }
    }
    console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
