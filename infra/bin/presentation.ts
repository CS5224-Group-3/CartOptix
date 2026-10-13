import { App, Tags } from "aws-cdk-lib";
import { PresentationStack } from "../src/presentation-stack.ts";

const app = new App();

// Every resource carries this tag so the CartOptix budget can exclude other
// workloads in the shared account.
Tags.of(app).add("Project", "cartoptix");

new PresentationStack(app, "CartOptixPresentation", {
  // Fixed rather than looked up, so `cdk synth` needs no AWS credentials.
  env: { account: "485530831349", region: "ap-southeast-1" },
  description: "CartOptix presentation deployment (#20). Destroy after each working session.",
});
