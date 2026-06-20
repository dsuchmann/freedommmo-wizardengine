// sim/world/buildings/specializations.js — vendor specialization taxonomy.
// Every craft/commercial/religious/military building resolves to a specific niche
// with a deterministic brand name and owner hash.  Pure functions, no kernel state.

import { rand, mix } from '../../kernel/rng.js';

// ── Specialization catalog ──────────────────────────────────────────────

export const SPECIALIZATIONS = {
  // ── craft ─────────────────────────────────────────────────────────────
  blacksmith: [
    { id: 'weaponsmith',    name: 'Weaponsmith',    desc: 'Swords, axes, spears',           baseItems: ['iron ingot', 'coal'],              specialtyItems: ['longsword', 'battle axe', 'war hammer', 'spear head'] },
    { id: 'armorer',        name: 'Armorer',        desc: 'Plate, chain, shields',           baseItems: ['iron ingot', 'leather'],           specialtyItems: ['breastplate', 'chain mail', 'tower shield', 'helm'] },
    { id: 'farrier',        name: 'Farrier',        desc: 'Horseshoes and animal gear',      baseItems: ['iron ingot', 'leather'],           specialtyItems: ['horseshoe', 'bridle bit', 'ox yoke', 'harness ring'] },
    { id: 'locksmith',      name: 'Locksmith',      desc: 'Locks, keys, mechanisms',         baseItems: ['iron ingot', 'brass'],             specialtyItems: ['padlock', 'key blank', 'door bolt', 'strongbox'] },
    { id: 'toolsmith',      name: 'Toolsmith',      desc: 'Hammers, tongs, saws',            baseItems: ['iron ingot', 'wood'],              specialtyItems: ['claw hammer', 'hand saw', 'tongs', 'chisel'] },
    { id: 'bladesmith',     name: 'Bladesmith',     desc: 'Fine daggers and razors',         baseItems: ['steel ingot', 'bone'],             specialtyItems: ['dagger', 'razor', 'stiletto', 'carving knife'] },
    { id: 'nail_maker',     name: 'Nail Maker',     desc: 'Nails, bolts, fasteners',         baseItems: ['iron ingot'],                      specialtyItems: ['iron nail', 'rivet', 'bolt', 'cleat'] },
    { id: 'chainsmith',     name: 'Chainsmith',     desc: 'Chain links, fetters, anchors',   baseItems: ['iron ingot'],                      specialtyItems: ['chain length', 'anchor', 'manacle', 'hook'] },
    { id: 'coppersmith',    name: 'Coppersmith',    desc: 'Copper vessels, fittings, pipes', baseItems: ['copper ingot'],                    specialtyItems: ['copper pot', 'pipe fitting', 'rain gutter', 'still coil'] },
    { id: 'bell_founder',   name: 'Bell Founder',   desc: 'Bells, chimes, gongs',            baseItems: ['bronze ingot', 'tin'],             specialtyItems: ['tower bell', 'hand bell', 'wind chime', 'gong'] },
  ],
  tannery: [
    { id: 'hide_tanner',    name: 'Hide Tanner',    desc: 'Raw hides to workable leather',   baseItems: ['raw hide', 'tannin'],              specialtyItems: ['cured leather', 'rawhide strip', 'parchment'] },
    { id: 'saddler',        name: 'Saddler',        desc: 'Saddles, harnesses, tack',        baseItems: ['cured leather', 'iron buckle'],    specialtyItems: ['riding saddle', 'pack saddle', 'bridle', 'girth strap'] },
    { id: 'cobbler',        name: 'Cobbler',        desc: 'Boots, shoes, sandals',           baseItems: ['cured leather', 'thread'],         specialtyItems: ['riding boot', 'sandal', 'clog', 'slipper'] },
    { id: 'glover',         name: 'Glover',         desc: 'Gloves, gauntlets, mitts',        baseItems: ['soft leather', 'thread'],          specialtyItems: ['leather glove', 'falconry gauntlet', 'work mitt'] },
    { id: 'belt_maker',     name: 'Belt Maker',     desc: 'Belts, straps, pouches',          baseItems: ['cured leather', 'brass buckle'],   specialtyItems: ['sword belt', 'coin pouch', 'quiver', 'baldric'] },
    { id: 'bookbinder',     name: 'Bookbinder',     desc: 'Book covers and bindings',        baseItems: ['cured leather', 'glue'],           specialtyItems: ['journal cover', 'folio', 'scroll case', 'portfolio'] },
    { id: 'furrier',        name: 'Furrier',        desc: 'Furs, pelts, winter garments',    baseItems: ['raw pelt', 'alum'],                specialtyItems: ['fur cloak', 'fur hat', 'fur-lined glove', 'pelt rug'] },
    { id: 'drum_maker',     name: 'Drum Maker',     desc: 'Drums and stretched-hide goods',  baseItems: ['raw hide', 'wood ring'],           specialtyItems: ['war drum', 'hand drum', 'tambourine', 'vellum sheet'] },
  ],
  bakery: [
    { id: 'bread_baker',    name: 'Bread Baker',    desc: 'Daily loaves and rolls',          baseItems: ['flour', 'yeast', 'salt'],          specialtyItems: ['rye loaf', 'wheat roll', 'sourdough round'] },
    { id: 'pastry_chef',    name: 'Pastry Chef',    desc: 'Pies, tarts, sweet pastries',     baseItems: ['flour', 'butter', 'sugar'],        specialtyItems: ['meat pie', 'fruit tart', 'honey cake', 'cream puff'] },
    { id: 'confectioner',   name: 'Confectioner',   desc: 'Sweets, candies, preserves',      baseItems: ['sugar', 'honey', 'fruit'],         specialtyItems: ['candied fruit', 'toffee', 'marzipan', 'jam jar'] },
    { id: 'biscuit_maker',  name: 'Biscuit Maker',  desc: 'Hardtack and travel rations',     baseItems: ['flour', 'salt'],                   specialtyItems: ['hardtack', 'oat biscuit', 'travel cake', 'cracker'] },
    { id: 'pretzel_maker',  name: 'Pretzel Maker',  desc: 'Twisted breads and salted snacks', baseItems: ['flour', 'lye', 'salt'],           specialtyItems: ['soft pretzel', 'salt stick', 'bread ring'] },
    { id: 'flatbread_baker', name: 'Flatbread Baker', desc: 'Flatbreads and wraps',          baseItems: ['flour', 'water', 'oil'],           specialtyItems: ['naan', 'tortilla', 'pita', 'chapati'] },
    { id: 'cake_baker',     name: 'Cake Baker',     desc: 'Celebration and feast cakes',     baseItems: ['flour', 'eggs', 'sugar', 'butter'], specialtyItems: ['layer cake', 'fruit cake', 'spice cake'] },
  ],
  pottery: [
    { id: 'potter',         name: 'Potter',         desc: 'Bowls, plates, everyday ware',    baseItems: ['clay', 'glaze'],                   specialtyItems: ['bowl', 'plate', 'mug', 'jug'] },
    { id: 'tile_maker',     name: 'Tile Maker',     desc: 'Floor and roof tiles',            baseItems: ['clay', 'sand'],                    specialtyItems: ['roof tile', 'floor tile', 'mosaic piece', 'brick'] },
    { id: 'pipe_maker',     name: 'Pipe Maker',     desc: 'Clay pipes and conduits',         baseItems: ['clay'],                            specialtyItems: ['water pipe', 'drain tile', 'chimney flue', 'tobacco pipe'] },
    { id: 'figurine_maker', name: 'Figurine Maker', desc: 'Small sculptures and votives',    baseItems: ['fine clay', 'pigment'],             specialtyItems: ['votive figure', 'animal figurine', 'deity idol'] },
    { id: 'lamp_maker',     name: 'Lamp Maker',     desc: 'Oil lamps and candle holders',    baseItems: ['clay', 'wick'],                    specialtyItems: ['oil lamp', 'candle holder', 'lantern base', 'fire pot'] },
    { id: 'urn_maker',      name: 'Urn Maker',      desc: 'Storage urns and amphora',        baseItems: ['clay', 'pitch'],                   specialtyItems: ['amphora', 'storage urn', 'wine jar', 'oil crock'] },
    { id: 'kiln_master',    name: 'Kiln Master',    desc: 'Fired ceramics and stoneware',    baseItems: ['stoneite clay', 'feldspar'],       specialtyItems: ['stoneware crock', 'fired crucible', 'kiln shelf'] },
  ],
  weaver: [
    { id: 'cloth_weaver',   name: 'Cloth Weaver',   desc: 'Everyday linen and wool cloth',   baseItems: ['wool', 'flax'],                    specialtyItems: ['linen bolt', 'wool bolt', 'canvas sheet'] },
    { id: 'tapestry_maker', name: 'Tapestry Maker', desc: 'Decorative wall hangings',        baseItems: ['dyed wool', 'silk thread'],         specialtyItems: ['wall tapestry', 'banner', 'heraldic pennant'] },
    { id: 'rope_maker',     name: 'Rope Maker',     desc: 'Rope, twine, cordage',            baseItems: ['hemp', 'flax'],                    specialtyItems: ['hemp rope', 'twine coil', 'net cord', 'bowstring'] },
    { id: 'sail_maker',     name: 'Sail Maker',     desc: 'Ship sails and heavy canvas',     baseItems: ['canvas', 'tar'],                   specialtyItems: ['mainsail', 'jib sail', 'tarpaulin', 'tent panel'] },
    { id: 'blanket_weaver', name: 'Blanket Weaver', desc: 'Blankets and bed coverings',      baseItems: ['wool', 'cotton'],                  specialtyItems: ['wool blanket', 'quilt', 'bedspread', 'throw'] },
    { id: 'basket_weaver',  name: 'Basket Weaver',  desc: 'Wicker baskets and trays',        baseItems: ['willow', 'reed'],                  specialtyItems: ['market basket', 'fish trap', 'grain sieve', 'hamper'] },
    { id: 'rug_weaver',     name: 'Rug Weaver',     desc: 'Floor rugs and mats',             baseItems: ['dyed wool', 'cotton'],              specialtyItems: ['floor rug', 'prayer mat', 'door mat', 'stair runner'] },
    { id: 'silk_weaver',    name: 'Silk Weaver',    desc: 'Fine silk fabrics',               baseItems: ['raw silk', 'dye'],                  specialtyItems: ['silk bolt', 'silk sash', 'silk veil', 'brocade'] },
  ],
  carpenter: [
    { id: 'joiner',         name: 'Joiner',         desc: 'Furniture and cabinetry',         baseItems: ['plank', 'wood glue'],               specialtyItems: ['chair', 'table', 'wardrobe', 'chest'] },
    { id: 'cooper',         name: 'Cooper',         desc: 'Barrels, casks, buckets',         baseItems: ['oak stave', 'iron hoop'],           specialtyItems: ['wine barrel', 'water bucket', 'butter churn', 'rain barrel'] },
    { id: 'wheelwright',    name: 'Wheelwright',    desc: 'Wheels, axles, carts',            baseItems: ['hardwood', 'iron rim'],              specialtyItems: ['cart wheel', 'wheelbarrow', 'spinning wheel', 'pulley'] },
    { id: 'shipwright',     name: 'Shipwright',     desc: 'Boats, keels, masts',             baseItems: ['timber', 'tar', 'iron nail'],       specialtyItems: ['dinghy hull', 'mast spar', 'rudder', 'oar'] },
    { id: 'carver',         name: 'Carver',         desc: 'Decorative woodwork and signs',   baseItems: ['softwood', 'chisel'],               specialtyItems: ['shop sign', 'relief panel', 'figurehead', 'totem'] },
    { id: 'bowyer',         name: 'Bowyer',         desc: 'Bows and crossbows',              baseItems: ['yew', 'sinew', 'horn'],             specialtyItems: ['longbow', 'shortbow', 'crossbow', 'quarrel shaft'] },
    { id: 'turner',         name: 'Turner',         desc: 'Lathe-turned items',              baseItems: ['hardwood'],                         specialtyItems: ['bowl', 'spindle', 'baluster', 'dowel set'] },
    { id: 'coffin_maker',   name: 'Coffin Maker',   desc: 'Coffins and burial goods',       baseItems: ['plank', 'iron nail'],               specialtyItems: ['pine coffin', 'oak casket', 'burial urn stand'] },
    { id: 'scaffolder',     name: 'Scaffolder',     desc: 'Ladders, scaffolds, platforms',   baseItems: ['timber', 'rope'],                   specialtyItems: ['ladder', 'scaffold frame', 'platform plank', 'trestle'] },
  ],
  alchemist: [
    { id: 'apothecary',     name: 'Apothecary',     desc: 'Healing draughts and salves',     baseItems: ['herb', 'oil', 'beeswax'],           specialtyItems: ['healing potion', 'wound salve', 'fever tonic', 'pain balm'] },
    { id: 'poison_brewer',  name: 'Poison Brewer',  desc: 'Toxins and antidotes',            baseItems: ['nightshade', 'venom sac'],          specialtyItems: ['blade poison', 'rat bane', 'antidote', 'sleeping draught'] },
    { id: 'perfumer',       name: 'Perfumer',       desc: 'Fragrances and scented oils',     baseItems: ['flower petal', 'alcohol'],           specialtyItems: ['perfume vial', 'scented oil', 'incense cone', 'potpourri'] },
    { id: 'ink_maker',      name: 'Ink Maker',      desc: 'Inks, dyes, pigments',            baseItems: ['gall nut', 'soot', 'gum'],          specialtyItems: ['black ink', 'colored ink', 'invisible ink', 'seal wax'] },
    { id: 'soap_maker',     name: 'Soap Maker',     desc: 'Soaps and cleansing agents',      baseItems: ['tallow', 'lye', 'ash'],             specialtyItems: ['bar soap', 'soft soap', 'laundry flake', 'tooth powder'] },
    { id: 'pyrotechnist',   name: 'Pyrotechnist',   desc: 'Fireworks and incendiaries',      baseItems: ['sulfur', 'charcoal', 'saltpeter'],  specialtyItems: ['smoke bomb', 'firework', 'flash powder', 'fuse cord'] },
    { id: 'herbalist',      name: 'Herbalist',      desc: 'Dried herbs and teas',            baseItems: ['herb', 'root'],                     specialtyItems: ['tea blend', 'dried herb bundle', 'poultice', 'tincture'] },
    { id: 'distiller',      name: 'Distiller',      desc: 'Essential oils and spirits',      baseItems: ['herb', 'grain', 'water'],           specialtyItems: ['essential oil', 'grain spirit', 'rose water', 'vinegar'] },
  ],
  jeweler: [
    { id: 'goldsmith',      name: 'Goldsmith',      desc: 'Gold rings, chains, brooches',    baseItems: ['gold nugget', 'flux'],              specialtyItems: ['gold ring', 'gold chain', 'brooch', 'tiara'] },
    { id: 'silversmith',    name: 'Silversmith',    desc: 'Silver tableware and jewelry',    baseItems: ['silver ingot', 'polish'],           specialtyItems: ['silver goblet', 'silver pendant', 'candelabra', 'mirror frame'] },
    { id: 'gem_cutter',     name: 'Gem Cutter',     desc: 'Cut and polished gemstones',      baseItems: ['rough gem', 'diamond dust'],         specialtyItems: ['cut ruby', 'polished sapphire', 'faceted emerald', 'opal cabochon'] },
    { id: 'engraver',       name: 'Engraver',       desc: 'Inscriptions and seals',          baseItems: ['metal blank', 'burin'],             specialtyItems: ['signet ring', 'seal stamp', 'name plate', 'memorial plaque'] },
    { id: 'bead_maker',     name: 'Bead Maker',     desc: 'Glass and stone beads',           baseItems: ['glass rod', 'semi-precious stone'], specialtyItems: ['glass bead', 'amber bead', 'prayer bead', 'necklace string'] },
    { id: 'crown_maker',    name: 'Crown Maker',    desc: 'Crowns, circlets, diadems',       baseItems: ['gold ingot', 'gem'],                specialtyItems: ['crown', 'circlet', 'diadem', 'coronet'] },
    { id: 'enameler',       name: 'Enameler',       desc: 'Enameled metalwork',              baseItems: ['copper plate', 'enamel powder'],    specialtyItems: ['enameled box', 'cloisonne pendant', 'enameled buckle'] },
  ],
  glassblower: [
    { id: 'bottle_maker',   name: 'Bottle Maker',   desc: 'Bottles, flasks, vials',          baseItems: ['sand', 'soda ash'],                 specialtyItems: ['wine bottle', 'potion vial', 'ink flask', 'perfume bottle'] },
    { id: 'window_maker',   name: 'Window Maker',   desc: 'Window panes and skylights',      baseItems: ['sand', 'lead strip'],               specialtyItems: ['crown glass pane', 'leaded window', 'skylight panel'] },
    { id: 'lens_grinder',   name: 'Lens Grinder',   desc: 'Lenses and optical instruments',  baseItems: ['crystal glass', 'abrasive'],        specialtyItems: ['magnifying lens', 'spyglass lens', 'spectacle pair'] },
    { id: 'bead_blower',    name: 'Bead Blower',    desc: 'Glass beads and marbles',         baseItems: ['glass rod', 'color frit'],           specialtyItems: ['glass bead set', 'marble bag', 'glass pendant'] },
    { id: 'lamp_blower',    name: 'Lamp Blower',    desc: 'Oil lamp globes and lantern glass', baseItems: ['clear glass', 'wire'],             specialtyItems: ['lamp globe', 'lantern chimney', 'candle shade'] },
    { id: 'mirror_maker',   name: 'Mirror Maker',   desc: 'Mirrors and reflective surfaces', baseItems: ['flat glass', 'tin', 'mercury'],     specialtyItems: ['hand mirror', 'wall mirror', 'shaving glass'] },
    { id: 'vessel_blower',  name: 'Vessel Blower',  desc: 'Drinking glasses and decanters',  baseItems: ['crystal glass'],                    specialtyItems: ['wine glass', 'goblet', 'decanter', 'pitcher'] },
  ],
  dyer: [
    { id: 'cloth_dyer',     name: 'Cloth Dyer',     desc: 'Bolt dyeing for weavers',         baseItems: ['raw cloth', 'dye'],                 specialtyItems: ['dyed linen bolt', 'dyed wool bolt', 'dyed canvas'] },
    { id: 'yarn_dyer',      name: 'Yarn Dyer',      desc: 'Pre-dyed yarns and threads',      baseItems: ['raw yarn', 'mordant'],               specialtyItems: ['dyed wool skein', 'dyed silk thread', 'embroidery floss'] },
    { id: 'leather_dyer',   name: 'Leather Dyer',   desc: 'Colored leather for saddlers',    baseItems: ['cured leather', 'dye'],              specialtyItems: ['dyed leather hide', 'stained belt blank', 'colored strap'] },
    { id: 'pigment_maker',  name: 'Pigment Maker',  desc: 'Raw pigments and paint',          baseItems: ['mineral', 'oil', 'egg yolk'],        specialtyItems: ['ochre pigment', 'lapis pigment', 'vermilion', 'tempera pot'] },
    { id: 'indigo_dyer',    name: 'Indigo Dyer',    desc: 'Deep blue specialist',            baseItems: ['indigo plant', 'lye'],               specialtyItems: ['indigo cloth', 'blue-dyed yarn', 'navy canvas'] },
    { id: 'bleacher',       name: 'Bleacher',       desc: 'Whitening and sun-bleaching',     baseItems: ['raw cloth', 'sulfur', 'urine'],      specialtyItems: ['bleached linen', 'whitened canvas', 'pale parchment'] },
    { id: 'print_dyer',     name: 'Print Dyer',     desc: 'Block-printed patterns on cloth', baseItems: ['cloth bolt', 'wood block', 'dye'],   specialtyItems: ['printed cotton', 'stamped linen', 'patterned silk'] },
  ],
  brewer: [
    { id: 'ale_brewer',     name: 'Ale Brewer',     desc: 'Ales and bitters',                baseItems: ['barley malt', 'hops', 'yeast'],     specialtyItems: ['pale ale', 'bitter ale', 'brown ale', 'mild'] },
    { id: 'mead_maker',     name: 'Mead Maker',     desc: 'Honey wines and metheglins',      baseItems: ['honey', 'water', 'yeast'],          specialtyItems: ['dry mead', 'sweet mead', 'spiced metheglin', 'melomel'] },
    { id: 'wine_maker',     name: 'Wine Maker',     desc: 'Grape and fruit wines',           baseItems: ['grape', 'yeast'],                   specialtyItems: ['red wine', 'white wine', 'fruit wine', 'rosé'] },
    { id: 'cider_maker',    name: 'Cider Maker',    desc: 'Apple and pear ciders',           baseItems: ['apple', 'yeast'],                   specialtyItems: ['dry cider', 'sweet cider', 'perry', 'scrumpy'] },
    { id: 'stout_brewer',   name: 'Stout Brewer',   desc: 'Dark stouts and porters',         baseItems: ['roasted barley', 'hops'],           specialtyItems: ['dry stout', 'milk stout', 'porter', 'imperial stout'] },
    { id: 'vinegar_maker',  name: 'Vinegar Maker',  desc: 'Vinegars and fermented sauces',   baseItems: ['wine', 'mother culture'],           specialtyItems: ['wine vinegar', 'malt vinegar', 'herb vinegar', 'fish sauce'] },
    { id: 'kvass_brewer',   name: 'Kvass Brewer',   desc: 'Bread-based ferments',            baseItems: ['stale bread', 'water', 'yeast'],    specialtyItems: ['rye kvass', 'beet kvass', 'fruit kvass'] },
  ],

  // ── commercial ────────────────────────────────────────────────────────
  market_stall: [
    { id: 'fruit_stall',    name: 'Fruit Stall',    desc: 'Fresh and dried fruits',          baseItems: ['apple', 'pear'],                    specialtyItems: ['apple basket', 'dried fig', 'grape bunch', 'plum bag'] },
    { id: 'vegetable_stall', name: 'Vegetable Stall', desc: 'Root and leaf vegetables',      baseItems: ['carrot', 'onion'],                  specialtyItems: ['turnip bundle', 'cabbage head', 'garlic braid', 'leek bunch'] },
    { id: 'cheese_stall',   name: 'Cheese Stall',   desc: 'Aged and fresh cheeses',          baseItems: ['milk', 'rennet'],                   specialtyItems: ['aged wheel', 'fresh curd', 'smoked round', 'herb cheese'] },
    { id: 'bread_stall',    name: 'Bread Stall',    desc: 'Fresh loaves and rolls',          baseItems: ['flour', 'yeast'],                   specialtyItems: ['wheat loaf', 'rye round', 'seed roll', 'flatbread'] },
    { id: 'meat_stall',     name: 'Meat Stall',     desc: 'Fresh and cured meats',           baseItems: ['carcass', 'salt'],                  specialtyItems: ['sausage link', 'bacon slab', 'smoked ham', 'jerky strip'] },
    { id: 'fish_stall',     name: 'Fish Stall',     desc: 'Fresh and salted fish',           baseItems: ['fresh fish', 'salt'],               specialtyItems: ['smoked trout', 'salted cod', 'pickled herring', 'fish pie'] },
    { id: 'flower_stall',   name: 'Flower Stall',   desc: 'Cut flowers and garlands',        baseItems: ['flower bunch'],                     specialtyItems: ['rose bouquet', 'wildflower posy', 'wreath', 'garland'] },
  ],
  bazaar: [
    { id: 'silk_bazaar',    name: 'Silk Bazaar',    desc: 'Imported silks and fine fabrics',  baseItems: ['silk bolt', 'dye'],                 specialtyItems: ['embroidered silk', 'silk scarf', 'brocade panel', 'damask cloth'] },
    { id: 'spice_bazaar',   name: 'Spice Bazaar',   desc: 'Exotic spices from distant lands', baseItems: ['pepper', 'cinnamon'],              specialtyItems: ['saffron packet', 'cardamom pod', 'star anise', 'vanilla bean'] },
    { id: 'carpet_bazaar',  name: 'Carpet Bazaar',  desc: 'Woven rugs and tapestries',       baseItems: ['dyed wool', 'loom cord'],           specialtyItems: ['prayer rug', 'palace carpet', 'runner rug', 'wall hanging'] },
    { id: 'gem_bazaar',     name: 'Gem Bazaar',     desc: 'Precious and semi-precious stones', baseItems: ['rough gem'],                      specialtyItems: ['polished ruby', 'raw sapphire', 'turquoise chunk', 'lapis block'] },
    { id: 'pottery_bazaar', name: 'Pottery Bazaar', desc: 'Decorated ceramics and porcelain', baseItems: ['fine clay', 'glaze'],              specialtyItems: ['painted vase', 'tea set', 'decorative plate', 'incense burner'] },
    { id: 'perfume_bazaar', name: 'Perfume Bazaar', desc: 'Attars and fragrant oils',         baseItems: ['flower extract', 'oil'],            specialtyItems: ['rose attar', 'sandalwood oil', 'musk vial', 'amber resin'] },
    { id: 'weapon_bazaar',  name: 'Weapon Bazaar',  desc: 'Exotic arms from afar',           baseItems: ['foreign steel'],                    specialtyItems: ['curved sword', 'throwing knife', 'war fan', 'foreign bow'] },
  ],
  shop: [
    { id: 'general_store',  name: 'General Store',  desc: 'Sundries and household goods',    baseItems: ['candle', 'soap', 'rope'],           specialtyItems: ['candle box', 'lamp oil', 'sewing kit', 'writing set'] },
    { id: 'clothier',       name: 'Clothier',       desc: 'Ready-made garments',             baseItems: ['cloth bolt', 'thread'],              specialtyItems: ['tunic', 'trousers', 'cloak', 'dress'] },
    { id: 'chandler',       name: 'Chandler',       desc: 'Candles, wax, lamp oil',          baseItems: ['beeswax', 'tallow', 'wick'],        specialtyItems: ['beeswax candle', 'tallow candle', 'lamp oil flask'] },
    { id: 'spice_merchant', name: 'Spice Merchant', desc: 'Exotic spices and seasonings',    baseItems: ['pepper', 'salt', 'saffron'],        specialtyItems: ['pepper sack', 'cinnamon bundle', 'nutmeg', 'clove packet'] },
    { id: 'herbseller',     name: 'Herb Seller',    desc: 'Medicinal and culinary herbs',    baseItems: ['herb bundle'],                      specialtyItems: ['sage bundle', 'rosemary bunch', 'thyme bunch', 'lavender'] },
    { id: 'bookshop',       name: 'Bookshop',       desc: 'Books, maps, scrolls',            baseItems: ['paper', 'ink'],                     specialtyItems: ['journal', 'almanac', 'map scroll', 'prayer book'] },
    { id: 'curiosity_shop', name: 'Curiosity Shop', desc: 'Oddities and rarities',           baseItems: [],                                   specialtyItems: ['ancient coin', 'strange fossil', 'puzzle box', 'crystal shard'] },
    { id: 'provisioner',    name: 'Provisioner',    desc: 'Travel supplies and rations',     baseItems: ['dried meat', 'hardtack'],            specialtyItems: ['ration pack', 'waterskin', 'tinderbox', 'bedroll'] },
  ],
  inn: [
    { id: 'wayfarers_rest', name: "Wayfarer's Rest", desc: 'Budget lodging for travelers',   baseItems: ['straw', 'blanket'],                 specialtyItems: ['straw bed', 'warm meal', 'stable stall'] },
    { id: 'merchants_lodge', name: "Merchant's Lodge", desc: 'Secure rooms with strongboxes', baseItems: ['iron lock', 'candle'],              specialtyItems: ['private room', 'strongbox', 'courier service'] },
    { id: 'pilgrims_hostel', name: "Pilgrim's Hostel", desc: 'Religious travelers welcome',   baseItems: ['bread', 'water'],                  specialtyItems: ['dormitory bed', 'prayer room', 'blessing scroll'] },
    { id: 'coaching_inn',   name: 'Coaching Inn',   desc: 'Horse relay and carriage stop',   baseItems: ['hay', 'grain'],                     specialtyItems: ['fresh horse', 'carriage repair', 'route map'] },
    { id: 'luxury_inn',     name: 'Luxury Inn',     desc: 'Fine rooms and private dining',   baseItems: ['linen', 'wine'],                    specialtyItems: ['feather bed', 'private bath', 'fine wine', 'butler service'] },
    { id: 'roadside_inn',   name: 'Roadside Inn',   desc: 'Quick stop with hot food',        baseItems: ['firewood', 'flour'],                specialtyItems: ['stew bowl', 'ale mug', 'bench seat', 'hitching post'] },
  ],
  tavern: [
    { id: 'ale_house',      name: 'Ale House',      desc: 'Cheap ale and loud company',      baseItems: ['barrel ale', 'mug'],                specialtyItems: ['house ale', 'nut bowl', 'bread basket'] },
    { id: 'wine_bar',       name: 'Wine Bar',       desc: 'Fine wines and quiet corners',    baseItems: ['wine bottle', 'goblet'],            specialtyItems: ['vintage red', 'white wine', 'cheese platter'] },
    { id: 'gambling_den',   name: 'Gambling Den',   desc: 'Cards, dice, and high stakes',    baseItems: ['dice set', 'card deck'],             specialtyItems: ['dice game', 'card table', 'betting chip', 'fortune card'] },
    { id: 'music_hall',     name: 'Music Hall',     desc: 'Live entertainment nightly',      baseItems: ['ale', 'bench'],                     specialtyItems: ['stage seat', 'song request', 'bard tip jar'] },
    { id: 'fight_pit',      name: 'Fight Pit',      desc: 'Bare-knuckle bouts and bets',    baseItems: ['ale', 'sawdust'],                   specialtyItems: ['ring seat', 'fight wager', 'healing draught'] },
    { id: 'smoke_house',    name: 'Smoke House',    desc: 'Pipe tobacco and hookah',         baseItems: ['pipe tobacco', 'hookah coal'],       specialtyItems: ['clay pipe', 'tobacco pouch', 'hookah session'] },
    { id: 'mead_hall',      name: 'Mead Hall',      desc: 'Mead by the horn, feasting',      baseItems: ['mead', 'roast meat'],               specialtyItems: ['mead horn', 'feast plate', 'drinking game'] },
  ],
  trading_post: [
    { id: 'fur_trader',     name: 'Fur Trader',     desc: 'Pelts and furs from the wild',    baseItems: ['raw pelt', 'trap'],                  specialtyItems: ['beaver pelt', 'fox fur', 'wolf skin', 'bear hide'] },
    { id: 'grain_dealer',   name: 'Grain Dealer',   desc: 'Bulk grain and seed',             baseItems: ['wheat sack', 'barley sack'],         specialtyItems: ['seed wheat', 'feed barley', 'milling grain', 'oat bundle'] },
    { id: 'timber_broker',  name: 'Timber Broker',  desc: 'Logs, planks, lumber',            baseItems: ['raw log', 'plank'],                  specialtyItems: ['oak beam', 'pine plank', 'cedar post', 'maple board'] },
    { id: 'ore_trader',     name: 'Ore Trader',     desc: 'Raw ores and metals',             baseItems: ['iron ore', 'copper ore'],             specialtyItems: ['tin ore', 'silver ore', 'gold dust', 'coal sack'] },
    { id: 'salt_trader',    name: 'Salt Trader',    desc: 'Salt by the block and barrel',    baseItems: ['salt block'],                        specialtyItems: ['table salt', 'curing salt', 'rock salt', 'salt lick'] },
    { id: 'livestock_dealer', name: 'Livestock Dealer', desc: 'Animals for work and food',   baseItems: [],                                    specialtyItems: ['draft horse', 'milk cow', 'laying hen', 'guard dog'] },
    { id: 'exotic_trader',  name: 'Exotic Trader',  desc: 'Foreign luxuries and curios',     baseItems: ['silk', 'spice'],                     specialtyItems: ['jade figurine', 'silk bolt', 'ivory comb', 'foreign coin'] },
  ],
  warehouse: [
    { id: 'grain_warehouse', name: 'Grain Warehouse', desc: 'Bulk grain storage',            baseItems: ['grain sack'],                        specialtyItems: ['stored wheat', 'stored barley', 'stored oats'] },
    { id: 'cold_store',     name: 'Cold Store',     desc: 'Ice-cooled perishables',          baseItems: ['ice block', 'straw'],                specialtyItems: ['salted meat', 'chilled butter', 'preserved fish'] },
    { id: 'bonded_warehouse', name: 'Bonded Warehouse', desc: 'Tax-sealed trade goods',      baseItems: ['seal', 'ledger'],                    specialtyItems: ['bonded wine cask', 'taxed spice chest', 'duty receipt'] },
    { id: 'lumber_yard',    name: 'Lumber Yard',    desc: 'Timber drying and storage',       baseItems: ['raw log'],                           specialtyItems: ['seasoned plank', 'dried beam', 'kiln-dried board'] },
    { id: 'arsenal',        name: 'Arsenal',        desc: 'Military supply depot',           baseItems: ['iron ingot', 'bowstring'],            specialtyItems: ['arrow bundle', 'spear rack', 'shield stack', 'armor crate'] },
    { id: 'trade_depot',    name: 'Trade Depot',    desc: 'Caravan loading and unloading',   baseItems: ['crate', 'rope'],                     specialtyItems: ['packed crate', 'manifest scroll', 'cargo net'] },
  ],

  // ── religious ─────────────────────────────────────────────────────────
  shrine: [
    { id: 'ancestor_shrine', name: 'Ancestor Shrine', desc: 'Veneration of the dead',       baseItems: ['incense', 'offering bowl'],          specialtyItems: ['ancestor token', 'memory candle', 'spirit bell'] },
    { id: 'nature_shrine',  name: 'Nature Shrine',  desc: 'Spirits of wood and water',      baseItems: ['garland', 'spring water'],            specialtyItems: ['moss wreath', 'river stone', 'acorn offering'] },
    { id: 'war_shrine',     name: 'War Shrine',     desc: 'Blessings before battle',        baseItems: ['weapon oil', 'red cloth'],            specialtyItems: ['war prayer', 'blood vow', 'victory token'] },
    { id: 'harvest_shrine', name: 'Harvest Shrine', desc: 'Fertility and abundance',        baseItems: ['grain sheaf', 'fruit'],               specialtyItems: ['corn dolly', 'seed blessing', 'rain prayer'] },
    { id: 'healer_shrine',  name: 'Healer Shrine',  desc: 'Prayers for the sick',           baseItems: ['herb', 'clean water'],                specialtyItems: ['healing prayer', 'cure token', 'blessed bandage'] },
  ],
  chapel: [
    { id: 'sun_chapel',     name: 'Sun Chapel',     desc: 'Dawn prayers and light',         baseItems: ['candle', 'gold leaf'],                specialtyItems: ['sun medallion', 'dawn prayer', 'light blessing'] },
    { id: 'moon_chapel',    name: 'Moon Chapel',    desc: 'Night vigils and prophecy',      baseItems: ['silver dust', 'mirror'],              specialtyItems: ['moon talisman', 'dream reading', 'tide blessing'] },
    { id: 'earth_chapel',   name: 'Earth Chapel',   desc: 'Stone and root worship',         baseItems: ['carved stone', 'root'],               specialtyItems: ['earth token', 'stone blessing', 'ground prayer'] },
    { id: 'storm_chapel',   name: 'Storm Chapel',   desc: 'Thunder gods and sky worship',   baseItems: ['iron rod', 'feather'],                specialtyItems: ['storm prayer', 'sky blessing', 'thunder rune'] },
    { id: 'flame_chapel',   name: 'Flame Chapel',   desc: 'Eternal flame and purification', baseItems: ['oil', 'flint'],                       specialtyItems: ['purification rite', 'flame blessing', 'ember vial'] },
    { id: 'sea_chapel',     name: 'Sea Chapel',     desc: 'Mariners and fisher-folk',       baseItems: ['salt', 'shell'],                      specialtyItems: ['safe voyage prayer', 'sea blessing', 'coral charm'] },
  ],
  temple: [
    { id: 'sun_temple',     name: 'Sun Temple',     desc: 'Grand solar worship',            baseItems: ['gold', 'incense', 'oil'],             specialtyItems: ['sun crown', 'solar calendar', 'dawn ritual'] },
    { id: 'death_temple',   name: 'Death Temple',   desc: 'Funerary rites and ancestor spirits', baseItems: ['myrrh', 'linen wrap'],           specialtyItems: ['funeral rite', 'spirit ward', 'bone relic'] },
    { id: 'war_temple',     name: 'War Temple',     desc: 'Martial blessings and oaths',    baseItems: ['weapon', 'red banner'],               specialtyItems: ['war blessing', 'oath of valor', 'champion crown'] },
    { id: 'wisdom_temple',  name: 'Wisdom Temple',  desc: 'Scholarship and archives',       baseItems: ['scroll', 'ink', 'lamp'],              specialtyItems: ['wisdom scroll', 'teaching session', 'archive pass'] },
    { id: 'nature_temple',  name: 'Nature Temple',  desc: 'Sacred groves within walls',     baseItems: ['sapling', 'spring water'],             specialtyItems: ['growth blessing', 'beast ward', 'seed vault'] },
    { id: 'forge_temple',   name: 'Forge Temple',   desc: 'Sacred smithing and creation',   baseItems: ['sacred metal', 'fire coal'],           specialtyItems: ['holy blade', 'blessed anvil rite', 'craft blessing'] },
    { id: 'sea_temple',     name: 'Sea Temple',     desc: 'Tides, navigation, and storms',  baseItems: ['coral', 'pearl', 'salt'],              specialtyItems: ['tide blessing', 'navigation chart', 'storm ward'] },
  ],
  monastery: [
    { id: 'scriptorium',    name: 'Scriptorium',    desc: 'Manuscript copying and illumination', baseItems: ['parchment', 'ink', 'gold leaf'],  specialtyItems: ['illuminated page', 'copied text', 'bound codex'] },
    { id: 'brewing_abbey',  name: 'Brewing Abbey',  desc: 'Monastic ales and liqueurs',     baseItems: ['barley', 'hops', 'herb'],             specialtyItems: ['abbey ale', 'herbal liqueur', 'medicinal tonic'] },
    { id: 'healing_order',  name: 'Healing Order',  desc: 'Sick-care and herb gardens',     baseItems: ['herb', 'linen', 'honey'],             specialtyItems: ['herbal cure', 'healing poultice', 'convalescent bed'] },
    { id: 'contemplative',  name: 'Contemplative',  desc: 'Silent meditation and prayer',   baseItems: ['candle', 'incense'],                  specialtyItems: ['meditation cell', 'prayer vigil', 'silence vow'] },
    { id: 'martial_order',  name: 'Martial Order',  desc: 'Warrior-monks and training',     baseItems: ['training staff', 'armor'],             specialtyItems: ['combat training', 'blessed weapon', 'crusade vow'] },
    { id: 'teaching_order', name: 'Teaching Order', desc: 'Schools for children and scholars', baseItems: ['book', 'slate', 'chalk'],          specialtyItems: ['lesson plan', 'reading primer', 'scholar certificate'] },
  ],
  oracle_chamber: [
    { id: 'seer',           name: 'Seer',           desc: 'Visions of the future',          baseItems: ['crystal', 'smoke herb'],              specialtyItems: ['prophecy scroll', 'vision draught', 'fate reading'] },
    { id: 'dream_reader',   name: 'Dream Reader',   desc: 'Interpretation of dreams',       baseItems: ['sleep herb', 'journal'],              specialtyItems: ['dream journal', 'sleep tea', 'nightmare ward'] },
    { id: 'bone_reader',    name: 'Bone Reader',    desc: 'Divination through bones',       baseItems: ['animal bone', 'cloth'],               specialtyItems: ['casting bones', 'omen reading', 'fate token'] },
    { id: 'star_gazer',     name: 'Star Gazer',     desc: 'Astrology and celestial signs',  baseItems: ['star chart', 'lens'],                  specialtyItems: ['horoscope scroll', 'celestial map', 'eclipse warning'] },
    { id: 'spirit_medium',  name: 'Spirit Medium',  desc: 'Communion with the departed',    baseItems: ['incense', 'bell', 'mirror'],          specialtyItems: ['seance session', 'spirit message', 'ghost ward'] },
  ],

  // ── military ──────────────────────────────────────────────────────────
  barracks: [
    { id: 'infantry_post',  name: 'Infantry Post',  desc: 'Foot soldiers and pike drill',   baseItems: ['spear', 'shield'],                    specialtyItems: ['pike', 'short sword', 'buckler', 'marching pack'] },
    { id: 'cavalry_post',   name: 'Cavalry Post',   desc: 'Mounted troops and horse care',  baseItems: ['lance', 'saddle'],                    specialtyItems: ['war horse', 'lance', 'cavalry saber', 'barding'] },
    { id: 'archer_post',    name: 'Archer Post',    desc: 'Bowmen and fletcher station',    baseItems: ['bow', 'arrow bundle'],                specialtyItems: ['longbow', 'crossbow', 'bodkin arrow', 'broadhead'] },
    { id: 'scout_post',     name: 'Scout Post',     desc: 'Rangers and reconnaissance',     baseItems: ['short bow', 'rope'],                  specialtyItems: ['spyglass', 'signal flag', 'climbing gear', 'trail ration'] },
    { id: 'siege_post',     name: 'Siege Post',     desc: 'Engineers and siege operators',  baseItems: ['rope', 'timber'],                     specialtyItems: ['battering ram part', 'siege ladder', 'catapult arm'] },
    { id: 'garrison',       name: 'Garrison',       desc: 'Town watch and guard rotation',  baseItems: ['short sword', 'torch'],               specialtyItems: ['guard badge', 'watch lantern', 'patrol map', 'whistle'] },
  ],
  armory: [
    { id: 'blade_armory',   name: 'Blade Armory',   desc: 'Swords and edged weapons',       baseItems: ['sword blank', 'whetstone'],            specialtyItems: ['longsword', 'broadsword', 'scimitar', 'falchion'] },
    { id: 'ranged_armory',  name: 'Ranged Armory',  desc: 'Bows, crossbows, ammunition',    baseItems: ['bow stave', 'string'],                 specialtyItems: ['composite bow', 'heavy crossbow', 'arrow sheaf'] },
    { id: 'armor_depot',    name: 'Armor Depot',    desc: 'Plate, mail, and helmets',       baseItems: ['iron plate', 'chain link'],             specialtyItems: ['full plate set', 'chain hauberk', 'great helm'] },
    { id: 'shield_depot',   name: 'Shield Depot',   desc: 'Shields and bucklers',           baseItems: ['wood blank', 'iron boss'],              specialtyItems: ['kite shield', 'round shield', 'tower shield', 'buckler'] },
    { id: 'polearm_armory', name: 'Polearm Armory', desc: 'Spears, halberds, pikes',        baseItems: ['ash shaft', 'iron head'],               specialtyItems: ['halberd', 'glaive', 'war pike', 'partisan'] },
  ],
  training_ground: [
    { id: 'sparring_yard',  name: 'Sparring Yard',  desc: 'Melee combat practice',         baseItems: ['practice sword', 'padded armor'],      specialtyItems: ['sparring match', 'footwork drill', 'form lesson'] },
    { id: 'archery_range',  name: 'Archery Range',  desc: 'Marksmanship training',          baseItems: ['target butt', 'practice arrow'],       specialtyItems: ['accuracy drill', 'speed shoot', 'moving target'] },
    { id: 'obstacle_course', name: 'Obstacle Course', desc: 'Agility and endurance',        baseItems: ['rope', 'timber wall'],                  specialtyItems: ['climbing drill', 'sprint trial', 'endurance march'] },
    { id: 'jousting_list',  name: 'Jousting List',  desc: 'Mounted combat tournaments',    baseItems: ['jousting lance', 'barrier'],            specialtyItems: ['tilt match', 'melee tourney', 'champion purse'] },
    { id: 'drill_square',   name: 'Drill Square',   desc: 'Formation marching and discipline', baseItems: ['drum', 'banner'],                  specialtyItems: ['formation drill', 'parade review', 'discipline march'] },
  ],

  // ── agricultural ──────────────────────────────────────────────────────
  mill: [
    { id: 'grain_mill',     name: 'Grain Mill',     desc: 'Wheat and barley grinding',       baseItems: ['millstone', 'grain sack'],             specialtyItems: ['fine flour', 'coarse meal', 'bran'] },
    { id: 'lumber_mill',    name: 'Lumber Mill',    desc: 'Log sawing and plank cutting',    baseItems: ['saw blade', 'raw log'],                specialtyItems: ['plank', 'beam', 'shingle', 'sawdust'] },
    { id: 'olive_press',    name: 'Olive Press',    desc: 'Oil pressing',                   baseItems: ['olive', 'press stone'],                 specialtyItems: ['olive oil', 'lamp oil', 'soap oil'] },
    { id: 'fulling_mill',   name: 'Fulling Mill',   desc: 'Cloth finishing and felting',     baseItems: ['raw cloth', 'fuller earth'],             specialtyItems: ['fulled wool', 'felted cloth', 'finished linen'] },
    { id: 'paper_mill',     name: 'Paper Mill',     desc: 'Paper from rags and pulp',       baseItems: ['rag', 'water'],                         specialtyItems: ['writing paper', 'blotting paper', 'card stock'] },
  ],
  stable: [
    { id: 'riding_stable',  name: 'Riding Stable',  desc: 'Saddle horses for hire',         baseItems: ['hay', 'oats'],                          specialtyItems: ['riding horse', 'saddle', 'horse blanket'] },
    { id: 'draft_stable',   name: 'Draft Stable',   desc: 'Work horses and oxen',           baseItems: ['hay', 'grain'],                          specialtyItems: ['draft horse', 'ox pair', 'plow harness'] },
    { id: 'breeding_stable', name: 'Breeding Stable', desc: 'Bloodlines and foals',         baseItems: ['premium feed', 'straw'],                  specialtyItems: ['stud service', 'foal', 'pedigree scroll'] },
    { id: 'courier_relay',  name: 'Courier Relay',  desc: 'Fresh horses for messengers',    baseItems: ['grain', 'water'],                        specialtyItems: ['relay horse', 'dispatch bag', 'route token'] },
    { id: 'farrier_shop',   name: 'Farrier Shop',   desc: 'Shoeing and hoof care',          baseItems: ['horseshoe', 'nail'],                     specialtyItems: ['hot shoe', 'hoof trim', 'leg wrap'] },
  ],

  // ── civic ─────────────────────────────────────────────────────────────
  library: [
    { id: 'public_library', name: 'Public Library', desc: 'Open stacks for all',            baseItems: ['book', 'shelf'],                        specialtyItems: ['reading pass', 'loaner book', 'story hour'] },
    { id: 'archive',        name: 'Archive',        desc: 'Historical records and deeds',   baseItems: ['scroll case', 'wax seal'],               specialtyItems: ['land deed copy', 'genealogy record', 'tax roll'] },
    { id: 'map_room',       name: 'Map Room',       desc: 'Cartography and surveys',        baseItems: ['parchment', 'compass'],                  specialtyItems: ['regional map', 'survey plat', 'nautical chart'] },
    { id: 'rare_books',     name: 'Rare Books',     desc: 'Valuable manuscripts and tomes', baseItems: ['preservation oil', 'linen glove'],       specialtyItems: ['illuminated manuscript', 'first edition', 'ancient scroll'] },
    { id: 'scriptorium',    name: 'Scriptorium',    desc: 'Copying and translation',        baseItems: ['ink', 'quill', 'parchment'],              specialtyItems: ['fresh copy', 'translation folio', 'calligraphy page'] },
  ],
  school: [
    { id: 'grammar_school', name: 'Grammar School', desc: 'Reading, writing, arithmetic',   baseItems: ['slate', 'chalk', 'primer'],               specialtyItems: ['reading lesson', 'writing lesson', 'math lesson'] },
    { id: 'trade_school',   name: 'Trade School',   desc: 'Apprenticeship coordination',    baseItems: ['tool set', 'manual'],                      specialtyItems: ['apprenticeship', 'journeyman cert', 'master exam'] },
    { id: 'academy',        name: 'Academy',        desc: 'Advanced studies and philosophy', baseItems: ['book', 'ink', 'candle'],                   specialtyItems: ['lecture pass', 'thesis defense', 'scholar robe'] },
    { id: 'war_college',    name: 'War College',    desc: 'Officer training and strategy',  baseItems: ['map', 'sand table'],                       specialtyItems: ['tactics seminar', 'strategy map', 'commission scroll'] },
    { id: 'music_school',   name: 'Music School',   desc: 'Instrument and vocal training',  baseItems: ['sheet music', 'tuning fork'],               specialtyItems: ['lute lesson', 'voice lesson', 'recital ticket'] },
  ],

  // ── entertainment ─────────────────────────────────────────────────────
  theater: [
    { id: 'comedy_theater', name: 'Comedy Theater', desc: 'Farces and satire',              baseItems: ['mask', 'costume'],                         specialtyItems: ['comedy ticket', 'jest collection', 'patron seat'] },
    { id: 'tragedy_theater', name: 'Tragedy Theater', desc: 'Drama and epic tales',         baseItems: ['mask', 'stage prop'],                       specialtyItems: ['drama ticket', 'playbill', 'box seat'] },
    { id: 'puppet_theater', name: 'Puppet Theater', desc: 'Marionettes and shadow plays',   baseItems: ['puppet', 'screen'],                         specialtyItems: ['puppet show ticket', 'shadow play', 'marionette'] },
    { id: 'opera_house',    name: 'Opera House',    desc: 'Vocal performances',             baseItems: ['libretto', 'costume'],                      specialtyItems: ['opera ticket', 'aria sheet', 'patron box'] },
    { id: 'amphitheater',   name: 'Amphitheater',   desc: 'Open-air performances',          baseItems: ['bench', 'torch'],                           specialtyItems: ['open-air ticket', 'festival seat', 'sunset show'] },
  ],
  feast_hall: [
    { id: 'lords_hall',     name: "Lord's Hall",    desc: 'Noble feasting and politics',    baseItems: ['fine plate', 'silver cup'],                  specialtyItems: ['feast invitation', 'wine course', 'roast platter'] },
    { id: 'guild_hall',     name: 'Guild Hall',     desc: 'Trade guild meetings and meals', baseItems: ['guild banner', 'table'],                     specialtyItems: ['guild feast', 'apprentice meal', 'master banquet'] },
    { id: 'harvest_hall',   name: 'Harvest Hall',   desc: 'Seasonal celebrations',          baseItems: ['garland', 'barrel'],                         specialtyItems: ['harvest feast', 'bonfire seat', 'cider toast'] },
    { id: 'veterans_hall',  name: "Veteran's Hall", desc: 'Retired soldiers and stories',   baseItems: ['ale', 'trophy'],                              specialtyItems: ['war story', 'memorial toast', 'badge ceremony'] },
    { id: 'wedding_hall',   name: 'Wedding Hall',   desc: 'Marriage ceremonies and banquets', baseItems: ['flower', 'candle', 'cake'],                specialtyItems: ['wedding feast', 'handfasting rite', 'toast cup'] },
  ],
};

