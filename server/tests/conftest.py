import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app, db


@pytest.fixture()
def app():
    application = create_app({
        "TESTING": True,
        "WTF_CSRF_ENABLED": False,
        "RATELIMIT_ENABLED": False,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
        "SECRET_KEY": "test-secret",
        "REMEMBER_COOKIE_SECURE": False,
        "SESSION_COOKIE_SECURE": False,
    })
    with application.app_context():
        db.create_all()
    yield application
    with application.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def register(client, username, password="password123"):
    return client.post("/register", data={"username": username, "password": password, "remember": "y"},
                       follow_redirects=False)
