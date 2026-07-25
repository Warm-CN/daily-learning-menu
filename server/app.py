from __future__ import annotations

import json
import os
import random
import re
import secrets
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from zoneinfo import ZoneInfo

import click
from flask import Flask, abort, jsonify, make_response, redirect, render_template, request, send_file, url_for
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user
from flask_sqlalchemy import SQLAlchemy
from flask_wtf import CSRFProtect, FlaskForm
from sqlalchemy import UniqueConstraint, event, func, inspect, or_, text
from sqlalchemy.engine import Engine
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix
from wtforms import BooleanField, PasswordField, StringField, SubmitField
from wtforms.validators import DataRequired, Length, ValidationError

db = SQLAlchemy()
login_manager = LoginManager()
csrf = CSRFProtect()
limiter = Limiter(key_func=get_remote_address, default_limits=[])

UTC = timezone.utc
APP_TZ = ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Shanghai"))
USERNAME_RE = re.compile(r"^[\w\-\u4e00-\u9fff]{3,20}$", re.UNICODE)
PROJECT_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
DEFAULT_PROJECTS = [
    ("math", "数学", "#4f8cf7", "📐"),
    ("english", "英语", "#34b878", "📝"),
    ("politics", "政治", "#b58ddb", "🏛️"),
    ("professional", "专业课", "#f5a623", "📖"),
]
POKEMON_MAX_XP_SECONDS = 50 * 3600
EEVEE_BRANCH_XP_SECONDS = 30 * 3600
EEVEE_ID = 133
EEVEE_EVOLUTIONS = {134, 135, 136}
POKEMON_BASE_SPECIES = [
    1, 4, 7, 10, 13, 16, 19, 21, 23, 25, 27, 29, 32, 35, 37, 39, 41, 43, 46, 48, 50, 52,
    54, 56, 58, 60, 63, 66, 69, 72, 74, 77, 79, 81, 83, 84, 86, 88, 90, 92, 95, 96, 98,
    100, 102, 104, 106, 107, 108, 109, 111, 113, 114, 115, 116, 118, 120, 122, 123,
    124, 125, 126, 127, 128, 129, 131, 132, 133, 137, 138, 140, 142, 143, 144, 145,
    146, 147, 150, 151,
]
LEGENDARY_POKEMON = {144, 145, 146, 150, 151}
LEGENDARY_UNLOCK_COUNT = 30


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def local_day(value: datetime) -> date:
    return as_utc(value).astimezone(APP_TZ).date()


@event.listens_for(Engine, "connect")
def configure_sqlite(connection, _record):
    cursor = connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(20), nullable=False)
    username_key = db.Column(db.String(40), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    last_seen_at = db.Column(db.DateTime)
    logged_out_at = db.Column(db.DateTime)
    is_approved = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    is_admin = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    auth_version = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    preferred_version = db.Column(db.String(12), nullable=False, default="classic", server_default="classic")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password, method="scrypt")

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def get_id(self) -> str:
        return f"{self.id}:{self.auth_version}"


