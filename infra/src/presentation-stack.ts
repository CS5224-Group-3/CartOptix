import {
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import { ORIGIN_DOMAIN, SITE_DOMAIN } from "./certificates.ts";
import { Observability } from "./observability.ts";

export interface PresentationStackProps extends StackProps {
  /** Full commit SHA of the API image tag. */
  readonly release: string;
  /** Full commit SHA of the web build currently uploaded to S3. */
  readonly webRelease: string;
  /** Full commit SHA whose CDK definition last changed the deployed infrastructure. */
  readonly infraRelease: string;
  /** Baseline application instances: 1 while building, 2 for evaluation and the presentation. */
  readonly minInstances: number;
  /** Existing Auto Scaling Group maximum; app releases must preserve it. */
  readonly maxInstances: number;
  /** Existing target-tracking warm-up, in seconds. */
  readonly scalingWarmupSeconds: number;
  /** Directory holding the built web app (apps/web/dist). */
  readonly webDist: string;
  /**
   * Requests per minute per instance that the scaling policy holds (#21).
   *
   * Calibrated by the shakedown run in the runbook rather than reasoned from
   * the load model, because the figure that matters is what one t4g.micro
   * serves within SC-05 while its CPU credits last.
   */
  readonly targetRequestsPerMinute: number;
}

const API_PORT = 3001;
const TLS_PORT = 443;
// AWS-managed prefix list com.amazonaws.global.cloudfront.origin-facing in
// ap-southeast-1. Hard-coded because looking it up would make synth need AWS.
const CLOUDFRONT_ORIGIN_FACING_PREFIX_LIST = "pl-31a34658";
/**
 * Connections one instance can hold: the comparison pool (4) plus the click
 * recorder's own pool (2), from `apps/api/src/database.ts` and
 * `apps/api/src/events/outbound-click.ts`. Scaling to the configured maximum therefore
 * demands 18, which is what the database has to absorb.
 */
const CONNECTIONS_PER_INSTANCE = 6;

/**
 * `max_connections` pinned on the database (#21).
 *
 * Pinned rather than left to the instance-class default so the headroom over
 * the 18 connections the configured maximum demands is a known number rather than one
 * inferred from a memory formula, and so it cannot move under us if the
 * instance class ever changes. The remainder covers the engineer's SSM tunnel
 * for migrations and RDS's own reserved superuser slots.
 */
const MAX_CONNECTIONS = 100;

/**
 * Presentation deployment (#20): Browser -> CloudFront -> internal ALB -> EC2 ASG -> RDS.
 *
 * The stack is created for a working session or the presentation window and
 * destroyed afterwards, so nothing in it is retained on deletion. The seed is
 * in Git, and click events are dumped by hand before teardown (see the runbook).
 */
export class PresentationStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly database: rds.DatabaseInstance;

  // Fixed rather than looked up, so `cdk synth` needs no AWS access.
  override get availabilityZones(): string[] {
    return ["ap-southeast-1a", "ap-southeast-1b"];
  }

  constructor(scope: Construct, id: string, props: PresentationStackProps) {
    super(scope, id, props);

    // Parameters persist across CI application releases. Certificate issuance
    // and DNS changes remain engineer-owned, outside this daily-lived stack.
    const certificate = (name: string, region: string) =>
      acm.Certificate.fromCertificateArn(
        this,
        name,
        new CfnParameter(this, `${name}Arn`, {
          type: "String",
          allowedPattern: `arn:aws:acm:${region}:[0-9]{12}:certificate/[0-9a-f-]{36}`,
          description: `Issued ACM public certificate in ${region}; see TLS setup in infra/RUNBOOK.md.`,
        }).valueAsString,
      );
    const viewerCertificate = certificate("ViewerCertificate", "us-east-1");
    const originCertificate = certificate("OriginCertificate", "ap-southeast-1");

    // No NAT gateway or interface endpoints: app instances reach ECR and SSM
    // through their own public IPv4 addresses, which is cheaper. The ALB and
    // RDS sit in isolated subnets; CloudFront reaches the ALB through a VPC
    // origin, which needs the internet gateway the public subnets provide.
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // The database never opens outbound connections.
    const databaseSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc: this.vpc,
      description: "CartOptix RDS PostgreSQL",
      allowAllOutbound: false,
    });

    // Matches the local PostgreSQL 18 image; verified offered on db.t4g.micro in #6.
    // Shared with the parameter group below, which must name the same engine.
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.of("18.6", "18"),
    });

    // Pins max_connections (#21) so the headroom over the configured maximum can
    // demand is a stated number rather than an instance-class default.
    const databaseParameters = new rds.ParameterGroup(this, "DatabaseParameters", {
      engine,
      description: "CartOptix PostgreSQL; connection ceiling pinned for #21",
      parameters: { max_connections: String(MAX_CONNECTIONS) },
    });

    // Single-AZ, so the database is a single point of failure. Do not describe
    // this as failover.
    this.database = new rds.DatabaseInstance(this, "Database", {
      engine,
      parameterGroup: databaseParameters,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      multiAz: false,
      publiclyAccessible: false,
      databaseName: "cartoptix",
      credentials: rds.Credentials.fromGeneratedSecret("cartoptix"),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      // Short-lived stack: no backups, snapshots or deletion protection, so
      // `cdk destroy` leaves nothing billable behind.
      backupRetention: Duration.days(0),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Application tier ---------------------------------------------------

    // Owned by the publish job in release.yml (#7). Referenced, never created,
    // so `cdk destroy` leaves the repository and its images in place.
    const repository = ecr.Repository.fromRepositoryName(this, "ApiRepository", "cartoptix-api");

    const logGroup = new logs.LogGroup(this, "ApiLogs", {
      retention: logs.RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const instanceRole = new iam.Role(this, "ApiInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      // Session Manager replaces SSH for administration and the database tunnel.
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    repository.grantPull(instanceRole);
    logGroup.grantWrite(instanceRole);
    // biome-ignore lint/style/noNonNullAssertion: fromGeneratedSecret always creates a secret.
    const databaseSecret = this.database.secret!;
    databaseSecret.grantRead(instanceRole);

    const instanceSecurityGroup = new ec2.SecurityGroup(this, "ApiSecurityGroup", {
      vpc: this.vpc,
      description: "CartOptix API instances; inbound only from the ALB",
      // Outbound reaches ECR, Systems Manager, Secrets Manager, CloudWatch Logs
      // and the package and certificate downloads at boot.
      allowAllOutbound: true,
    });
    this.database.connections.allowDefaultPortFrom(instanceSecurityGroup, "API instances");

    const launchTemplate = new ec2.LaunchTemplate(this, "ApiLaunchTemplate", {
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      // Standard credits: a throttled instance, never a surplus-credit charge.
      cpuCredits: ec2.CpuCredits.STANDARD,
      associatePublicIpAddress: true,
      securityGroup: instanceSecurityGroup,
      role: instanceRole,
      requireImdsv2: true,
      userData: ec2.UserData.forLinux(),
    });

    const group = new autoscaling.AutoScalingGroup(this, "ApiGroup", {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      launchTemplate,
      minCapacity: props.minInstances,
      maxCapacity: props.maxInstances,
      // Publishes desired/in-service capacity to CloudWatch (#21). Without
      // this the ASG reports no capacity metrics at all, and a scaling
      // experiment leaves nothing to read afterwards.
      groupMetrics: [autoscaling.GroupMetrics.all()],
      // Liveness only (see the target group): a database outage does not make
      // instances unhealthy, but a hung application is replaced. The grace
      // period covers a slow first boot: installing Docker alone has taken six
      // minutes on a t4g.micro.
      healthChecks: autoscaling.HealthChecks.withAdditionalChecks({
        additionalTypes: [autoscaling.AdditionalHealthCheckType.ELB],
        gracePeriod: Duration.minutes(15),
      }),
      // Creation and every release wait for each new instance to report that
      // the API answers /health/live; a failed release rolls back.
      signals: autoscaling.Signals.waitForMinCapacity({ timeout: Duration.minutes(15) }),
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
        maxBatchSize: 1,
        minInstancesInService: props.minInstances,
        waitOnResourceSignals: true,
        pauseTime: Duration.minutes(15),
      }),
    });

    // biome-ignore lint/style/noNonNullAssertion: forLinux() always returns user data.
    const userData = launchTemplate.userData!;
    userData.addCommands(
      ...apiBootCommands({
        region: this.region,
        image: repository.repositoryUriForTag(props.release),
        registry: `${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
        secretArn: databaseSecret.secretArn,
        logGroup: logGroup.logGroupName,
        release: props.release,
      }),
    );
    userData.addSignalOnExitCommand(group);

    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: this.vpc,
      description: "CartOptix internal ALB; inbound only from CloudFront",
      allowAllOutbound: false,
    });
    albSecurityGroup.addIngressRule(
      ec2.Peer.prefixList(CLOUDFRONT_ORIGIN_FACING_PREFIX_LIST),
      ec2.Port.tcp(TLS_PORT),
      "CloudFront VPC origin",
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      internetFacing: false,
      securityGroup: albSecurityGroup,
    });

    const listener = alb.addListener("Https", {
      port: TLS_PORT,
      open: false,
      certificates: [originCertificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
    });
    const targets = listener.addTargets("Api", {
      port: TLS_PORT,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      targets: [group],
      healthCheck: {
        protocol: elbv2.Protocol.HTTPS,
        path: "/health/live",
        interval: Duration.seconds(15),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: Duration.seconds(30),
      // A joining instance has a cold database pool and, in standard credit
      // mode, no CPU credits. Given its full share at once, it failed 0.3% of
      // requests (most likely pool timeouts) in the #21 scale-out run; ramp it in.
      slowStart: Duration.seconds(120),
    });

    // Target tracking scales both ways from one policy: it adds instances
    // above the target and removes them below it, so scale-in needs no
    // separate rule.
    //
    // No `cooldown` here. CDK accepts one, but CloudFormation documents
    // `Cooldown` as valid only for simple scaling, so on a target-tracking
    // policy it is inert. The timing instead comes from the two alarms AWS
    // creates with the policy: roughly three one-minute datapoints above
    // target before scaling out, and about fifteen below it before scaling
    // in. The shakedown records what was actually observed rather than
    // asserting those figures here.
    group.scaleOnRequestCount("RequestsPerTarget", {
      targetRequestsPerMinute: props.targetRequestsPerMinute,
      // A new instance installs Docker and pulls the image before it serves
      // anything. Counting its empty request rate before then would read as
      // spare capacity and cancel the scale-out that just happened. Unlike
      // cooldown, this one does apply to target tracking.
      estimatedInstanceWarmup: Duration.seconds(props.scalingWarmupSeconds),
    });

    // --- Edge ---------------------------------------------------------------

    const siteBucket = new s3.Bucket(this, "WebBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const vpcOrigin = new cloudfront.VpcOrigin(this, "ApiVpcOrigin", {
      endpoint: cloudfront.VpcOriginEndpoint.applicationLoadBalancer(alb),
      httpsPort: TLS_PORT,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
    });
    // Ensure the HTTPS listener exists before CloudFront provisions the VPC origin.
    vpcOrigin.node.addDependency(listener);
    const apiOrigin = origins.VpcOrigin.withVpcOrigin(vpcOrigin, { domainName: ORIGIN_DOMAIN });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      // Uncached, so load tests measure the application rather than the edge.
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };

    // The web app routes on the client (/basket, /results, ...). Serve
    // index.html for any path without a file extension. This runs on the
    // frontend behaviour only, so API status codes are never rewritten.
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (!/\\.[a-z0-9]+$/i.test(r.uri)) { r.uri = '/index.html'; } return r; }",
      ),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "CartOptix presentation",
      domainNames: [SITE_DOMAIN],
      certificate: viewerCertificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        "/api/*": apiBehavior,
        "/health/*": apiBehavior,
      },
    });

    new s3deploy.BucketDeployment(this, "WebDeployment", {
      sources: [s3deploy.Source.asset(props.webDist)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // --- Observability (#21) ------------------------------------------------

    const observability = new Observability(this, "Observability", {
      logGroup,
      loadBalancer: alb,
      targetGroup: targets,
      autoScalingGroup: group,
      database: this.database,
      maxInstances: props.maxInstances,
      maxConnections: MAX_CONNECTIONS,
      connectionsPerInstance: CONNECTIONS_PER_INSTANCE,
    });

    new CfnOutput(this, "Url", { value: `https://${SITE_DOMAIN}` });
    new CfnOutput(this, "ViewerDnsTarget", { value: distribution.distributionDomainName });
    new CfnOutput(this, "OriginDnsTarget", { value: alb.loadBalancerDnsName });
    new CfnOutput(this, "Dashboard", {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/${observability.dashboard.dashboardName}`,
    });
    new CfnOutput(this, "Release", { value: props.release });
    new CfnOutput(this, "WebRelease", { value: props.webRelease });
    new CfnOutput(this, "InfraRelease", { value: props.infraRelease });
    new CfnOutput(this, "AutoScalingGroupName", { value: group.autoScalingGroupName });
    new CfnOutput(this, "DatabaseEndpoint", { value: this.database.dbInstanceEndpointAddress });
    new CfnOutput(this, "DatabaseSecretArn", { value: databaseSecret.secretArn });
  }
}

interface BootOptions {
  region: string;
  image: string;
  registry: string;
  secretArn: string;
  logGroup: string;
  release: string;
}

/**
 * Boot script for an API instance: install Docker, build DATABASE_URL from the
 * RDS secret, run the release's image and wait until nginx serves HTTPS liveness. A
 * non-zero exit is reported to CloudFormation by the signal command.
 */
function apiBootCommands(o: BootOptions): string[] {
  const caBundle = `https://truststore.pki.rds.amazonaws.com/${o.region}/${o.region}-bundle.pem`;
  return [
    "set -euo pipefail",
    "dnf install -y docker jq aws-cfn-bootstrap nginx openssl",
    "systemctl enable --now docker",
    "install -d -m 755 /etc/cartoptix",
    // The API verifies the database's certificate against the RDS CA bundle.
    `curl -fsSL --retry 5 -o /etc/cartoptix/rds-ca.pem ${caBundle}`,
    "chmod 644 /etc/cartoptix/rds-ca.pem",
    `secret=$(aws secretsmanager get-secret-value --region ${o.region} --secret-id ${o.secretArn} --query SecretString --output text)`,
    'url=$(jq -r \'"postgresql://\\(.username):\\(.password|@uri)@\\(.host):\\(.port)/\\(.dbname)?sslmode=verify-full&sslrootcert=/certs/rds-ca.pem"\' <<<"$secret")',
    "umask 077",
    "printf 'DATABASE_URL=%s\\nNODE_ENV=production\\n' \"$url\" > /etc/cartoptix/api.env",
    "umask 022",
    `aws ecr get-login-password --region ${o.region} | docker login --username AWS --password-stdin ${o.registry}`,
    'instance_id=$(TOKEN=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" http://169.254.169.254/latest/api/token) && curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)',
    [
      "docker run -d --name cartoptix-api --restart unless-stopped",
      `-p 127.0.0.1:${API_PORT}:${API_PORT}`,
      "--env-file /etc/cartoptix/api.env",
      "-v /etc/cartoptix/rds-ca.pem:/certs/rds-ca.pem:ro",
      `--label com.cartoptix.release=${o.release}`,
      "--log-driver awslogs",
      `--log-opt awslogs-region=${o.region}`,
      `--log-opt awslogs-group=${o.logGroup}`,
      '--log-opt awslogs-stream="$instance_id"',
      o.image,
    ].join(" "),
    // Each instance generates its own key; no shared key, CA service or Git secret.
    "install -d -m 700 /etc/cartoptix/tls",
    'openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 90 -subj "/CN=$instance_id" -addext "subjectAltName=DNS:$instance_id" -keyout /etc/cartoptix/tls/key.pem -out /etc/cartoptix/tls/cert.pem',
    "chmod 600 /etc/cartoptix/tls/key.pem",
    // Replace the default config so nginx never opens an HTTP listener.
    "cat > /etc/nginx/nginx.conf <<'NGINX'",
    "user nginx;",
    "worker_processes auto;",
    "error_log /var/log/nginx/error.log warn;",
    "pid /run/nginx.pid;",
    "events { worker_connections 1024; }",
    "http {",
    "  access_log off;",
    "  server {",
    `    listen ${TLS_PORT} ssl;`,
    "    ssl_certificate /etc/cartoptix/tls/cert.pem;",
    "    ssl_certificate_key /etc/cartoptix/tls/key.pem;",
    "    ssl_protocols TLSv1.2 TLSv1.3;",
    "    ssl_ciphers ECDHE+AESGCM:ECDHE+CHACHA20;",
    "    location / {",
    `      proxy_pass http://127.0.0.1:${API_PORT};`,
    "      proxy_http_version 1.1;",
    "      proxy_set_header Connection '';",
    "      proxy_set_header Host $host;",
    "      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "      proxy_set_header X-Forwarded-Proto https;",
    "    }",
    "  }",
    "}",
    "NGINX",
    "nginx -t",
    "systemctl enable --now nginx",
    // Trust precisely this instance's certificate; do not use curl --insecure.
    `for attempt in $(seq 1 30); do curl -fsS --connect-timeout 1 --max-time 2 --noproxy '*' --cacert /etc/cartoptix/tls/cert.pem --resolve "$instance_id:${TLS_PORT}:127.0.0.1" -o /dev/null "https://$instance_id:${TLS_PORT}/health/live" && exit 0; sleep 2; done`,
    "echo 'The HTTPS proxy did not serve API liveness within two minutes.' >&2",
    "exit 1",
  ];
}
