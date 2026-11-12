<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Dose status (taken/pending/missed) is derived at read time from schedules + `dose_logs` in `src/lib/medication.ts`, never stored or updated by cron — keeps history consistent and avoids background jobs.
- Access to a person's data goes through the `can_access(owner_id)` SQL helper (owner or linked caregiver) in every RLS policy — one place defines who can see an elder's data.
- Real ESP32 devices are created only by the `registerRealDevice` server function; device keys are stored hashed in `device_keys` (service role only) and verified in `src/lib/device-api.ts` by the `/api/public/device/*` routes — a trigger blocks signed-in users from writing telemetry on real devices so the UI can never fake a connection.
- Simulated devices and their events use `mode/source = 'simulated'` and must render with the sim styling — real and simulated data are never mixed.
- UI strings live in `src/lib/i18n.tsx` (th + en dictionaries); add every new string to both.
