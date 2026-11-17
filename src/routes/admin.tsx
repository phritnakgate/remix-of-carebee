import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { LangSwitch } from "@/components/lang-switch";
import { DeveloperTemplateEditor } from "@/components/reminder-developer-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminAuth, adminHeaders } from "@/lib/admin-auth";
import {
  checkAdminAccess,
  getAdminTemplate,
  listAdminRecords,
  saveAdminTemplate,
  updateAdminRecord,
  type AdminTable,
} from "@/lib/admin.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "CareBee Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

async function sessionHeaders() {
  const { data } = await adminAuth().getSession();
  if (!data.session) throw new Error("Admin session expired");
  return adminHeaders(data.session.access_token);
}

function AdminPage() {
  const { t } = useI18n();
  const [sessionId, setSessionId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    let auth: ReturnType<typeof adminAuth> | undefined;
    setPending(true);
    setError(false);
    try {
      auth = adminAuth();
      const { data } = await auth.signInWithPassword({
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password")),
      });
      if (!data.session) throw new Error("Sign-in failed");
      if (!(await checkAdminAccess({ headers: adminHeaders(data.session.access_token) }))) {
        throw new Error("Admin access required");
      }
      setSessionId(crypto.randomUUID());
    } catch {
      setError(true);
      await auth?.signOut({ scope: "local" }).catch(() => {});
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-4 px-4 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("adminTitle")}</h1>
        <div className="flex items-center gap-2">
          <LangSwitch />
          {sessionId && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setPending(true);
                setSessionId("");
                try {
                  await adminAuth().signOut({ scope: "local" });
                } finally {
                  setPending(false);
                }
              }}
            >
              {t("signOut")}
            </Button>
          )}
        </div>
      </header>
      {sessionId ? (
        <AdminWorkspace sessionId={sessionId} />
      ) : (
        <form onSubmit={signIn} className="max-w-sm space-y-3 rounded-xl border bg-card p-4">
          <div className="space-y-1">
            <Label htmlFor="admin-email">{t("adminEmail")}</Label>
            <Input
              required
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="admin-password">{t("adminPassword")}</Label>
            <Input
              required
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={pending}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("adminSignInFailed")}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {t(pending ? "loading" : "signIn")}
          </Button>
        </form>
      )}
    </main>
  );
}

const tables = {
  profiles: "profile",
  devices: "devices",
  medicines: "medicines",
  medication_schedules: "adminSchedules",
} as const;

const sections = { reminder: "reminderTemplate", sensor: "sensorTemplate", ...tables } as const;

function AdminWorkspace({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [section, setSection] = useState<keyof typeof sections>("reminder");

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(sections) as (keyof typeof sections)[]).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={item === section ? "default" : "outline"}
            aria-pressed={item === section}
            onClick={() => setSection(item)}
          >
            {t(sections[item])}
          </Button>
        ))}
      </div>
      {section === "reminder" || section === "sensor" ? (
        <AdminTemplate key={section} kind={section} sessionId={sessionId} />
      ) : (
        <AdminRecords key={section} sessionId={sessionId} table={section} />
      )}
    </>
  );
}

function AdminTemplate({ sessionId, kind }: { sessionId: string; kind: "reminder" | "sensor" }) {
  const { t } = useI18n();
  const template = useQuery({
    queryKey: ["admin-template", sessionId, kind],
    queryFn: async () => getAdminTemplate({ headers: await sessionHeaders(), data: { kind } }),
    gcTime: 0,
    retry: false,
  });
  return (
    <section className="rounded-xl border bg-card p-4">
      {template.isPending && <p role="status">{t("loading")}</p>}
      {template.isError && <p role="alert">{t("adminLoadFailed")}</p>}
      {!template.isError && template.data && (
        <DeveloperTemplateEditor
          kind={kind}
          initialTemplate={template.data.template}
          available={template.data.available}
          onSave={async (value) =>
            saveAdminTemplate({
              headers: await sessionHeaders(),
              data: { kind, template: value },
            })
          }
        />
      )}
    </section>
  );
}

type AdminRecord = Awaited<ReturnType<typeof listAdminRecords>>["rows"][number];

function AdminRecords({ sessionId, table }: { sessionId: string; table: AdminTable }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1);
  const records = useQuery({
    queryKey: ["admin-records", sessionId, table, after, filter],
    queryFn: async () =>
      listAdminRecords({
        data: { table, after, filter: filter || undefined },
        headers: await sessionHeaders(),
      }),
    gcTime: 0,
    retry: false,
  });
  return (
    <section className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(String(new FormData(event.currentTarget).get("uuid")).trim());
          setCursors([]);
        }}
      >
        <div className="w-full max-w-sm space-y-1">
          <Label htmlFor="record-filter">{t("adminFilter")}</Label>
          <Input
            id="record-filter"
            name="uuid"
            pattern="[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          {t("adminApplyFilter")}
        </Button>
      </form>
      {records.isPending && <p role="status">{t("loading")}</p>}
      {records.isError && <p role="alert">{t("adminLoadFailed")}</p>}
      {records.data?.rows.length === 0 && <p>{t("adminNoRecords")}</p>}
      <ul className="grid gap-2">
        {!records.isError &&
          records.data?.rows.map((row) => (
            <li key={row.id}>
              <RecordEditor record={row} setSaved={() => records.refetch()} />
            </li>
          ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!cursors.length}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          {t("previous")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!records.data?.next}
          onClick={() => {
            const next = records.data?.next;
            if (next) setCursors([...cursors, next]);
          }}
        >
          {t("next")}
        </Button>
      </div>
    </section>
  );
}

