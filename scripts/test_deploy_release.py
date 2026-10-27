import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_fixtures import ENV, PARAMS, WEB, api_changes, change, description, git, template

SCRIPTS = Path(__file__).resolve().parents[1] / "infra" / "scripts"

FAKE_AWS = r"""#!/usr/bin/env python3
import json, os, sys
d = os.environ["FAKE_DIR"]
args = sys.argv[1:]
open(f"{d}/calls", "a").write("aws " + " ".join(args) + "\n")
cmd = " ".join(args[:2])
read = lambda name: open(f"{d}/{name}").read()
if cmd == "cloudformation describe-stacks":
    stack = json.loads(read("stack.json"))
    print(json.dumps(stack["Stacks"][0] if "--query" in args else stack))
elif cmd == "cloudformation get-template":
    print(read("proposed.json" if "--change-set-name" in args else "current.json"))
elif cmd == "cloudformation describe-change-set":
    if os.path.exists(f"{d}/no-change-set"):
        sys.stderr.write("An error occurred (ChangeSetNotFound)\n")
        sys.exit(254)
    print(read("changes.json"))
elif cmd == "autoscaling describe-auto-scaling-groups":
    print(json.dumps({"AutoScalingGroups": [{"MinSize": 1, "MaxSize": 3}]}))
elif cmd == "autoscaling describe-policies":
    print(json.dumps({"ScalingPolicies": [{"TargetTrackingConfiguration": {"TargetValue": 3300}, "EstimatedInstanceWarmup": 480}]}))
elif cmd == "ecr describe-images":
    print("{}")
"""
FAKE_PNPM = '#!/usr/bin/env bash\necho "pnpm $*" >> "$FAKE_DIR/calls"\n'
FAKE_MIGRATIONS = '#!/usr/bin/env bash\necho "migrations $*" >> "$FAKE_DIR/calls"\n'


def executable(path, text):
    path.write_text(text)
    path.chmod(0o755)


class DeployReleaseTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.repo, self.fake = tmp / "repo", tmp / "fake"
        self.fake.mkdir()
        scripts = self.repo / "infra" / "scripts"
        scripts.mkdir(parents=True)
        for name in ("deploy-release.sh", "release_scope.py", "check_release_change_set.py"):
            shutil.copy(SCRIPTS / name, scripts / name)
        executable(scripts / "run-migrations.sh", FAKE_MIGRATIONS)
        for name in ("aws", "pnpm", "curl"):
            executable(self.fake / name, {"aws": FAKE_AWS, "pnpm": FAKE_PNPM}.get(name, "#!/usr/bin/env bash\nexit 0\n"))
        git(self.repo, "init", "-q")
        self.write({"apps/api/a.ts": "1", "apps/web/w.ts": "1", "packages/contracts/c.ts": "1", "docs/d.md": "1"})
        self.base = self.commit("base")

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, files):
        for name, text in files.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)

    def commit(self, message):
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", message)
        return git(self.repo, "rev-parse", "HEAD")

    def stage(self, current, proposed, changes, web_release=None, **extra):
        outputs = [{"OutputKey": k, "OutputValue": v} for k, v in (
            ("Release", self.base), ("WebRelease", web_release or self.base), ("InfraRelease", self.base),
            ("AutoScalingGroupName", "group"), ("Url", "https://example.test"))]
        stack = {"Stacks": [{"Outputs": outputs, "Parameters": PARAMS}]}
        files = {"stack.json": stack, "current.json": current, "proposed.json": proposed, "changes.json": changes}
        for name, value in files.items():
            (self.fake / name).write_text(json.dumps(value))
        if extra.get("no_change_set"):
            (self.fake / "no-change-set").touch()

    def release(self, head, dry_run=False):
        env = {**ENV, "PATH": f"{self.fake}{os.pathsep}{ENV['PATH']}", "FAKE_DIR": str(self.fake), "CI": "true", "RELEASE": head}
        if dry_run:
            env["DRY_RUN"] = "true"
        result = subprocess.run(
            [str(self.repo / "infra" / "scripts" / "deploy-release.sh")], env=env, capture_output=True, text=True, cwd=self.repo / "infra"
        )
        calls = (self.fake / "calls").read_text().splitlines() if (self.fake / "calls").exists() else []
        return result, calls

    def methods(self, calls):
        return [c.split("--method ")[1].split()[0] for c in calls if "cdk deploy" in c]

    def test_docs_only_change_deploys_nothing(self):
        self.write({"docs/d.md": "2"})
        head = self.commit("docs")
        self.stage(template(), template(), {})
        result, calls = self.release(head)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.methods(calls), [])

    def test_api_only_change_is_detected_from_infra_and_deployed_after_migrations(self):
        self.write({"apps/api/a.ts": "2"})
        head = self.commit("api")
        self.stage(template(self.base, self.base), template(head, self.base), description(api_changes()))
        result, calls = self.release(head)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.methods(calls), ["prepare-change-set", "execute-change-set"])
        order = [c.split()[0] if not c.startswith("pnpm") else "cdk-" + str(self.methods([c])) for c in calls]
        self.assertLess(order.index("migrations"), order.index("cdk-['execute-change-set']"))

    def test_web_only_change_is_detected_from_infra_and_published(self):
        self.write({"apps/web/w.ts": "2"})
        head = self.commit("web")
        self.stage(template(self.base, self.base), template(self.base, head, key="new.zip"), description([change("WebDeploymentCustomResource08", WEB)]))
        result, calls = self.release(head)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.methods(calls), ["prepare-change-set", "execute-change-set"])
        self.assertFalse(any(c.startswith("migrations") for c in calls))

    def test_unchanged_web_assets_still_advance_the_release_pointer(self):
        self.write({"apps/web/w.ts": "2"})
        head = self.commit("web")
        self.stage(template(self.base, self.base), template(self.base, head), description([]))
        result, calls = self.release(head)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.methods(calls), ["prepare-change-set", "execute-change-set"])

    def test_missing_change_set_with_a_stale_release_output_fails(self):
        self.write({"apps/web/w.ts": "2"})
        head = self.commit("web")
        self.stage(template(), template(), {}, no_change_set=True)
        result, calls = self.release(head)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not show", result.stderr)
        self.assertNotIn("nothing to publish", result.stdout)

    def test_prohibited_infrastructure_change_stops_before_migrations(self):
        self.write({"apps/api/a.ts": "2"})
        head = self.commit("api")
        proposed = template(head, self.base)
        proposed["Resources"]["ApiLaunchTemplate89"]["Properties"]["LaunchTemplateData"]["InstanceType"] = "m7g.4xlarge"
        self.stage(template(self.base, self.base), proposed, description(api_changes()))
        result, calls = self.release(head)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("InstanceType", result.stderr)
        self.assertEqual(self.methods(calls), ["prepare-change-set"])
        self.assertFalse(any(c.startswith("migrations") for c in calls))

    def test_dry_run_validates_then_discards(self):
        self.write({"apps/api/a.ts": "2"})
        head = self.commit("api")
        self.stage(template(self.base, self.base), template(head, self.base), description(api_changes()))
        result, calls = self.release(head, dry_run=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.methods(calls), ["prepare-change-set"])
        self.assertTrue(any("delete-change-set" in c for c in calls))
        self.assertFalse(any(c.startswith("migrations") for c in calls))


if __name__ == "__main__":
    unittest.main()