// ── Brand name parts ────────────────────────────────────────────────────

export const BRAND_PARTS = {
  prefixes: [
    'Iron',      'Golden',    'Silver',    'Crimson',   'Old',       'Stone',
    'Ember',     'Copper',    'Ash',       'Frost',     'Storm',     'Oak',
    'Raven',     'Wolf',      'Bear',      'Hawk',      'Stag',      'Fox',
    'Thorn',     'Moss',      'Briar',     'Flint',     'Dusk',      'Dawn',
    'Forge',     'Steel',     'Bronze',    'Jade',      'Amber',     'Onyx',
    'Red',       'White',     'Black',     'Grey',      'Blue',      'Green',
    'Bright',    'Dark',      'Swift',     'Bold',      'True',      'High',
    'Deep',      'Wild',      'Far',       'Still',     'Keen',      'Grim',
    'Crown',     'Hearth',    'Rose',      'Ivy',       'Sage',      'Wren',
    'Hollow',    'Ridge',     'Marsh',     'Glen',      'Crest',     'Vale',
    'North',     'South',     'East',      'West',      'Moon',      'Sun',
    'Star',      'Cloud',     'Wind',      'Rain',      'Spark',     'Flame',
  ],
  suffixes: [
    'forge',     'works',     'hearth',    'anvil',     'hammer',    'craft',
    'house',     'hall',      'den',       'nest',      'keep',      'gate',
    'well',      'spring',    'brook',     'stone',     'bark',      'leaf',
    'horn',      'claw',      'fang',      'wing',      'hide',      'bone',
    'ward',      'watch',     'hold',      'rest',      'haven',     'harbor',
    'court',     'yard',      'field',     'grove',     'wood',      'dale',
    'bend',      'crossing',  'bridge',    'tower',     'spire',     'wall',
    'mark',      'brand',     'sign',      'seal',      'crown',     'helm',
    'song',      'bell',      'drum',      'pipe',      'loom',      'wheel',
    'plow',      'mill',      'kiln',      'still',     'press',     'vat',
    'root',      'thorn',     'bloom',     'vine',      'seed',      'bough',
    'flame',     'glow',      'spark',     'ash',       'drift',     'tide',
  ],
  titles: [
    'The',  'Ye Olde', 'Master',  'Grand',  'Royal',   'Ancient',
    'Noble', 'Honest',  'Fabled',  'Lucky',  'Blessed', 'Sturdy',
  ],
};

