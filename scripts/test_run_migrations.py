import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "infra" / "scripts" / "run-migrations.sh"
RELEASE = "a" * 40

FAKE_AWS = r"""#!/usr/bin/env python3
import json, os, sys
d = os.environ["FAKE_DIR"]
args = sys.argv[1:]
open(f"{d}/calls", "a").write(" ".join(args) + "\n")
cmd = " ".join(args[:2])
statuses = f"{d}/statuses"
if cmd == "autoscaling describe-auto-scaling-groups":
    print("i-abc")
elif cmd == "ssm list-commands":
    # Like the real API: only report the busy command if the query asks for its status.
    busy_status = os.environ.get("FAKE_BUSY_STATUS", "InProgress")
    print(os.environ["FAKE_BUSY"] if os.environ.get("FAKE_BUSY") and f"Status=='{busy_status}'" in " ".join(args) else "None")
elif cmd == "ssm send-command":
    print("cmd-1")
elif cmd == "ssm cancel-command":
    open(f"{d}/cancelled", "w").close()
elif cmd == "ssm get-command-invocation":
    if os.path.exists(f"{d}/cancelled") and not os.environ.get("FAKE_STUCK"):
        current = "Cancelled"
    else:
        queue = open(statuses).read().split()
        current = queue[0]
        if len(queue) > 1:
            open(statuses, "w").write("\n".join(queue[1:]))
    if "--query" in args:
        print(current)
    else:
        print(json.dumps({"Status": current, "StandardOutputContent": "migrated\n", "StandardErrorContent": "boom\n"}))
"""


@unittest.skipUnless(shutil.which("jq"), "jq is required")
class RunMigrationsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        fake = self.dir / "aws"
        fake.write_text(FAKE_AWS)
        fake.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{self.dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE_DIR": str(self.dir),
            "CI": "true",
            "MIGRATION_POLL_SECONDS": "0",
            "MIGRATION_DEADLINE_MARGIN_SECONDS": "0",
            "MIGRATION_CANCEL_WAIT_SECONDS": "0",
        }
        self.env.pop("AWS_PROFILE", None)

    def tearDown(self):
        self._tmp.cleanup()

    def start(self, statuses, **extra):
        (self.dir / "statuses").write_text("\n".join(statuses))
        return subprocess.Popen(
            [str(SCRIPT), RELEASE, "group"], env={**self.env, **extra}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )

    def run_script(self, statuses, **extra):
        process = self.start(statuses, **extra)
        out, err = process.communicate(timeout=30)
        return process.returncode, out, err

    @property
    def calls(self):
        return (self.dir / "calls").read_text()

    def test_success_after_a_long_running_command(self):
        code, out, _ = self.run_script(["InProgress"] * 5 + ["Success"])
        self.assertEqual(code, 0)
        self.assertIn("migrated", out)
        self.assertIn('"executionTimeout"', self.calls)

    def test_failed_migration_blocks_the_release(self):
        code, _, err = self.run_script(["InProgress", "Failed"])
        self.assertEqual(code, 1)
        self.assertIn("status Failed", err)
        self.assertIn("boom", err)

    def test_timeout_cancels_and_confirms_a_terminal_status(self):
        code, _, err = self.run_script(["InProgress"], MIGRATION_TIMEOUT_SECONDS="0")
        self.assertEqual(code, 1)
        self.assertIn("timed out", err)
        self.assertIn("ssm cancel-command", self.calls)
        self.assertIn("ended as Cancelled", err)

    def test_unconfirmed_cancel_says_state_is_uncertain(self):
        code, _, err = self.run_script(["InProgress"], MIGRATION_TIMEOUT_SECONDS="0", FAKE_STUCK="1")
        self.assertEqual(code, 1)
        self.assertIn("uncertain", err)

    def test_active_migration_blocks_a_second_one(self):
        code, _, err = self.run_script(["Success"], FAKE_BUSY="cmd-0")
        self.assertEqual(code, 1)
        self.assertIn("still active", err)
        self.assertNotIn("send-command", self.calls)

    def test_command_still_cancelling_blocks_a_second_one(self):
        code, _, err = self.run_script(["Success"], FAKE_BUSY="cmd-0", FAKE_BUSY_STATUS="Cancelling")
        self.assertEqual(code, 1)
        self.assertIn("still active", err)
        self.assertNotIn("send-command", self.calls)

    def test_interrupt_cancels_the_remote_command(self):
        process = self.start(["InProgress"], MIGRATION_POLL_SECONDS="1", MIGRATION_TIMEOUT_SECONDS="600")
        time.sleep(2)
        process.send_signal(signal.SIGTERM)
        _, err = process.communicate(timeout=30)
        self.assertEqual(process.returncode, 1)
        self.assertIn("ssm cancel-command", self.calls)
        self.assertIn("interrupted", err)


if __name__ == "__main__":
    unittest.main()
