from datetime import datetime, timedelta
from uuid import uuid4

from app import APP_TZ, UTC, ActiveTimer, DailyStudy, Project, StudySession, User, db
from conftest import register


def payload(response):
    body = response.get_json()
    assert body["ok"], body
    return body["data"]


def utc_naive(study_date, hour, minute=0):
    local = datetime(study_date.year, study_date.month, study_date.day, hour, minute, tzinfo=APP_TZ)
    return local.astimezone(UTC).replace(tzinfo=None)


def project(app, user_id, external_id):
    with app.app_context():
        return db.session.scalar(db.select(Project).where(
            Project.user_id == user_id, Project.external_id == external_id)).id


def add_session(user_id, project_id, started_at, seconds):
    db.session.add(StudySession(session_uuid=str(uuid4()), user_id=user_id, project_id=project_id,
                                started_at=started_at, ended_at=started_at + timedelta(seconds=seconds),
                                duration_seconds=seconds))


def test_daily_candles_and_project_filter(app, client):
    register(client, "trend_daily")
    today = datetime.now(APP_TZ).date()
    math_id = project(app, 1, "math")
    english_id = project(app, 1, "english")
    with app.app_context():
        add_session(1, math_id, utc_naive(today, 8), 1200)
        add_session(1, math_id, utc_naive(today, 10), 3600)
        add_session(1, math_id, utc_naive(today, 12), 1800)
        add_session(1, english_id, utc_naive(today, 14), 2400)
        db.session.add_all([
            DailyStudy(user_id=1, project_id=math_id, study_date=today, seconds=7200),
            DailyStudy(user_id=1, project_id=english_id, study_date=today, seconds=2400),
        ])
        db.session.commit()
    data = payload(client.get("/api/trends?interval=day&projectId=math&limit=30"))
    candle = data["candles"][-1]
    assert candle == {"key": today.isoformat(), "label": today.strftime("%m/%d"),
                      "totalSeconds": 7200, "sessionCount": 3,
                      "openSeconds": 1200, "highSeconds": 3600,
                      "lowSeconds": 1200, "closeSeconds": 1800}
    assert any(item["id"] == "math" for item in data["projects"])


def test_manual_only_volume_does_not_create_candle(app, client):
    register(client, "trend_manual")
    study_day = datetime.now(APP_TZ).date() - timedelta(days=1)
    math_id = project(app, 1, "math")
    with app.app_context():
        db.session.add(DailyStudy(user_id=1, project_id=math_id, study_date=study_day, seconds=5400))
        db.session.commit()
    data = payload(client.get("/api/trends?interval=day&projectId=all&limit=30"))
    candle = next(item for item in data["candles"] if item["key"] == study_day.isoformat())
    assert candle["totalSeconds"] == 5400
    assert candle["sessionCount"] == 0
    assert candle["openSeconds"] is None


def test_intraday_returns_live_timer_and_completed_curve(app, client):
    register(client, "trend_live")
    today = datetime.now(APP_TZ).date()
    math_id = project(app, 1, "math")
    with app.app_context():
        add_session(1, math_id, utc_naive(today, 8), 900)
        db.session.add(DailyStudy(user_id=1, project_id=math_id, study_date=today, seconds=900))
        db.session.commit()
    started = payload(client.post("/api/timer/start", json={"projectId": "math", "mode": "countup"}))
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(seconds=75)
        timer.session_started_at -= timedelta(seconds=75)
        db.session.commit()
    data = payload(client.get(f"/api/trends?interval=intraday&projectId=math&date={today.isoformat()}"))
    assert data["sessionSeconds"] == 900
    assert data["sessions"][0]["projectId"] == "math"
    assert data["activeTimer"]["sessionId"] == started["sessionId"]
    assert data["activeTimer"]["elapsedSeconds"] >= 74


def test_intraday_immediately_includes_expired_countdown(app, client):
    register(client, "trend_countdown")
    today = datetime.now(APP_TZ).date()
    started = payload(client.post("/api/timer/start", json={"projectId": "math", "mode": "countdown",
                                                             "targetSeconds": 60}))
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(seconds=80)
        timer.session_started_at -= timedelta(seconds=80)
        db.session.commit()
    data = payload(client.get(f"/api/trends?interval=intraday&projectId=math&date={today.isoformat()}"))
    assert data["activeTimer"] is None
    assert data["sessionSeconds"] == 60
    assert data["totalSeconds"] == 60
    assert data["sessions"][0]["durationSeconds"] == 60
    assert data["sessions"][0]["startedAt"] <= data["sessions"][0]["endedAt"]
    assert started["sessionId"]


def test_weekly_aggregation_uses_monday_across_year(app, client):
    register(client, "trend_week")
    study_day = datetime(2025, 12, 31, tzinfo=APP_TZ).date()
    math_id = project(app, 1, "math")
    with app.app_context():
        add_session(1, math_id, utc_naive(study_day, 9), 1500)
        add_session(1, math_id, utc_naive(study_day, 15), 2700)
        db.session.add(DailyStudy(user_id=1, project_id=math_id, study_date=study_day, seconds=4200))
        db.session.commit()
    data = payload(client.get("/api/trends?interval=week&projectId=all&limit=104"))
    candle = next(item for item in data["candles"] if item["key"] == "2025-12-29")
    assert candle["weekEnd"] == "2026-01-04"
    assert candle["openSeconds"] == 1500 and candle["closeSeconds"] == 2700
    assert candle["highSeconds"] == 2700 and candle["lowSeconds"] == 1500


def test_cross_midnight_session_belongs_to_start_day(app, client):
    register(client, "trend_midnight")
    start_day = datetime.now(APP_TZ).date() - timedelta(days=1)
    math_id = project(app, 1, "math")
    with app.app_context():
        add_session(1, math_id, utc_naive(start_day, 23, 59), 120)
        db.session.add(DailyStudy(user_id=1, project_id=math_id, study_date=start_day, seconds=60))
        db.session.commit()
    data = payload(client.get("/api/trends?interval=day&projectId=math&limit=30"))
    candle = next(item for item in data["candles"] if item["key"] == start_day.isoformat())
    assert candle["openSeconds"] == 120
    assert candle["totalSeconds"] == 60


def test_trend_validation_and_user_isolation(app):
    alice = app.test_client(); bob = app.test_client()
    register(alice, "trend_alice"); register(bob, "trend_bob")
    with app.app_context():
        bob_user = db.session.scalar(db.select(User).where(User.username_key == "trend_bob"))
        bob_project = db.session.scalar(db.select(Project).where(Project.user_id == bob_user.id))
        bob_project.external_id = "bob_private"
        db.session.commit()
    assert alice.get("/api/trends?interval=month").status_code == 400
    assert alice.get("/api/trends?interval=day&limit=31").status_code == 400
    assert alice.get("/api/trends?interval=intraday&date=bad-date").status_code == 400
    assert alice.get("/api/trends?interval=day&projectId=bob_private&limit=30").status_code == 400
    assert app.test_client().get("/api/trends").status_code == 401
