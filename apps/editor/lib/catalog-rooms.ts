import type { AssetInput } from '@pascal-app/core'
import type { FunctionTreeNode } from '@pascal-app/editor'
import { CATALOG_KO_NAMES } from './catalog-ko-names'

/**
 * inZOI-style catalog browse: rooms first (the top tabs), then the kind of
 * object within the room (the chip row). Items are filed by catalog id; an
 * id missing here (a new catalog item) lands in 장식·기타 › 소품.
 */
/** `icon` is the catalog id whose thumbnail stands for the room tab. */
type Room = { slug: string; name: string; icon: string; kinds: [slug: string, name: string][] }

const ROOMS: Room[] = [
  {
    slug: 'bedroom',
    name: '침실',
    icon: 'double-bed',
    kinds: [
      ['bed', '침대'],
      ['storage', '수납'],
      ['table', '협탁'],
    ],
  },
  {
    slug: 'living',
    name: '거실',
    icon: 'sofa',
    kinds: [
      ['sofa', '소파·의자'],
      ['table', '테이블'],
      ['storage', '수납'],
      ['media', 'TV·음향'],
      ['lighting', '조명'],
      ['rug', '러그'],
    ],
  },
  {
    slug: 'kitchen',
    name: '주방',
    icon: 'fridge',
    kinds: [
      ['table', '식탁·의자'],
      ['cabinet', '주방가구'],
      ['appliance', '주방가전'],
      ['utensil', '주방용품'],
    ],
  },
  {
    slug: 'bathroom',
    name: '욕실',
    icon: 'bathtub',
    kinds: [
      ['fixture', '욕실설비'],
      ['laundry', '세탁'],
      ['accessory', '욕실용품'],
    ],
  },
  {
    slug: 'study',
    name: '서재',
    icon: 'bookshelf',
    kinds: [
      ['desk', '책상·의자'],
      ['storage', '책장·수납'],
      ['device', '기기'],
    ],
  },
  {
    slug: 'hobby',
    name: '취미',
    icon: 'piano',
    kinds: [
      ['fitness', '운동'],
      ['art', '음악·공예'],
      ['play', '놀이'],
    ],
  },
  {
    slug: 'outdoor',
    name: '야외',
    icon: 'patio-umbrella',
    kinds: [
      ['landscape', '조경'],
      ['leisure', '레저'],
      ['vehicle', '차량'],
      ['facility', '시설'],
    ],
  },
  {
    slug: 'utility',
    name: '설비',
    icon: 'air-conditioning',
    kinds: [
      ['climate', '냉난방'],
      ['electric', '전기'],
      ['safety', '안전·소방'],
      ['lighting', '천장조명'],
      ['structure', '구조'],
    ],
  },
  {
    slug: 'decor',
    name: '장식·기타',
    icon: 'indoor-plant',
    kinds: [
      ['plant', '식물'],
      ['wall', '벽장식'],
      ['misc', '소품'],
    ],
  },
]

const FALLBACK = 'decor.misc'

