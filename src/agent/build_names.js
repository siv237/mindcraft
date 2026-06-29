export const BLUEPRINT_TYPE_NAMES = {
    'house_5x5': 'дом',
    'small_wood_house': 'деревянный дом',
    'small_stone_house': 'каменный дом',
    'large_house': 'большой дом',
    'stone_brick_house': 'каменный дом',
    'farm_hut': 'ферма',
    'storage_shed': 'сарай',
    'watchtower': 'башня',
    'lighthouse': 'маяк',
    'mine_entrance': 'шахта',
    'bridge': 'мост',
    'church': 'церковь',
    'cobblestone_tower': 'башня',
    'dirt_shelter': 'укрытие',
    'wall_7x7': 'стена',
    'villagerFarm': 'ферма',
};

const BIOME_LANDMARKS = {
    'forest': 'в лесу',
    'birch_forest': 'в берёзовом лесу',
    'dark_forest': 'в тёмном лесу',
    'taiga': 'в тайге',
    'snowy_taiga': 'в снежной тайге',
    'plains': 'в поле',
    'sunflower_plains': 'в поле',
    'desert': 'в пустыне',
    'savanna': 'в саванне',
    'swamp': 'на болоте',
    'mangrove_swamp': 'на болоте',
    'jungle': 'в джунглях',
    'bamboo_jungle': 'в бамбуковом лесу',
    'beach': 'у берега',
    'stony_shore': 'у берега',
    'ocean': 'у моря',
    'cold_ocean': 'у моря',
    'warm_ocean': 'у моря',
    'lukewarm_ocean': 'у моря',
    'frozen_ocean': 'у моря',
    'deep_ocean': 'у моря',
    'river': 'у реки',
    'frozen_river': 'у реки',
    'mountains': 'на горе',
    'wooded_mountains': 'на горе',
    'snowy_slopes': 'на снежном склоне',
    'snowy_peaks': 'на снежном пике',
    'jagged_peaks': 'на пике',
    'frozen_peaks': 'на ледяном пике',
    'stony_peaks': 'на скале',
    'meadow': 'на лугу',
    'grove': 'в роще',
    'cherry_grove': 'в вишнёвой роще',
    'windswept_hills': 'на холме',
    'windswept_gravelly_hills': 'на холме',
    'windswept_forest': 'в лесу на холме',
    'windswept_savanna': 'на холме',
    'badlands': 'в пустоше',
    'wooded_badlands': 'в пустоше',
    'eroded_badlands': 'в пустоше',
    'mushroom_fields': 'на грибном острове',
    'dripstone_caves': 'в пещере',
    'lush_caves': 'в пещере',
    'deep_dark': 'в глубине',
    'nether_wastes': 'в незере',
    'soul_sand_valley': 'в долине душ',
    'crimson_forest': 'в багровом лесу',
    'warped_forest': 'в искажённом лесу',
    'basalt_deltas': 'в базальтовых дельтах',
    'the_end': 'в конце',
    'end_barrens': 'в конце',
    'end_highlands': 'в конце',
    'end_midlands': 'в конце',
    'small_end_islands': 'в конце',
};

import { Vec3 } from 'vec3';

export function generateBuildName(blueprintName, bot, buildSite) {
    const typeName = BLUEPRINT_TYPE_NAMES[blueprintName] || blueprintName;
    let landmark = '';
    try {
        const pos = new Vec3(buildSite.x, buildSite.y, buildSite.z);
        const biomeId = bot.world.getBiome(pos);
        const biomeName = bot.registry?.biomesByID?.[biomeId]?.name?.toLowerCase() || '';
        landmark = BIOME_LANDMARKS[biomeName] || '';
        if (!landmark) {
            for (const [key, val] of Object.entries(BIOME_LANDMARKS)) {
                if (biomeName.includes(key)) { landmark = val; break; }
            }
        }
    } catch {}
    if (!landmark) {
        if (buildSite.y >= 100) landmark = 'на горе';
        else if (buildSite.y <= 0) landmark = 'под землёй';
        else landmark = 'здесь';
    }
    return `${typeName} ${landmark}`;
}
