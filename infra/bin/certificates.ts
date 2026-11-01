import { App, Tags } from "aws-cdk-lib";
import { CertificateStack, ORIGIN_DOMAIN, SITE_DOMAIN } from "../src/certificates.ts";

const app = new App();
Tags.of(app).add("Project", "cartoptix");
for (const [name, region, domainName] of [
  ["CartOptixViewerCertificate", "us-east-1", SITE_DOMAIN],
  ["CartOptixOriginCertificate", "ap-southeast-1", ORIGIN_DOMAIN],
] as const) {
  new CertificateStack(app, name, {
    env: { account: "485530831349", region },
    domainName,
    description:
      "CartOptix public TLS certificate (#92). Remove after final presentation teardown.",
  });
}
