from datetime import datetime

from sqlalchemy import inspect, text

from app import APP_TZ, User, build_bundle, db, initialize_database
from conftest import register


def payload(response):
    body = response.get_json()
    assert body["ok"], body
    return body["data"]


def test_countdown_save_update_clear_and_bootstrap(app, client):
    register(client, "countdown_owner")
    initial = payload(client.get("/api/bootstrap"))
    assert initial["countdown"] is None

    saved = payload(client.patch("/api/preferences/countdown", json={
        "name": "  考研初试  ", "date": "2026-12-26",
    }))
    assert saved == {"name": "考研初试", "date": "2026-12-26"}
    assert payload(client.get("/api/bootstrap"))["countdown"] == saved

    updated = payload(client.patch("/api/preferences/countdown", json={
        "name": "复试", "date": "2027-03-20",
    }))
    assert updated == {"name": "复试", "date": "2027-03-20"}

    assert payload(client.patch("/api/preferences/countdown", json={"date": None})) is None
    assert payload(client.get("/api/bootstrap"))["countdown"] is None
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "countdown_owner"))
        assert user.countdown_name is None and user.countdown_date is None


def test_countdown_validation_and_authentication(client):
    assert client.patch("/api/preferences/countdown", json={
        "name": "考研初试", "date": "2026-12-26",
    }).status_code == 401


def test_countdown_rejects_invalid_payloads(app, client):
    register(client, "countdown_invalid")
    invalid_payloads = [
        {},
        {"name": "考研初试"},
        {"date": "2026-12-26"},
        {"name": "", "date": "2026-12-26"},
        {"name": "   ", "date": "2026-12-26"},
        {"name": "x" * 21, "date": "2026-12-26"},
        {"name": "考研初试", "date": "2026-02-30"},
        {"name": "考研初试", "date": "2026/12/26"},
        {"name": "考研初试", "date": "20261226"},
        {"name": "考研初试", "date": 20261226},
        {"name": ["考研初试"], "date": "2026-12-26"},
    ]
    for item in invalid_payloads:
        response = client.patch("/api/preferences/countdown", json=item)
        assert response.status_code == 400, item
    assert payload(client.get("/api/bootstrap"))["countdown"] is None


def test_countdown_is_private_and_import_export_restore_preserve_it(app, client):
    alice = client
    bob = app.test_client()
    register(alice, "countdown_alice")
    register(bob, "countdown_bob")
    expected = payload(alice.patch("/api/preferences/countdown", json={
        "name": "Alice 目标", "date": "2026-12-26",
    }))
    assert payload(bob.get("/api/bootstrap"))["countdown"] is None

    with app.app_context():
        alice_user = db.session.scalar(db.select(User).where(User.username_key == "countdown_alice"))
        bundle = build_bundle(alice_user.id)
    assert "countdown" not in bundle
    exported = alice.get("/api/data/export")
    assert exported.status_code == 200
    assert b'"countdown"' not in exported.data

    imported = dict(bundle)
    imported["countdown"] = {"name": "恶意覆盖", "date": "2030-01-01"}
    assert alice.post("/api/data/import", json=imported).status_code == 200
    assert payload(alice.get("/api/bootstrap"))["countdown"] == expected
    assert alice.post("/api/data/restore").status_code == 200
    assert payload(alice.get("/api/bootstrap"))["countdown"] == expected


def test_initialize_database_adds_countdown_columns_to_legacy_user_table(app):
    with app.app_context():
        db.drop_all()
        with db.engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE user (
                    id INTEGER PRIMARY KEY,
                    username VARCHAR(20) NOT NULL,
                    username_key VARCHAR(40) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    created_at DATETIME NOT NULL,
                    last_seen_at DATETIME,
                    logged_out_at DATETIME,
                    is_approved BOOLEAN NOT NULL DEFAULT 0,
                    is_admin BOOLEAN NOT NULL DEFAULT 0,
                    auth_version INTEGER NOT NULL DEFAULT 0,
                    preferred_version VARCHAR(12) NOT NULL DEFAULT 'classic'
                )
            """))
            connection.execute(text("""
                INSERT INTO user (id, username, username_key, password_hash, created_at, is_approved)
                VALUES (7, 'legacy_user', 'legacy_user', 'hash', :created_at, 1)
            """), {"created_at": datetime.now(APP_TZ).replace(tzinfo=None)})
        initialize_database()
        columns = {item["name"] for item in inspect(db.engine).get_columns("user")}
        assert {"countdown_name", "countdown_date"}.issubset(columns)
        legacy = db.session.get(User, 7)
        assert legacy.username == "legacy_user"
        assert legacy.countdown_name is None and legacy.countdown_date is None
