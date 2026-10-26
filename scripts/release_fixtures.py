"""Shared CloudFormation fixtures for the release guard tests."""

LT = "AWS::EC2::LaunchTemplate"
ASG = "AWS::AutoScaling::AutoScalingGroup"
WEB = "Custom::CDKBucketDeployment"
A, B, W1, W2 = "a" * 40, "b" * 40, "1" * 40, "2" * 40


def template(api=A, web=W1, key="old.zip"):
    return {
        "Resources": {
            "ApiLaunchTemplate89": {
                "Type": LT,
                "Properties": {
                    "LaunchTemplateData": {
                        "InstanceType": "t4g.micro",
                        "UserData": {"Fn::Base64": {"Fn::Join": ["", [f"release={api}\n", f"image=repo:{api}"]]}},
                    }
                },
            },
            "ApiGroupASG12": {
                "Type": ASG,
                "Properties": {"MaxSize": "3", "LaunchTemplate": {"Version": {"Fn::GetAtt": ["ApiLaunchTemplate89", "LatestVersionNumber"]}}},
            },
            "WebDeploymentCustomResource08": {
                "Type": WEB,
                "Properties": {"ServiceToken": "arn:fn", "DestinationBucketName": "site", "SourceObjectKeys": [key]},
            },
        },
        "Outputs": {"Release": {"Value": api}, "WebRelease": {"Value": web}, "InfraRelease": {"Value": "i" * 40}},
    }


def change(logical_id, resource_type, replacement="False", details=None):
    return {
        "Type": "Resource",
        "ResourceChange": {
            "LogicalResourceId": logical_id,
            "ResourceType": resource_type,
            "Action": "Modify",
            "Replacement": replacement,
            "Details": details if details is not None else [],
        },
    }


def api_changes():
    return [
        change("ApiLaunchTemplate89", LT),
        change(
            "ApiGroupASG12",
            ASG,
            details=[{"Target": {"Attribute": "Properties"}, "Evaluation": "Dynamic", "CausingEntity": "ApiLaunchTemplate89.LatestVersionNumber"}],
        ),
    ]


PARAMS = [{"ParameterKey": "Ami", "ParameterValue": "/ssm/ami", "ResolvedValue": "ami-1"}]


def description(changes, status="CREATE_COMPLETE", reason="", parameters=None):
    return {"Status": status, "StatusReason": reason, "Changes": changes, "Parameters": parameters or PARAMS}
