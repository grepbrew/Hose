# TC-032, TC-077, TC-078: the on-Pod watchdog's stop decision. TC-170: what it reads from /metrics. Run by `npm test` with `python3 -I tests/watchdog_test.py`.
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))
from watchdog import load, should_stop  # noqa: E402

FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"

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

    # TC-077: the per-run budget, as minutes of GPU time, stops even a busy pod
    def test_budget_59_min_keeps_running(self):
        stop = should_stop(now=59 * MIN, booted_at=0, last_activity=59 * MIN, ready=True, idle_s=IDLE, boot_s=BOOT, max_s=60 * MIN)

        self.assertFalse(stop)

    def test_budget_61_min_stops_busy_pod(self):
        stop = should_stop(now=61 * MIN, booted_at=0, last_activity=61 * MIN, ready=True, idle_s=IDLE, boot_s=BOOT, max_s=60 * MIN)

        self.assertTrue(stop)

    # TC-078: idle_s 0 is "Never"
    def test_never_idle_5_h_keeps_running(self):
        stop = should_stop(now=5 * 60 * MIN, booted_at=0, last_activity=0, ready=True, idle_s=0, boot_s=BOOT, max_s=0)

        self.assertFalse(stop)


class Load(unittest.TestCase):
    def test_metrics_chat(self):
        busy_done = load((FIXTURES / "vllm-metrics.txt").read_text())

        self.assertEqual(busy_done, (0, 2))

    # TC-170: a picture pod (vLLM-Omni) reports vllm_omni:* only; a finished picture must reset the idle timer
    def test_metrics_omni(self):
        busy_done = load((FIXTURES / "omni-metrics.txt").read_text())

        self.assertEqual(busy_done, (0, 1))


if __name__ == "__main__":
    unittest.main()
