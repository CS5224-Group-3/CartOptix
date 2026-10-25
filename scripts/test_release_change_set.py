import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from infra.scripts.check_release_change_set import validate


def change(logical_id, resource_type, action="Modify", replacement="False"):
    return {
        "ResourceChange": {
            "LogicalResourceId": logical_id,
            "ResourceType": resource_type,
            "Action": action,
            "Replacement": replacement,
        }
    }


class ReleaseChangeSetTests(unittest.TestCase):
    def test_allows_api_launch_template_update(self):
        validate("api", [change("ApiLaunchTemplate89156735", "AWS::EC2::LaunchTemplate")])

    def test_allows_web_asset_update(self):
        validate("web", [change("WebDeploymentCustomResource08EEC474", "Custom::CDKBucketDeployment")])

    def test_rejects_unrelated_resource_changes(self):
        with self.assertRaisesRegex(ValueError, "unexpected resource"):
            validate("api", [change("DatabaseABC", "AWS::RDS::DBInstance")])

    def test_rejects_resource_replacement(self):
        with self.assertRaisesRegex(ValueError, "replace or remove"):
            validate("api", [change("ApiLaunchTemplate89156735", "AWS::EC2::LaunchTemplate", replacement="True")])

    def test_rejects_empty_change_set(self):
        with self.assertRaisesRegex(ValueError, "no application resource changes"):
            validate("web", [])


if __name__ == "__main__":
    unittest.main()
