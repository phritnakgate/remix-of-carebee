import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { mqttPayloadLimit } from "@/lib/mqtt";
import { useDevices } from "@/lib/queries";
import {
  readReminderTemplate,
  reminderPreview,
  reminderTemplateExample,
  renderReminderTemplate,
  saveReminderTemplate,
} from "@/lib/reminder-template";

export function ReminderDeveloperSettings({ userId }: { userId: string }) {
  const { t } = useI18n();
  const devices = useDevices(userId);
  const boxes = (devices.data ?? []).filter((box) => box.mode === "real");
  const [selected, setSelected] = useState("");
  const box = boxes.find((candidate) => candidate.id === selected) ?? boxes[0];

  return (
    <details className="rounded-2xl border bg-card p-4 sm:p-5">
      <summary className="cursor-pointer text-lg font-bold">{t("developerSettings")}</summary>
      {box ? (
        <div className="mt-3 space-y-3">
          <Label htmlFor="developer-box">{t("medicineBox")}</Label>
          <Select value={box.id} onValueChange={setSelected}>
            <SelectTrigger id="developer-box" className="w-full sm:max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {boxes.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TemplateEditor key={box.id} boxId={box.id} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {t(devices.isPending ? "loading" : "hwNotConfiguredBody")}
        </p>
      )}
    </details>
  );
}

function TemplateEditor({ boxId }: { boxId: string }) {
  const { t } = useI18n();
  const [text, setText] = useState(() => readReminderTemplate(boxId));
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
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        try {
          saveReminderTemplate(boxId, text);
          toast.success(t("saved"));
        } catch {
          toast.error(t("reminderTemplateSaveFailed"));
        }
      }}
    >
      <p className="text-sm text-muted-foreground">{t("reminderTemplateHint")}</p>
      <Label htmlFor="reminder-template">{t("reminderTemplate")}</Label>
      <Textarea
        id="reminder-template"
        className="min-h-32 font-mono"
        value={text}
        maxLength={mqttPayloadLimit}
        placeholder={reminderTemplateExample}
        onChange={(event) => setText(event.target.value)}
        aria-invalid={invalid}
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
      >
        {t("reminderTemplateExample")}
      </Button>{" "}
      <Button type="submit" size="sm" disabled={invalid}>
        {t("save")}
      </Button>
    </form>
  );
}
