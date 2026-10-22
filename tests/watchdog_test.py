# TC-032: the on-Pod watchdog's stop decision. Run by `npm test` with `python3 -I tests/watchdog_test.py`.
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))
from watchdog import should_stop  # noqa: E402

MIN = 60
IDLE, BOOT = 10 * MIN, 20 * MIN


class ShouldStop(unittest.TestCase):
    def test_booting_19_min_keeps_running(self):
        stop = should_stop(now=19 * MIN, booted_at=0, last_activity=0, ready=False, idle_s=IDLE, boot_s=BOOT)

        self.assertFalse(stop)

    def test_booting_21_min_stops(self):
        stop = should_stop(now=21 * MIN, booted_at=0, last_activity=0, ready=False, idle_s=IDLE, boot_s=BOOT)

        self.assertTrue(stop)

    def test_ready_idle_9_min_keeps_running(self):
        stop = should_stop(now=30 * MIN, booted_at=0, last_activity=21 * MIN, ready=True, idle_s=IDLE, boot_s=BOOT)

        self.assertFalse(stop)

    def test_ready_idle_11_min_stops(self):
        stop = should_stop(now=30 * MIN, booted_at=0, last_activity=19 * MIN, ready=True, idle_s=IDLE, boot_s=BOOT)

        self.assertTrue(stop)


if __name__ == "__main__":
    unittest.main()
