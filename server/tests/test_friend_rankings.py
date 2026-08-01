import json
from datetime import datetime, time, timedelta
from uuid import uuid4

from app import (APP_TZ, UTC, ActiveTimer, DailyStudy, Project, StudySession, User, db,
                 utcnow)
from conftest import register


def payload(response):
    body = response.get_json()
    assert body["ok"], body
    return body["data"]


def local_utc(study_date, hour, minute=0):
    return datetime.combine(study_date, time(hour, minute), APP_TZ).astimezone(UTC).replace(tzinfo=None)


def member(data, username):
    return next(item for item in data["members"] if item["username"] == username)


def add_session(user_id, project_id, started_at, seconds):
    db.session.add(StudySession(session_uuid=str(uuid4()), user_id=user_id, project_id=project_id,
        started_at=started_at, ended_at=started_at + timedelta(seconds=seconds), duration_seconds=seconds))


def test_rankings_include_only_self_and_friends_with_daily_metrics(app):
    alice = app.test_client(); bob = app.test_client(); outsider = app.test_client()
    register(alice, "rank_alice"); register(bob, "rank_bob"); register(outsider, "rank_outsider")
    alice.post("/api/friends/add", json={"username": "rank_bob"})
    today = datetime.now(APP_TZ).date(); yesterday = today - timedelta(days=1)
    with app.app_context():
        users = {user.username: user for user in db.session.scalars(db.select(User))}
        projects = {user_id: db.session.scalar(db.select(Project).where(Project.user_id == user_id))
                    for user_id in [item.id for item in users.values()]}
        db.session.add_all([
            DailyStudy(user_id=users["rank_alice"].id, project_id=projects[users["rank_alice"].id].id,
                       study_date=today, seconds=3600),
            DailyStudy(user_id=users["rank_alice"].id, project_id=projects[users["rank_alice"].id].id,
                       study_date=yesterday, seconds=1800),
            DailyStudy(user_id=users["rank_bob"].id, project_id=projects[users["rank_bob"].id].id,
                       study_date=today, seconds=1200),
            DailyStudy(user_id=users["rank_bob"].id, project_id=projects[users["rank_bob"].id].id,
                       study_date=yesterday, seconds=2400),
            DailyStudy(user_id=users["rank_outsider"].id, project_id=projects[users["rank_outsider"].id].id,
                       study_date=today, seconds=99999),
        ])
        add_session(users["rank_alice"].id, projects[users["rank_alice"].id].id, local_utc(today, 8), 900)
        add_session(users["rank_bob"].id, projects[users["rank_bob"].id].id, local_utc(today, 9), 600)
        add_session(users["rank_bob"].id, projects[users["rank_bob"].id].id, local_utc(today, 10), 1800)
        add_session(users["rank_bob"].id, projects[users["rank_bob"].id].id,
                    local_utc(yesterday, 23, 59), 7200)
        db.session.commit()

    response = alice.get("/api/friends/rankings")
    data = payload(response)
    assert response.headers["Cache-Control"] == "no-store"
    assert data["date"] == today.isoformat() and data["timezone"] == "Asia/Shanghai"
    assert {item["username"] for item in data["members"]} == {"rank_alice", "rank_bob"}
    assert member(data, "rank_alice")["isSelf"] is True
    assert member(data, "rank_alice")["todaySeconds"] == 3600
    assert member(data, "rank_alice")["yesterdaySeconds"] == 1800
    assert member(data, "rank_alice")["longestSessionSeconds"] == 900
    assert member(data, "rank_bob")["todaySeconds"] == 1200
    assert member(data, "rank_bob")["yesterdaySeconds"] == 2400
    assert member(data, "rank_bob")["longestSessionSeconds"] == 1800
    assert app.test_client().get("/api/friends/rankings").status_code == 401


def test_unsettled_cross_midnight_timer_does_not_double_count_after_stop(app):
    alice = app.test_client(); bob = app.test_client()
    register(alice, "cross_rank_alice"); register(bob, "cross_rank_bob")
    alice.post("/api/friends/add", json={"username": "cross_rank_bob"})
    started = payload(bob.post("/api/timer/start", json={"projectId": "math", "mode": "countup"}))
    today = datetime.now(APP_TZ).date(); yesterday = today - timedelta(days=1)
    segment_start = local_utc(yesterday, 23, 59)
    segment_end = local_utc(today, 0, 1)
    with app.app_context():
        bob_user = db.session.scalar(db.select(User).where(User.username_key == "cross_rank_bob"))
        timer = db.session.get(ActiveTimer, bob_user.id)
        timer.segments_json = json.dumps([[segment_start.isoformat(), segment_end.isoformat()]])
        timer.session_started_at = segment_start
        timer.segment_started_at = None
        timer.accumulated_seconds = 120
        timer.phase = "paused"
        db.session.commit()

    before = member(payload(alice.get("/api/friends/rankings")), "cross_rank_bob")
    assert before["todayActiveSeconds"] == 60
    assert before["yesterdayActiveSeconds"] == 60
    assert before["todaySeconds"] == 60 and before["yesterdaySeconds"] == 60
    assert before["activeTimer"]["phase"] == "paused"

    bob.post("/api/timer/stop", json={"sessionId": started["sessionId"], "version": started["version"]})
    after = member(payload(alice.get("/api/friends/rankings")), "cross_rank_bob")
    assert after["todayActiveSeconds"] == 0 and after["yesterdayActiveSeconds"] == 0
    assert after["todaySettledSeconds"] == 60 and after["yesterdaySettledSeconds"] == 60
    assert after["todaySeconds"] == before["todaySeconds"]
    assert after["yesterdaySeconds"] == before["yesterdaySeconds"]
    assert after["longestSessionSeconds"] == 0


def test_running_countdown_is_capped_and_finalized_by_ranking_read(app, client):
    register(client, "countdown_rank")
    started = payload(client.post("/api/timer/start", json={
        "projectId": "english", "mode": "countdown", "targetSeconds": 60,
    }))
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "countdown_rank"))
        timer = db.session.get(ActiveTimer, user.id)
        timer.segment_started_at -= timedelta(seconds=80)
        timer.session_started_at -= timedelta(seconds=80)
        db.session.commit()

    data = payload(client.get("/api/friends/rankings"))
    own = member(data, "countdown_rank")
    assert own["todaySeconds"] == 60
    assert own["todayActiveSeconds"] == 0
    assert own["activeTimer"] is None
    assert own["longestSessionSeconds"] == 60
    with app.app_context():
        assert db.session.get(StudySession, started["sessionId"]) is not None


def test_deleted_friend_disappears_from_rankings(app):
    alice = app.test_client(); bob = app.test_client()
    register(alice, "remove_rank_alice"); register(bob, "remove_rank_bob")
    added = payload(alice.post("/api/friends/add", json={"username": "remove_rank_bob"}))
    assert len(payload(alice.get("/api/friends/rankings"))["members"]) == 2
    alice.delete(f"/api/friends/{added['id']}")
    remaining = payload(alice.get("/api/friends/rankings"))["members"]
    assert len(remaining) == 1 and remaining[0]["isSelf"] is True
