from __future__ import annotations

import json
import os
import random
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask
from sqlalchemy import text

from .models import Brand, Notification, Order, Phone, Review, SavedComparison, User, db

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "phones.json"
DB_FILE = BASE_DIR / "instance" / "capstone.sqlite3"


def configure_database(app: Flask) -> None:
    app.config.setdefault("SQLALCHEMY_DATABASE_URI", f"sqlite:///{DB_FILE.as_posix()}")
    app.config.setdefault("SQLALCHEMY_TRACK_MODIFICATIONS", False)
    app.config.setdefault("JSON_SORT_KEYS", False)
    db.init_app(app)


def ensure_schema(app: Flask) -> None:
    with app.app_context():
        os.makedirs(DB_FILE.parent, exist_ok=True)
        db.create_all()
        _migrate_schema()
        seed_database()


def load_phone_seed_data() -> list[dict]:
    with open(DATA_FILE, "r", encoding="utf-8") as handle:
        return json.load(handle)


def seed_database() -> None:
    if Phone.query.count() == 0:
        for index, entry in enumerate(load_phone_seed_data(), start=1):
            db.session.add(Phone(
                brand=entry["brand"],
                name=entry["name"],
                price=entry["price"],
                ram=entry["ram"],
                storage=entry["storage"],
                camera=entry["camera"],
                battery=entry["battery"],
                processor=entry["processor"],
                performance_score=entry["performance_score"],
                image_url=entry["image_url"],
                display=f"{6.1 + (index % 5) * 0.2:.1f}-inch AMOLED",
                operating_system="Android" if entry["brand"].lower() != "apple" else "iOS",
                description=f'{entry["brand"]} {entry["name"]} with {entry["ram"]} GB RAM and {entry["storage"]} GB storage.',
                stock_quantity=max(8, 70 - int(entry["price"] // 12)),
                featured=bool(entry["performance_score"] >= 9.0),
                status="active",
                view_count=int(150 + entry["performance_score"] * 42 + index * 5),
                purchase_count=int(max(5, entry["performance_score"] * 11 + index % 6)),
            ))
        db.session.commit()

    if not User.query.filter_by(email="admin@demo.com").first():
        import bcrypt

        password_hash = bcrypt.hashpw(b"Admin@123", bcrypt.gensalt()).decode("utf-8")
        db.session.add(User(name="Administrator", email="admin@demo.com", password_hash=password_hash, role="admin", status="active"))
        db.session.commit()

    _backfill_existing_rows()
    _seed_brands()
    _seed_reviews()
    _seed_orders()
    _seed_notifications()


def _migrate_schema() -> None:
    _ensure_columns("users", [
        ("status", "VARCHAR(20) DEFAULT 'active'"),
        ("avatar_url", "VARCHAR(500)"),
        ("created_at", "DATETIME"),
        ("updated_at", "DATETIME"),
    ])
    _ensure_columns("phones", [
        ("display", "VARCHAR(120)"),
        ("operating_system", "VARCHAR(120)"),
        ("description", "TEXT"),
        ("stock_quantity", "INTEGER DEFAULT 0"),
        ("featured", "BOOLEAN DEFAULT 0"),
        ("status", "VARCHAR(20) DEFAULT 'active'"),
        ("view_count", "INTEGER DEFAULT 0"),
        ("purchase_count", "INTEGER DEFAULT 0"),
    ])
    _ensure_columns("reviews", [
        ("is_approved", "BOOLEAN DEFAULT 1"),
        ("is_hidden", "BOOLEAN DEFAULT 0"),
        ("updated_at", "DATETIME"),
    ])


def _ensure_columns(table_name: str, columns: list[tuple[str, str]]) -> None:
    existing = {row[1] for row in db.session.execute(text(f"PRAGMA table_info({table_name})")).fetchall()}
    for column_name, definition in columns:
        if column_name not in existing:
            db.session.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))
    db.session.commit()


