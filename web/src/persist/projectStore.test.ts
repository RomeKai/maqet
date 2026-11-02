import { describe, expect, it } from "vitest";
import { PROJECT_KEY, clearProject, loadProject, saveProject, type ProjectSnapshot, type StorageLike } from "./projectStore";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const snapshot: ProjectSnapshot = {
  v: 1,
  locale: "es-AR",
  stage: "stage.reform",
  captureStep: "check",
  scene: { id: "s1", walls: [{ id: "w1" }] } as ProjectSnapshot["scene"],
  baseScene: { id: "s0", walls: [] } as ProjectSnapshot["scene"],
  variants: { A: { scene: { id: "s1" } as ProjectSnapshot["scene"], ops: [] } },
  history: [],
  chats: { "stage.reform:A": [{ id: "u-1", role: "user", text: "hola" }] },
  professionalFlags: ["second_floor"],
};

describe("projectStore", () => {
  it("round-trips a snapshot", () => {
    const storage = memoryStorage();
    expect(saveProject(snapshot, storage)).toBe(true);
    expect(loadProject(storage)).toEqual(snapshot);
  });

  it("returns null when nothing is stored", () => {
    expect(loadProject(memoryStorage())).toBeNull();
  });

  it("treats corrupt JSON as no project and clears it", () => {
    const storage = memoryStorage({ [PROJECT_KEY]: "{not json" });
    expect(loadProject(storage)).toBeNull();
    expect(storage.data[PROJECT_KEY]).toBeUndefined();
  });

  it("rejects a snapshot with the wrong shape or version", () => {
    for (const bad of [
      { ...snapshot, v: 2 },
      { ...snapshot, scene: null },
      { ...snapshot, stage: "stage.nope" },
      { ...snapshot, locale: "fr" },
      { ...snapshot, chats: [] },
      { ...snapshot, history: "x" },
    ]) {
      expect(loadProject(memoryStorage({ [PROJECT_KEY]: JSON.stringify(bad) }))).toBeNull();
    }
  });

  it("never throws when storage is unavailable or full", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(saveProject(snapshot, broken)).toBe(false);
    expect(loadProject(broken)).toBeNull();
    expect(() => clearProject(broken)).not.toThrow();
    expect(saveProject(snapshot, null)).toBe(false);
    expect(loadProject(null)).toBeNull();
  });

  it("clearProject removes the stored project", () => {
    const storage = memoryStorage();
    saveProject(snapshot, storage);
    clearProject(storage);
    expect(loadProject(storage)).toBeNull();
  });
});
