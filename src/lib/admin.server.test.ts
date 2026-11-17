import { afterEach, describe, expect, it, vi } from "vitest";

import { hasAdminAccess } from "./admin.server";

const { getClaims, getRequest } = vi.hoisted(() => ({ getClaims: vi.fn(), getRequest: vi.fn() }));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest,
  setResponseHeader: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { auth: { getClaims } },
}));

const userId = "9bef35ad-f957-42aa-98b3-a9be87e00b63";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("admin access", () => {
  it("requires an allowlisted identity verified with a password session", async () => {
    vi.stubEnv("CAREBEE_ADMIN_USER_IDS", userId);
    getRequest.mockReturnValue({
      headers: new Headers({ "X-CareBee-Admin-Token": "admin-token" }),
    });
    getClaims.mockResolvedValue({
      data: { claims: { sub: userId, amr: [{ method: "password" }] } },
    });

    expect(await hasAdminAccess()).toBe(true);
    expect(getClaims).toHaveBeenCalledWith("admin-token");
  });

  it.each([
    { sub: userId, amr: [{ method: "oauth" }] },
    { sub: "user-outside-allowlist", amr: [{ method: "password" }] },
  ])("rejects a verified session without administrator access (%o)", async (claims) => {
    vi.stubEnv("CAREBEE_ADMIN_USER_IDS", userId);
    getRequest.mockReturnValue({
      headers: new Headers({ "X-CareBee-Admin-Token": "admin-token" }),
    });
    getClaims.mockResolvedValue({ data: { claims } });

    expect(await hasAdminAccess()).toBe(false);
  });

  it("rejects ordinary app authorization and invalid admin tokens", async () => {
    vi.stubEnv("CAREBEE_ADMIN_USER_IDS", userId);
    getRequest.mockReturnValue({ headers: new Headers({ Authorization: "Bearer app-token" }) });
    expect(await hasAdminAccess()).toBe(false);
    expect(getClaims).not.toHaveBeenCalled();

    getRequest.mockReturnValue({
      headers: new Headers({ "X-CareBee-Admin-Token": "invalid-token" }),
    });
    getClaims.mockResolvedValue({ data: null, error: new Error("Invalid token") });
    expect(await hasAdminAccess()).toBe(false);
  });
});
