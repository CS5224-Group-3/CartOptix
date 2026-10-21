/** Command-line options for refresh.ts, validated before anything is collected. */
import { parseArgs } from "node:util";
import { RETAILERS, type Retailer } from "./observation.ts";

export interface Options {
  command: "new" | "listings" | "search" | "sellers";
  retailers: readonly Retailer[];
  headed: boolean;
  /** Lazada checks a run may meet before skipping its remaining items; unlimited when absent. */
  maxChecks?: number;
}

export const USAGE =
  `Usage: node scripts/scrape/refresh.ts listings|search [${RETAILERS.join("|")}…] [--headed] [--max-checks N]\n` +
  "       node scripts/scrape/refresh.ts new|sellers [--headed] [--max-checks N]";

export function parseOptions(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { headed: { type: "boolean" }, "max-checks": { type: "string" } },
  });
  const [command, ...names] = positionals;
  if (
    command !== "new" &&
    command !== "listings" &&
    command !== "search" &&
    command !== "sellers"
  ) {
    throw new Error(USAGE);
  }
  const unknown = names.filter((name) => !(RETAILERS as readonly string[]).includes(name));
  if (unknown.length > 0 || ((command === "new" || command === "sellers") && names.length > 0)) {
    throw new Error(USAGE);
  }
  const raw = values["max-checks"];
  if (raw !== undefined && !/^\d+$/.test(raw)) {
    throw new Error(`--max-checks needs a whole number of checks, not ${JSON.stringify(raw)}`);
  }
  return {
    command,
    retailers: names.length > 0 ? RETAILERS.filter((r) => names.includes(r)) : RETAILERS,
    headed: values.headed ?? false,
    maxChecks: raw === undefined ? undefined : Number(raw),
  };
}
