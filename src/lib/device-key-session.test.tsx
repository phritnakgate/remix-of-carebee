import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { rememberDeviceKey, useDeviceKey } from "./device-key-session";

const key = "smrb_" + "a".repeat(48);
beforeEach(() => sessionStorage.clear());

it("exposes the full issued key only for its owner, device and current prefix", () => {
  const { result, rerender } = renderHook(
    ({ owner, device, prefix }) => useDeviceKey(owner, device, prefix),
    { initialProps: { owner: "owner", device: "box", prefix: key.slice(0, 10) } },
  );
  expect(result.current).toBeNull();
  act(() => rememberDeviceKey("owner", "box", key));
  expect(result.current).toBe(key);
  rerender({ owner: "another-owner", device: "box", prefix: key.slice(0, 10) });
  expect(result.current).toBeNull();
  rerender({ owner: "owner", device: "another-box", prefix: key.slice(0, 10) });
  expect(result.current).toBeNull();
  rerender({ owner: "owner", device: "box", prefix: "smrb_bbbbb" });
  expect(result.current).toBeNull();
});