class Friendship(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_low_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    user_high_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    __table_args__ = (UniqueConstraint("user_low_id", "user_high_id", name="uq_friend_pair"),)


class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    external_id = db.Column(db.String(64), nullable=False)
    name = db.Column(db.String(20), nullable=False)
    color = db.Column(db.String(7), nullable=False, default="#4f8cf7")
    icon = db.Column(db.String(8), nullable=False, default="📚")
    archived = db.Column(db.Boolean, nullable=False, default=False)
    __table_args__ = (UniqueConstraint("user_id", "external_id", name="uq_user_project"),)


class DailyStudy(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = db.Column(db.Integer, db.ForeignKey("project.id", ondelete="CASCADE"), nullable=False)
    study_date = db.Column(db.Date, nullable=False, index=True)
    seconds = db.Column(db.Integer, nullable=False, default=0)
    __table_args__ = (UniqueConstraint("user_id", "project_id", "study_date", name="uq_daily_project"),)


class DailyMeta(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    study_date = db.Column(db.Date, nullable=False)
    energy = db.Column(db.Integer, nullable=False, default=0)
    notes = db.Column(db.Text, nullable=False, default="")
    milestones_json = db.Column(db.Text, nullable=False, default="[]")
    __table_args__ = (UniqueConstraint("user_id", "study_date", name="uq_daily_meta"),)


class StudySession(db.Model):
    session_uuid = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = db.Column(db.Integer, db.ForeignKey("project.id", ondelete="CASCADE"), nullable=False)
    started_at = db.Column(db.DateTime, nullable=False)
    ended_at = db.Column(db.DateTime, nullable=False)
    duration_seconds = db.Column(db.Integer, nullable=False)
    energy = db.Column(db.Integer)


class ActiveTimer(db.Model):
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    session_uuid = db.Column(db.String(36), unique=True, nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey("project.id", ondelete="CASCADE"), nullable=False)
    mode = db.Column(db.String(12), nullable=False)
    target_seconds = db.Column(db.Integer)
    phase = db.Column(db.String(12), nullable=False)
    accumulated_seconds = db.Column(db.Float, nullable=False, default=0)
    session_started_at = db.Column(db.DateTime, nullable=False)
    segment_started_at = db.Column(db.DateTime)
    segments_json = db.Column(db.Text, nullable=False, default="[]")
    version = db.Column(db.Integer, nullable=False, default=1)


class UserBackup(db.Model):
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    payload_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class PokemonProfile(db.Model):
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    current_pokemon_id = db.Column(db.Integer, nullable=True)
    unspent_xp_seconds = db.Column(db.Integer, nullable=False, default=0)
    pending_candidates_json = db.Column(db.Text, nullable=False, default="[]")
    version = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class OwnedPokemon(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    base_species_id = db.Column(db.Integer, nullable=False)
    experience_seconds = db.Column(db.Integer, nullable=False, default=0)
    evolved_species_id = db.Column(db.Integer)
    graduated = db.Column(db.Boolean, nullable=False, default=False)
    acquired_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class PokemonReward(db.Model):
    session_uuid = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    awarded_seconds = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class LoginForm(FlaskForm):
    username = StringField("用户名", validators=[DataRequired(), Length(min=3, max=20)])
    password = PasswordField("密码", validators=[DataRequired(), Length(min=8, max=128)])
    remember = BooleanField("记住我", default=True)
    submit = SubmitField("登录")


class RegisterForm(LoginForm):
    def validate_username(self, field):
        value = field.data.strip()
        if not USERNAME_RE.fullmatch(value):
            raise ValidationError("用户名只能包含中文、字母、数字、下划线或短横线")
        if db.session.scalar(db.select(User).where(User.username_key == value.casefold())):
            raise ValidationError("该用户名已被使用")


@login_manager.user_loader
def load_user(identifier):
    try:
        raw_id, raw_version = str(identifier).split(":", 1) if ":" in str(identifier) else (identifier, None)
        user = db.session.get(User, int(raw_id))
        if not user or (not user.is_approved and not user.is_admin):
            return None
        if raw_version is None:
            return user if user.auth_version == 0 else None
        return user if user.auth_version == int(raw_version) else None
    except (TypeError, ValueError):
        return None


def api_ok(data=None, status=200):
    return jsonify({"ok": True, "data": data}), status


def api_error(message, status=400, code=None):
    return jsonify({"ok": False, "error": {"message": message, "code": code}}), status


def member_home_endpoint(user):
    if user.is_admin:
        return "admin_page"
    return "pokemon_page" if user.preferred_version == "pokemon" else "dashboard"


def parse_json_body():
    return request.get_json(silent=True) or {}


def initialize_database():
    """Create new tables and upgrade the legacy user table in place."""
    db.create_all()
    columns = {column["name"] for column in inspect(db.engine).get_columns("user")}
    statements = []
    approval_added = "is_approved" not in columns
    if approval_added:
        statements.append("ALTER TABLE user ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT 0")
    if "is_admin" not in columns:
        statements.append("ALTER TABLE user ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0")
    if "auth_version" not in columns:
        statements.append("ALTER TABLE user ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0")
    if "logged_out_at" not in columns:
        statements.append("ALTER TABLE user ADD COLUMN logged_out_at DATETIME")
    if "preferred_version" not in columns:
        statements.append("ALTER TABLE user ADD COLUMN preferred_version VARCHAR(12) NOT NULL DEFAULT 'classic'")
    if statements:
        with db.engine.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))
            if approval_added:
                connection.execute(text("UPDATE user SET is_approved = 1"))
        db.session.expire_all()


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user.is_authenticated:
            return login_manager.unauthorized()
        if not current_user.is_admin:
            if request.path.startswith("/api/"):
                return api_error("需要管理员权限", 403, "admin_required")
            abort(403)
        return view(*args, **kwargs)
    return wrapped


def generate_temporary_password(length=20):
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def project_dict(project: Project):
    return {"id": project.external_id, "name": project.name, "color": project.color,
            "icon": project.icon, "archived": project.archived}


def get_projects(user_id):
    return list(db.session.scalars(db.select(Project).where(Project.user_id == user_id).order_by(Project.id)))


def get_project(user_id, external_id):
    return db.session.scalar(db.select(Project).where(Project.user_id == user_id, Project.external_id == external_id))


def create_defaults(user_id):
    existing = set(db.session.scalars(db.select(Project.external_id).where(Project.user_id == user_id)))
    for external_id, name, color, icon in DEFAULT_PROJECTS:
        if external_id not in existing:
            db.session.add(Project(user_id=user_id, external_id=external_id, name=name, color=color, icon=icon))


def get_or_create_pokemon_profile(user_id):
    profile = db.session.get(PokemonProfile, user_id)
    if not profile:
        profile = PokemonProfile(user_id=user_id)
        db.session.add(profile)
        db.session.flush()
    return profile


def get_owned_pokemon(user_id, pokemon_id):
    if not pokemon_id:
        return None
    return db.session.scalar(db.select(OwnedPokemon).where(
        OwnedPokemon.id == pokemon_id, OwnedPokemon.user_id == user_id))


def pokemon_owned_counts(user_id):
    rows = db.session.execute(db.select(OwnedPokemon.base_species_id, func.count()).where(
        OwnedPokemon.user_id == user_id).group_by(OwnedPokemon.base_species_id))
    return {species_id: count for species_id, count in rows}


def available_pokemon_species(user_id):
    counts = pokemon_owned_counts(user_id)
    graduated = db.session.scalar(db.select(func.count()).select_from(OwnedPokemon).where(
        OwnedPokemon.user_id == user_id, OwnedPokemon.graduated.is_(True))) or 0
    return [species_id for species_id in POKEMON_BASE_SPECIES
            if (species_id not in LEGENDARY_POKEMON or graduated >= LEGENDARY_UNLOCK_COUNT)
            and counts.get(species_id, 0) < (3 if species_id == EEVEE_ID else 1)]


def pending_pokemon_candidates(profile):
    try:
        values = json.loads(profile.pending_candidates_json or "[]")
    except (TypeError, json.JSONDecodeError):
        values = []
    return [value for value in values if isinstance(value, int)]


def ensure_pokemon_candidates(profile):
    current = get_owned_pokemon(profile.user_id, profile.current_pokemon_id)
    if current and not current.graduated:
        profile.pending_candidates_json = "[]"
        return []
    existing = pending_pokemon_candidates(profile)
    available = set(available_pokemon_species(profile.user_id))
    valid = [species_id for species_id in existing if species_id in available]
    if valid:
        if valid != existing:
            profile.pending_candidates_json = json.dumps(valid)
        return valid
    choices = random.sample(list(available), min(3, len(available))) if available else []
    profile.pending_candidates_json = json.dumps(choices)
    return choices


def apply_unspent_pokemon_xp(profile):
    current = get_owned_pokemon(profile.user_id, profile.current_pokemon_id)
    if not current or current.graduated or profile.unspent_xp_seconds <= 0:
        return
    cap = (EEVEE_BRANCH_XP_SECONDS if current.base_species_id == EEVEE_ID
           and current.evolved_species_id is None else POKEMON_MAX_XP_SECONDS)
    transfer = min(max(0, cap - current.experience_seconds), profile.unspent_xp_seconds)
    current.experience_seconds += transfer
    profile.unspent_xp_seconds -= transfer
    if current.experience_seconds >= POKEMON_MAX_XP_SECONDS:
        current.experience_seconds = POKEMON_MAX_XP_SECONDS
        current.graduated = True


def award_pokemon_session(session):
    if db.session.get(PokemonReward, session.session_uuid):
        return
    seconds = max(0, int(session.duration_seconds))
    profile = get_or_create_pokemon_profile(session.user_id)
    db.session.add(PokemonReward(session_uuid=session.session_uuid, user_id=session.user_id,
                                 awarded_seconds=seconds))
    profile.unspent_xp_seconds += seconds
    apply_unspent_pokemon_xp(profile)


def claim_pokemon_state_version(profile, raw_version):
    try:
        expected = int(raw_version)
    except (TypeError, ValueError):
        return False
    if expected != profile.version:
        return False
    result = db.session.execute(db.update(PokemonProfile).where(
        PokemonProfile.user_id == profile.user_id, PokemonProfile.version == expected).values(
            version=expected + 1).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.session.rollback()
        return False
    profile.version = expected + 1
    return True


def pokemon_state_dict(profile, generate_candidates=False):
    if generate_candidates:
        ensure_pokemon_candidates(profile)
    owned = list(db.session.scalars(db.select(OwnedPokemon).where(
        OwnedPokemon.user_id == profile.user_id).order_by(OwnedPokemon.id)))
    current = next((item for item in owned if item.id == profile.current_pokemon_id), None)
    return {
        "stateVersion": profile.version,
        "currentPokemonId": current.id if current else None,
        "unspentXpSeconds": profile.unspent_xp_seconds,
        "pendingCandidates": pending_pokemon_candidates(profile),
        "graduatedCount": sum(1 for item in owned if item.graduated),
        "owned": [{"id": item.id, "baseSpeciesId": item.base_species_id,
                   "experienceSeconds": item.experience_seconds,
                   "evolvedSpeciesId": item.evolved_species_id, "graduated": item.graduated,
                   "acquiredAt": as_utc(item.acquired_at).isoformat().replace("+00:00", "Z")}
                  for item in owned],
    }


def friend_ids(user_id):
    rows = db.session.scalars(db.select(Friendship).where(or_(Friendship.user_low_id == user_id,
                                                              Friendship.user_high_id == user_id)))
    return [row.user_high_id if row.user_low_id == user_id else row.user_low_id for row in rows]


def timer_segments(timer: ActiveTimer):
    try:
        return json.loads(timer.segments_json or "[]")
    except (TypeError, json.JSONDecodeError):
        return []


def timer_elapsed(timer: ActiveTimer, now=None):
    now = now or utcnow()
    elapsed = float(timer.accumulated_seconds)
    if timer.phase == "running" and timer.segment_started_at:
        elapsed += max(0.0, (now - timer.segment_started_at).total_seconds())
    return elapsed


def append_segment(timer: ActiveTimer, start: datetime, end: datetime):
    if end <= start:
        return
    segments = timer_segments(timer)
    segments.append([start.isoformat(), end.isoformat()])
    timer.segments_json = json.dumps(segments, ensure_ascii=False)


def split_segments(segments, limit_seconds):
    remaining = max(0.0, float(limit_seconds))
    totals = defaultdict(float)
    clipped = []
    for raw_start, raw_end in segments:
        if remaining <= 0:
            break
        start = datetime.fromisoformat(raw_start)
        end = datetime.fromisoformat(raw_end)
        used = min(max(0.0, (end - start).total_seconds()), remaining)
        if used <= 0:
            continue
        end = start + timedelta(seconds=used)
        clipped.append((start, end))
        cursor = as_utc(start)
        end_aware = as_utc(end)
        while cursor < end_aware:
            local = cursor.astimezone(APP_TZ)
            next_midnight = datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), APP_TZ).astimezone(UTC)
            boundary = min(end_aware, next_midnight)
            totals[local.date()] += (boundary - cursor).total_seconds()
            cursor = boundary
        remaining -= used
    rounded = {key: int(value) for key, value in totals.items()}
    target = round(sum(totals.values()))
    missing = target - sum(rounded.values())
    for key, _value in sorted(totals.items(), key=lambda item: item[1] % 1, reverse=True)[:missing]:
        rounded[key] += 1
    return rounded, clipped


def add_daily_seconds(user_id, project_id, study_date, seconds):
    row = db.session.scalar(db.select(DailyStudy).where(DailyStudy.user_id == user_id,
        DailyStudy.project_id == project_id, DailyStudy.study_date == study_date))
    if row:
        row.seconds += int(seconds)
    else:
        db.session.add(DailyStudy(user_id=user_id, project_id=project_id, study_date=study_date, seconds=int(seconds)))


def finalize_timer(timer: ActiveTimer, end_at=None, forced_seconds=None):
    existing = db.session.get(StudySession, timer.session_uuid)
    if existing:
        db.session.delete(timer)
        return existing
    now = end_at or utcnow()
    if timer.phase == "running" and timer.segment_started_at:
        append_segment(timer, timer.segment_started_at, now)
    elapsed = forced_seconds if forced_seconds is not None else timer_elapsed(timer, now)
    if timer.mode == "countdown":
        elapsed = min(elapsed, timer.target_seconds or elapsed)
    seconds = max(0, round(elapsed))
    by_day, clipped = split_segments(timer_segments(timer), seconds)
    for study_date, value in by_day.items():
        add_daily_seconds(timer.user_id, timer.project_id, study_date, value)
    started = clipped[0][0] if clipped else timer.session_started_at
    ended = clipped[-1][1] if clipped else now
    session = StudySession(session_uuid=timer.session_uuid, user_id=timer.user_id, project_id=timer.project_id,
        started_at=started, ended_at=ended, duration_seconds=seconds)
    db.session.add(session)
    award_pokemon_session(session)
    db.session.delete(timer)
    return session


def refresh_timer(user_id):
    timer = db.session.get(ActiveTimer, user_id)
    if not timer or timer.phase != "running":
        return timer
    now = utcnow()
    elapsed = timer_elapsed(timer, now)
    if timer.mode == "countdown" and elapsed >= (timer.target_seconds or 0):
        needed = max(0.0, (timer.target_seconds or 0) - timer.accumulated_seconds)
        end_at = timer.segment_started_at + timedelta(seconds=needed)
        finalize_timer(timer, end_at=end_at, forced_seconds=timer.target_seconds)
        return None
    if timer.mode == "countup" and elapsed >= 86400:
        needed = max(0.0, 86400 - timer.accumulated_seconds)
        end_at = timer.segment_started_at + timedelta(seconds=needed)
        append_segment(timer, timer.segment_started_at, end_at)
        timer.accumulated_seconds = 86400
        timer.segment_started_at = None
        timer.phase = "paused"
        timer.version += 1
    return timer


def serialize_timer(timer):
    if not timer:
        return None
    project = db.session.get(Project, timer.project_id)
    now = utcnow()
    elapsed = timer_elapsed(timer, now)
    remaining = max(0, (timer.target_seconds or 0) - elapsed) if timer.mode == "countdown" else None
    return {"sessionId": timer.session_uuid, "projectId": project.external_id if project else None,
            "projectName": project.name if project else "未知项目", "mode": timer.mode,
            "targetSeconds": timer.target_seconds, "phase": timer.phase, "elapsedSeconds": elapsed,
            "remainingSeconds": remaining, "serverNow": now.isoformat() + "Z", "version": timer.version}


def build_bundle(user_id):
    projects = get_projects(user_id)
    project_by_id = {item.id: item for item in projects}
    study = {}
    rows = db.session.scalars(db.select(DailyStudy).where(DailyStudy.user_id == user_id))
    for row in rows:
        key = row.study_date.isoformat()
        study.setdefault(key, {"energy": 0, "notes": ""})
        if row.project_id in project_by_id:
            study[key][project_by_id[row.project_id].external_id] = row.seconds
    milestones = {}
    for meta in db.session.scalars(db.select(DailyMeta).where(DailyMeta.user_id == user_id)):
        key = meta.study_date.isoformat()
        study.setdefault(key, {"energy": 0, "notes": ""})
        study[key]["energy"] = meta.energy
        study[key]["notes"] = meta.notes
        try:
            values = json.loads(meta.milestones_json)
        except json.JSONDecodeError:
            values = []
        if values:
            milestones[key] = values
    sessions = []
    for item in db.session.scalars(db.select(StudySession).where(StudySession.user_id == user_id).order_by(StudySession.started_at)):
        project = project_by_id.get(item.project_id)
        sessions.append({"id": item.session_uuid, "date": local_day(item.started_at).isoformat(),
            "startedAt": int(as_utc(item.started_at).timestamp() * 1000), "endedAt": int(as_utc(item.ended_at).timestamp() * 1000),
            "durationSec": item.duration_seconds, "durationMin": round(item.duration_seconds / 60),
            "subject": project.external_id if project else None, "energy": item.energy})
    bundle = {"format": "kaoyan-study-backup", "version": 1, "exportedAt": datetime.now(UTC).isoformat(),
              "study": study, "sessions": sessions, "milestones": milestones,
              "projects": [project_dict(item) for item in projects]}
    profile = db.session.get(PokemonProfile, user_id)
    if profile:
        pokemon = pokemon_state_dict(profile)
        pokemon["rewards"] = [{"sessionId": item.session_uuid, "seconds": item.awarded_seconds}
                              for item in db.session.scalars(db.select(PokemonReward).where(
                                  PokemonReward.user_id == user_id).order_by(PokemonReward.created_at))]
        bundle["pokemon"] = pokemon
    user = db.session.get(User, user_id)
    bundle["preferredVersion"] = user.preferred_version if user else "classic"
    return bundle


def validate_bundle(payload):
    if not isinstance(payload, dict) or payload.get("format") != "kaoyan-study-backup" or payload.get("version") != 1:
        raise ValueError("不是受支持的考研看板备份")
    if not isinstance(payload.get("study"), dict) or not isinstance(payload.get("sessions"), list):
        raise ValueError("备份数据不完整")
    if payload.get("projects") is not None and not isinstance(payload["projects"], list):
        raise ValueError("项目配置无效")
    if payload.get("pokemon") is not None and not isinstance(payload["pokemon"], dict):
        raise ValueError("宝可梦存档无效")


def replace_pokemon_data(user_id, payload):
    version = payload.get("preferredVersion")
    if version in {"classic", "pokemon"}:
        user = db.session.get(User, user_id)
        if user:
            user.preferred_version = version
    raw = payload.get("pokemon")
    if raw is None:
        return
    db.session.query(PokemonReward).filter_by(user_id=user_id).delete()
    db.session.query(OwnedPokemon).filter_by(user_id=user_id).delete()
    db.session.query(PokemonProfile).filter_by(user_id=user_id).delete()
    db.session.flush()
    try:
        state_version = max(1, int(raw.get("stateVersion") or 1))
    except (TypeError, ValueError):
        state_version = 1
    try:
        unspent_xp = int(raw.get("unspentXpSeconds") or 0)
    except (TypeError, ValueError):
        raise ValueError("宝可梦经验数据无效")
    if unspent_xp < 0:
        raise ValueError("宝可梦经验数据无效")
    profile = PokemonProfile(user_id=user_id,
        unspent_xp_seconds=unspent_xp,
        pending_candidates_json="[]", version=state_version)
    db.session.add(profile)
    db.session.flush()
    owned_items = raw.get("owned") or []
    if not isinstance(owned_items, list) or len(owned_items) > 200:
        raise ValueError("宝可梦持有数据无效")
    normalized_owned = []
    ownership_counts = defaultdict(int)
    seen_old_ids = set()
    for item in owned_items:
        if not isinstance(item, dict):
            raise ValueError("宝可梦持有数据无效")
        try:
            old_id = int(item.get("id"))
            species_id = int(item.get("baseSpeciesId"))
            experience = int(item.get("experienceSeconds") or 0)
        except (TypeError, ValueError):
            raise ValueError("宝可梦持有数据无效")
        if experience < 0 or experience > POKEMON_MAX_XP_SECONDS:
            raise ValueError("宝可梦经验数据无效")
        if old_id in seen_old_ids:
            raise ValueError("宝可梦编号重复")
        seen_old_ids.add(old_id)
        if species_id not in POKEMON_BASE_SPECIES:
            raise ValueError("宝可梦种类无效")
        ownership_counts[species_id] += 1
        if ownership_counts[species_id] > (3 if species_id == EEVEE_ID else 1):
            raise ValueError("宝可梦持有数量超过限制")
        evolved = item.get("evolvedSpeciesId")
        try:
            evolved = int(evolved) if evolved is not None else None
        except (TypeError, ValueError):
            raise ValueError("宝可梦进化数据无效")
        if evolved is not None and (species_id != EEVEE_ID or evolved not in EEVEE_EVOLUTIONS
                                    or experience < EEVEE_BRANCH_XP_SECONDS):
            raise ValueError("宝可梦进化数据无效")
        normalized_owned.append({"old_id": old_id, "species_id": species_id, "experience": experience,
                                 "evolved": evolved, "graduated": experience >= POKEMON_MAX_XP_SECONDS})
    graduated_nonlegendary = sum(1 for item in normalized_owned
                                  if item["graduated"] and item["species_id"] not in LEGENDARY_POKEMON)
    if any(item["species_id"] in LEGENDARY_POKEMON for item in normalized_owned) \
            and graduated_nonlegendary < LEGENDARY_UNLOCK_COUNT:
        raise ValueError("传说宝可梦尚未解锁")
    id_map = {}
    for item in normalized_owned:
        old_id = item["old_id"]
        species_id = item["species_id"]
        owned = OwnedPokemon(user_id=user_id, base_species_id=species_id,
                             experience_seconds=item["experience"],
                             evolved_species_id=item["evolved"], graduated=item["graduated"])
        db.session.add(owned)
        db.session.flush()
        id_map[old_id] = owned.id
    try:
        profile.current_pokemon_id = id_map.get(int(raw.get("currentPokemonId")))
    except (TypeError, ValueError):
        profile.current_pokemon_id = None
    candidates = raw.get("pendingCandidates") or []
    if not isinstance(candidates, list) or len(candidates) > 3 or len(candidates) != len(set(candidates)):
        raise ValueError("宝可梦候选数据无效")
    available = set(available_pokemon_species(user_id))
    if any(not isinstance(value, int) or value not in available for value in candidates):
        raise ValueError("宝可梦候选数据无效")
    profile.pending_candidates_json = json.dumps(candidates)
    session_durations = {}
    for item in payload.get("sessions", []):
        if not isinstance(item, dict):
            continue
        session_id = str(item.get("id") or "")
        try:
            seconds = max(0, int(item.get("durationSec") or float(item.get("durationMin") or 0) * 60))
        except (TypeError, ValueError):
            continue
        if session_id and len(session_id) <= 36:
            session_durations[session_id] = seconds
    reward_items = raw.get("rewards") or []
    if not isinstance(reward_items, list) or len(reward_items) > 100000:
        raise ValueError("宝可梦奖励记录无效")
    normalized_rewards = []
    seen_rewards = set()
    for item in reward_items:
        if not isinstance(item, dict):
            raise ValueError("宝可梦奖励记录无效")
        session_id = str(item.get("sessionId") or "")
        try:
            seconds = int(item.get("seconds") or 0)
        except (TypeError, ValueError):
            raise ValueError("宝可梦奖励记录无效")
        if (not session_id or len(session_id) > 36 or session_id in seen_rewards
                or seconds < 0 or seconds > 86400 or session_durations.get(session_id) != seconds):
            raise ValueError("宝可梦奖励记录无效")
        seen_rewards.add(session_id)
        normalized_rewards.append((session_id, seconds))
    distributed_xp = unspent_xp + sum(item["experience"] for item in normalized_owned)
    if distributed_xp != sum(seconds for _session_id, seconds in normalized_rewards):
        raise ValueError("宝可梦经验与计时奖励不一致")
    for session_id, seconds in normalized_rewards:
        db.session.add(PokemonReward(session_uuid=session_id, user_id=user_id, awarded_seconds=seconds))


def replace_user_data(user_id, payload):
    validate_bundle(payload)
    db.session.query(DailyStudy).filter_by(user_id=user_id).delete()
    db.session.query(DailyMeta).filter_by(user_id=user_id).delete()
    db.session.query(StudySession).filter_by(user_id=user_id).delete()
    db.session.query(Project).filter_by(user_id=user_id).delete()
    db.session.flush()
    project_map = {}
    items = payload.get("projects") or [{"id": x[0], "name": x[1], "color": x[2], "icon": x[3]} for x in DEFAULT_PROJECTS]
    imported_projects = []
    for raw in items:
        external_id = str(raw.get("id", ""))
        if not PROJECT_ID_RE.fullmatch(external_id) or external_id in {"energy", "notes"}:
            continue
        project = Project(user_id=user_id, external_id=external_id, name=str(raw.get("name") or external_id)[:20],
            color=str(raw.get("color") or "#4f8cf7") if re.fullmatch(r"#[0-9a-fA-F]{6}", str(raw.get("color"))) else "#4f8cf7",
            icon=str(raw.get("icon") or "📚")[:8], archived=bool(raw.get("archived")))
        db.session.add(project)
        db.session.flush()
        project_map[external_id] = project
        imported_projects.append(project)
    if imported_projects and all(project.archived for project in imported_projects):
        imported_projects[0].archived = False
    for key, day in payload["study"].items():
        try:
            study_date = date.fromisoformat(key)
        except (TypeError, ValueError):
            continue
        if not isinstance(day, dict):
            continue
        meta = DailyMeta(user_id=user_id, study_date=study_date,
            energy=max(0, min(100, int(day.get("energy") or 0))), notes=str(day.get("notes") or "")[:10000],
            milestones_json=json.dumps((payload.get("milestones") or {}).get(key, []), ensure_ascii=False))
        db.session.add(meta)
        for external_id, raw_seconds in day.items():
            if external_id in {"energy", "notes"}:
                continue
            if external_id not in project_map and PROJECT_ID_RE.fullmatch(external_id):
                project = Project(user_id=user_id, external_id=external_id, name=external_id, color="#4f8cf7", icon="📚")
                db.session.add(project)
                db.session.flush()
                project_map[external_id] = project
            if external_id in project_map:
                try:
                    seconds = max(0, round(float(raw_seconds)))
                except (TypeError, ValueError):
                    seconds = 0
                if seconds:
                    db.session.add(DailyStudy(user_id=user_id, project_id=project_map[external_id].id,
                        study_date=study_date, seconds=seconds))
    seen_sessions = set()
    for raw in payload.get("sessions", []):
        project = project_map.get(raw.get("subject"))
        if not project:
            continue
        try:
            started = datetime.fromtimestamp(float(raw.get("startedAt")) / 1000, UTC).replace(tzinfo=None)
            ended = datetime.fromtimestamp(float(raw.get("endedAt")) / 1000, UTC).replace(tzinfo=None)
            session_id = str(raw.get("id") or uuid.uuid4())
            if len(session_id) > 36:
                session_id = str(uuid.uuid4())
            if session_id in seen_sessions:
                continue
            seen_sessions.add(session_id)
            db.session.add(StudySession(session_uuid=session_id, user_id=user_id, project_id=project.id,
                started_at=started, ended_at=ended, duration_seconds=max(0, int(raw.get("durationSec") or
                    float(raw.get("durationMin") or 0) * 60)), energy=int(raw["energy"]) if raw.get("energy") is not None else None))
        except (TypeError, ValueError, OSError):
            continue
    replace_pokemon_data(user_id, payload)


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    db_path = Path(app.instance_path) / "kaoyan.db"
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-only-change-me"),
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", f"sqlite:///{db_path.as_posix()}"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        REMEMBER_COOKIE_DURATION=timedelta(days=30),
        REMEMBER_COOKIE_HTTPONLY=True,
        REMEMBER_COOKIE_SAMESITE="Lax",
        REMEMBER_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
        MAX_CONTENT_LENGTH=5 * 1024 * 1024,
        RATELIMIT_STORAGE_URI=os.environ.get("RATELIMIT_STORAGE_URI", "memory://"),
    )
    if test_config:
        app.config.update(test_config)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    db.init_app(app)
    login_manager.init_app(app)
    csrf.init_app(app)
    limiter.init_app(app)
    login_manager.login_view = "login"

    @app.before_request
    def keep_admin_out_of_member_features():
        if not current_user.is_authenticated or not current_user.is_admin:
            return None
        endpoint = request.endpoint or ""
        allowed = endpoint in {"admin_page", "logout", "static", "health"} or endpoint.startswith("admin_")
        if allowed:
            return None
        if request.path.startswith("/api/"):
            return api_error("管理员账号不能使用学习功能", 403, "admin_only")
        return redirect(url_for("admin_page"))

    @login_manager.unauthorized_handler
    def unauthorized():
        if request.path.startswith("/api/"):
            return api_error("请先登录", 401, "unauthorized")
        return redirect(url_for("login", next=request.path))

    @app.get("/health")
    def health():
        db.session.execute(db.select(1))
        return api_ok({"status": "ok"})

    @app.route("/register", methods=["GET", "POST"])
    @limiter.limit("5 per hour")
    def register():
        if current_user.is_authenticated:
            return redirect(url_for(member_home_endpoint(current_user)))
        form = RegisterForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            user = User(username=username, username_key=username.casefold(), last_seen_at=None,
                        is_approved=False, is_admin=False, auth_version=0)
            user.set_password(form.password.data)
            db.session.add(user)
            db.session.commit()
            app.logger.info("new user pending approval: user_id=%s username=%s", user.id, user.username)
            return redirect(url_for("login", registered="pending"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    @limiter.limit("10 per minute")
    def login():
        if current_user.is_authenticated:
            return redirect(url_for(member_home_endpoint(current_user)))
        form = LoginForm()
        error = None
        notice = "注册成功，账号正在等待管理员审批。" if request.args.get("registered") == "pending" else None
        if form.validate_on_submit():
            user = db.session.scalar(db.select(User).where(User.username_key == form.username.data.strip().casefold()))
            if user and user.check_password(form.password.data):
                if not user.is_approved and not user.is_admin:
                    return render_template("login.html", form=form, error="账号正在等待管理员审批", notice=notice)
                user.last_seen_at = utcnow()
                user.logged_out_at = None
                db.session.commit()
                login_user(user, remember=form.remember.data, duration=timedelta(days=30))
                return redirect(url_for(member_home_endpoint(user)))
            error = "用户名或密码不正确"
        return render_template("login.html", form=form, error=error, notice=notice)

    @app.post("/logout")
    @login_required
    def logout():
        now = utcnow()
        current_user.last_seen_at = now
        current_user.logged_out_at = now
        db.session.commit()
        logout_user()
        return redirect(url_for("login"))

    @app.get("/")
    def index():
        if not current_user.is_authenticated:
            return redirect(url_for("login"))
        return redirect(url_for(member_home_endpoint(current_user)))

    @app.get("/dashboard")
    @login_required
    def dashboard():
        return render_template("dashboard.html", pokemon_mode=False)

    @app.get("/pokemon")
    @login_required
    def pokemon_page():
        return render_template("dashboard.html", pokemon_mode=True)

    @app.get("/friends")
    @login_required
    def friends_page():
        return render_template("friends.html")

    register_admin_routes(app)
    register_api_routes(app)
    register_cli(app)
    return app


def register_admin_routes(app):
    @app.get("/admin")
    @admin_required
    def admin_page():
        pending_users = list(db.session.scalars(db.select(User).where(
            User.is_admin.is_(False), User.is_approved.is_(False)).order_by(User.created_at.asc())))
        approved_users = list(db.session.scalars(db.select(User).where(
            User.is_admin.is_(False), User.is_approved.is_(True)).order_by(User.created_at.desc())))
        response = make_response(render_template("admin.html", pending_users=pending_users,
            approved_users=approved_users))
        response.headers["Cache-Control"] = "no-store"
        return response

    def managed_user(user_id):
        user = db.session.get(User, user_id)
        if not user:
            return None, api_error("用户不存在", 404, "not_found")
        if user.is_admin:
            return None, api_error("不能操作管理员账号", 403, "admin_protected")
        return user, None

    @app.post("/api/admin/users/<int:user_id>/approve")
    @admin_required
    def admin_approve_user(user_id):
        user, error = managed_user(user_id)
        if error:
            return error
        if not user.is_approved:
            user.is_approved = True
            create_defaults(user.id)
            db.session.commit()
            app.logger.info("admin approved user: admin_id=%s user_id=%s username=%s",
                current_user.id, user.id, user.username)
        return api_ok({"id": user.id, "username": user.username, "approved": True})

    @app.post("/api/admin/users/<int:user_id>/reset-password")
    @limiter.limit("20 per hour")
    @admin_required
    def admin_reset_password(user_id):
        user, error = managed_user(user_id)
        if error:
            return error
        if not user.is_approved:
            return api_error("只能重置正式用户的密码", 409, "pending_user")
        temporary_password = generate_temporary_password()
        user.set_password(temporary_password)
        user.auth_version += 1
        user.last_seen_at = None
        db.session.commit()
        app.logger.info("admin reset user password: admin_id=%s user_id=%s username=%s",
            current_user.id, user.id, user.username)
        response = jsonify({"ok": True, "data": {"id": user.id, "username": user.username,
            "temporaryPassword": temporary_password}})
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.delete("/api/admin/users/<int:user_id>")
    @admin_required
    def admin_delete_user(user_id):
        user, error = managed_user(user_id)
        if error:
            return error
        username = user.username
        db.session.delete(user)
        db.session.commit()
        app.logger.info("admin deleted user: admin_id=%s user_id=%s username=%s",
            current_user.id, user_id, username)
        return api_ok(None)


def register_api_routes(app):
    @app.get("/api/bootstrap")
    @login_required
    def bootstrap():
        timer = refresh_timer(current_user.id)
        db.session.commit()
        bundle = build_bundle(current_user.id)
        bundle["timer"] = serialize_timer(timer)
        bundle["user"] = {"id": current_user.id, "username": current_user.username}
        return api_ok(bundle)

    @app.patch("/api/preferences/version")
    @login_required
    def preferred_version():
        version = parse_json_body().get("version")
        if version not in {"classic", "pokemon"}:
            return api_error("版本无效")
        current_user.preferred_version = version
        db.session.commit()
        return api_ok({"version": version, "url": url_for("pokemon_page" if version == "pokemon" else "dashboard")})

    @app.post("/api/pokemon/bootstrap")
    @login_required
    def pokemon_bootstrap():
        profile = get_or_create_pokemon_profile(current_user.id)
        apply_unspent_pokemon_xp(profile)
        data = pokemon_state_dict(profile, generate_candidates=True)
        db.session.commit()
        return api_ok(data)

    @app.post("/api/pokemon/claim")
    @login_required
    def pokemon_claim():
        body = parse_json_body()
        profile = get_or_create_pokemon_profile(current_user.id)
        current = get_owned_pokemon(current_user.id, profile.current_pokemon_id)
        if current and not current.graduated:
            return api_error("当前伙伴尚未毕业", 409, "pokemon_active")
        try:
            species_id = int(body.get("baseSpeciesId"))
        except (TypeError, ValueError):
            return api_error("请选择有效的宝可梦")
        candidates = ensure_pokemon_candidates(profile)
        if species_id not in candidates or species_id not in available_pokemon_species(current_user.id):
            return api_error("该宝可梦不在本次候选中", 409, "invalid_candidate")
        if not claim_pokemon_state_version(profile, body.get("stateVersion")):
            return api_error("养成状态已在其他设备更新", 409, "stale_pokemon")
        owned = OwnedPokemon(user_id=current_user.id, base_species_id=species_id)
        db.session.add(owned)
        db.session.flush()
        profile.current_pokemon_id = owned.id
        profile.pending_candidates_json = "[]"
        apply_unspent_pokemon_xp(profile)
        data = pokemon_state_dict(profile, generate_candidates=True)
        db.session.commit()
        return api_ok(data, 201)

    @app.post("/api/pokemon/evolve")
    @login_required
    def pokemon_evolve():
        body = parse_json_body()
        try:
            pokemon_id = int(body.get("pokemonId"))
            target_id = int(body.get("targetSpeciesId"))
        except (TypeError, ValueError):
            return api_error("进化选择无效")
        profile = get_or_create_pokemon_profile(current_user.id)
        owned = get_owned_pokemon(current_user.id, pokemon_id)
        if (not owned or profile.current_pokemon_id != owned.id or owned.base_species_id != EEVEE_ID
                or owned.evolved_species_id is not None or owned.experience_seconds < EEVEE_BRANCH_XP_SECONDS
                or target_id not in EEVEE_EVOLUTIONS):
            return api_error("当前宝可梦不能进行该进化", 409, "invalid_evolution")
        if not claim_pokemon_state_version(profile, body.get("stateVersion")):
            return api_error("养成状态已在其他设备更新", 409, "stale_pokemon")
        owned.evolved_species_id = target_id
        apply_unspent_pokemon_xp(profile)
        data = pokemon_state_dict(profile, generate_candidates=True)
        db.session.commit()
        return api_ok(data)

    @app.post("/api/presence")
    @login_required
    def presence():
        current_user.last_seen_at = utcnow()
        timer = refresh_timer(current_user.id)
        db.session.commit()
        return api_ok({"online": True, "timer": serialize_timer(timer)})

    @app.route("/api/projects", methods=["POST"])
    @login_required
    def add_project():
        body = parse_json_body()
        external_id = str(body.get("id") or ("project_" + uuid.uuid4().hex[:16]))
        name = str(body.get("name") or "").strip()
        color = str(body.get("color") or "#4f8cf7")
        icon = str(body.get("icon") or "📚")
        if not PROJECT_ID_RE.fullmatch(external_id) or external_id in {"energy", "notes"}:
            return api_error("项目 ID 无效")
        if not name or len(name) > 20 or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            return api_error("项目名称或颜色无效")
        if get_project(current_user.id, external_id):
            return api_error("项目已存在", 409, "conflict")
        project = Project(user_id=current_user.id, external_id=external_id, name=name, color=color, icon=icon[:8])
        db.session.add(project)
        db.session.commit()
        return api_ok(project_dict(project), 201)

    @app.patch("/api/projects/<external_id>")
    @login_required
    def edit_project(external_id):
        project = get_project(current_user.id, external_id)
        if not project:
            return api_error("项目不存在", 404)
        body = parse_json_body()
        if "name" in body:
            name = str(body["name"]).strip()
            if not name or len(name) > 20:
                return api_error("项目名称无效")
            project.name = name
        if "color" in body:
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(body["color"])):
                return api_error("颜色无效")
            project.color = body["color"]
        if "icon" in body:
            project.icon = str(body["icon"] or "📚")[:8]
        if "archived" in body:
            timer = db.session.get(ActiveTimer, current_user.id)
            if body["archived"] and timer and timer.project_id == project.id:
                return api_error("当前计时正在使用该项目", 409, "timer_active")
            if body["archived"] and db.session.scalar(db.select(func.count()).select_from(Project).where(
                    Project.user_id == current_user.id, Project.archived.is_(False))) <= 1:
                return api_error("至少保留一个可用项目")
            project.archived = bool(body["archived"])
        db.session.commit()
        return api_ok(project_dict(project))

    @app.get("/api/timer/state")
    @login_required
    def timer_state():
        timer = refresh_timer(current_user.id)
        db.session.commit()
        return api_ok(serialize_timer(timer))

    @app.post("/api/timer/start")
    @login_required
    def timer_start():
        if db.session.get(ActiveTimer, current_user.id):
            return api_error("已有活动计时", 409, "timer_exists")
        body = parse_json_body()
        project = get_project(current_user.id, body.get("projectId"))
        mode = body.get("mode")
        target = body.get("targetSeconds")
        if not project or project.archived or mode not in {"countup", "countdown"}:
            return api_error("计时参数无效")
        if mode == "countdown" and (not isinstance(target, int) or target < 60 or target > 86400):
            return api_error("倒计时时长必须在 1 分钟到 24 小时之间")
        now = utcnow()
        timer = ActiveTimer(user_id=current_user.id, session_uuid=str(uuid.uuid4()), project_id=project.id,
            mode=mode, target_seconds=target if mode == "countdown" else None, phase="running",
            accumulated_seconds=0, session_started_at=now, segment_started_at=now, version=1)
        db.session.add(timer)
        current_user.last_seen_at = now
        db.session.commit()
        return api_ok(serialize_timer(timer), 201)

    def checked_timer(body):
        timer = refresh_timer(current_user.id)
        if not timer:
            session_id = body.get("sessionId")
            completed = db.session.get(StudySession, session_id) if session_id else None
            return None, completed, None
        if body.get("sessionId") != timer.session_uuid or body.get("version") != timer.version:
            return timer, None, api_error("计时状态已在其他设备更新", 409, "stale_timer")
        return timer, None, None

    @app.post("/api/timer/pause")
    @login_required
    def timer_pause():
        body = parse_json_body(); timer, completed, error = checked_timer(body)
        if error: return error
        if completed: db.session.commit(); return api_error("倒计时已经完成", 409, "timer_completed")
        if not timer or timer.phase != "running": return api_error("当前计时不能暂停", 409)
        now = utcnow(); append_segment(timer, timer.segment_started_at, now)
        timer.accumulated_seconds = timer_elapsed(timer, now)
        timer.segment_started_at = None; timer.phase = "paused"; timer.version += 1
        db.session.commit(); return api_ok(serialize_timer(timer))

    @app.post("/api/timer/resume")
    @login_required
    def timer_resume():
        body = parse_json_body(); timer, completed, error = checked_timer(body)
        if error: return error
        if completed: db.session.commit(); return api_error("倒计时已经完成", 409, "timer_completed")
        if not timer or timer.phase != "paused": return api_error("当前计时不能继续", 409)
        timer.segment_started_at = utcnow(); timer.phase = "running"; timer.version += 1
        db.session.commit(); return api_ok(serialize_timer(timer))

    @app.post("/api/timer/stop")
    @login_required
    def timer_stop():
        body = parse_json_body(); timer, completed, error = checked_timer(body)
        if error: return error
        if completed: db.session.commit(); return api_ok({"completed": True, "durationSeconds": completed.duration_seconds})
        if not timer: return api_error("没有活动计时", 404)
        session = finalize_timer(timer)
        db.session.commit()
        return api_ok({"completed": True, "durationSeconds": session.duration_seconds})

    @app.post("/api/timer/reset")
    @login_required
    def timer_reset():
        body = parse_json_body(); timer, completed, error = checked_timer(body)
        if error: return error
        if completed: db.session.commit(); return api_ok(None)
        if not timer: return api_ok(None)
        db.session.delete(timer); db.session.commit(); return api_ok(None)

    @app.put("/api/study/day/<study_date>")
    @login_required
    def edit_day(study_date):
        try: parsed_date = date.fromisoformat(study_date)
        except ValueError: return api_error("日期无效")
        durations = parse_json_body().get("durations")
        if not isinstance(durations, dict): return api_error("学习时长格式无效")
        for external_id, value in durations.items():
            project = get_project(current_user.id, external_id)
            if not project: return api_error("项目不存在：" + external_id)
            try: seconds = max(0, min(86400, round(float(value))))
            except (TypeError, ValueError): return api_error("学习时长无效")
            row = db.session.scalar(db.select(DailyStudy).where(DailyStudy.user_id == current_user.id,
                DailyStudy.project_id == project.id, DailyStudy.study_date == parsed_date))
            if row: row.seconds = seconds
            else: db.session.add(DailyStudy(user_id=current_user.id, project_id=project.id,
                                           study_date=parsed_date, seconds=seconds))
        db.session.commit(); return api_ok({"date": study_date})

    @app.patch("/api/study/meta/<study_date>")
    @login_required
    def edit_meta(study_date):
        try: parsed_date = date.fromisoformat(study_date)
        except ValueError: return api_error("日期无效")
        body = parse_json_body()
        meta = db.session.scalar(db.select(DailyMeta).where(DailyMeta.user_id == current_user.id,
                                                             DailyMeta.study_date == parsed_date))
        if not meta: meta = DailyMeta(user_id=current_user.id, study_date=parsed_date); db.session.add(meta)
        if "energy" in body: meta.energy = max(0, min(100, int(body["energy"])))
        if "notes" in body: meta.notes = str(body["notes"])[:10000]
        db.session.commit(); return api_ok({"date": study_date, "energy": meta.energy, "notes": meta.notes})

    @app.get("/api/friends/search")
    @login_required
    def friend_search():
        query = request.args.get("q", "").strip().casefold()
        if len(query) < 1: return api_ok([])
        existing = set(friend_ids(current_user.id)) | {current_user.id}
        users = db.session.scalars(db.select(User).where(User.username_key.contains(query),
            User.is_approved.is_(True), User.is_admin.is_(False)).limit(10))
        return api_ok([{"id": u.id, "username": u.username} for u in users if u.id not in existing])

    @app.post("/api/friends/add")
    @login_required
    def friend_add():
        username = str(parse_json_body().get("username") or "").strip()
        other = db.session.scalar(db.select(User).where(User.username_key == username.casefold(),
            User.is_approved.is_(True), User.is_admin.is_(False)))
        if not other: return api_error("用户不存在", 404)
        if other.id == current_user.id: return api_error("不能添加自己")
        low, high = sorted((current_user.id, other.id))
        row = db.session.scalar(db.select(Friendship).where(Friendship.user_low_id == low,
                                                             Friendship.user_high_id == high))
        if not row: db.session.add(Friendship(user_low_id=low, user_high_id=high)); db.session.commit()
        return api_ok({"id": other.id, "username": other.username})

    @app.delete("/api/friends/<int:user_id>")
    @login_required
    def friend_remove(user_id):
        low, high = sorted((current_user.id, user_id))
        row = db.session.scalar(db.select(Friendship).where(Friendship.user_low_id == low,
                                                             Friendship.user_high_id == high))
        if not row: return api_error("好友关系不存在", 404)
        db.session.delete(row); db.session.commit(); return api_ok(None)

    @app.get("/api/friends/status")
    @login_required
    def friend_status():
        ids = friend_ids(current_user.id)
        users = db.session.scalars(db.select(User).where(User.id.in_(ids), User.is_approved.is_(True),
            User.is_admin.is_(False))).all() if ids else []
        today = datetime.now(APP_TZ).date(); cutoff = utcnow() - timedelta(seconds=60); result = []
        for user in users:
            timer = refresh_timer(user.id)
            total = db.session.scalar(db.select(func.coalesce(func.sum(DailyStudy.seconds), 0)).where(
                DailyStudy.user_id == user.id, DailyStudy.study_date == today)) or 0
            online = bool(user.last_seen_at and user.last_seen_at >= cutoff and
                          (not user.logged_out_at or user.last_seen_at > user.logged_out_at))
            result.append({"id": user.id, "username": user.username, "online": online,
                           "lastSeenAt": as_utc(user.last_seen_at).isoformat().replace("+00:00", "Z")
                               if user.last_seen_at else None,
                           "todaySeconds": int(total), "timer": serialize_timer(timer) if online else None})
        db.session.commit()
        return api_ok(result)

    @app.get("/api/data/export")
    @login_required
    def data_export():
        payload = json.dumps(build_bundle(current_user.id), ensure_ascii=False, indent=2).encode("utf-8")
        from io import BytesIO
        return send_file(BytesIO(payload), mimetype="application/json", as_attachment=True,
                         download_name=f"考研学习数据-{datetime.now(APP_TZ).date().isoformat()}.json")

    @app.post("/api/data/import")
    @login_required
    def data_import():
        if db.session.get(ActiveTimer, current_user.id): return api_error("请先结束当前计时", 409)
        payload = parse_json_body()
        try: validate_bundle(payload)
        except ValueError as error: return api_error(str(error))
        backup = db.session.get(UserBackup, current_user.id)
        snapshot = json.dumps(build_bundle(current_user.id), ensure_ascii=False)
        if backup: backup.payload_json = snapshot; backup.created_at = utcnow()
        else: db.session.add(UserBackup(user_id=current_user.id, payload_json=snapshot))
        db.session.commit()
        try: replace_user_data(current_user.id, payload); db.session.commit()
        except Exception:
            db.session.rollback(); return api_error("导入失败，原数据未改变", 400)
        return api_ok(None)

    @app.post("/api/data/restore")
    @login_required
    def data_restore():
        if db.session.get(ActiveTimer, current_user.id): return api_error("请先结束当前计时", 409)
        backup = db.session.get(UserBackup, current_user.id)
        if not backup: return api_error("没有可恢复的安全副本", 404)
        old = json.loads(backup.payload_json); current = build_bundle(current_user.id)
        try:
            replace_user_data(current_user.id, old)
            backup.payload_json = json.dumps(current, ensure_ascii=False); backup.created_at = utcnow()
            db.session.commit()
        except Exception:
            db.session.rollback(); return api_error("恢复失败，当前数据未改变")
        return api_ok(None)


def register_cli(app):
    @app.cli.command("init-db")
    def init_db():
        initialize_database(); click.echo("数据库已初始化并完成结构升级")

    @app.cli.command("create-admin")
    @click.option("--username", default="admin", show_default=True)
    @click.password_option(confirmation_prompt=True)
    def create_admin(username, password):
        initialize_database()
        username = username.strip()
        if not USERNAME_RE.fullmatch(username):
            raise click.ClickException("管理员用户名格式无效")
        if db.session.scalar(db.select(User).where(User.username_key == username.casefold())):
            raise click.ClickException("用户名已存在")
        if len(password) < 12:
            raise click.ClickException("管理员密码至少 12 位")
        user = User(username=username, username_key=username.casefold(), is_approved=True,
                    is_admin=True, auth_version=0, last_seen_at=None)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        click.echo(f"管理员已创建：{username}")

    @app.cli.command("reset-password")
    @click.argument("username")
    @click.password_option()
    def reset_password(username, password):
        user = db.session.scalar(db.select(User).where(User.username_key == username.casefold()))
        if not user: raise click.ClickException("用户不存在")
        if len(password) < 8: raise click.ClickException("密码至少 8 位")
        user.set_password(password); user.auth_version += 1; user.last_seen_at = None
        db.session.commit(); click.echo("密码已重置，旧登录会话已失效")


app = create_app()
