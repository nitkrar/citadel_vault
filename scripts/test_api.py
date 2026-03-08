#!/usr/bin/env python3
"""
test_api.py — API test suite for Personal Vault V2.
Uses test_site_admin for admin tests. NEVER touches citadel_site_admin.
Tests: auth, encryption, accounts, assets, insurance, portfolio,
       reference, sharing, users, export.
Run seed_data.py first to create test users.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from test_config import *


def main():
    print_header("Personal Vault V2 — API Tests")

    if not check_server():
        sys.exit(1)

    # =====================================================================
    # AUTH TESTS
    # =====================================================================
    print_section("Auth: Login")

    code, _, _ = login_user("nonexistent", "wrong")
    assert_status(code, 401, "Login with wrong credentials")

    code, resp, u1_token = login_user(TEST_USER1, TEST_PASS1)
    assert_status(code, 200, "Login test user 1")
    assert_contains(resp.get("data", {}), "token", "Got JWT token")

    code, resp, u2_token = login_user(TEST_USER2, TEST_PASS2)
    assert_status(code, 200, "Login test user 2")

    code, resp, admin_token = login_user(TEST_ADMIN, TEST_ADMIN_PASS)
    assert_status(code, 200, "Login test admin")

    print_section("Auth: Profile")
    code, resp = api_get("auth.php?action=me", token=u1_token)
    assert_status(code, 200, "Get profile")
    assert_equals(resp.get("data", {}).get("username"), TEST_USER1, "Profile username")

    # =====================================================================
    # ENCRYPTION TESTS
    # =====================================================================
    print_section("Encryption: Vault Status & Unlock")

    code, resp = api_get("encryption.php?action=status", token=u1_token)
    assert_status(code, 200, "Vault status")
    assert_equals(resp.get("data", {}).get("has_vault_key"), True, "User 1 has vault key")

    code, resp, u1_data_token = unlock_vault(TEST_VAULT_KEY, u1_token)
    assert_status(code, 200, "Unlock vault user 1")
    assert_contains(resp.get("data", {}), "data_token", "Got data token")

    code, resp, _ = unlock_vault("999999", u1_token)
    assert_status(code, 401, "Wrong vault key rejected")

    code, resp, u2_data_token = unlock_vault(TEST_VAULT_KEY, u2_token)
    assert_status(code, 200, "Unlock vault user 2")

    code, resp, admin_data_token = unlock_vault(TEST_VAULT_KEY, admin_token)
    assert_status(code, 200, "Unlock vault test admin")

    # =====================================================================
    # REFERENCE DATA TESTS
    # =====================================================================
    print_section("Reference: Account Types")
    code, resp = api_get("reference.php?resource=account-types", token=u1_token)
    assert_status(code, 200, "List account types")
    types = resp.get("data", [])
    assert_equals(len(types) >= 7, True, "At least 7 account types")

    print_section("Reference: Asset Types")
    code, resp = api_get("reference.php?resource=asset-types", token=u1_token)
    assert_status(code, 200, "List asset types")
    atypes = resp.get("data", [])
    assert_equals(len(atypes) >= 12, True, "At least 12 asset types")

    equity = [t for t in atypes if t.get("category") == "equity"]
    if equity:
        assert_equals(isinstance(equity[0].get("json_schema"), list), True, "json_schema decoded as array")

    print_section("Reference: Countries & Currencies")
    code, resp = api_get("reference.php?resource=countries", token=u1_token)
    assert_status(code, 200, "List countries")
    assert_equals(len(resp.get("data", [])) >= 24, True, "24 countries")

    code, resp = api_get("reference.php?resource=currencies", token=u1_token)
    assert_status(code, 200, "List currencies")
    currencies_list = resp.get("data", [])
    assert_equals(len(currencies_list) >= 23, True, "23 currencies")

    # Build lookup maps
    currencies = {c['code']: c['id'] for c in currencies_list}
    code, resp = api_get("reference.php?resource=countries", token=u1_token)
    country_map = {c['code']: c['id'] for c in resp.get("data", [])}
    acc_type_map = {t['name']: t['id'] for t in types}
    asset_type_map = {t['name']: t['id'] for t in atypes}

    # =====================================================================
    # ACCOUNTS TESTS (container-only)
    # =====================================================================
    print_section("Accounts: CRUD")

    code, resp = api_post("accounts.php", {
        "name": "Test Savings",
        "institution": "Test Bank",
        "account_type_id": acc_type_map.get("Savings", 2),
        "country_id": country_map.get("GB"),
        "currency_id": currencies.get("GBP", 1),
        "subtype": "isa",
        "comments": "Test account",
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 201, "Create account")
    account_id = resp.get("data", {}).get("id")

    code, resp = api_get("accounts.php", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "List accounts")
    assert_equals(len(resp.get("data", [])) >= 1, True, "At least 1 account")

    code, resp = api_get(f"accounts.php?id={account_id}", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "Get single account")
    assert_equals(resp.get("data", {}).get("name"), "Test Savings", "Account name")

    code, resp = api_put(f"accounts.php?id={account_id}", {
        "name": "Updated Savings",
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "Update account")

    code, resp = api_get(f"accounts.php?id={account_id}", token=u1_token, data_token=u1_data_token)
    assert_equals(resp.get("data", {}).get("name"), "Updated Savings", "Account name updated")

    # =====================================================================
    # ASSETS TESTS
    # =====================================================================
    print_section("Assets: CRUD")

    code, resp = api_post("assets.php", {
        "name": "Test Balance",
        "asset_type_id": asset_type_map.get("Cash Balance", 1),
        "currency_id": currencies.get("GBP", 1),
        "amount": 5000.50,
        "is_liquid": 1,
        "account_id": account_id,
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 201, "Create asset (linked)")
    asset_id = resp.get("data", {}).get("id")

    code, resp = api_post("assets.php", {
        "name": "Test Property",
        "asset_type_id": asset_type_map.get("Property", 6),
        "currency_id": currencies.get("GBP", 1),
        "amount": 200000,
        "is_liquid": 0,
        "asset_data": {"address": "Test Street", "purchase_price": 180000},
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 201, "Create standalone asset")
    asset_id2 = resp.get("data", {}).get("id")

    code, resp = api_post("assets.php", {
        "name": "Test Loan",
        "asset_type_id": asset_type_map.get("Debt / Liability", 10),
        "currency_id": currencies.get("GBP", 1),
        "amount": 50000,
        "is_liability": 1,
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 201, "Create liability")
    liability_id = resp.get("data", {}).get("id")

    code, resp = api_get("assets.php", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "List assets")
    assert_equals(len(resp.get("data", [])) >= 3, True, "At least 3 assets")

    code, resp = api_get(f"assets.php?account_id={account_id}", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "List assets by account")
    assert_equals(len(resp.get("data", [])) >= 1, True, "At least 1 in account")

    code, resp = api_get(f"assets.php?id={asset_id}", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "Get single asset")
    assert_equals(resp.get("data", {}).get("amount"), 5000.50, "Asset amount")

    code, resp = api_get(f"assets.php?id={asset_id2}", token=u1_token, data_token=u1_data_token)
    assert_equals(resp.get("data", {}).get("asset_data", {}).get("address"), "Test Street", "Asset data decoded")

    code, resp = api_put(f"assets.php?id={asset_id}", {
        "amount": 6000.75,
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "Update asset")

    # =====================================================================
    # INSURANCE TESTS
    # =====================================================================
    print_section("Insurance: CRUD")

    code, resp = api_post("insurance.php", {
        "policy_name": "Test Life Cover",
        "provider": "Test Insurance Co",
        "category": "Life",
        "premium_amount": 50.00,
        "coverage_amount": 100000,
        "payment_frequency": "monthly",
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 201, "Create insurance policy")
    policy_id = resp.get("data", {}).get("id")

    code, resp = api_get("insurance.php", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "List policies")
    assert_equals(len(resp.get("data", [])) >= 1, True, "At least 1 policy")

    code, resp = api_get(f"insurance.php?id={policy_id}", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "Get single policy")
    assert_equals(resp.get("data", {}).get("policy_name"), "Test Life Cover", "Policy name")

    code, resp = api_put(f"insurance.php?id={policy_id}", {
        "premium_amount": 55.00,
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "Update policy")

    # =====================================================================
    # PORTFOLIO TESTS
    # =====================================================================
    print_section("Portfolio")

    code, resp = api_get("portfolio.php", token=u1_token, data_token=u1_data_token)
    assert_status(code, 200, "Get portfolio")
    portfolio = resp.get("data", {})
    assert_contains(portfolio, "summary", "Has summary")
    assert_contains(portfolio, "assets", "Has assets")
    assert_contains(portfolio, "by_country", "Has by_country")
    assert_contains(portfolio, "by_type", "Has by_type")

    summary = portfolio.get("summary", {})
    assert_equals(summary.get("net_worth") is not None, True, "Net worth computed")

    code, resp = api_post("portfolio.php?action=snapshot", {
        "date": "2024-01-15",
    }, token=u1_token, data_token=u1_data_token)
    assert_status(code, 201, "Save snapshot")

    code, resp = api_get("portfolio.php?action=snapshots", token=u1_token)
    assert_status(code, 200, "List snapshots")
    assert_equals(len(resp.get("data", [])) >= 1, True, "At least 1 snapshot")

    # =====================================================================
    # SHARING TESTS
    # =====================================================================
    print_section("Sharing")

    code, resp = api_get("users.php?action=list-simple", token=u1_token)
    assert_status(code, 200, "List users for sharing")
    users_list = resp.get("data", [])
    u2_id = None
    for u in users_list:
        if u.get("username") == TEST_USER2:
            u2_id = u["id"]
            break

    if u2_id and asset_id:
        code, resp = api_post("sharing.php", {
            "recipient_user_id": u2_id,
            "source_type": "asset",
            "source_id": asset_id,
            "sync_mode": "snapshot",
            "label": "Test share",
        }, token=u1_token, data_token=u1_data_token)
        assert_status(code, 201, "Share asset")
        share_id = resp.get("data", {}).get("id")

        code, resp = api_get("sharing.php?action=sent", token=u1_token, data_token=u1_data_token)
        assert_status(code, 200, "List sent shares")
        assert_equals(len(resp.get("data", [])) >= 1, True, "At least 1 sent")

        code, resp = api_get("sharing.php?action=received", token=u2_token, data_token=u2_data_token)
        assert_status(code, 200, "List received shares")

        code, resp = api_get("sharing.php?action=pending-count", token=u2_token, data_token=u2_data_token)
        assert_status(code, 200, "Pending count")
        assert_equals(resp.get("data", {}).get("count", 0) >= 1, True, "At least 1 pending")

        if share_id:
            code, resp = api_delete(f"sharing.php?id={share_id}", token=u1_token, data_token=u1_data_token)
            assert_status(code, 200, "Revoke share")

    # =====================================================================
    # ADMIN TESTS (using test_site_admin)
    # =====================================================================
    print_section("Admin: User Management")

    code, resp = api_get("users.php", token=admin_token)
    assert_status(code, 200, "Admin list users")
    assert_equals(len(resp.get("data", [])) >= 3, True, "At least 3 users")

    code, resp = api_get("users.php", token=u1_token)
    assert_status(code, 403, "Non-admin cannot list users")

    # =====================================================================
    # EXPORT TESTS
    # =====================================================================
    print_section("Export")

    code, body = api_download(
        "export.php?format=csv&sections=portfolio,assets,accounts,insurance,rates",
        token=u1_token, data_token=u1_data_token,
    )
    assert_status(code, 200, "Export CSV")
    csv_text = body.decode("utf-8-sig", errors="replace") if isinstance(body, bytes) else str(body)
    assert_equals("PORTFOLIO SUMMARY" in csv_text, True, "Has portfolio section")
    assert_equals("ASSETS" in csv_text, True, "Has assets section")

    # =====================================================================
    # CLEANUP
    # =====================================================================
    print_section("Cleanup")

    for aid in [liability_id, asset_id2, asset_id]:
        if aid:
            code, resp = api_delete(f"assets.php?id={aid}", token=u1_token, data_token=u1_data_token)
            assert_status(code, 200, f"Delete asset {aid}")

    if policy_id:
        code, resp = api_delete(f"insurance.php?id={policy_id}", token=u1_token, data_token=u1_data_token)
        assert_status(code, 200, "Delete policy")

    if account_id:
        code, resp = api_delete(f"accounts.php?id={account_id}", token=u1_token, data_token=u1_data_token)
        assert_status(code, 200, "Delete account")

    # =====================================================================
    # SUMMARY
    # =====================================================================
    exit_code = print_summary()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
