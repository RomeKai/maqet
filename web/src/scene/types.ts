/**
 * GENERATED — do not edit.
 * Source: snapshot C:\Users\lenovo\Desktop\kit\maqet\web\openapi.snapshot.json
 * Regenerate: npm run gen:types (from web/)
 */

export interface Furniture {
id: string;
catalog_id?: string | null;
concept_id?: string | null;
room_id: string;
position: [number, number];
rotation_deg?: number;
size_m: [number, number, number];
concept?: boolean;
}

export interface HTTPValidationError {
detail?: ValidationError[];
}

export interface HealthOut {
status: string;
version: string;
}

export interface Material {
id: string;
source: "catalog" | "generated";
catalog_id?: string | null;
texture_url?: string | null;
prompt?: string | null;
tiling_m?: [number, number];
concept?: boolean;
}

export interface Opening {
id: string;
wall_id: string;
kind: "door" | "window";
offset_m: number;
width_m: number;
height_m: number;
sill_m?: number | null;
}

export interface Room {
id: string;
name: string;
polygon: [number, number][];
function?: string | null;
}

export interface RoomSurfaceTarget {
type?: "room";
room_id: string;
part: "floor" | "ceiling";
}

export interface Scene {
id: string;
version?: number;
units?: "m";
scale_confirmed?: boolean;
ceiling_height_m?: number;
walls?: Wall[];
openings?: Opening[];
rooms?: Room[];
surfaces?: Surface[];
furniture?: Furniture[];
materials?: Material[];
}

export interface Surface {
id: string;
target: (RoomSurfaceTarget | WallSurfaceTarget);
material_id: string;
}

export interface ValidationError {
loc: (string | number)[];
msg: string;
type: string;
input?: unknown;
ctx?: unknown;
}

export interface ValidationReportOut {
ok: boolean;
errors?: string[];
warnings?: string[];
flags?: string[];
}

export interface Wall {
id: string;
a: [number, number];
b: [number, number];
thickness_m: number;
kind: "exterior" | "interior";
height_m?: number | null;
load_bearing?: boolean;
}

export interface WallSurfaceTarget {
type?: "wall";
wall_id: string;
side: "left" | "right";
}
