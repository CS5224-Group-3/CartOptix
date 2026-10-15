import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App, Tags } from "aws-cdk-lib";
import { PresentationStack } from "../src/presentation-stack.ts";

const app = new App();

// Fixed rather than looked up, so `cdk synth` needs no AWS credentials.
const ACCOUNT = "485530831349";
const REGION = "ap-southeast-1";

// Deploy through scripts/deploy.sh, which checks the release before passing it.
const release = String(app.node.tryGetContext("release") ?? "");
if (!/^[0-9a-f]{40}$/.test(release)) {
  throw new Error(`Context "release" must be a full commit SHA, received "${release}".`);
}

const minInstances = Number(app.node.tryGetContext("minInstances") ?? 1);
if (![1, 2, 3].includes(minInstances)) {
  throw new Error(`Context "minInstances" must be 1, 2 or 3, received "${minInstances}".`);
}

// Calibrated by the shakedown run in infra/RUNBOOK.md (#21). The default is a
// starting point, not a measurement: roughly 5 requests per second per
// instance, so the load model's 12 RPS surge scales a second instance out.
// Override with -c targetRequestsPerMinute=<n> once a run has measured it.
const targetRequestsPerMinute = Number(app.node.tryGetContext("targetRequestsPerMinute") ?? 300);
if (!Number.isInteger(targetRequestsPerMinute) || targetRequestsPerMinute < 1) {
  throw new Error(
    `Context "targetRequestsPerMinute" must be a positive integer, received "${targetRequestsPerMinute}".`,
  );
}

const webDist = fileURLToPath(new URL("../../apps/web/dist", import.meta.url));
if (!existsSync(`${webDist}/index.html`)) {
  throw new Error(`No web build at ${webDist}. Run "pnpm --filter @cartoptix/web build" first.`);
}

// Every resource carries this tag so the CartOptix budget can exclude other
// workloads in the shared account.
Tags.of(app).add("Project", "cartoptix");

new PresentationStack(app, "CartOptixPresentation", {
  env: { account: ACCOUNT, region: REGION },
  description: "CartOptix presentation deployment (#20). Destroy after each working session.",
  release,
  minInstances,
  webDist,
  targetRequestsPerMinute,
});