// ── Settlement name generation ──────────────────────────────────────────

const PLACE_SUFFIXES = [
  'haven', 'hold', 'stead', 'ford', 'gate', 'bridge', 'field', 'dale',
  'vale', 'glen', 'crest', 'ridge', 'brook', 'spring', 'well', 'tower',
  'keep', 'watch', 'harbor', 'port', 'bury', 'worth', 'ton', 'wick',
  'ham', 'minster', 'mouth', 'fell', 'moor', 'march', 'crossing',
];

/** Generate a deterministic settlement name. Pure f(seed, x, y). */
export function generateSettlementName(seed, x, y) {
  const h = mix(seed, x * 9001, y * 7013, 0xCC01);
  const prefixes = BRAND_PARTS.prefixes;
  const pi = Math.floor(rand(h, 0xCC02) * prefixes.length);
  const si = Math.floor(rand(h, 0xCC03) * PLACE_SUFFIXES.length);
  return prefixes[pi] + PLACE_SUFFIXES[si];
}

// ── Settlement composition by tier ──────────────────────────────────────

const COMPOSITION = {
  homestead: {
    residential: 2, craft: 1, commercial: 0, agricultural: 1,
    religious: 0, civic: 0, military: 0, entertainment: 0,
    infrastructure: 0,
  },
  hamlet: {
    residential: 4, craft: 2, commercial: 1, agricultural: 1,
    religious: 1, civic: 0, military: 0, entertainment: 0,
    infrastructure: 0,
  },
  village: {
    residential: 6, craft: 3, commercial: 2, agricultural: 2,
    religious: 1, civic: 0, military: 0, entertainment: 0,
    infrastructure: 1,
  },
  township: {
    residential: 10, craft: 5, commercial: 4, agricultural: 3,
    religious: 2, civic: 1, military: 0, entertainment: 0,
    infrastructure: 2,
  },
  town: {
    residential: 14, craft: 7, commercial: 6, agricultural: 4,
    religious: 3, civic: 3, military: 2, entertainment: 1,
    infrastructure: 3,
  },
  borough: {
    residential: 22, craft: 10, commercial: 8, agricultural: 5,
    religious: 4, civic: 4, military: 3, entertainment: 3,
    infrastructure: 5,
  },
  city: {
    residential: 30, craft: 15, commercial: 12, agricultural: 8,
    religious: 6, civic: 5, military: 6, entertainment: 5,
    infrastructure: 8,
  },
  great_city: {
    residential: 50, craft: 22, commercial: 18, agricultural: 12,
    religious: 10, civic: 8, military: 10, entertainment: 8,
    infrastructure: 12,
  },
  capital: {
    residential: 75, craft: 30, commercial: 25, agricultural: 15,
    religious: 14, civic: 12, military: 14, entertainment: 12,
    infrastructure: 16,
  },
  metropolis: {
    residential: 110, craft: 40, commercial: 35, agricultural: 18,
    religious: 18, civic: 16, military: 18, entertainment: 18,
    infrastructure: 22,
  },
  megacity: {
    residential: 160, craft: 55, commercial: 50, agricultural: 22,
    religious: 24, civic: 22, military: 24, entertainment: 25,
    infrastructure: 28,
  },
  world_capital: {
    residential: 220, craft: 75, commercial: 70, agricultural: 28,
    religious: 30, civic: 30, military: 30, entertainment: 35,
    infrastructure: 35,
  },
};