def _backfill_existing_rows() -> None:
    now = datetime.utcnow()
    for user in User.query.all():
        if not getattr(user, "status", None):
            user.status = "active"
        if not getattr(user, "created_at", None):
            user.created_at = now
        if not getattr(user, "updated_at", None):
            user.updated_at = now
    for index, phone in enumerate(Phone.query.all(), start=1):
        if not getattr(phone, "display", None):
            phone.display = f"{6.1 + (index % 5) * 0.2:.1f}-inch AMOLED"
        if not getattr(phone, "operating_system", None):
            phone.operating_system = "Android" if phone.brand.lower() != "apple" else "iOS"
        if not getattr(phone, "description", None):
            phone.description = f"{phone.brand} {phone.name} with {phone.ram} GB RAM and {phone.storage} GB storage."
        if not getattr(phone, "stock_quantity", None):
            phone.stock_quantity = max(8, 70 - int(phone.price // 12))
        if getattr(phone, "featured", None) in (None, 0) and phone.performance_score >= 9.0:
            phone.featured = True
        if not getattr(phone, "status", None):
            phone.status = "active"
        if not getattr(phone, "view_count", None):
            phone.view_count = int(150 + phone.performance_score * 42 + index * 5)
        if not getattr(phone, "purchase_count", None):
            phone.purchase_count = int(max(5, phone.performance_score * 11 + index % 6))
    for review in Review.query.all():
        if not getattr(review, "is_approved", None):
            review.is_approved = True
        if getattr(review, "is_hidden", None) is None:
            review.is_hidden = False
        if not getattr(review, "updated_at", None):
            review.updated_at = now
    db.session.commit()


def _seed_brands() -> None:
    if Brand.query.count():
        return
    brands = sorted({phone.brand for phone in Phone.query.all()})
    for brand_name in brands:
        db.session.add(Brand(
            name=brand_name,
            logo_url=f"https://placehold.co/160x80/0f766e/ffffff?text={brand_name.replace(' ', '+')}",
            description=f"Popular {brand_name} devices in the recommendation catalog.",
        ))
    db.session.commit()


def _seed_reviews() -> None:
    if Review.query.count() > 0:
        return
    admin = User.query.filter_by(email="admin@demo.com").first()
    phones = Phone.query.order_by(Phone.phone_id.asc()).limit(4).all()
    if not admin or not phones:
        return
    comments = [
        (5, "Excellent value and performance."),
        (4, "Very capable daily driver."),
        (5, "Camera output is impressive."),
        (4, "Battery life is strong."),
    ]
    for index, phone in enumerate(phones):
        rating, comment = comments[index % len(comments)]
        db.session.add(Review(
            user_id=admin.user_id,
            phone_id=phone.phone_id,
            rating=rating,
            comment=comment,
            created_at=datetime.utcnow() - timedelta(days=14 - index * 2),
            is_approved=True,
            is_hidden=False,
        ))
    db.session.commit()


def _seed_orders() -> None:
    if Order.query.count() > 0:
        return
    admin = User.query.filter_by(email="admin@demo.com").first()
    phones = Phone.query.order_by(Phone.performance_score.desc()).limit(6).all()
    if not admin or not phones:
        return
    statuses = ["Pending", "Processing", "Shipped", "Delivered"]
    payment_statuses = ["Paid", "Paid", "Paid", "Pending"]
    for index in range(6):
        selected = random.sample(phones, k=min(2, len(phones)))
        total_amount = round(sum(phone.price for phone in selected) * (1 + index * 0.03), 2)
        products = [{"phone_id": phone.phone_id, "name": phone.name, "quantity": 1} for phone in selected]
        db.session.add(Order(
            user_id=admin.user_id,
            customer_name=f"Customer {index + 1}",
            customer_email=f"customer{index + 1}@demo.com",
            products_json=json.dumps(products),
            total_amount=total_amount,
            order_date=datetime.utcnow() - timedelta(days=22 - index * 3),
            payment_status=payment_statuses[index % len(payment_statuses)],
            delivery_status=statuses[index % len(statuses)],
            notes="Seed order for admin dashboard demo",
        ))
    db.session.commit()


def _seed_notifications() -> None:
    if Notification.query.count() > 0:
        return
    notification_rows = [
        ("user", "New user registration", "A new account has joined the recommendation system."),
        ("order", "New order created", "An order was placed from the storefront."),
        ("stock", "Low stock warning", "One or more devices are running low on stock."),
        ("review", "New review received", "A customer submitted a new product review."),
    ]
    for notification_type, title, message in notification_rows:
        db.session.add(Notification(type=notification_type, title=title, message=message, is_read=False))
    db.session.commit()
