import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from infra.scripts.check_release_change_set import NO_CHANGES, validate
from release_fixtures import FIXTURES, dynamic, API_NEW, API_OLD, ASG, LT, PARAMS, WEB, WEB_NEW, WEB_OLD, api_changes, change, description, template

STACK = {"Parameters": PARAMS, "Outputs": [{"OutputKey": "WebRelease", "OutputValue": WEB_OLD}]}
API = {"api_from": API_OLD, "api_to": API_NEW, "web_from": WEB_OLD, "web_to": WEB_OLD}
WEB_RELEASE = {"api_from": API_OLD, "api_to": API_OLD, "web_from": WEB_OLD, "web_to": WEB_NEW}


def run_api(proposed, changes=None, desc=None, releases=API, current=None):
    return validate("api", desc or description(changes if changes is not None else api_changes()), STACK, current or template(), proposed, releases)


def run_web(proposed, changes, desc=None):
    web_changes = [change("WebDeploymentCustomResource08", WEB)] if changes is None else changes
    return validate("web", desc or description(web_changes), STACK, template(), proposed, WEB_RELEASE)


class ApiReleaseTests(unittest.TestCase):
    def test_allows_release_and_user_data(self):
        self.assertEqual(run_api(template(api=API_NEW)), "execute")

    def test_rollback_uses_the_same_rules(self):
        rollback = {"api_from": API_NEW, "api_to": API_OLD, "web_from": WEB_OLD, "web_to": WEB_OLD}
        self.assertEqual(run_api(template(api=API_OLD), releases=rollback, current=template(api=API_NEW)), "execute")

    def test_rejects_other_user_data_changes(self):
        proposed = template(api=API_NEW)
        proposed["Resources"]["ApiLaunchTemplate89"]["Properties"]["LaunchTemplateData"]["UserData"]["Fn::Base64"]["Fn::Join"][1].append("curl evil")
        with self.assertRaisesRegex(ValueError, "would change"):
            run_api(proposed)

    def test_ignores_same_prefix_resources_that_are_not_launch_templates(self):
        current, proposed = template(), template(api=API_NEW)
        for t in (current, proposed):
            t["Resources"]["ApiLaunchTemplateProfile50"] = {"Type": "AWS::IAM::InstanceProfile", "Properties": {"Roles": ["role"]}}
        self.assertEqual(run_api(proposed, current=current), "execute")

    def test_rejects_a_launch_template_that_mixes_old_and_new_releases(self):
        proposed = template(api=API_NEW)
        join = proposed["Resources"]["ApiLaunchTemplate89"]["Properties"]["LaunchTemplateData"]["UserData"]["Fn::Base64"]["Fn::Join"][1]
        join[1] = f"image=repo:{API_OLD}"
        with self.assertRaisesRegex(ValueError, "user data does not fully move"):
            run_api(proposed)

    def test_rejects_instance_type(self):
        proposed = template(api=API_NEW)
        proposed["Resources"]["ApiLaunchTemplate89"]["Properties"]["LaunchTemplateData"]["InstanceType"] = "m7g.4xlarge"
        with self.assertRaisesRegex(ValueError, "InstanceType"):
            run_api(proposed)

    def test_rejects_security_group_attachment(self):
        proposed = template(api=API_NEW)
        proposed["Resources"]["ApiLaunchTemplate89"]["Properties"]["LaunchTemplateData"]["SecurityGroupIds"] = ["sg-open"]
        with self.assertRaisesRegex(ValueError, "SecurityGroupIds"):
            run_api(proposed)

    def test_rejects_scaling_capacity(self):
        proposed = template(api=API_NEW)
        proposed["Resources"]["ApiGroupASG12"]["Properties"]["MaxSize"] = "30"
        with self.assertRaisesRegex(ValueError, "MaxSize"):
            run_api(proposed)

    def test_rejects_parameter_change(self):
        moved = [{"ParameterKey": "Ami", "ParameterValue": "/ssm/ami", "ResolvedValue": "ami-2"}]
        with self.assertRaisesRegex(ValueError, "parameters"):
            run_api(template(api=API_NEW), desc=description(api_changes(), parameters=moved))

    def test_rejects_unrelated_output(self):
        proposed = template(api=API_NEW)
        proposed["Outputs"]["InfraRelease"]["Value"] = "x" * 40
        with self.assertRaisesRegex(ValueError, "InfraRelease"):
            run_api(proposed)

    def test_accepts_the_real_change_set_cloudformation_returned(self):
        with open(os.path.join(FIXTURES, "real_api_change_set.json")) as handle:
            real = json.load(handle)
        real["Parameters"] = PARAMS
        self.assertEqual(run_api(template(api=API_NEW), desc=real), "execute")

    def test_conditional_replacement_needs_a_dynamic_cause(self):
        static = [change("ApiGroupASG12", ASG, replacement="Conditional")]
        with self.assertRaisesRegex(ValueError, "conditionally replace"):
            run_api(template(api=API_NEW), changes=static)

    def test_rejects_a_dependent_that_is_caused_by_something_else(self):
        other = [change("ApiGroupScalingPolicy2C", "AWS::AutoScaling::ScalingPolicy", replacement="Conditional", details=dynamic("Database.Endpoint", "Always"))]
        with self.assertRaisesRegex(ValueError, "dynamic"):
            run_api(template(api=API_NEW), changes=other)

    def test_rejects_unexpected_resource_replacement_and_dynamic_change(self):
        with self.assertRaisesRegex(ValueError, "unexpected resource"):
            run_api(template(api=API_NEW), changes=[change("DatabaseABC", "AWS::RDS::DBInstance")])
        with self.assertRaisesRegex(ValueError, "replace or remove"):
            run_api(template(api=API_NEW), changes=[change("ApiLaunchTemplate89", LT, replacement="True")])
        dynamic = [change("ApiGroupASG12", ASG, details=[{"Target": {"Attribute": "Properties"}, "Evaluation": "Dynamic", "CausingEntity": "Database.Endpoint"}])]
        with self.assertRaisesRegex(ValueError, "dynamic"):
            run_api(template(api=API_NEW), changes=dynamic)

    def test_rejects_empty_change_set(self):
        with self.assertRaisesRegex(ValueError, "no change set"):
            run_api(template(api=API_NEW), desc={"Status": "FAILED", "StatusReason": NO_CHANGES[0]})
        with self.assertRaisesRegex(ValueError, "no resource changes"):
            run_api(template(api=API_NEW), changes=[])


