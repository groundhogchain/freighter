import { ThruputStore, defaultThruputStorage } from "../storage";

describe("Thruput storage transactions", () => {
  it("does not replace committed state after a failed write and recovers the queue", async () => {
    let disk = defaultThruputStorage();
    const write = jest.fn(async (next) => {
      disk = structuredClone(next);
    });
    write.mockRejectedValueOnce(new Error("quota"));
    const store = new ThruputStore({ read: async () => disk, write });
    await expect(
      store.update((next) => {
        next.networkHash = "1".repeat(64);
      }),
    ).rejects.toThrow("quota");
    expect((await store.read()).networkHash).toBe(disk.networkHash);
    await store.update((next) => {
      next.networkHash = "2".repeat(64);
    });
    expect((await store.read()).networkHash).toBe("2".repeat(64));
  });

  it("serializes concurrent read-modify-write updates", async () => {
    let disk = defaultThruputStorage();
    const store = new ThruputStore({
      read: async () => disk,
      write: async (next) => {
        disk = structuredClone(next);
      },
    });
    await Promise.all([
      store.update((next) => {
        next.airdrops.a = "1".repeat(32);
      }),
      store.update((next) => {
        next.airdrops.b = "2".repeat(32);
      }),
    ]);
    expect(Object.keys((await store.read()).airdrops)).toEqual(["a", "b"]);
  });

  it("does not erase damaged transaction evidence", async () => {
    const write = jest.fn();
    const disk = { ...defaultThruputStorage(), outgoing: [{ hash: "broken" }] };
    const store = new ThruputStore({ read: async () => disk, write });
    await expect(store.update(() => {})).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
