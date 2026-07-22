import sqlite3

from sqlalchemy import inspect, or_

from app import (ActiveTimer, DailyStudy, Friendship, Project, StudySession, User, UserBackup,
                 create_app, db, initialize_database)
from conftest import register


def create_admin(app, username="admin", password="AdminPassword123"):
    with app.app_context():
        user = User(username=username, username_key=username.casefold(), is_approved=True,
                    is_admin=True, auth_version=0)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return user.id


def login(client, username, password):
    return client.post("/login", data={"username": username, "password": password, "remember": "y"},
                       follow_redirects=False)


def test_registration_stays_pending_until_admin_approval(app, client):
    response = register(client, "pending_user", approve=False)
    assert response.status_code == 302 and "registered=pending" in response.headers["Location"]
    assert client.get("/api/bootstrap").status_code == 401
    rejected = login(client, "pending_user", "password123")
    assert rejected.status_code == 200
    assert "账号正在等待管理员审批" in rejected.get_data(as_text=True)
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "pending_user"))
        assert not user.is_approved and not user.is_admin
        assert db.session.scalar(db.select(db.func.count()).select_from(Project).where(
            Project.user_id == user.id)) == 0


def test_admin_approves_user_and_regular_user_cannot_open_admin(app):
    regular = app.test_client()
    register(regular, "regular_user")
    assert regular.get("/admin").status_code == 403

    pending = app.test_client()
    register(pending, "new_member", approve=False)
    with app.app_context():
        pending_user = db.session.scalar(db.select(User).where(User.username_key == "new_member"))
        pending_id = pending_user.id

    admin = app.test_client()
    create_admin(app)
    response = login(admin, "admin", "AdminPassword123")
    assert response.status_code == 302 and response.headers["Location"].endswith("/admin")
    page = admin.get("/admin")
    assert page.status_code == 200 and page.headers["Cache-Control"] == "no-store"
    assert "new_member" in page.get_data(as_text=True)

    assert admin.post(f"/api/admin/users/{pending_id}/approve").status_code == 200
    assert admin.post(f"/api/admin/users/{pending_id}/approve").status_code == 200
    with app.app_context():
        user = db.session.get(User, pending_id)
        assert user.is_approved
        assert db.session.scalar(db.select(db.func.count()).select_from(Project).where(
            Project.user_id == user.id)) == 4
    assert login(pending, "new_member", "password123").status_code == 302


def test_random_password_reset_invalidates_old_password_and_sessions(app):
    member = app.test_client()
    register(member, "reset_member")
    with app.app_context():
        member_id = db.session.scalar(db.select(User.id).where(User.username_key == "reset_member"))

    admin = app.test_client()
    create_admin(app)
    login(admin, "admin", "AdminPassword123")
    response = admin.post(f"/api/admin/users/{member_id}/reset-password")
    body = response.get_json()
    temporary_password = body["data"]["temporaryPassword"]
    assert response.status_code == 200 and response.headers["Cache-Control"] == "no-store"
    assert len(temporary_password) == 20 and "temporaryPassword" in body["data"]

    assert member.get("/api/bootstrap").status_code == 401
    assert login(member, "reset_member", "password123").status_code == 200
    assert login(member, "reset_member", temporary_password).status_code == 302


def test_admin_delete_cascades_user_data_and_protects_admin(app):
    member = app.test_client()
    friend = app.test_client()
    register(member, "delete_member")
    register(friend, "friend_member")
    member.post("/api/friends/add", json={"username": "friend_member"})
    member.put("/api/study/day/2026-07-21", json={"durations": {"math": 3600}})
    member.post("/api/timer/start", json={"projectId": "english", "mode": "countup"})
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "delete_member"))
        user_id = user.id
        db.session.add(UserBackup(user_id=user_id, payload_json="{}"))
        db.session.commit()

    admin = app.test_client()
    admin_id = create_admin(app)
    login(admin, "admin", "AdminPassword123")
    assert admin.delete(f"/api/admin/users/{admin_id}").status_code == 403
    assert admin.post(f"/api/admin/users/{admin_id}/reset-password").status_code == 403
    assert admin.delete(f"/api/admin/users/{user_id}").status_code == 200

    with app.app_context():
        assert db.session.get(User, user_id) is None
        assert db.session.get(ActiveTimer, user_id) is None
        assert db.session.get(UserBackup, user_id) is None
        assert db.session.scalar(db.select(db.func.count()).select_from(Project).where(Project.user_id == user_id)) == 0
        assert db.session.scalar(db.select(db.func.count()).select_from(DailyStudy).where(DailyStudy.user_id == user_id)) == 0
        assert db.session.scalar(db.select(db.func.count()).select_from(StudySession).where(StudySession.user_id == user_id)) == 0
        assert db.session.scalar(db.select(db.func.count()).select_from(Friendship).where(
            or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id))) == 0
    assert member.get("/api/bootstrap").status_code == 401


def test_pending_users_and_admin_are_hidden_from_friend_features(app):
    member = app.test_client()
    register(member, "search_owner")
    pending = app.test_client()
    register(pending, "hidden_pending", approve=False)
    create_admin(app)

    assert member.get("/api/friends/search?q=hidden").get_json()["data"] == []
    assert member.get("/api/friends/search?q=admin").get_json()["data"] == []
    assert member.post("/api/friends/add", json={"username": "hidden_pending"}).status_code == 404
    assert member.post("/api/friends/add", json={"username": "admin"}).status_code == 404


def test_legacy_database_migration_marks_existing_users_approved(tmp_path):
    database_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(database_path)
    connection.execute("""CREATE TABLE user (
        id INTEGER PRIMARY KEY, username VARCHAR(20) NOT NULL, username_key VARCHAR(40) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL, last_seen_at DATETIME
    )""")
    connection.execute("INSERT INTO user VALUES (1, 'legacy_user', 'legacy_user', 'hash', CURRENT_TIMESTAMP, NULL)")
    connection.commit()
    connection.close()

    application = create_app({"TESTING": True, "WTF_CSRF_ENABLED": False, "RATELIMIT_ENABLED": False,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{database_path.as_posix()}", "SECRET_KEY": "migration-test"})
    with application.app_context():
        initialize_database()
        user = db.session.get(User, 1)
        assert user.is_approved is True
        assert user.is_admin is False
        assert user.auth_version == 0
        assert user.logged_out_at is None
        column_names = {column["name"] for column in inspect(db.engine).get_columns("user")}
        assert {"is_approved", "is_admin", "auth_version", "logged_out_at"}.issubset(column_names)