/**
 * How many buildings of each category a settlement at this tier should have.
 * Homestead ~4, Village ~15, Town ~43, City ~95, World Capital ~553.
 * @param {string} tier  One of TIER_NAMES
 * @returns {{ [category: string]: number }}
 */
export function compositionForTier(tier) {
  return { ...(COMPOSITION[tier] ?? COMPOSITION.village) };
}

// ── Deterministic brand generation ──────────────────────────────────────

/**
 * Generate a deterministic brand name and owner hash for a building.
 * @param {number} seed
 * @param {string} typeId   e.g. 'blacksmith'
 * @param {string} specId   e.g. 'weaponsmith'
 * @returns {{ name: string, owner: string }}
 */
export function generateBrand(seed, typeId, specId) {
  const h = mix(seed, hashStr(typeId), hashStr(specId), 0xBEEF);
  const prefixes = BRAND_PARTS.prefixes;
  const suffixes = BRAND_PARTS.suffixes;
  const titles   = BRAND_PARTS.titles;

  const pi = Math.floor(rand(h, 0xAA01) * prefixes.length);
  const si = Math.floor(rand(h, 0xAA02) * suffixes.length);
  const useTitle = rand(h, 0xAA03) < 0.3;
  const ti = Math.floor(rand(h, 0xAA04) * titles.length);

  const core = `${prefixes[pi]}${suffixes[si]}`;
  const name = useTitle ? `${titles[ti]} ${core}` : core;

  // Owner: deterministic hash as hex stub (placeholder for real NPC system)
  const ownerHash = mix(h, 0xDEAD).toString(16).padStart(8, '0');

  return { name, owner: ownerHash };
}