type AdminUpdate = Parameters<typeof updateAdminRecord>[0]["data"];

function recordUpdate(record: AdminRecord, form: FormData): AdminUpdate {
  const id = record.id;
  if ("display_name" in record)
    return {
      table: "profiles",
      id,
      values: {
        display_name: String(form.get("display_name")),
        phone: String(form.get("phone")),
        timezone: String(form.get("timezone")),
      },
    };
  if ("dose_time" in record)
    return {
      table: "medication_schedules",
      id,
      values: { dose_time: String(form.get("dose_time")), notify: form.has("notify") },
    };
  const name = String(form.get("name"));
  if ("quantity" in record)
    return {
      table: "medicines",
      id,
      values: { name, quantity: Number(form.get("quantity")), active: form.has("active") },
    };
  return { table: "devices", id, values: { name } };
}

function RecordEditor({ record, setSaved }: { record: AdminRecord; setSaved: () => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const title =
    "display_name" in record
      ? record.display_name
      : "dose_time" in record
        ? record.dose_time.slice(0, 5)
        : record.name;
  const prefix = record.id;
  return (
    <details className="rounded-xl border bg-card p-3">
      <summary className="cursor-pointer break-all text-sm font-semibold">
        {title || t("adminUnnamed")}{" "}
        <code className="ml-1 text-xs font-normal text-muted-foreground">{record.id}</code>
      </summary>
      <dl className="my-2 grid gap-1 break-all text-xs text-muted-foreground">
        {"owner_id" in record && (
          <div>
            <dt className="inline">{t("adminOwnerId")} </dt>
            <dd className="inline font-mono">{record.owner_id}</dd>
          </div>
        )}
        {"device_id" in record && record.device_id && (
          <div>
            <dt className="inline">{t("adminDeviceId")} </dt>
            <dd className="inline font-mono">{record.device_id}</dd>
          </div>
        )}
        {"medicine_id" in record && (
          <div>
            <dt className="inline">{t("adminMedicineId")} </dt>
            <dd className="inline font-mono">{record.medicine_id}</dd>
          </div>
        )}
        {"box_slot" in record && record.box_slot && (
          <div>
            <dt className="inline">{t("adminBoxRound")} </dt>
            <dd className="inline font-mono">{record.box_slot}</dd>
          </div>
        )}
        {"mode" in record && (
          <div>
            <dt className="inline">
              {t(record.mode === "simulated" ? "simulated" : "realDevice")} · {t("lastSeen")}{" "}
            </dt>
            <dd className="inline">
              {record.last_seen_at ? new Date(record.last_seen_at).toLocaleString() : "—"}
            </dd>
          </div>
        )}
      </dl>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          const data = recordUpdate(record, new FormData(event.currentTarget));
          setPending(true);
          try {
            await updateAdminRecord({ data, headers: await sessionHeaders() });
            setSaved();
            toast.success(t("saved"));
          } catch {
            toast.error(t("adminRecordSaveFailed"));
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={pending} className="grid items-end gap-3 sm:grid-cols-2">
          {"display_name" in record && (
            <>
              <Field id={`${prefix}-display`} label={t("displayName")}>
                <Input
                  id={`${prefix}-display`}
                  name="display_name"
                  maxLength={60}
                  defaultValue={record.display_name ?? ""}
                />
              </Field>
              <Field id={`${prefix}-phone`} label={t("phone")}>
                <Input
                  id={`${prefix}-phone`}
                  name="phone"
                  type="tel"
                  maxLength={20}
                  defaultValue={record.phone ?? ""}
                />
              </Field>
              <Field id={`${prefix}-tz`} label={t("timezone")}>
                <Input
                  required
                  id={`${prefix}-tz`}
                  name="timezone"
                  maxLength={100}
                  defaultValue={record.timezone}
                />
              </Field>
            </>
          )}
          {"name" in record && (
            <Field id={`${prefix}-name`} label={t("adminName")}>
              <Input
                required
                id={`${prefix}-name`}
                name="name"
                maxLength={60}
                defaultValue={record.name}
              />
            </Field>
          )}
          {"quantity" in record && (
            <>
              <Field id={`${prefix}-quantity`} label={t("quantity")}>
                <Input
                  required
                  id={`${prefix}-quantity`}
                  name="quantity"
                  type="number"
                  min={0}
                  max={2147483647}
                  defaultValue={record.quantity}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input name="active" type="checkbox" defaultChecked={record.active} />
                {t("active")}
              </label>
            </>
          )}
          {"dose_time" in record && (
            <>
              <Field id={`${prefix}-time`} label={t("time")}>
                <Input
                  required
                  id={`${prefix}-time`}
                  name="dose_time"
                  type="time"
                  defaultValue={record.dose_time.slice(0, 5)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input name="notify" type="checkbox" defaultChecked={record.notify} />
                {t("reminderOn")}
              </label>
            </>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm">
              {t(pending ? "loading" : "save")}
            </Button>
          </div>
        </fieldset>
      </form>
    </details>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
