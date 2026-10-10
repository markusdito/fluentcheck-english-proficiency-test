import { afterEach, describe, expect, it, vi } from "vitest";
import { abandonSubmissionOnLeave } from "./test-api";

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
