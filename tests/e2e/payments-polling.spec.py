"""End-to-end test: verify the admin payments ledger refetch cadence honors
the polling fallback interval preference (30s / 60s / 2m / Off).

Runs against the live dev server at http://localhost:8080. Requires the seeded
admin account (admin@arasi.test / Admin@12345).

The test signs in, navigates to /admin/payments, then for each polling option:
  1. Changes the "Poll every" select on the page header.
  2. Asserts the UI status badge reflects the new interval.
  3. Waits (interval + buffer) with realtime forced disconnected, counting how
     many times the `listAdminPayments` TanStack server function is invoked,
     and asserts the observed cadence matches the setting.

Full run takes ~4 minutes because the 2m case requires a real ~2m observation
window. Set FAST=1 to skip the 60s / 120s waits (badge assertions still run).

Usage:
    python3 tests/e2e/payments-polling.spec.py
    FAST=1 python3 tests/e2e/payments-polling.spec.py
"""
import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
SHOTS = Path(__file__).parent / "shots" / "payments-polling"
SHOTS.mkdir(parents=True, exist_ok=True)
FAST = os.environ.get("FAST") == "1"

# (label, select_value_ms, badge_visible_text, badge_title_substring,
#  observe_seconds, expect_first_poll_by_seconds, expect_no_calls)
# We block realtime so the "disconnected" branch of the refetchInterval is
# exercised. `expect_first_poll_by` = the deadline (from settle) by which we
# demand at least one `listAdminPayments` call (interval + generous buffer for
# timer drift and possible React Query retries). `expect_no_calls=True` means
# background polling must be silent for the whole `observe_seconds` window.
CASES = [
    ("30s",  30_000,  "Polling", "polling every 30s",  45,  45,  False),
    ("60s",  60_000,  "Polling", "polling every 60s",  80,  80,  False),
    ("2m",   120_000, "Polling", "polling every 120s", 140, 140, False),
    ("off",  0,       "Manual",  "background polling is off", 15, 0, True),
]


