// The six permaculture zones (Mollison and Holmgren): placed by how often you go there,
// so the things that need the most care sit closest to the door.

export interface ZoneInfo {
  n: number;
  name: string;
  visits: string;
  purpose: string;
  belongs: string[];
  categories: string[]; // library categories the guide shows first for this zone
}

export const ZONES: ZoneInfo[] = [
  { n: 0, name: 'Zone 0: the home', visits: 'Lived in', purpose: 'The house itself: windowsills, sunrooms, kitchen counters and pots by the door.',
    belongs: ['Sprouts and microgreens', 'Windowsill herbs', 'Potted citrus and figs brought in for winter', 'Mushroom grow bags', 'Seed starting', 'Kitchen scraps to the compost'],
    categories: ['indoor', 'herb', 'vegetable', 'fruit-tree', 'berry'] },
  { n: 1, name: 'Zone 1: the kitchen garden', visits: 'Every day', purpose: 'Right outside the door: what you pick for every meal and what needs daily care.',
    belongs: ['Salad greens and herbs', 'Tomatoes, peppers and other high-care vegetables', 'Strawberries', 'Seedling nursery and cold frame', 'Worm farm and kitchen compost', 'Rain barrel'],
    categories: ['vegetable', 'herb', 'flower', 'perennial-veg', 'berry', 'cover'] },
  { n: 2, name: 'Zone 2: the food forest', visits: 'A few times a week', purpose: 'Perennial food that needs less daily attention: the orchard and food forest, small animals, ponds.',
    belongs: ['Fruit trees with guilds beneath them', 'Berry bushes and vines', 'Perennial vegetables', 'Nitrogen fixers and comfrey for chop and drop', 'Chickens, ducks, rabbits', 'Ponds, hot compost, beehives'],
    categories: ['fruit-tree', 'berry', 'vine', 'perennial-veg', 'support', 'flower'] },
  { n: 3, name: 'Zone 3: the farm', visits: 'Weekly or by season', purpose: 'Main crops for storage and sale, grazing and the big water.',
    belongs: ['Grains, dry beans, potatoes, winter squash', 'Nut orchards', 'Pasture, hay and cover crops', 'Larger livestock', 'Dams, swales and big water storage', 'Windbreaks'],
    categories: ['grain', 'nut-tree', 'pasture', 'cover', 'support', 'vegetable'] },
  { n: 4, name: 'Zone 4: the managed wild', visits: 'Now and then', purpose: 'Semi-wild land: foraging, timber, firewood, coppice and wildlife, managed lightly.',
    belongs: ['Timber and firewood', 'Coppice and pollard', 'Nut trees and wild fruit for foraging', 'Wild grazing', 'Mushroom logs in shade', 'Wildlife corridors'],
    categories: ['timber', 'nut-tree', 'support', 'berry', 'pasture'] },
  { n: 5, name: 'Zone 5: wilderness', visits: 'Only to observe', purpose: 'Left alone. Here nature teaches: watch, learn, and protect what already grows.',
    belongs: ['No planting and no management', 'Native plants and animals left in peace', 'A place to observe patterns you can copy elsewhere'],
    categories: [] },
];
