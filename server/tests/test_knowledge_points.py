from datetime import datetime, timedelta

from app import APP_TZ, KnowledgePoint, Project, User, build_bundle, db
from conftest import register


def payload(response):
    body = response.get_json()
    assert body["ok"], body
    return body["data"]


def test_knowledge_point_crud_validation_and_user_isolation(app):
    alice = app.test_client(); bob = app.test_client()
    register(alice, "knowledge_alice"); register(bob, "knowledge_bob")
    today = datetime.now(APP_TZ).date()
    created = alice.post("/api/knowledge-points", json={
        "date": today.isoformat(), "projectId": "math", "content": "  极限存在不等于连续\n注意定义域  ",
    })
    assert created.status_code == 201
    item = payload(created)
    assert item["content"] == "极限存在不等于连续\n注意定义域"
    assert item["project"]["id"] == "math"
    assert bob.patch(f"/api/knowledge-points/{item['id']}", json={"content": "越权"}).status_code == 404
    assert bob.delete(f"/api/knowledge-points/{item['id']}").status_code == 404

    yesterday = today - timedelta(days=1)
    edited = payload(alice.patch(f"/api/knowledge-points/{item['id']}", json={
        "date": yesterday.isoformat(), "projectId": "english", "content": "长难句先找主干",
    }))
    assert edited["date"] == yesterday.isoformat() and edited["project"]["id"] == "english"
    assert payload(alice.get(f"/api/knowledge-points?date={yesterday.isoformat()}"))["total"] == 1
    assert payload(alice.get(f"/api/knowledge-points?date={today.isoformat()}"))["total"] == 0

    future = (today + timedelta(days=1)).isoformat()
    assert alice.post("/api/knowledge-points", json={
        "date": future, "projectId": "math", "content": "未来",
    }).status_code == 400
    assert alice.post("/api/knowledge-points", json={
        "projectId": "math", "content": " " * 10,
    }).status_code == 400
    assert alice.post("/api/knowledge-points", json={
        "projectId": "math", "content": "x" * 2001,
    }).status_code == 400

    with app.app_context():
        alice_user = db.session.scalar(db.select(User).where(User.username_key == "knowledge_alice"))
        english = db.session.scalar(db.select(Project).where(
            Project.user_id == alice_user.id, Project.external_id == "english"))
        politics = db.session.scalar(db.select(Project).where(
            Project.user_id == alice_user.id, Project.external_id == "politics"))
        english.archived = True; politics.archived = True; db.session.commit()
    assert alice.patch(f"/api/knowledge-points/{item['id']}", json={"content": "归档后仍能修改"}).status_code == 200
    assert alice.patch(f"/api/knowledge-points/{item['id']}", json={"projectId": "politics"}).status_code == 400
    assert alice.post("/api/knowledge-points", json={
        "projectId": "english", "content": "不能新增",
    }).status_code == 400
    assert alice.delete(f"/api/knowledge-points/{item['id']}").status_code == 200
    assert payload(alice.get(f"/api/knowledge-points?date={yesterday.isoformat()}"))["total"] == 0


def test_knowledge_filters_order_pagination_and_calendar(app, client):
    register(client, "knowledge_filters")
    today = datetime.now(APP_TZ).date()
    month = today.strftime("%Y-%m")
    older = today.replace(day=1)
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "knowledge_filters"))
        projects = {project.external_id: project for project in db.session.scalars(
            db.select(Project).where(Project.user_id == user.id))}
        for index in range(55):
            project = projects["math"] if index % 2 == 0 else projects["english"]
            db.session.add(KnowledgePoint(user_id=user.id, project_id=project.id, study_date=today,
                content=f"分页知识点 {index} {'关键极限' if index in {3, 7} else ''}"))
        db.session.add(KnowledgePoint(user_id=user.id, project_id=projects["politics"].id,
                                     study_date=older, content="政治旧知识"))
        db.session.commit()

    first = payload(client.get(f"/api/knowledge-points?month={month}&page=1"))
    second = payload(client.get(f"/api/knowledge-points?month={month}&page=2"))
    assert first["total"] == 56 and len(first["items"]) == 50 and first["hasMore"] is True
    assert len(second["items"]) == 6 and second["hasMore"] is False
    assert first["items"][0]["date"] >= first["items"][-1]["date"]
    math = payload(client.get(f"/api/knowledge-points?month={month}&projectId=math"))
    assert math["total"] == 28 and all(item["project"]["id"] == "math" for item in math["items"])
    searched = payload(client.get(f"/api/knowledge-points?month={month}&q=关键极限"))
    assert searched["total"] == 2
    counts = payload(client.get(f"/api/knowledge-points/calendar?month={month}"))["counts"]
    assert counts[today.isoformat()] == 55 + int(older == today)
    assert counts[older.isoformat()] >= 1
    assert client.get("/api/knowledge-points?month=bad").status_code == 400
    assert client.get(f"/api/knowledge-points?month={month}&date={today.isoformat()}").status_code == 400
    assert client.get(f"/api/knowledge-points?month={month}&page=0").status_code == 400
    assert client.get(f"/api/knowledge-points?month={month}&q={'x' * 101}").status_code == 400


def test_knowledge_backup_restore_and_legacy_import_preservation(app, client):
    register(client, "knowledge_backup")
    today = datetime.now(APP_TZ).date().isoformat()
    original = payload(client.post("/api/knowledge-points", json={
        "date": today, "projectId": "math", "content": "原始知识点",
    }))
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == "knowledge_backup"))
        exported = build_bundle(user.id)
    assert exported["knowledgePoints"][0]["content"] == "原始知识点"

    legacy = dict(exported)
    legacy.pop("knowledgePoints")
    assert client.post("/api/data/import", json=legacy).status_code == 200
    preserved = payload(client.get(f"/api/knowledge-points?date={today}"))
    assert preserved["total"] == 1 and preserved["items"][0]["content"] == "原始知识点"

    replacement = dict(exported)
    replacement["knowledgePoints"] = [{"date": today, "projectId": "english", "content": "导入后的知识点"}]
    assert client.post("/api/data/import", json=replacement).status_code == 200
    imported = payload(client.get(f"/api/knowledge-points?date={today}"))
    assert imported["total"] == 1 and imported["items"][0]["content"] == "导入后的知识点"
    assert client.post("/api/data/restore").status_code == 200
    restored = payload(client.get(f"/api/knowledge-points?date={today}"))
    assert restored["total"] == 1
    assert restored["items"][0]["content"] == "原始知识点"