// ── Inventory generation ────────────────────────────────────────────────

/**
 * Generate base + specialty inventory for a specialization.
 * @param {number} seed
 * @param {{ baseItems: string[], specialtyItems: string[] }} spec
 * @returns {{ base: string[], specialty: string[] }}
 */
export function generateInventory(seed, spec) {
  const base = [...(spec.baseItems ?? [])];
  // Pick 2-4 specialty items deterministically
  const all = spec.specialtyItems ?? [];
  const count = Math.min(all.length, 2 + Math.floor(rand(seed, 0xCC01) * 3));
  const specialty = [];
  const picked = new Set();
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(rand(seed, 0xCC02, i) * all.length);
    let tries = 0;
    while (picked.has(idx) && tries < all.length) { idx = (idx + 1) % all.length; tries++; }
    if (!picked.has(idx)) { picked.add(idx); specialty.push(all[idx]); }
  }
  return { base, specialty };
}

// ── Building specialization ─────────────────────────────────────────────

/**
 * Assign specialization, brand, owner, and inventory to a building.
 * Uses communitySpecializations to avoid duplicate niches in small settlements.
 *
 * @param {number} seed
 * @param {string} typeId                  Building type id from taxonomy
 * @param {'village'|'town'|'city'} tier
 * @param {Set<string>} communitySpecializations  Already-assigned spec ids in this settlement
 * @returns {{ specialization: object|null, brand: { name: string, owner: string }, owner: string, inventory: { base: string[], specialty: string[] } }}
 */
