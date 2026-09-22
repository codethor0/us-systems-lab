import { describe, expect, it } from "vitest";
import { createUrlSync, URL_WRITE_INTERVAL_MS } from "./url-sync";
import type { UrlSyncPort, UrlSyncStatus } from "./url-sync";

function clock() {
  let time = 0;
  let sequence = 0;
  let url = "/";
  let failure: "none" | "drop" | "throw" = "none";
  const writes: { at: number; url: string }[] = [];
  const states: UrlSyncStatus[] = [];
  const tasks = new Map<number, { at: number; callback: () => void }>();
  const callbacks: (() => void)[] = [];
  const port: UrlSyncPort = {
    read: () => url,
    write: (target) => {
      writes.push({ at: time, url: target });
      if (failure === "throw") throw new Error("Simulated History API rejection");
      if (failure !== "drop") url = target;
    },
    now: () => time,
    schedule: (callback, delay) => {
      sequence += 1;
      tasks.set(sequence, { at: time + delay, callback });
      callbacks.push(callback);
      return sequence;
    },
    clear: (id) => {
      tasks.delete(id);
    },
    status: (state) => {
      states.push(state);
    },
  };
  return {
    sync: createUrlSync(port),
    writes,
    states,
    tasks,
    callbacks,
    read: () => url,
    external: (target: string) => {
      url = target;
    },
    fail: (mode: typeof failure) => {
      failure = mode;
    },
    advance: (milliseconds: number) => {
      const end = time + milliseconds;
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (next === undefined || next[1].at > end) break;
        time = next[1].at;
        tasks.delete(next[0]);
        next[1].callback();
      }
      time = end;
    },
  };
}

describe("bounded latest-state URL writes", () => {
  it("writes the first change immediately and skips an already-canonical URL", () => {
    const c = clock();
    c.sync.request("/");
    expect(c.writes).toHaveLength(0);
    c.sync.request("/?l=productivity:100");
    expect(c.writes).toEqual([{ at: 0, url: "/?l=productivity:100" }]);
    expect(c.states.at(-1)).toBe("synced");
  });
  it("coalesces rapid requests to the latest value at a bounded interval", () => {
    const c = clock();
    c.sync.request("/first");
    c.advance(30);
    c.sync.request("/old");
    c.advance(50);
    c.sync.request("/latest");
    expect(c.tasks.size).toBe(1);
    c.advance(URL_WRITE_INTERVAL_MS - 81);
    expect(c.read()).toBe("/first");
    c.advance(1);
    expect(c.read()).toBe("/latest");
    expect(c.writes).toEqual([
      { at: 0, url: "/first" },
      { at: 400, url: "/latest" },
    ]);
  });
  it("lets Reset replace a queued nonzero scenario without restoring it later", () => {
    const c = clock();
    c.sync.request("/active");
    c.sync.request("/queued");
    c.sync.request("/");
    c.advance(400);
    expect(c.read()).toBe("/");
    c.advance(10000);
    expect(c.writes.map((w) => w.url)).toEqual(["/active", "/"]);
  });
  it("drops a queued request when the latest request is already in the address bar", () => {
    const c = clock();
    c.sync.request("/active");
    c.sync.request("/queued");
    c.sync.request("/active");
    c.advance(1000);
    expect(c.writes).toHaveLength(1);
    expect(c.tasks.size).toBe(0);
  });
  it("does not flood History during a long stream of input events", () => {
    const c = clock();
    for (let i = 0; i < 1000; i++) {
      c.sync.request(`/input-${String(i)}`);
      c.advance(5);
    }
    c.advance(1000);
    expect(c.read()).toBe("/input-999");
    expect(c.writes.length).toBeLessThanOrEqual(14);
    for (let i = 1; i < c.writes.length; i++) {
      expect((c.writes[i]?.at ?? 0) - (c.writes[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(400);
    }
  });
  it("cancels pending state before history navigation and retains the new entry", () => {
    const c = clock();
    c.sync.request("/first");
    c.sync.request("/queued");
    const stale = c.callbacks[0];
    if (stale === undefined) throw new Error("Missing scheduled callback");
    c.sync.cancel();
    c.external("/back");
    stale();
    c.advance(1000);
    expect(c.read()).toBe("/back");
    expect(c.writes).toHaveLength(1);
  });
  it("disposes without writing pending state or accepting later requests", () => {
    const c = clock();
    c.sync.request("/first");
    c.sync.request("/queued");
    const stale = c.callbacks[0];
    if (stale === undefined) throw new Error("Missing scheduled callback");
    c.sync.dispose();
    stale();
    c.sync.request("/after-dispose");
    c.sync.cancel();
    c.advance(1000);
    expect(c.read()).toBe("/first");
    expect(c.writes).toHaveLength(1);
  });
  it("detects silently ignored writes and retries without claiming synchronization", () => {
    const c = clock();
    c.fail("drop");
    c.sync.request("/target");
    expect(c.states.at(-1)).toBe("error");
    expect(c.read()).toBe("/");
    c.fail("none");
    c.advance(1000);
    expect(c.read()).toBe("/target");
    expect(c.states.at(-1)).toBe("synced");
  });
  it("limits retries after exceptions and permits a later new request", () => {
    const c = clock();
    c.fail("throw");
    c.sync.request("/rejected");
    c.advance(10000);
    expect(c.writes).toHaveLength(3);
    expect(c.tasks.size).toBe(0);
    expect(c.states.at(-1)).toBe("error");
    c.fail("none");
    c.sync.request("/recovered");
    expect(c.read()).toBe("/recovered");
    expect(c.states.at(-1)).toBe("synced");
  });
  it("retries only the newest request after a rejection", () => {
    const c = clock();
    c.fail("drop");
    c.sync.request("/older");
    c.advance(50);
    c.fail("none");
    c.sync.request("/latest");
    c.advance(950);
    expect(c.read()).toBe("/latest");
    expect(c.writes.map((w) => w.url)).toEqual(["/older", "/latest"]);
  });
});
