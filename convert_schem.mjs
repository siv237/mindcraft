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
