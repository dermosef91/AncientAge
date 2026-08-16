/** Warm Mediterranean diorama palette shared by terrain, props and buildings. */
export const C = {
  // Ground
  sandLight: 0xefdda6,
  sand: 0xe3c98b,
  sandDark: 0xcaa963,
  grass: 0x93ad4f,
  grassDark: 0x6f8546,
  grassDry: 0xc9b365,
  dirt: 0xc4a878,
  path: 0xe6d7b0,
  rock: 0x9c968c,
  rockDark: 0x7c776f,
  rockLight: 0xb6b0a5,
  cliff: 0xa89d8b,
  waterShallow: 0x4cc8bf,
  waterDeep: 0x14708a,
  foam: 0xd6f0ec,

  // Materials
  wood: 0x9a6b3f,
  woodDark: 0x6f4b2c,
  woodLight: 0xbb8b52,
  thatch: 0xcbaa6c,
  limestone: 0xeae5d6,
  limestoneDark: 0xd0cab6,
  limestoneShade: 0xbab3a0,
  mudbrick: 0xd8c197,
  mudbrickDark: 0xbca682,
  mudbrickLight: 0xe6d3ad,
  sandstone: 0xd9b98a,
  terracotta: 0xa8402f,
  terracottaDark: 0x8b3325,
  marble: 0xf2efe4,
  bronze: 0xb08d57,
  bronzeDark: 0x8a6d3f,
  iron: 0x8d949c,
  ironDark: 0x60666d,
  gold: 0xe6b422,
  goldDark: 0xbb8f18,
  cloth: 0xe8e2d0,

  // Nature
  palmTrunk: 0x9b7a4f,
  palmLeaf: 0x5f9145,
  palmLeafDark: 0x4b7a37,
  oliveTrunk: 0x8a7355,
  oliveLeaf: 0x87a06a,
  cypress: 0x4a6b3c,
  cypressDark: 0x3d5a32,
  bush: 0x6e9350,
  berry: 0xc63f3f,
  crop: 0x9fb453,
  cropDark: 0x7f9440,
  wheat: 0xd9bf6b,

  // Deposits
  goldOre: 0xe9c449,
  goldRock: 0xb9ae92,
  stoneOre: 0x9a958d,
  stoneRock: 0x8b867e,

  // Units
  skin: 0xd9a878,
  skinDark: 0xb98a5e,
  hair: 0x3a2c22,
  leather: 0x8b6236,
  shieldWood: 0xa5743f,

  // Effects
  dust: 0xe0d0ae,
  blood: 0xa5352c,
  spark: 0xffd98a,
  white: 0xffffff,
  shadow: 0x2b2a26,
} as const;

export type ColorName = keyof typeof C;
