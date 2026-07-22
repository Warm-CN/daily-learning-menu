from datetime import datetime, timedelta

from app import ActiveTimer, DailyStudy, Project, StudySession, User, db, split_segments, utcnow
from conftest import register


def payload(response):
    body = response.get_json()
    assert body["ok"], body
    return body["data"]


def test_registration_login_and_protected_api(app, client):
    response = register(client, "张三同学")
    assert response.status_code == 302
    assert client.get("/api/bootstrap").status_code == 200
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "张三同学"))
        assert user.check_password("password123")
        assert len(db.session.scalars(db.select(Project).where(Project.user_id == user.id)).all()) == 4
    client.post("/logout")
    assert client.get("/api/bootstrap").status_code == 401


def test_direct_friendship_and_status(app):
    alice = app.test_client(); bob = app.test_client()
    register(alice, "alice"); register(bob, "bob")
    assert alice.post("/api/friends/add", json={"username": "bob"}).status_code == 200
    assert alice.post("/api/friends/add", json={"username": "bob"}).status_code == 200
    alice_view = payload(alice.get("/api/friends/status"))
    bob_view = payload(bob.get("/api/friends/status"))
    assert alice_view[0]["username"] == "bob" and alice_view[0]["online"]
    assert bob_view[0]["username"] == "alice"
    with app.app_context():
        bob_user = db.session.scalar(db.select(User).where(User.username_key == "bob"))
        bob_user.last_seen_at = utcnow() - timedelta(seconds=61)
        db.session.commit()
    offline = payload(alice.get("/api/friends/status"))[0]
    assert offline["online"] is False
    assert offline["lastSeenAt"].endswith("Z")
    assert alice.delete(f"/api/friends/{alice_view[0]['id']}").status_code == 200
    assert payload(alice.get("/api/friends/status")) == []


def test_logout_is_immediately_offline_and_preserves_last_seen(app):
    alice = app.test_client(); bob = app.test_client()
    register(alice, "logout_watcher"); register(bob, "logout_friend")
    alice.post("/api/friends/add", json={"username": "logout_friend"})
    assert payload(alice.get("/api/friends/status"))[0]["online"] is True
    assert bob.post("/logout").status_code == 302
    friend = payload(alice.get("/api/friends/status"))[0]
    assert friend["online"] is False
    assert friend["lastSeenAt"].endswith("Z")
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "logout_friend"))
        assert user.last_seen_at == user.logged_out_at


def test_timer_version_pause_resume_and_idempotent_stop(app, client):
    register(client, "timer_user")
    started = payload(client.post("/api/timer/start", json={"projectId": "math", "mode": "countup",
                                                             "targetSeconds": None}))
    stale = client.post("/api/timer/pause", json={"sessionId": started["sessionId"], "version": 999})
    assert stale.status_code == 409
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(seconds=90)
        db.session.commit()
    paused = payload(client.post("/api/timer/pause", json={"sessionId": started["sessionId"],
                                                            "version": started["version"]}))
    assert paused["phase"] == "paused" and paused["elapsedSeconds"] >= 89
    resumed = payload(client.post("/api/timer/resume", json={"sessionId": paused["sessionId"],
                                                              "version": paused["version"]}))
    result = payload(client.post("/api/timer/stop", json={"sessionId": resumed["sessionId"],
                                                           "version": resumed["version"]}))
    assert result["durationSeconds"] >= 89
    duplicate = payload(client.post("/api/timer/stop", json={"sessionId": resumed["sessionId"],
                                                              "version": resumed["version"]}))
    assert duplicate["durationSeconds"] == result["durationSeconds"]
    with app.app_context():
        assert db.session.scalar(db.select(db.func.count()).select_from(StudySession)) == 1
        assert db.session.scalar(db.select(db.func.sum(DailyStudy.seconds))) == result["durationSeconds"]


def test_expired_countdown_finalizes_on_read(app, client):
    register(client, "countdown_user")
    started = payload(client.post("/api/timer/start", json={"projectId": "english", "mode": "countdown",
                                                             "targetSeconds": 60}))
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(seconds=80)
        timer.session_started_at -= timedelta(seconds=80)
        db.session.commit()
    assert payload(client.get("/api/timer/state")) is None
    with app.app_context():
        session = db.session.get(StudySession, started["sessionId"])
        assert session.duration_seconds == 60


def test_expired_countdown_stop_commits_immediately(app, client):
    register(client, "stop_countdown")
    started = payload(client.post("/api/timer/start", json={"projectId": "math", "mode": "countdown",
                                                             "targetSeconds": 60}))
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(seconds=80)
        timer.session_started_at -= timedelta(seconds=80)
        db.session.commit()
    response = client.post("/api/timer/stop", json={"sessionId": started["sessionId"],
                                                     "version": started["version"]})
    assert payload(response)["durationSeconds"] == 60
    with app.app_context():
        assert db.session.get(StudySession, started["sessionId"]) is not None
        assert db.session.get(ActiveTimer, 1) is None


def test_countup_auto_pauses_at_24_hours(app, client):
    register(client, "long_timer")
    payload(client.post("/api/timer/start", json={"projectId": "math", "mode": "countup"}))
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(hours=25)
        timer.session_started_at -= timedelta(hours=25)
        db.session.commit()
    state = payload(client.get("/api/timer/state"))
    assert state["phase"] == "paused"
    assert round(state["elapsedSeconds"]) == 86400


def test_cross_midnight_split_uses_china_timezone():
    start = datetime.fromisoformat("2026-07-20T15:59:30")  # UTC: 中国时间 23:59:30
    end = start + timedelta(seconds=90)
    totals, _ = split_segments([[start.isoformat(), end.isoformat()]], 90)
    assert sorted(totals.values()) == [30, 60]


def test_backup_import_and_restore(app, client):
    register(client, "backup_user")
    bundle = payload(client.get("/api/bootstrap"))
    imported = {"format": "kaoyan-study-backup", "version": 1, "study": {
        "2026-07-20": {"math": 3600, "energy": 80, "notes": "导入"}}, "sessions": [],
        "milestones": {}, "projects": bundle["projects"]}
    assert client.post("/api/data/import", json=imported).status_code == 200
    loaded = payload(client.get("/api/bootstrap"))
    assert loaded["study"]["2026-07-20"]["math"] == 3600
    assert client.post("/api/data/restore").status_code == 200
    restored = payload(client.get("/api/bootstrap"))
    assert "2026-07-20" not in restored["study"]


def test_cannot_edit_another_users_project(app):
    alice = app.test_client(); bob = app.test_client()
    register(alice, "owner"); register(bob, "other")
    with app.app_context():
        other = db.session.scalar(db.select(User).where(User.username_key == "other"))
        project = db.session.scalar(db.select(Project).where(Project.user_id == other.id))
    assert alice.patch(f"/api/projects/{project.external_id}", json={"name": "越权"}).status_code == 200
    with app.app_context():
        # 相同 external_id 只会修改 alice 自己的项目，bob 数据不变。
        bob_project = db.session.get(Project, project.id)
        assert bob_project.name != "越权"


def test_api_post_requires_csrf_when_enabled(app, client):
    register(client, "csrf_user")
    app.config["WTF_CSRF_ENABLED"] = True
    assert client.post("/api/presence").status_code == 400