/** Catalog id → `room.kind`. */
const ITEM_ROOMS: Record<string, string> = {
  // 침실
  'single-bed': 'bedroom.bed',
  'double-bed': 'bedroom.bed',
  bunkbed: 'bedroom.bed',
  closet: 'bedroom.storage',
  dresser: 'bedroom.storage',
  'coat-rack': 'bedroom.storage',
  'bedside-table': 'bedroom.table',
  // 거실
  sofa: 'living.sofa',
  'my-leather-couch-modp80ha': 'living.sofa',
  'livingroom-chair': 'living.sofa',
  'lounge-chair': 'living.sofa',
  'coffee-table': 'living.table',
  'tv-stand': 'living.storage',
  shelf: 'living.storage',
  television: 'living.media',
  'stereo-speaker': 'living.media',
  'floor-lamp': 'living.lighting',
  'table-lamp': 'living.lighting',
  'ceiling-lamp': 'living.lighting',
  'rectangular-carpet': 'living.rug',
  'round-carpet': 'living.rug',
  // 주방
  'dining-table': 'kitchen.table',
  'dining-table-mo9ms5yh': 'kitchen.table',
  'dining-chair': 'kitchen.table',
  stool: 'kitchen.table',
  kitchen: 'kitchen.cabinet',
  'kitchen-cabinet': 'kitchen.cabinet',
  'kitchen-counter': 'kitchen.cabinet',
  'kitchen-shelf': 'kitchen.cabinet',
  'wooden-kitchen-bar-moa2hhh4': 'kitchen.cabinet',
  fridge: 'kitchen.appliance',
  stove: 'kitchen.appliance',
  hood: 'kitchen.appliance',
  microwave: 'kitchen.appliance',
  'dishwasher-movn72ls': 'kitchen.appliance',
  'coffee-machine': 'kitchen.appliance',
  toaster: 'kitchen.appliance',
  kettle: 'kitchen.appliance',
  'cutting-board': 'kitchen.utensil',
  'kitchen-utensils': 'kitchen.utensil',
  'frying-pan': 'kitchen.utensil',
  fruits: 'kitchen.utensil',
  'wine-bottle': 'kitchen.utensil',
  // 욕실
  toilet: 'bathroom.fixture',
  bathtub: 'bathroom.fixture',
  'bathroom-sink': 'bathroom.fixture',
  'shower-angle': 'bathroom.fixture',
  'shower-square': 'bathroom.fixture',
  'washing-machine': 'bathroom.laundry',
  'drying-rack': 'bathroom.laundry',
  'laundry-bag': 'bathroom.laundry',
  iron: 'bathroom.laundry',
  'ironing-board': 'bathroom.laundry',
  'toilet-paper': 'bathroom.accessory',
  'shower-rug': 'bathroom.accessory',
  // 서재
  'office-table': 'study.desk',
  'standing-desk-mo8wgz95': 'study.desk',
  'office-chair': 'study.desk',
  'herman-miller-aeron-mo8x36k9': 'study.desk',
  bookshelf: 'study.storage',
  'ikea-kallax-1x4-moa2y49n': 'study.storage',
  books: 'study.storage',
  computer: 'study.device',
  // 취미
  barbell: 'hobby.fitness',
  'barbell-stand': 'hobby.fitness',
  threadmill: 'hobby.fitness',
  piano: 'hobby.art',
  guitar: 'hobby.art',
  easel: 'hobby.art',
  'sewing-machine': 'hobby.art',
  'pool-table': 'hobby.play',
  toy: 'hobby.play',
  'car-toy': 'hobby.play',
  // 야외
  tree: 'outdoor.landscape',
  'fir-tree': 'outdoor.landscape',
  palm: 'outdoor.landscape',
  bush: 'outdoor.landscape',
  sunbed: 'outdoor.leisure',
  'patio-umbrella': 'outdoor.leisure',
  'outdoor-playhouse': 'outdoor.leisure',
  'basket-hoop': 'outdoor.leisure',
  ball: 'outdoor.leisure',
  skate: 'outdoor.leisure',
  scooter: 'outdoor.vehicle',
  tesla: 'outdoor.vehicle',
  '1967-chevrolet-camaro-moa24wsf': 'outdoor.vehicle',
  'parking-spot': 'outdoor.facility',
  pillar: 'outdoor.facility',
  hydrant: 'outdoor.facility',
  'ev-wall-charger': 'outdoor.facility',
  // 설비
  'air-conditioning': 'utility.climate',
  'ac-block': 'utility.climate',
  thermostat: 'utility.climate',
  'ceiling-fan': 'utility.climate',
  'fireplace-movn1fnn': 'utility.climate',
  'electric-panel': 'utility.electric',
  'power-outlet-moa09g0o': 'utility.electric',
  sprinkler: 'utility.safety',
  'exit-sign': 'utility.safety',
  'fire-detector': 'utility.safety',
  'smoke-detector': 'utility.safety',
  'alarm-keypad': 'utility.safety',
  'recessed-light': 'utility.lighting',
  column: 'utility.structure',
  // 장식·기타
  cactus: 'decor.plant',
  'indoor-plant': 'decor.plant',
  'small-indoor-plant': 'decor.plant',
  picture: 'decor.wall',
  'round-mirror': 'decor.wall',
  'trash-bin': 'decor.misc',
}

export const MY_MODELS_SLUG = 'mine'

export const CATALOG_ROOM_TREE: FunctionTreeNode[] = [
  ...ROOMS.map((room) => ({
    slug: room.slug,
    name: room.name,
    iconUrl: `/items/${room.icon}/thumbnail.webp`,
    children: room.kinds.map(([kind, name]) => ({
      slug: `${room.slug}.${kind}`,
      name,
      children: [],
    })),
  })),
  { slug: MY_MODELS_SLUG, name: '내 모델', iconUrl: '/icons/item.webp', children: [] },
]

/** File catalog items under their room / kind. */
export function withRoomTags(items: AssetInput[]): AssetInput[] {
  return items.map((item) => ({
    ...item,
    name: CATALOG_KO_NAMES[item.id] ?? item.name,
    functionTags: [ITEM_ROOMS[item.id] ?? FALLBACK],
  }))
}

/** The user's imported GLBs go under 내 모델. */
export function withMyModelTag(items: AssetInput[]): AssetInput[] {
  return items.map((item) => ({ ...item, functionTags: [MY_MODELS_SLUG] }))
}
