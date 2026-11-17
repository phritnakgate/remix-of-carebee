import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import {
  defaultSensorTemplate,
  parseSensorTemplate,
  readLoadCellReport,
  sensorReportExample,
  sensorTemplateExample,
} from "@/lib/load-cell";
import { mqttPayloadLimit } from "@/lib/mqtt";
import {
  reminderPreview,
  reminderTemplateExample,
  renderReminderTemplate,
} from "@/lib/reminder-template";

export function DeveloperTemplateEditor({
  kind,
  initialTemplate,
  available,
  onSave,
}: {
  kind: "reminder" | "sensor";
  initialTemplate: string;
  available: boolean;
  onSave: (template: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initialTemplate);
  const [saved, setSaved] = useState(initialTemplate);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState(sensorReportExample);
  const sensor = kind === "sensor";
  const label = sensor ? "sensorTemplate" : "reminderTemplate";
  const example = sensor ? sensorTemplateExample : reminderTemplateExample;
  const id = `${kind}-template`;
  let preview = "";
  let invalid = false;
  let sampleInvalid = false;
  try {
    if (sensor) {
      const template = text.trim() ? parseSensorTemplate(text) : defaultSensorTemplate;
      try {
        const reading = readLoadCellReport(JSON.parse(sample), template);
        if (reading) preview = JSON.stringify(reading, null, 2);
        else sampleInvalid = !!sample.trim();
      } catch {
        sampleInvalid = !!sample.trim();
      }
    } else if (text.trim()) {
      preview = JSON.stringify(JSON.parse(renderReminderTemplate(text, reminderPreview)), null, 2);
    }
  } catch {
    invalid = true;
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (invalid || !available || saving || text.trim() === saved) return;
        setSaving(true);
        try {
          const template = text.trim();
          if (!(await onSave(template))) {
            toast.error(t("adminTemplateUnavailable"));
            return;
          }
          setSaved(template);
          toast.success(t("saved"));
        } catch {
          toast.error(t(sensor ? "sensorTemplateSaveFailed" : "reminderTemplateSaveFailed"));
        } finally {
          setSaving(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t(sensor ? "sensorTemplateHint" : "reminderTemplateHint")}
      </p>
      {!available && (
        <p role="status" className="text-sm text-destructive">
          {t("adminTemplateUnavailable")}
        </p>
      )}
      <Label htmlFor={id}>{t(label)}</Label>
      <Textarea
        id={id}
        className="min-h-32 font-mono"
        value={text}
        maxLength={mqttPayloadLimit}
        placeholder={example}
        onChange={(event) => setText(event.target.value)}
        aria-invalid={invalid}
        disabled={saving}
      />
      {invalid && (
        <p className="text-sm text-destructive">
          {t(sensor ? "sensorTemplateInvalid" : "reminderTemplateInvalid")}
        </p>
      )}
      {sensor ? (
        <div className="space-y-2">
          <Label htmlFor="sensor-preview-input">{t("sensorTemplateSample")}</Label>
          <Textarea
            id="sensor-preview-input"
            value={sample}
            maxLength={mqttPayloadLimit}
            className="min-h-24 font-mono"
            onChange={(event) => setSample(event.target.value)}
            aria-invalid={sampleInvalid}
          />
          {sampleInvalid && (
            <p className="text-sm text-destructive">{t("sensorTemplateSampleInvalid")}</p>
          )}
        </div>
      ) : (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{t("reminderTemplateFields")}</summary>
          <code className="mt-2 block break-words">
            {Object.keys(reminderPreview)
              .map((field) => `{{${field}}}`)
              .join("  ")}
          </code>
        </details>
      )}
      {preview && (
        <div>
          <p className="text-sm font-medium">{t("reminderTemplatePreview")}</p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {preview}
          </pre>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setText(example)}
        disabled={saving}
      >
        {t("reminderTemplateExample")}
      </Button>{" "}
      <Button
        type="submit"
        size="sm"
        disabled={invalid || !available || saving || text.trim() === saved}
      >
        {t(saving ? "loading" : "save")}
      </Button>
    </form>
  );
}
