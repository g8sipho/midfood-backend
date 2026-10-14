// What a store sells, as the tiles on the app's home screen.
//
// MidFood started with restaurants but the same drivers can carry anything
// a shop in town sells, so stores are grouped into categories a customer
// picks by icon: burgers, pizza, drinks ... groceries, pharmacy, car spares.
// A store's categories are either set by hand on the admin page
// (restaurants.categories) or, until then, worked out from its "cuisine" line
// and the names and sections of what is on its menu.
//
// `icon` is a MaterialCommunityIcons glyph name, which the phone app draws
// directly; the web page keeps its own emoji for the same keys.
const CATEGORIES = [
  { key: 'burgers', label: 'Burgers', icon: 'hamburger', emoji: '🍔', words: ['burger', 'kota', 'sandwich', 'toastie', 'gatsby'] },
  { key: 'pizza', label: 'Pizza', icon: 'pizza', emoji: '🍕', words: ['pizza', 'pasta', 'italian'] },
  { key: 'chicken', label: 'Chicken', icon: 'food-drumstick', emoji: '🍗', words: ['chicken', 'wings', 'drumstick', 'flame-grilled', 'peri', 'nugget'] },
  { key: 'grills', label: 'Grills & braai', icon: 'grill', emoji: '🔥', words: ['braai', 'grill', 'steak', 'shisanyama', 'ribs', 'boerewors', 'wors', 'chops', 'meat', 'platter'] },
  { key: 'local', label: 'Local kitchen', icon: 'pot-steam', emoji: '🍲', words: ['south african', 'home-style', 'homestyle', 'pap', 'umngqusho', 'chakalaka', 'bunny', 'traditional', 'mogodu', 'stew', 'samp', 'vetkoek', 'magwinya', 'dombolo'] },
  { key: 'fish', label: 'Fish & seafood', icon: 'fish', emoji: '🐟', words: ['fish', 'seafood', 'prawn', 'hake', 'calamari', 'snoek'] },
  { key: 'asian', label: 'Asian', icon: 'noodles', emoji: '🍜', words: ['chinese', 'asian', 'thai', 'noodle', 'sushi', 'japanese', 'wok', 'curry', 'indian', 'biryani'] },
  { key: 'healthy', label: 'Healthy', icon: 'leaf', emoji: '🥗', words: ['salad', 'vegan', 'vegetarian', 'healthy', 'wrap', 'bowl', 'smoothie'] },
  { key: 'bakery', label: 'Bakery', icon: 'bread-slice', emoji: '🥐', words: ['bakery', 'bread', 'cake', 'pastry', 'pastries', 'muffin', 'scone', 'pie', 'doughnut', 'donut'] },
  { key: 'desserts', label: 'Desserts', icon: 'ice-cream', emoji: '🍦', words: ['dessert', 'ice cream', 'ice-cream', 'waffle', 'sweet', 'pudding', 'milkshake', 'chocolate'] },
  { key: 'drinks', label: 'Drinks & coffee', icon: 'cup', emoji: '🥤', words: ['drink', 'cold drink', 'coke', 'juice', 'coffee', 'cafe', 'café', 'tea', 'soda', 'water', 'energy'] },
  { key: 'groceries', label: 'Groceries', icon: 'cart', emoji: '🛒', words: ['grocer', 'grocery', 'supermarket', 'spaza', 'tuck', 'bread and milk', 'essentials', 'household'] },
  { key: 'pharmacy', label: 'Pharmacy', icon: 'pill', emoji: '💊', words: ['pharmacy', 'chemist', 'medicine', 'medication', 'vitamin', 'first aid', 'baby'] },
  { key: 'car', label: 'Car spares', icon: 'car-wrench', emoji: '🔧', words: ['car spare', 'spares', 'auto', 'parts', 'tyre', 'battery', 'oil', 'brake', 'motor'] },
  { key: 'shops', label: 'Other shops', icon: 'store', emoji: '🏪', words: ['hardware', 'stationery', 'flower', 'gift', 'phone', 'electronics', 'clothing', 'shop', 'store'] },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

function isCategory(key) {
  return BY_KEY.has(String(key || '').trim());
}

// Picks the categories for a store from free text (its cuisine line plus
// what its menu calls things). Returns up to four keys, strongest first, so
// a grill house that also sells cold drinks lands under grills, not drinks.
function derive(texts) {
  const text = texts.filter(Boolean).join(' \n ').toLowerCase();
  if (!text.trim()) return [];
  const scored = [];
  for (const c of CATEGORIES) {
    let score = 0;
    for (const w of c.words) {
      const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'g');
      const hits = (text.match(re) || []).length;
      if (hits) score += hits;
    }
    if (score) scored.push({ key: c.key, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((s) => s.key);
}

// Explicit categories win over the guess, when the admin has set them.
function forStore(explicit, texts) {
  const set = Array.isArray(explicit) ? explicit.filter(isCategory) : [];
  if (set.length) return set;
  const guessed = derive(texts);
  return guessed.length ? guessed : ['shops'];
}

module.exports = { CATEGORIES, isCategory, derive, forStore };
