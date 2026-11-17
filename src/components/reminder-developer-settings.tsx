import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { mqttPayloadLimit } from "@/lib/mqtt";
import {
  reminderPreview,
  reminderTemplateExample,
  renderReminderTemplate,
} from "@/lib/reminder-template";

export function ReminderDeveloperSettings({
  initialTemplate,
  available,
  onSave,
}: {
  initialTemplate: string;
  available: boolean;
  onSave: (template: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initialTemplate);
  const [saved, setSaved] = useState(initialTemplate);
  const [saving, setSaving] = useState(false);
  let preview = "";
  let invalid = false;
  if (text.trim()) {
    try {
      preview = JSON.stringify(JSON.parse(renderReminderTemplate(text, reminderPreview)), null, 2);
    } catch {
      invalid = true;
    }
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
          toast.error(t("reminderTemplateSaveFailed"));
        } finally {
          setSaving(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">{t("reminderTemplateHint")}</p>
      {!available && (
        <p role="status" className="text-sm text-destructive">
          {t("adminTemplateUnavailable")}
        </p>
      )}
      <Label htmlFor="reminder-template">{t("reminderTemplate")}</Label>
      <Textarea
        id="reminder-template"
        className="min-h-32 font-mono"
        value={text}
        maxLength={mqttPayloadLimit}
        placeholder={reminderTemplateExample}
        onChange={(event) => setText(event.target.value)}
        aria-invalid={invalid}
        disabled={saving}
      />
      {invalid && <p className="text-sm text-destructive">{t("reminderTemplateInvalid")}</p>}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">{t("reminderTemplateFields")}</summary>
        <code className="mt-2 block break-words">
          {Object.keys(reminderPreview)
            .map((field) => `{{${field}}}`)
            .join("  ")}
        </code>
      </details>
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
        onClick={() => setText(reminderTemplateExample)}
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
