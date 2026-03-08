"""
test_config.py — Shared configuration and helpers for test scripts.
Zero external dependencies — uses only Python stdlib.
"""
import json, sys, urllib.request, urllib.error, os

# Configuration
BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8081")
API_URL = f"{BASE_URL}/src/api"

# Real site admin — scripts must NEVER touch this user
SITE_ADMIN_USER = "citadel_site_admin"

# Test site admin — created by seed, used for admin-level tests
TEST_ADMIN = "test_site_admin"
TEST_ADMIN_EMAIL = "testadmin@pv.local"
TEST_ADMIN_PASS = "TestAdmin@123"

# Test users
TEST_USER1 = "testuser1"
TEST_EMAIL1 = "test1@pv.local"
TEST_PASS1 = "TestPass123"

TEST_USER2 = "testuser2"
TEST_EMAIL2 = "test2@pv.local"
TEST_PASS2 = "TestPass456"

# Vault key (numeric only, 6+ digits)
TEST_VAULT_KEY = "123456"

# Colors for terminal output
RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
BLUE = "\033[0;34m"
CYAN = "\033[0;36m"
BOLD = "\033[1m"
NC = "\033[0m"

# Test counters
tests_passed = 0
tests_failed = 0
tests_total = 0


# =============================================================================
# HTTP helpers
# =============================================================================

def api_request(method, endpoint, body=None, token=None, data_token=None, raw=False):
    """
    Make an HTTP request to the API.
    Returns (status_code, response_dict_or_str).
    """
    url = f"{API_URL}/{endpoint}"
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")

    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if data_token:
        req.add_header("X-Data-Token", data_token)

    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            body_bytes = resp.read()
            if raw:
                return status, body_bytes
            return status, json.loads(body_bytes)
    except urllib.error.HTTPError as e:
        status = e.code
        body_bytes = e.read()
        if raw:
            return status, body_bytes
        try:
            return status, json.loads(body_bytes)
        except (json.JSONDecodeError, ValueError):
            return status, {"success": False, "error": body_bytes.decode("utf-8", errors="replace")}
    except urllib.error.URLError as e:
        return 0, {"success": False, "error": str(e)}


def api_post(endpoint, body=None, token=None, data_token=None):
    """POST request wrapper."""
    return api_request("POST", endpoint, body=body, token=token, data_token=data_token)


def api_get(endpoint, token=None, data_token=None):
    """GET request wrapper."""
    return api_request("GET", endpoint, token=token, data_token=data_token)


def api_put(endpoint, body=None, token=None, data_token=None):
    """PUT request wrapper."""
    return api_request("PUT", endpoint, body=body, token=token, data_token=data_token)


def api_delete(endpoint, token=None, data_token=None):
    """DELETE request wrapper."""
    return api_request("DELETE", endpoint, token=token, data_token=data_token)


def api_download(endpoint, token=None, data_token=None):
    """GET request that returns raw bytes."""
    return api_request("GET", endpoint, token=token, data_token=data_token, raw=True)


# =============================================================================
# Auth / encryption workflow helpers
# =============================================================================

def register_user(username, email, password):
    """Register a new user. Returns (status_code, data, token)."""
    code, resp = api_post("auth.php?action=register", {
        "username": username,
        "email": email,
        "password": password,
    })
    token = None
    data = resp.get("data", {}) if isinstance(resp, dict) else {}
    if isinstance(data, dict):
        token = data.get("token")
    return code, resp, token


def login_user(username, password):
    """Login a user. Returns (status_code, data, token)."""
    code, resp = api_post("auth.php?action=login", {
        "username": username,
        "password": password,
    })
    token = None
    data = resp.get("data", {}) if isinstance(resp, dict) else {}
    if isinstance(data, dict):
        token = data.get("token")
    return code, resp, token


def setup_vault_key(vault_key, token):
    """
    First-time vault key setup.
    Returns (status_code, data, data_token, recovery_key).
    """
    code, resp = api_post("encryption.php?action=setup", {
        "vault_key": vault_key,
        "confirm_vault_key": vault_key,
    }, token=token)
    data = resp.get("data", {}) if isinstance(resp, dict) else {}
    data_token = data.get("data_token") if isinstance(data, dict) else None
    recovery_key = data.get("recovery_key") if isinstance(data, dict) else None
    return code, resp, data_token, recovery_key


