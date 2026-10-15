

export const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
export const BODY_FONT = '"Inter", "Helvetica Neue", sans-serif';

export const YELLOW = "#F5C542"; 
export const INK = "#1B1B22"; 
export const PAPER = "#FFE8A3"; 
export const PAPER_LIGHT = "#FFF6DC"; 
export const PAPER_DARK = "#F5D57A"; 
export const LINE = "#E7C878";
export const MUTED = "#8b7a4d";



export const SKY = "#FBDD7E";
export const SKY_FOG = "#FCE7A8";
export const GRASS = "#8FD46B";
export const GRASS_DARK = "#6FBF4E";
export const PATH_STONE = "#F3E6BE";


export const HOME_CORE = "#FFFFFF";
export const HOME_CORE_ROOF = INK;




export interface RoomHue {
  body: string;
  roof: string;
  window: string;
}

export const ROOM_PALETTE: RoomHue[] = [
  { body: "#FF8FB1", roof: "#E8536F", window: "#FFE3EC" }, 
  { body: "#5EC8F2", roof: "#2E86C1", window: "#E4F6FF" }, 
  { body: "#6FE3B4", roof: "#2FAE7A", window: "#E3FFF3" }, 
  { body: "#FFB454", roof: "#E8862E", window: "#FFF1DC" }, 
  { body: "#B9A3F5", roof: "#7C5CD1", window: "#F1EBFF" }, 
  { body: "#FFD84D", roof: "#E0AC1D", window: "#FFF8DC" }, 
  { body: "#FF7A6E", roof: "#D4483B", window: "#FFE7E4" }, 
  { body: "#7AD6E0", roof: "#2E9AA8", window: "#E2F9FB" }, 
];

export function getRoomTheme(index: number): RoomHue {
  return ROOM_PALETTE[index % ROOM_PALETTE.length];
}
