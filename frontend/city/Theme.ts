export const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
export const BODY_FONT = '"Inter", "Helvetica Neue", sans-serif';

export const YELLOW = "#F5C542";
export const INK = "#1B1B22";
export const PAPER = "#F3E4B8";
export const PAPER_LIGHT = "#FFF6DC";
export const PAPER_DARK = "#F5D57A";
export const LINE = "#E7C878";
export const MUTED = "#8b7a4d";

export const SKY = "#EFE3C2";
export const SKY_FOG = "#EFE3C2";
export const GRASS = "#A9C98F";
export const GRASS_DARK = "#8DB174";
export const PATH_STONE = "#E9DFC4";

export const HOME_CORE = "#FFFFFF";
export const HOME_CORE_ROOF = INK;

export interface RoomHue {
  body: string;
  roof: string;
  window: string;
}

export const ROOM_PALETTE: RoomHue[] = [
  { body: "#E3A1B6", roof: "#C4637D", window: "#F6E4EA" },
  { body: "#8CC3DE", roof: "#4F8DB3", window: "#E6F2F8" },
  { body: "#8FD3B6", roof: "#4E9F7D", window: "#E6F6EE" },
  { body: "#E8BB82", roof: "#C98440", window: "#F8EBD8" },
  { body: "#B9AEDF", roof: "#7F6BB8", window: "#EEEAF8" },
  { body: "#E6CE7A", roof: "#BFA030", window: "#F8F1D8" },
  { body: "#E3958B", roof: "#BC5A4D", window: "#F7E4E1" },
  { body: "#93CDD4", roof: "#4F9AA5", window: "#E5F3F5" },
];

export function getRoomTheme(index: number): RoomHue {
  return ROOM_PALETTE[index % ROOM_PALETTE.length];
}
