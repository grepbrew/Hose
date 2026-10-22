# Runs on the Pod next to vLLM (passed in via env HOSE_WATCHDOG, see podInput in cost.ts).
# Deletes the Pod once nobody has chatted for HOSE_IDLE_MIN minutes (0 = never) and nothing is running, or once
# this run has had HOSE_MAX_MIN minutes (the budget, 0 = none), so a forgotten model stops billing even when the
# Mac sleeps or Hose is closed. The model survives on the network volume at /workspace, if Hose mounted one. Stdlib only.
# ponytail: the clock starts with the container, so a first run's image pull isn't counted against the budget;
# Hose's backstop counts it while the app is open.
import json
import os
import re
import time
import urllib.request

BOOT_S = 20 * 60  # vLLM not ready after this: stuck download or out of memory, give up


def should_stop(now, booted_at, last_activity, ready, idle_s, boot_s, max_s=0):
    if max_s and now - booted_at > max_s:
        return True
    if not ready:
        return now - booted_at > boot_s
    return bool(idle_s) and now - last_activity > idle_s


def metrics():
    """(requests running + waiting, finished requests so far), or None while vLLM is down."""
    try:
        text = urllib.request.urlopen("http://127.0.0.1:8000/metrics", timeout=5).read().decode()
    except Exception:
        return None
    total = lambda name: sum(float(v) for v in re.findall(r"^%s(?:\{[^}]*\})? (\S+)" % re.escape(name), text, re.M))
    return total("vllm:num_requests_running") + total("vllm:num_requests_waiting"), total("vllm:request_success_total")


def call(url, method, body=None):
    headers = {"Authorization": "Bearer " + os.environ["RUNPOD_API_KEY"], "Content-Type": "application/json"}
    urllib.request.urlopen(urllib.request.Request(url, data=body, method=method, headers=headers), timeout=30)


def delete_self():
    pod = os.environ["RUNPOD_POD_ID"]
    try:
        call("https://api.runpod.io/v2/pods/" + pod, "DELETE")
    except Exception as e:
        print("hose watchdog: rest delete failed, trying graphql:", e, flush=True)
        query = 'mutation { podTerminate(input: {podId: "%s"}) }' % pod
        call("https://api.runpod.io/graphql", "POST", json.dumps({"query": query}).encode())


def main():
    idle_s = float(os.environ.get("HOSE_IDLE_MIN", "10")) * 60
    max_s = float(os.environ.get("HOSE_MAX_MIN", "0")) * 60
    booted_at = last_activity = time.time()
    ready, finished = False, None
    while not should_stop(time.time(), booted_at, last_activity, ready, idle_s, BOOT_S, max_s):
        time.sleep(30)
        m = metrics()
        # after ready this counts as idle, so a crashed vLLM still gets deleted.
        # ponytail: with idle Never and no budget (24/7) a crashed vLLM keeps billing; add a down-for-N-min stop if that bites
        if m is None:
            continue
        busy, done = m
        if not ready:
            ready, last_activity = True, time.time()
        if busy or done != finished:
            last_activity, finished = time.time(), done
    print("hose watchdog: idle or budget used, deleting pod", flush=True)
    while True:
        try:
            delete_self()
            return
        except Exception as e:
            print("hose watchdog: delete failed, retrying in 60 s:", e, flush=True)
            time.sleep(60)


if __name__ == "__main__":
    main()