class WebReleaseTests(unittest.TestCase):
    def test_allows_asset_and_release_pointer(self):
        self.assertEqual(run_web(template(web=WEB_NEW, key="new.zip"), None), "execute")

    def test_identical_assets_advance_only_the_pointer(self):
        self.assertEqual(run_web(template(web=WEB_NEW), []), "execute")

    def test_no_change_set_is_a_noop_only_when_the_stack_already_runs_the_release(self):
        missing = {"Status": "FAILED", "StatusReason": NO_CHANGES[1]}
        deployed = {"Parameters": PARAMS, "Outputs": [{"OutputKey": "WebRelease", "OutputValue": WEB_NEW}]}
        self.assertEqual(validate("web", missing, deployed, template(), template(), WEB_RELEASE), "noop")

    def test_missing_change_set_with_a_stale_release_output_fails_closed(self):
        missing = {"Status": "FAILED", "StatusReason": NO_CHANGES[0]}
        with self.assertRaisesRegex(ValueError, "does not show"):
            validate("web", missing, STACK, template(), template(), WEB_RELEASE)
        no_output = {"Parameters": PARAMS, "Outputs": []}
        with self.assertRaisesRegex(ValueError, "does not show"):
            validate("web", missing, no_output, template(), template(), WEB_RELEASE)

    def test_rejects_assets_changed_without_resource_changes(self):
        with self.assertRaisesRegex(ValueError, "no resource changes"):
            run_web(template(web=WEB_NEW, key="new.zip"), [])

    def test_rejects_destination_and_service_token(self):
        for prop in ("DestinationBucketName", "ServiceToken"):
            proposed = template(web=WEB_NEW, key="new.zip")
            proposed["Resources"]["WebDeploymentCustomResource08"]["Properties"][prop] = "elsewhere"
            with self.subTest(prop=prop), self.assertRaisesRegex(ValueError, prop):
                run_web(proposed, None)

    def test_rejects_api_and_bucket_changes(self):
        proposed = template(web=WEB_NEW, key="new.zip")
        proposed["Resources"]["ApiGroupASG12"]["Properties"]["MaxSize"] = "30"
        with self.assertRaisesRegex(ValueError, "MaxSize"):
            run_web(proposed, None)
        with self.assertRaisesRegex(ValueError, "unexpected resource"):
            run_web(template(web=WEB_NEW, key="new.zip"), [change("WebBucket", "AWS::S3::Bucket")])

    def test_rejects_unknown_stage_and_failed_change_set(self):
        with self.assertRaisesRegex(ValueError, "unknown"):
            validate("infra", description([]), STACK, template(), template(), API)
        with self.assertRaisesRegex(ValueError, "FAILED"):
            run_web(template(), None, desc={"Status": "FAILED", "StatusReason": "boom"})


if __name__ == "__main__":
    unittest.main()