def unlock_vault(vault_key, token):
    """
    Unlock vault with vault key.
    Returns (status_code, data, data_token).
    """
    code, resp = api_post("encryption.php?action=unlock", {
        "vault_key": vault_key,
    }, token=token)
    data = resp.get("data", {}) if isinstance(resp, dict) else {}
    data_token = data.get("data_token") if isinstance(data, dict) else None
    return code, resp, data_token


def full_auth(username, password, vault_key):
    """
    Login + unlock vault. Returns (token, data_token).
    Raises SystemExit on failure.
    """
    code, resp, token = login_user(username, password)
    if code != 200 or not token:
        print(f"{RED}FATAL: Login failed for {username}: {resp}{NC}")
        sys.exit(1)

    code, resp, data_token = unlock_vault(vault_key, token)
    if code != 200 or not data_token:
        print(f"{RED}FATAL: Vault unlock failed for {username}: {resp}{NC}")
        sys.exit(1)

    return token, data_token


# =============================================================================
# Assertion helpers
# =============================================================================

def assert_status(actual, expected, name):
    """Assert HTTP status code matches expected."""
    global tests_passed, tests_failed, tests_total
    tests_total += 1
    if actual == expected:
        tests_passed += 1
        print(f"  {GREEN}PASS{NC}  {name}  (HTTP {actual})")
    else:
        tests_failed += 1
        print(f"  {RED}FAIL{NC}  {name}  (expected {expected}, got {actual})")


def assert_contains(data, key, name):
    """Assert that a key exists in the response data."""
    global tests_passed, tests_failed, tests_total
    tests_total += 1
    if isinstance(data, dict) and key in data:
        tests_passed += 1
        print(f"  {GREEN}PASS{NC}  {name}  (key '{key}' found)")
    else:
        tests_failed += 1
        print(f"  {RED}FAIL{NC}  {name}  (key '{key}' missing)")


def assert_not_contains(data, key, name):
    """Assert that a key does NOT exist in the response data."""
    global tests_passed, tests_failed, tests_total
    tests_total += 1
    if isinstance(data, dict) and key not in data:
        tests_passed += 1
        print(f"  {GREEN}PASS{NC}  {name}  (key '{key}' absent)")
    else:
        tests_failed += 1
        print(f"  {RED}FAIL{NC}  {name}  (key '{key}' should not exist)")


def assert_equals(actual, expected, name):
    """Assert that actual value equals expected."""
    global tests_passed, tests_failed, tests_total
    tests_total += 1
    if actual == expected:
        tests_passed += 1
        print(f"  {GREEN}PASS{NC}  {name}  ({repr(actual)})")
    else:
        tests_failed += 1
        print(f"  {RED}FAIL{NC}  {name}  (expected {repr(expected)}, got {repr(actual)})")


# =============================================================================
# Display helpers
# =============================================================================

def print_header(title):
    """Print a bold header."""
    print(f"\n{BOLD}{BLUE}{'=' * 70}{NC}")
    print(f"{BOLD}{BLUE}  {title}{NC}")
    print(f"{BOLD}{BLUE}{'=' * 70}{NC}\n")


def print_section(title):
    """Print a section divider."""
    print(f"\n{CYAN}--- {title} ---{NC}")


def print_summary():
    """Print the final test summary and return exit code."""
    print(f"\n{BOLD}{'=' * 70}{NC}")
    if tests_failed == 0:
        print(f"{GREEN}{BOLD}  ALL {tests_total} TESTS PASSED{NC}")
    else:
        print(f"{RED}{BOLD}  {tests_failed} FAILED{NC} / {tests_total} total  "
              f"({GREEN}{tests_passed} passed{NC})")
    print(f"{BOLD}{'=' * 70}{NC}\n")
    return 0 if tests_failed == 0 else 1


def check_server():
    """Verify the server is reachable."""
    print(f"Checking server at {BASE_URL} ...")
    try:
        req = urllib.request.Request(BASE_URL)
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"{GREEN}Server is reachable (HTTP {resp.status}){NC}")
            return True
    except Exception as e:
        print(f"{RED}Server unreachable: {e}{NC}")
        print(f"{YELLOW}Start it with: php -S localhost:8081 router.php{NC}")
        return False