async def login(page):
    await page.goto(f"{BASE}/auth?portal=admin", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    await page.locator("input[type=email]").first.fill("admin@arasi.test")
    await page.locator("input[type=password]").first.fill("Admin@12345")
    await page.locator("button[type=submit]").first.click()
    for _ in range(40):
        await page.wait_for_timeout(500)
        if "/auth" not in page.url:
            return
    raise RuntimeError(f"login did not leave /auth; final url={page.url}")


def is_list_admin_payments_call(url: str) -> bool:
    """Server-fn URLs look like /_serverFn/<base64>. The base64 encodes JSON with
    the export name; decode and match the listAdminPayments handler so we don't
    accidentally count the last-webhook or export server fns."""
    marker = "/_serverFn/"
    if marker not in url:
        return False
    tail = url.split(marker, 1)[1].split("?", 1)[0].split("/", 1)[0]
    try:
        padded = tail + "=" * (-len(tail) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8", "replace"))
    except Exception:
        # Fall back to a substring check on the raw path.
        return "listAdminPayments" in url
    export = str(payload.get("export", ""))
    return export.startswith("listAdminPayments")


async def set_polling(page, value_ms: int):
    select = page.get_by_label("Payments polling fallback interval")
    await select.wait_for(state="visible", timeout=10_000)
    await select.select_option(str(value_ms))
    # UI writes to localStorage synchronously via setUiPrefs; give React a tick.
    await page.wait_for_timeout(300)


async def assert_badge(page, visible_text: str, title_substring: str):
    # The visible badge shows "Live" / "Polling" / "Manual"; the polling
    # interval detail lives in the `title` tooltip. Locate the status badge
    # by its "Realtime" title prefix (set on all three visual states).
    badge = page.locator("[title^='Realtime']").first
    await badge.wait_for(state="visible", timeout=5_000)
    text = (await badge.inner_text()).strip().lower()
    title = ((await badge.get_attribute("title")) or "").lower()
    if visible_text.lower() not in text:
        raise AssertionError(
            f"badge visible text {text!r} did not include {visible_text!r}"
        )
    if title_substring.lower() not in title:
        raise AssertionError(
            f"badge title {title!r} did not contain {title_substring!r}"
        )


async def run_case(page, calls: list, label, value_ms, badge_text,
                   badge_title, observe_s, first_by_s, expect_no_calls):
    await set_polling(page, value_ms)
    await assert_badge(page, badge_text, badge_title)
    if FAST and value_ms in (60_000, 120_000):
        print(f"[{label}] FAST=1 → skipping {observe_s}s network observation "
              f"(badge asserted).")
        return
    # Let any immediate refetch (from focus/prop-change) drain before we start
    # measuring background poll cadence.
    await page.wait_for_timeout(3000)
    calls.clear()
    start = time.monotonic()
    while time.monotonic() - start < observe_s:
        await page.wait_for_timeout(1000)
    deltas = [round(t - start, 1) for t in calls]
    n = len(calls)
    await page.screenshot(path=str(SHOTS / f"{label}.png"))
    print(f"[{label}] observed {n} listAdminPayments calls in {observe_s}s "
          f"at t={deltas}.")
    if expect_no_calls:
        if n != 0:
            raise AssertionError(
                f"[{label}] expected zero background polls when set to Off, "
                f"observed {n} at {deltas}"
            )
        return
    if n == 0:
        raise AssertionError(
            f"[{label}] expected at least one background poll within "
            f"{first_by_s}s, observed none"
        )
    # First poll must arrive by the interval + buffer already baked into
    # first_by_s.
    if deltas[0] > first_by_s:
        raise AssertionError(
            f"[{label}] first background poll at t={deltas[0]}s exceeded "
            f"deadline {first_by_s}s"
        )
    # Consecutive-poll gap should approximate the configured interval. Group
    # calls that arrive within 8s of the previous call (React Query retry
    # burst) into one scheduled tick, then require the gap between ticks to
    # sit near the interval (±40% tolerance to absorb drift + backoff).
    ticks = [deltas[0]]
    last = deltas[0]
    for d in deltas[1:]:
        if d - last > 8:
            ticks.append(d)
        last = d
    if len(ticks) >= 2:
        interval_s = value_ms / 1000
        gap = ticks[1] - ticks[0]
        low, high = interval_s * 0.6, interval_s * 1.4
        if not (low <= gap <= high):
            raise AssertionError(
                f"[{label}] inter-poll gap {gap:.1f}s outside "
                f"[{low:.1f}, {high:.1f}]s (ticks={ticks})"
            )



async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        # Block Supabase realtime so the "disconnected" polling branch is what
        # we're exercising. Playwright's HTTP `route` handler does not intercept
        # WebSocket upgrades, so we sabotage the WebSocket constructor for the
        # realtime endpoint via an init script.
        await context.add_init_script(
            """
            (() => {
              const OrigWS = window.WebSocket;
              window.WebSocket = function (url, protocols) {
                if (typeof url === 'string' && url.includes('/realtime/v1')) {
                  // Return a stub that never opens and reports errors so the
                  // Supabase channel status stays anything but SUBSCRIBED.
                  const stub = {
                    url, readyState: 3, protocol: '',
                    bufferedAmount: 0, extensions: '',
                    onopen: null, onmessage: null, onerror: null, onclose: null,
                    send() {}, close() {},
                    addEventListener() {}, removeEventListener() {},
                    dispatchEvent() { return false; },
                  };
                  setTimeout(() => stub.onerror && stub.onerror(new Event('error')), 0);
                  setTimeout(() => stub.onclose && stub.onclose(new CloseEvent('close')), 0);
                  return stub;
                }
                return new OrigWS(url, protocols);
              };
              window.WebSocket.CONNECTING = 0;
              window.WebSocket.OPEN = 1;
              window.WebSocket.CLOSING = 2;
              window.WebSocket.CLOSED = 3;
            })();
            """
        )
        page = await context.new_page()

        calls: list[float] = []
        all_srv: list[str] = []

        def on_request(req):
            if "/_serverFn/" not in req.url:
                return
            all_srv.append(f"{req.method} {req.url}")
            if is_list_admin_payments_call(req.url):
                calls.append(time.monotonic())

        page.on("request", on_request)

        await login(page)
        await page.goto(f"{BASE}/admin/payments", wait_until="domcontentloaded")
        # Wait for the first ledger fetch to settle so the initial call doesn't
        # skew per-case counts.
        await page.wait_for_timeout(3000)
        await page.get_by_label("Payments polling fallback interval").wait_for(
            state="visible", timeout=15_000
        )

        failures = []
        print("sample _serverFn calls seen during warmup:")
        for u in all_srv[:6]:
            print("  ", u[:200])
        for case in CASES:
            try:
                await run_case(page, calls, *case)
            except AssertionError as e:
                failures.append(str(e))
                print(f"FAIL: {e}", file=sys.stderr)

        await browser.close()
        if failures:
            print(f"\n{len(failures)} case(s) failed.", file=sys.stderr)
            sys.exit(1)
        print("\nAll polling cadence cases passed.")


if __name__ == "__main__":
    asyncio.run(main())
