import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import type { Construct } from "constructs";

export const SITE_DOMAIN = "cartoptix.hellodon.dev";
export const ORIGIN_DOMAIN = "cartoptix-origin.hellodon.dev";

/** Separate lifecycle: reuse validated certificates across daily presentation teardown. */
export class CertificateStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { domainName: string }) {
    super(scope, id, props);
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.domainName,
      // External Namecheap DNS: an engineer adds ACM's validation CNAME.
      validation: acm.CertificateValidation.fromDns(),
    });
    new CfnOutput(this, "CertificateArn", { value: certificate.certificateArn });
  }
}
