import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const infraRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(infraRoot, "..");
const isWindows = process.platform === "win32";
const useShell = isWindows;
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const cdk = isWindows ? "cdk.cmd" : "cdk";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: useShell });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const releaseResult = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  shell: useShell,
});
if (releaseResult.error) throw releaseResult.error;
if (releaseResult.status !== 0) process.exit(releaseResult.status ?? 1);
const release = releaseResult.stdout.trim();

run(pnpm, ["--filter", "@cartoptix/web", "build"], repoRoot);
run(
  cdk,
  ["synth", "--quiet", "-c", `release=${release}`, "-c", "alertEmail=synth@example.invalid"],
  infraRoot,
);
