import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";

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

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

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

    // Single-AZ: an application-instance failure is survivable, a database
    // failure is not. Do not describe this as failover.
    this.database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        // Matches the local PostgreSQL 18 image; verified offered on db.t4g.micro in #6.
        version: rds.PostgresEngineVersion.of("18.6", "18"),
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
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
  }
}
