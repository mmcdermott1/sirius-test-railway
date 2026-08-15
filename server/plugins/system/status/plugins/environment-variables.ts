/**
 * Environment-variables status plugin (Task #1052).
 *
 * scan(): terse counts + required-but-unset warnings, safe to cache.
 * details(): full listing grouped by category with values — secret values
 * FULLY obfuscated server-side (they never leave the server), long
 * non-secret values truncated. NOTHING in this path may log values.
 */
import {
  getEnvironmentVariable,
  listEnvironmentVariables,
} from "../../../../config/env-registry";
import { registerSystemStatusPlugin } from "../registry";
import type { StatusDetailGroup, StatusDetailRow, StatusMessage } from "../types";

const OBFUSCATED = "••••••••";
const MAX_VALUE_LENGTH = 120;

function displayValue(name: string, secret: boolean, isSet: boolean): string | undefined {
  if (!isSet) return undefined;
  if (secret) return OBFUSCATED;
  let value: string | undefined;
  try {
    value = getEnvironmentVariable(name);
  } catch {
    // A transform/required hook threw; presence is already known via isSet.
    return "(unreadable)";
  }
  if (value === undefined || value === "") return undefined;
  if (value.length > MAX_VALUE_LENGTH) {
    return `${value.slice(0, MAX_VALUE_LENGTH)}… (${value.length} chars)`;
  }
  return value;
}

registerSystemStatusPlugin({
  id: "environment-variables",
  name: "Environment Variables",
  description:
    "Registered environment variables: counts, required-but-unset warnings, and a full drill-down.",
  async scan(): Promise<StatusMessage[]> {
    const vars = listEnvironmentVariables();
    const set = vars.filter((v) => v.isSet).length;
    const unset = vars.length - set;
    const secret = vars.filter((v) => v.secret).length;
    const requiredUnset = vars.filter((v) => v.required && !v.isSet);
    const messages: StatusMessage[] = [
      {
        priority: "info",
        title: `${vars.length} registered variable${vars.length === 1 ? "" : "s"}, ${set} set, ${unset} unset`,
        details: `${secret} marked secret. Use Details for the full listing.`,
      },
    ];
    for (const v of requiredUnset) {
      messages.push({
        priority: "warning",
        title: `Required variable ${v.name} is not set`,
        details: v.description,
      });
    }
    return messages;
  },
  async details() {
    const vars = listEnvironmentVariables();
    const byCategory = new Map<string, StatusDetailRow[]>();
    for (const v of vars) {
      const badges: string[] = [];
      if (v.secret) badges.push("secret");
      if (v.required) badges.push("required");
      badges.push(v.isSet ? "set" : "unset");
      const row: StatusDetailRow = {
        label: v.name,
        description: v.description,
        value: displayValue(v.name, v.secret, v.isSet),
        badges,
        priority: v.required && !v.isSet ? "warning" : "info",
      };
      const rows = byCategory.get(v.category);
      if (rows) rows.push(row);
      else byCategory.set(v.category, [row]);
    }
    const groups: StatusDetailGroup[] = Array.from(byCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, rows]) => ({ title, rows }));
    return { groups };
  },
});
