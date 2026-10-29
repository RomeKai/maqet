/**
 * GENERATED — do not edit.
 * Source: snapshot C:\Users\lenovo\Desktop\kit\maqet-hardening\web\openapi.snapshot.json
 * Regenerate: npm run gen:types (from web/)
 */

export interface AgentTurnIn {
scene: Scene;
message: string;
stage: "reform" | "design" | "present";
history?: OpRecordIn[];
selected?: SelectedRef | null;
}

export interface AgentTurnOut {
scene: Scene;
reply: string;
ops_applied: AppliedOpOut[];
professional_flags: string[];
history: OpRecordIn[];
}

export interface AppliedOpOut {
name: string;
arguments: unknown;
flags?: string[];
}

export interface Body_post_intake_intake_post {
file?: string | null;
kind: string;
anchor_index?: number | null;
sample?: string | null;
}

export interface Body_post_transcribe_transcribe_post {
audio?: string | null;
language?: string | null;
keywords?: string | null;
}

export interface ForkIn {
label: string;
from_branch?: string;
}

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

export interface IntakeDimension {
text: string;
a: [number, number];
b: [number, number];
wall_index: number | null;
}

export interface IntakeLabel {
text: string;
at: [number, number];
}

export interface IntakeOpening {
wall_index: number;
t0: number;
t1: number;
kind: "door" | "window";
}

export interface IntakeOut {
proposal: IntakeProposal;
scene: Scene;
warnings?: string[];
scale_m_per_px: number;
anchor_index: number;
anchor_meters: number;
}

export interface IntakeProposal {
input_kind: "plan" | "sketch";
walls: IntakeWall[];
openings: IntakeOpening[];
labels: IntakeLabel[];
dimensions: IntakeDimension[];
}

export interface IntakeWall {
a: [number, number];
b: [number, number];
kind: "exterior" | "interior" | null;
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

export interface OpRecordIn {
op: string;
args: unknown;
before_version: number;
after_version: number;
actor: string;
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
level?: number;
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
professional_flags?: string[];
}

export interface SelectedRef {
kind: string;
id: string;
}

export interface Surface {
id: string;
target: (RoomSurfaceTarget | WallSurfaceTarget);
material_id: string;
}

export interface TranscribeOut {
text: string;
duration_ms: number;
}

export interface UndoIn {
label?: string | null;
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

export interface VariantOut {
label: string;
parent: string | null;
fork_at_version: number;
op_count: number;
scene: Scene;
}

export interface VariantsOut {
chosen: string;
variants: VariantOut[];
}

export interface Wall {
id: string;
a: [number, number];
b: [number, number];
thickness_m: number;
kind: "exterior" | "interior";
height_m?: number | null;
load_bearing?: boolean;
provenance?: "measured_ar" | "measured_tape" | "written_on_sketch" | "estimated";
measured_length_m?: number | null;
}

export interface WallSurfaceTarget {
type?: "wall";
wall_id: string;
side: "left" | "right";
}
