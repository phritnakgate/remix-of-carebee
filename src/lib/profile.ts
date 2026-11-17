import { z } from "zod";

export const profileTimezones = [
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "America/New_York",
  "Australia/Sydney",
];

export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(60)
    .transform((value) => value || null),
  phone: z
    .string()
    .trim()
    .max(20)
    .transform((value) => value || null),
  timezone: z
    .string()
    .trim()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});
