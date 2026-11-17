import { z } from "zod";

const jsonPath = z
  .string()
  .max(120)
  .regex(/^[\w-]+(?:\.[\w-]+)*$/);

export const sensorTemplateSchema = z
  .object({
    eventPath: jsonPath,
    eventValue: z.string().trim().min(1).max(60),
    compartmentPath: jsonPath.nullable(),
    weightPath: jsonPath,
    thresholdGrams: z.number().finite().positive().max(1000),
  })
  .strict();

export const defaultSensorTemplate: SensorTemplate = {
  eventPath: "type",
  eventValue: "load_cell",
  compartmentPath: "compartment",
  weightPath: "weight_g",
  thresholdGrams: 0.5,
};

export const sensorTemplateExample = JSON.stringify(defaultSensorTemplate, null, 2);
export const sensorReportExample =
  '{\n  "type": "load_cell",\n  "compartment": 1,\n  "weight_g": 12.4\n}';

const readingSchema = z.object({
  compartment: z.number().int().min(1).max(7).nullable(),
  weight_g: z.number().finite().min(-10000).max(10000),
});

type SensorTemplate = z.infer<typeof sensorTemplateSchema>;
type Reading = z.infer<typeof readingSchema>;

const loadCellSchema = z.object({
  weight_g: readingSchema.shape.weight_g,
  reference_g: readingSchema.shape.weight_g,
  last_change: z.enum(["decreased", "increased"]).optional(),
});

export type LoadCellStatus = z.infer<typeof loadCellSchema>;

export function parseSensorTemplate(text: string) {
  return sensorTemplateSchema.parse(JSON.parse(text));
}

function fieldAt(input: unknown, path: string): unknown {
  let value = input;
  for (const field of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, field)) return undefined;
    value = Reflect.get(value, field);
  }
  return value;
}

export function isLoadCellReport(message: unknown, template: SensorTemplate) {
  return fieldAt(message, template.eventPath) === template.eventValue;
}

export function readLoadCellReport(message: unknown, template: SensorTemplate) {
  if (!isLoadCellReport(message, template)) return null;
  const reading = readingSchema.safeParse({
    compartment: template.compartmentPath
      ? (fieldAt(message, template.compartmentPath) ?? undefined)
      : null,
    weight_g: fieldAt(message, template.weightPath),
  });
  return reading.success ? reading.data : null;
}

// Keep a reference until a real change occurs so small fluctuations do not move the baseline.
export function nextLoadCellStatus(reading: Reading, previous: unknown, threshold: number) {
  const prior = loadCellSchema.safeParse(previous);
  const weight = reading.weight_g;
  const reference = prior.success ? prior.data.reference_g : weight;
  const delta = Number((weight - reference).toFixed(6));
  const direction = Math.abs(delta) >= threshold ? (delta < 0 ? "decreased" : "increased") : null;
  const lastChange = direction ?? (prior.success ? prior.data.last_change : undefined);
  const status = {
    weight_g: weight,
    reference_g: direction ? weight : reference,
    ...(lastChange ? { last_change: lastChange } : {}),
  } satisfies LoadCellStatus;
  return { status, change: direction ? { ...reading, delta_g: delta, direction } : null };
}
