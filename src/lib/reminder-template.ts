import type { Json } from "@/integrations/supabase/types";

export const reminderTemplateExample =
  '{\n  "command": "remind",\n  "channel": "{{compartment}}",\n  "time": "{{time}}",\n  "schedule_id": "{{schedule_id}}"\n}';

export const reminderPreview: Record<string, Json> = {
  type: "medication_due",
  notification_id: "example-notification",
  box_id: "example-box",
  device_id: "example-box",
  box_slot: "bedtime",
  date: "2026-11-17",
  timezone: "Asia/Bangkok",
  time: "21:00",
  medicine: "Demo",
  pills: 1,
  dosage: null,
  food_instruction: "any",
  compartment: 7,
  slot: "bedtime",
  schedule_id: "example-schedule",
  medicine_id: "example-medicine",
  reminder: true,
  taken: false,
  confirmed_at: null,
};

export function renderReminderTemplate(text: string, fields: Record<string, Json>) {
  function get(field: string) {
    if (!Object.hasOwn(fields, field)) throw new Error(`Unknown reminder field: ${field}`);
    return fields[field] ?? null;
  }

  function resolve(value: Json): Json {
    if (typeof value === "string") {
      const exact = /^\{\{\s*(\w+)\s*\}\}$/.exec(value);
      if (exact?.[1]) return get(exact[1]);
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, field: string) => {
        const replacement = get(field);
        return typeof replacement === "string" ? replacement : JSON.stringify(replacement);
      });
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, resolve(child ?? null)]),
      );
    }
    return value;
  }

  return JSON.stringify(resolve(JSON.parse(text) as Json));
}

export function scheduledReminderPayload(
  message: Record<string, Json>,
  sharedTemplate: string,
  localTemplate: string,
  customPayload: string,
) {
  for (const template of [sharedTemplate, localTemplate]) {
    if (!template.trim()) continue;
    try {
      return renderReminderTemplate(template, { device_id: null, box_slot: null, ...message });
    } catch {
      // Keep delivery available when an older template can no longer be rendered.
    }
  }
  return customPayload || JSON.stringify(message);
}

const templateKey = (boxId: string) => `carebee-reminder-template:${boxId}`;

export function readReminderTemplate(boxId: string) {
  try {
    return localStorage.getItem(templateKey(boxId)) ?? "";
  } catch {
    return "";
  }
}
