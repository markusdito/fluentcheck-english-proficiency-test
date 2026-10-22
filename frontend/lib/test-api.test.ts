import { afterEach, describe, expect, it, vi } from "vitest";
import { abandonSubmissionOnLeave, getPromptAudioUrl } from "./test-api";

describe("abandonSubmissionOnLeave", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a beacon to the abandon endpoint", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    abandonSubmissionOnLeave("sub-1");
    expect(sendBeacon).toHaveBeenCalledWith("/backend-api/submissions/sub-1/abandon");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch when the beacon is refused", () => {
    vi.stubGlobal("navigator", { sendBeacon: vi.fn().mockReturnValue(false) });
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchSpy);

    abandonSubmissionOnLeave("sub-1");
    expect(fetchSpy).toHaveBeenCalledWith("/backend-api/submissions/sub-1/abandon", {
      method: "POST",
      keepalive: true,
      credentials: "include",
    });
  });
});

describe("getPromptAudioUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-signs one prompt through the owner-scoped endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "success", data: { url: "https://r2.example/fresh.webm" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getPromptAudioUrl("sub-1", "entry-1")).resolves.toBe("https://r2.example/fresh.webm");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/backend-api/submissions/sub-1/prompts/entry-1",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
