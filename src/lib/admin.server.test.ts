import { afterEach, describe, expect, it, vi } from "vitest";

import { adminAccessStatus, checkAdminHttpAccess, requireAdmin } from "./admin.server";

const { getClaims, getUser, getRequest, setResponseStatus } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  getRequest: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest,
  setResponseHeader: vi.fn(),
  setResponseStatus,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { auth: { getClaims, getUser } },
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

    expect(await adminAccessStatus()).toBe("allowed");
    expect(getClaims).toHaveBeenCalledWith("admin-token");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a Google session even if the account is an administrator", async () => {
    vi.stubEnv("CAREBEE_ADMIN_USER_IDS", userId);
    getRequest.mockReturnValue({
      headers: new Headers({ "X-CareBee-Admin-Token": "admin-token" }),
    });
    getClaims.mockResolvedValue({
      data: { claims: { sub: userId, amr: [{ method: "oauth" }] } },
    });

    expect(await checkAdminHttpAccess()).toBe("password_required");
    expect(setResponseStatus).toHaveBeenCalledWith(403);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects ordinary app authorization and invalid admin tokens", async () => {
    vi.stubEnv("CAREBEE_ADMIN_USER_IDS", userId);
    getRequest.mockReturnValue({ headers: new Headers({ Authorization: "Bearer app-token" }) });
    expect(await checkAdminHttpAccess()).toBe("invalid_session");
    expect(setResponseStatus).toHaveBeenCalledWith(401);
    expect(getClaims).not.toHaveBeenCalled();

    getRequest.mockReturnValue({
      headers: new Headers({ "X-CareBee-Admin-Token": "invalid-token" }),
    });
    getClaims.mockResolvedValue({ data: null, error: new Error("Invalid token") });
    expect(await adminAccessStatus()).toBe("invalid_session");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("can grant and revoke access through the current account even without a runtime secret", async () => {
    vi.stubEnv("CAREBEE_ADMIN_USER_IDS", "");
    getRequest.mockReturnValue({
      headers: new Headers({ "X-CareBee-Admin-Token": "admin-token" }),
    });
    getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: userId,
          amr: [{ method: "password" }],
          app_metadata: { carebee_admin: true },
        },
      },
    });
    getUser.mockResolvedValueOnce({
      data: { user: { id: userId, app_metadata: { carebee_admin: true } } },
    });
    expect(await adminAccessStatus()).toBe("allowed");
    expect(getUser).toHaveBeenCalledWith("admin-token");

    getUser.mockResolvedValue({
      data: { user: { id: userId, app_metadata: {}, user_metadata: { carebee_admin: true } } },
    });
    expect(await adminAccessStatus()).toBe("forbidden");
    await expect(requireAdmin()).rejects.toThrow("Admin access required");
  });

  it("distinguishes an auth service error from denied access", async () => {
    getRequest.mockReturnValue({
      headers: new Headers({ "X-CareBee-Admin-Token": "admin-token" }),
    });
    getClaims.mockResolvedValue({ data: null, error: { status: 503 } });
    expect(await checkAdminHttpAccess()).toBe("unavailable");
    expect(setResponseStatus).toHaveBeenCalledWith(503);
  });
});