export function specializeBuilding(seed, typeId, tier, communitySpecializations) {
  const specs = SPECIALIZATIONS[typeId];
  if (!specs || specs.length === 0) {
    // No specializations for this type (residential, infrastructure, etc.)
    return { specialization: null, inventory: { base: [], specialty: [] } };
  }

  const h = mix(seed, hashStr(typeId), 0xF001);

  // Filter out already-used specializations:
  // small settlements (homestead-village): strict unique
  // mid (township-borough): allow overlap when niches exhausted
  // large (city+): allow multiple vendors of the same niche
  const tierNum = { homestead: 1, hamlet: 2, village: 3, township: 4, town: 5,
    borough: 6, city: 7, great_city: 8, capital: 9, metropolis: 10,
    megacity: 11, world_capital: 12 }[tier] ?? 3;
  let available = specs;
  if (tierNum <= 3) {
    const filtered = specs.filter(s => !communitySpecializations.has(s.id));
    if (filtered.length > 0) available = filtered;
  } else if (tierNum <= 6) {
    const filtered = specs.filter(s => !communitySpecializations.has(s.id));
    if (filtered.length > 0) available = filtered;
    // Mid-tier: allow overlap only when all niches are exhausted
  }
  // Large settlements (city+): no filtering, allow multiple vendors

  // Pick deterministically
  const idx = Math.floor(rand(h, 0xF002) * available.length);
  const spec = available[idx];

  communitySpecializations.add(spec.id);

  const inventory = generateInventory(mix(seed, 0xF003), spec);

  return { specialization: spec, inventory };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Simple string -> int32 hash for seeding. */
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
