import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { afterAll, describe, expect, it } from "vitest";
import { CertificateStack, ORIGIN_DOMAIN, SITE_DOMAIN } from "./certificates.ts";
import { PresentationStack } from "./presentation-stack.ts";

const webDist = mkdtempSync(join(tmpdir(), "cartoptix-tls-"));
writeFileSync(join(webDist, "index.html"), "<!doctype html><title>TLS test</title>");
afterAll(() => rmSync(webDist, { recursive: true, force: true }));

const app = new App();
const stack = new PresentationStack(app, "Presentation", {
  env: { account: "485530831349", region: "ap-southeast-1" },
  release: "a".repeat(40),
  webRelease: "a".repeat(40),
  infraRelease: "a".repeat(40),
  minInstances: 1,
  maxInstances: 3,
  scalingWarmupSeconds: 480,
  targetRequestsPerMinute: 3300,
  webDist,
});
const template = Template.fromStack(stack);

describe("presentation TLS (#92)", () => {
  it("requires regional certificate parameters without AWS lookups", () => {
    template.hasParameter("ViewerCertificateArn", {
      AllowedPattern: Match.stringLikeRegexp("acm:us-east-1:"),
    });
    template.hasParameter("OriginCertificateArn", {
      AllowedPattern: Match.stringLikeRegexp("acm:ap-southeast-1:"),
    });
    expect(
      app.node.tryGetContext("availability-zones:account=485530831349:region=ap-southeast-1"),
    ).toBeUndefined();
  });

  it("keeps the ALB private and has only an HTTPS listener and HTTPS targets", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internal",
    });
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Protocol: "HTTPS",
      Certificates: [{ CertificateArn: { Ref: "OriginCertificateArn" } }],
      SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: 443,
      Protocol: "HTTPS",
      HealthCheckProtocol: "HTTPS",
      HealthCheckPath: "/health/live",
    });
    const json = template.toJSON();
    const ingress = Object.values(json.Resources).filter(
      (resource) => (resource as { Type: string }).Type === "AWS::EC2::SecurityGroupIngress",
    );
    for (const resource of ingress) {
      const port = (resource as { Properties: { FromPort: unknown } }).Properties.FromPort;
      expect(port).not.toBe(80);
      expect(port).not.toBe(3001);
    }
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      GroupId: { "Fn::GetAtt": [Match.stringLikeRegexp("^AlbSecurityGroup"), "GroupId"] },
      FromPort: 443,
      ToPort: 443,
      IpProtocol: "tcp",
      SourcePrefixListId: "pl-31a34658",
      Description: "CloudFront VPC origin",
    });
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      FromPort: 443,
      ToPort: 443,
      SourceSecurityGroupId: Match.anyValue(),
      GroupId: { "Fn::GetAtt": [Match.stringLikeRegexp("^ApiSecurityGroup"), "GroupId"] },
    });
  });

  it("uses matching origin SNI, HTTPS only, and the public viewer alias", () => {
    template.hasResourceProperties("AWS::CloudFront::VpcOrigin", {
      VpcOriginEndpointConfig: Match.objectLike({
        HTTPSPort: 443,
        OriginProtocolPolicy: "https-only",
        OriginSSLProtocols: ["TLSv1.2"],
      }),
    });
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: [SITE_DOMAIN],
        ViewerCertificate: {
          AcmCertificateArn: { Ref: "ViewerCertificateArn" },
          MinimumProtocolVersion: "TLSv1.2_2021",
          SslSupportMethod: "sni-only",
        },
        Origins: Match.arrayWith([
          Match.objectLike({ DomainName: ORIGIN_DOMAIN, VpcOriginConfig: Match.anyValue() }),
        ]),
      }),
    });
    template.hasOutput("Url", { Value: `https://${SITE_DOMAIN}` });
    template.hasOutput("ViewerDnsTarget", { Value: Match.anyValue() });
    template.hasOutput("OriginDnsTarget", { Value: Match.anyValue() });
  });

  it("generates instance-local keys, binds API to loopback, and gates signals on HTTPS", () => {
    const resources = template.findResources("AWS::EC2::LaunchTemplate");
    const resource = Object.values(resources)[0];
    if (!resource) throw new Error("Missing launch template");
    const boot = JSON.stringify(resource.Properties.LaunchTemplateData.UserData);
    expect(boot).toContain("-p 127.0.0.1:3001:3001");
    expect(boot).not.toContain("-p 3001:3001");
    expect(boot).toContain("openssl req -x509");
    expect(boot).toContain("subjectAltName=DNS:$instance_id");
    expect(boot).toContain("chmod 600 /etc/cartoptix/tls/key.pem");
    expect(boot).toContain("listen 443 ssl;");
    expect(boot).not.toMatch(/listen 80[ ;]/);
    expect(boot).toContain("ssl_protocols TLSv1.2 TLSv1.3;");
    expect(boot).toContain("proxy_pass http://127.0.0.1:3001;");
    expect(boot).toContain("--cacert /etc/cartoptix/tls/cert.pem");
    expect(boot).not.toContain("--insecure");
    expect(boot).toContain("nginx -t");
    expect(boot).toContain("/health/live");
    expect(boot).toContain("cfn-signal");
  });

  it.skipIf(process.platform === "win32")("renders valid bash user data", () => {
    const resource = Object.values(template.findResources("AWS::EC2::LaunchTemplate"))[0];
    if (!resource) throw new Error("Missing launch template");
    const userData = resource.Properties.LaunchTemplateData.UserData;
    const commands = userData["Fn::Base64"]["Fn::Join"][1] as unknown[];
    const script = commands
      .map((part) => (typeof part === "string" ? part : "test-value"))
      .join("");
    const syntax = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    expect(syntax.stderr).toBe("");
    expect(syntax.status).toBe(0);
  });
});

describe("certificate lifecycle", () => {
  it.each([
    ["Viewer", "us-east-1", SITE_DOMAIN],
    ["Origin", "ap-southeast-1", ORIGIN_DOMAIN],
  ])("issues %s through external DNS validation", (name, region, domainName) => {
    const certificateStack = new CertificateStack(new App(), name, {
      env: { account: "485530831349", region },
      domainName,
    });
    const certificateTemplate = Template.fromStack(certificateStack);
    certificateTemplate.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    certificateTemplate.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: domainName,
      ValidationMethod: "DNS",
    });
    certificateTemplate.resourceCountIs("AWS::Route53::HostedZone", 0);
    certificateTemplate.resourceCountIs("AWS::Route53::RecordSet", 0);
  });
});
