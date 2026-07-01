"""End-to-end test: clicking the "Dashboard" sidebar item from an admin
session keeps the user on `/dashboard` (no bounce to `/admin`, no stray
`/admin/admin` route match, no console route errors).

Guards the redirect wiring added in `_authenticated/admin/index.tsx` and the
`notFoundComponent` on the admin layout that catch bare `/admin` and any
stray `/admin/admin` link.

Usage:
    python3 tests/e2e/admin-dashboard-nav.spec.py
"""
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
SHOTS = Path(__file__).parent / "shots" / "admin-dashboard-nav"
SHOTS.mkdir(parents=True, exist_ok=True)

# Console messages we treat as route-related errors.
ROUTE_ERROR_MARKERS = (
    "no route matches",
    "invariant failed",
    "match for location",
    "not found",
    "routematchnotfound",
    "invalid route",
)


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


async def assert_on_dashboard(page, label: str):
    # Give the router a beat to settle any pending redirects.
    await page.wait_for_timeout(750)
    url = page.url
    if not url.rstrip("/").endswith("/dashboard"):
        raise AssertionError(f"[{label}] expected /dashboard, got {url}")
    if "/admin/admin" in url or url.rstrip("/").endswith("/admin"):
        raise AssertionError(f"[{label}] landed on stray admin URL: {url}")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        console_errors: list[str] = []

        def on_console(msg):
            if msg.type not in ("error", "warning"):
                return
            text = msg.text.lower()
            if any(m in text for m in ROUTE_ERROR_MARKERS):
                console_errors.append(f"{msg.type}: {msg.text}")

        page.on("console", on_console)

        failures: list[str] = []

        try:
            await login(page)

            # 1) Land on /dashboard from a fresh login.
            await page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
            await assert_on_dashboard(page, "initial-load")
            await page.screenshot(path=str(SHOTS / "1_dashboard.png"))

            # 2) Click the Dashboard sidebar menu item and confirm no bounce.
            dashboard_link = page.get_by_role("link", name="Dashboard").first
            await dashboard_link.wait_for(state="visible", timeout=10_000)
            await dashboard_link.click()
            await assert_on_dashboard(page, "sidebar-click")
            # Watch for a delayed redirect for another second.
            await page.wait_for_timeout(1200)
            await assert_on_dashboard(page, "sidebar-click-settled")
            await page.screenshot(path=str(SHOTS / "2_after_click.png"))

            # 3) Directly hitting bare /admin must redirect to /dashboard
            # (guards the /_authenticated/admin/index.tsx redirect).
            await page.goto(f"{BASE}/admin", wait_until="domcontentloaded")
            await assert_on_dashboard(page, "bare-admin")

            # 4) A stray /admin/admin URL must not surface a route error;
            # the admin layout's notFoundComponent redirects to /dashboard.
            await page.goto(f"{BASE}/admin/admin", wait_until="domcontentloaded")
            await assert_on_dashboard(page, "stray-admin-admin")
            await page.screenshot(path=str(SHOTS / "3_stray_admin_admin.png"))

        except AssertionError as e:
            failures.append(str(e))
            print(f"FAIL: {e}", file=sys.stderr)

        if console_errors:
            for line in console_errors:
                print(f"console route-error: {line}", file=sys.stderr)
            failures.append(
                f"{len(console_errors)} route-related console error(s) captured"
            )

        await browser.close()

        if failures:
            print(f"\n{len(failures)} check(s) failed.", file=sys.stderr)
            sys.exit(1)
        print("Admin dashboard navigation is stable — no bounce, no route errors.")


if __name__ == "__main__":
    asyncio.run(main())
