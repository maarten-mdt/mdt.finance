"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { withContext } from "@/lib/db";
import { SETTING_META, formatSetting, parseSettingInput } from "@/lib/settings";

export interface SettingState {
  ok?: string;
  error?: string;
}

/** Settings are never edited: a change is a new row effective from now. */
export async function changeSettingAction(_prev: SettingState, form: FormData): Promise<SettingState> {
  const viewer = await requireAdmin();
  const key = String(form.get("key") ?? "");
  const meta = SETTING_META[key];
  if (!meta) return { error: "Unknown setting." };
  let value: bigint;
  try {
    value = parseSettingInput(key, String(form.get("value") ?? ""));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  await withContext(adminContext(viewer), (tx) =>
    tx.query(
      `INSERT INTO settings (key, int_value, description)
       SELECT $1, $2, description FROM current_settings WHERE key = $1`,
      [key, value.toString()],
    ),
  );
  revalidatePath("/admin/settings");
  return { ok: `${meta.label} is now ${formatSetting(key, value)}.` };
}
