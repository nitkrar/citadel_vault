#!/usr/bin/env python3
"""
seed_data.py — Seed test data for Personal Vault V2.
Creates test users (including a test site admin), accounts, assets, and insurance.
NEVER touches the real site admin (citadel_site_admin).
Requires: php -S localhost:8081 router.php
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from test_config import *


def main():
    print_header("Personal Vault V2 — Seed Data")

    if not check_server():
        sys.exit(1)

    # ── Step 1: Register test users (self-register, no admin needed) ─────
    print_section("Register Test Users")
    tokens = {}
    for uname, email, passwd in [
        (TEST_USER1, TEST_EMAIL1, TEST_PASS1),
        (TEST_USER2, TEST_EMAIL2, TEST_PASS2),
    ]:
        code, resp, token = register_user(uname, email, passwd)
        if code == 201:
            print(f"{GREEN}Registered {uname}{NC}")
            tokens[uname] = token
        else:
            print(f"{YELLOW}{uname}: {resp.get('error', 'already exists')}{NC}")
            # Login to get token
            code, resp, token = login_user(uname, passwd)
            if code == 200:
                tokens[uname] = token

    # ── Step 2: Create test site admin via real admin ────────────────────
    print_section("Create Test Site Admin")

    # Login as real site admin to create the test admin user
    # Real admin has must_change_password=1, so we need to change it first
    # But we promised not to touch it... so we use the users API
    # Actually, we need to login first. Let's handle the force-change.
    real_admin_pass = "Admin@123"
    code, resp, admin_token = login_user(SITE_ADMIN_USER, real_admin_pass)

    if code == 200 and admin_token:
        # Check if must_change_password
        user_data = resp.get("data", {}).get("user", {})
        if user_data.get("must_change_password"):
            print(f"{YELLOW}Real admin requires password change — skipping test admin creation via admin API{NC}")
            print(f"{YELLOW}Please login as {SITE_ADMIN_USER} in the browser first to change password{NC}")
            print(f"{YELLOW}Test admin will be registered as regular user instead{NC}")
            admin_token = None
    else:
        # Try common changed passwords
        admin_token = None

    if admin_token:
        # Create test admin via admin API
        code, resp = api_post("users.php", {
            "username": TEST_ADMIN,
            "email": TEST_ADMIN_EMAIL,
            "password": TEST_ADMIN_PASS,
            "role": "site_admin",
        }, token=admin_token)
        if code == 201:
            print(f"{GREEN}Created test site admin: {TEST_ADMIN}{NC}")
        elif code == 409:
            print(f"{YELLOW}Test admin already exists{NC}")
        else:
            print(f"{YELLOW}Could not create test admin: {resp.get('error', 'unknown')}{NC}")
    else:
        # Fallback: register as regular user (won't have admin role)
        code, resp, token = register_user(TEST_ADMIN, TEST_ADMIN_EMAIL, TEST_ADMIN_PASS)
        if code == 201:
            print(f"{YELLOW}Registered {TEST_ADMIN} as regular user (no admin to promote it){NC}")
        else:
            print(f"{YELLOW}{TEST_ADMIN}: {resp.get('error', 'already exists')}{NC}")

    # Login as test admin and setup vault
    code, resp, ta_token = login_user(TEST_ADMIN, TEST_ADMIN_PASS)
    if code == 200 and ta_token:
        code, resp = api_get("encryption.php?action=status", token=ta_token)
        if not resp.get("data", {}).get("has_vault_key"):
            code, resp, ta_dt, recovery = setup_vault_key(TEST_VAULT_KEY, ta_token)
            if code == 200:
                print(f"{GREEN}Test admin vault set. Recovery: {recovery}{NC}")
        else:
            print(f"{GREEN}Test admin vault already set up{NC}")

    # ── Step 3: Setup test user 1 vault and create data ──────────────────
    print_section("Test User 1 — Setup & Seed")
    code, resp, u1_token = login_user(TEST_USER1, TEST_PASS1)
    if code != 200:
        print(f"{RED}Cannot login as {TEST_USER1}{NC}")
        sys.exit(1)

    code, resp = api_get("encryption.php?action=status", token=u1_token)
    u1_data = resp.get("data", {})
    u1_data_token = None

    if not u1_data.get("has_vault_key"):
        code, resp, u1_data_token, recovery = setup_vault_key(TEST_VAULT_KEY, u1_token)
        print(f"{GREEN}User1 vault key set. Recovery: {recovery}{NC}")
    else:
        code, resp, u1_data_token = unlock_vault(TEST_VAULT_KEY, u1_token)
        print(f"{GREEN}User1 vault unlocked{NC}")

    if not u1_data_token:
        print(f"{RED}No data token for user1 — cannot seed data{NC}")
        sys.exit(1)

    # Get reference data
    code, resp = api_get("reference.php?resource=currencies", token=u1_token)
    currencies = {c['code']: c['id'] for c in (resp.get('data') or [])}

    code, resp = api_get("reference.php?resource=countries", token=u1_token)
    countries = {c['code']: c['id'] for c in (resp.get('data') or [])}

    code, resp = api_get("reference.php?resource=account-types", token=u1_token)
    acc_types = {t['name']: t['id'] for t in (resp.get('data') or [])}

    code, resp = api_get("reference.php?resource=asset-types", token=u1_token)
    asset_types = {t['name']: t['id'] for t in (resp.get('data') or [])}

    # Create accounts (containers)
    print(f"\n{CYAN}Creating accounts...{NC}")
    account_ids = {}
    accounts_to_create = [
        {"name": "Barclays Current", "institution": "Barclays", "account_type": "Current / Checking", "country": "GB", "currency": "GBP"},
        {"name": "HDFC Savings", "institution": "HDFC Bank", "account_type": "Savings", "country": "IN", "currency": "INR", "subtype": "ppf"},
        {"name": "Vanguard ISA", "institution": "Vanguard UK", "account_type": "Brokerage / Trading", "country": "GB", "currency": "GBP", "subtype": "isa"},
        {"name": "Chase Checking", "institution": "JPMorgan Chase", "account_type": "Current / Checking", "country": "US", "currency": "USD"},
        {"name": "Amex Gold", "institution": "American Express", "account_type": "Credit Card", "country": "GB", "currency": "GBP"},
    ]

    for acc in accounts_to_create:
        payload = {
            "name": acc["name"],
            "institution": acc["institution"],
            "account_type_id": acc_types.get(acc["account_type"], 1),
            "country_id": countries.get(acc["country"]),
            "currency_id": currencies.get(acc["currency"], 1),
        }
        if "subtype" in acc:
            payload["subtype"] = acc["subtype"]

        code, resp = api_post("accounts.php", payload, token=u1_token, data_token=u1_data_token)
        if code == 201:
            aid = resp.get("data", {}).get("id")
            account_ids[acc["name"]] = aid
            print(f"  {GREEN}Created account: {acc['name']} (id={aid}){NC}")
        else:
            print(f"  {YELLOW}Account {acc['name']}: {resp.get('error', 'skip')}{NC}")

    # Create assets
    print(f"\n{CYAN}Creating assets...{NC}")
    assets_to_create = [
        {"name": "Barclays Balance", "asset_type": "Cash Balance", "account": "Barclays Current", "currency": "GBP", "amount": 5420.50, "is_liquid": 1},
        {"name": "HDFC Balance", "asset_type": "Cash Balance", "account": "HDFC Savings", "currency": "INR", "amount": 250000, "is_liquid": 1},
        {"name": "Vanguard S&P 500", "asset_type": "Mutual Fund", "account": "Vanguard ISA", "currency": "GBP", "amount": 15200, "is_liquid": 1, "asset_data": {"fund_name": "Vanguard S&P 500 ETF", "units": 120, "nav": 126.67}},
        {"name": "Apple Stock", "asset_type": "Equity / Stock", "account": "Vanguard ISA", "currency": "USD", "amount": 9000, "is_liquid": 1, "asset_data": {"ticker": "AAPL", "shares": 50, "price_per_share": 180}},
        {"name": "Primary Residence", "asset_type": "Property", "account": None, "currency": "GBP", "amount": 350000, "is_liquid": 0, "asset_data": {"address": "123 Main Street, London", "purchase_price": 320000}},
        {"name": "Gold Coins", "asset_type": "Gold / Precious Metal", "account": None, "currency": "GBP", "amount": 4500, "is_liquid": 0, "asset_data": {"weight_grams": 100, "purity": "24K"}},
        {"name": "Bitcoin", "asset_type": "Cryptocurrency", "account": None, "currency": "USD", "amount": 12000, "is_liquid": 1, "asset_data": {"coin": "BTC", "quantity": 0.15}},
        {"name": "Amex Balance", "asset_type": "Debt / Liability", "account": "Amex Gold", "currency": "GBP", "amount": 2300, "is_liquid": 0, "is_liability": 1, "asset_data": {"debt_type": "Credit Card", "interest_rate": 22.9}},
        {"name": "Mortgage", "asset_type": "Debt / Liability", "account": None, "currency": "GBP", "amount": 180000, "is_liquid": 0, "is_liability": 1, "asset_data": {"debt_type": "Mortgage", "interest_rate": 4.5, "emi": 1200, "remaining_months": 240}},
        {"name": "Emergency Fund", "asset_type": "Cash Equivalent", "account": None, "currency": "GBP", "amount": 10000, "is_liquid": 1},
    ]

    for asset in assets_to_create:
        payload = {
            "name": asset["name"],
            "asset_type_id": asset_types.get(asset["asset_type"], 1),
            "currency_id": currencies.get(asset["currency"], 1),
            "amount": asset["amount"],
            "is_liquid": asset.get("is_liquid", 0),
            "is_liability": asset.get("is_liability", 0),
        }
        if asset.get("account") and asset["account"] in account_ids:
            payload["account_id"] = account_ids[asset["account"]]
        if "asset_data" in asset:
            payload["asset_data"] = asset["asset_data"]

        code, resp = api_post("assets.php", payload, token=u1_token, data_token=u1_data_token)
        if code == 201:
            print(f"  {GREEN}Created asset: {asset['name']}{NC}")
        else:
            print(f"  {YELLOW}Asset {asset['name']}: {resp.get('error', 'skip')}{NC}")

    # Create insurance policies
    print(f"\n{CYAN}Creating insurance policies...{NC}")
    policies = [
        {"policy_name": "Aviva Life Cover", "provider": "Aviva", "category": "Life", "premium_amount": 45.00, "coverage_amount": 250000, "payment_frequency": "monthly", "start_date": "2022-01-01", "maturity_date": "2052-01-01"},
        {"policy_name": "Bupa Health", "provider": "Bupa", "category": "Health", "premium_amount": 120.00, "coverage_amount": 50000, "payment_frequency": "monthly"},
        {"policy_name": "Car Insurance", "provider": "Admiral", "category": "Vehicle", "premium_amount": 480.00, "payment_frequency": "annually", "start_date": "2024-06-01"},
    ]

    for pol in policies:
        code, resp = api_post("insurance.php", pol, token=u1_token, data_token=u1_data_token)
        if code == 201:
            print(f"  {GREEN}Created policy: {pol['policy_name']}{NC}")
        else:
            print(f"  {YELLOW}Policy {pol['policy_name']}: {resp.get('error', 'skip')}{NC}")

    # ── Step 4: Setup test user 2 ────────────────────────────────────────
    print_section("Test User 2 — Setup")
    code, resp, u2_token = login_user(TEST_USER2, TEST_PASS2)
    if code == 200:
        code, resp = api_get("encryption.php?action=status", token=u2_token)
        if not resp.get("data", {}).get("has_vault_key"):
            code, resp, u2_dt, recovery = setup_vault_key(TEST_VAULT_KEY, u2_token)
            print(f"{GREEN}User2 vault set. Recovery: {recovery}{NC}")
        else:
            print(f"{GREEN}User2 vault already set up{NC}")

    # ── Done ─────────────────────────────────────────────────────────────
    print_header("Seed Complete!")
    print(f"  Test Admin : {TEST_ADMIN} / {TEST_ADMIN_PASS}")
    print(f"  Test User 1: {TEST_USER1} / {TEST_PASS1}")
    print(f"  Test User 2: {TEST_USER2} / {TEST_PASS2}")
    print(f"  Vault key  : {TEST_VAULT_KEY}")
    print(f"\n  Real admin ({SITE_ADMIN_USER}) was NOT touched.")
    print()


if __name__ == "__main__":
    main()
