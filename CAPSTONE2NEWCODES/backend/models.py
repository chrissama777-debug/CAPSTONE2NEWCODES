from __future__ import annotations

from datetime import datetime

from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    user_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="user")
    status = db.Column(db.String(20), nullable=False, default="active")
    avatar_url = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    reviews = db.relationship("Review", backref="user", lazy=True)
    comparisons = db.relationship("SavedComparison", backref="user", lazy=True)
    orders = db.relationship("Order", backref="user", lazy=True)

    def to_dict(self):
        return {
            "user_id": self.user_id,
            "name": self.name,
            "email": self.email,
            "role": self.role,
            "status": self.status,
            "avatar_url": self.avatar_url,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Brand(db.Model):
    __tablename__ = "brands"

    brand_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(120), unique=True, nullable=False, index=True)
    logo_url = db.Column(db.String(500), nullable=True)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "brand_id": self.brand_id,
            "name": self.name,
            "logo_url": self.logo_url,
            "description": self.description,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Phone(db.Model):
    __tablename__ = "phones"

    phone_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    brand = db.Column(db.String(80), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False, index=True)
    price = db.Column(db.Float, nullable=False)
    ram = db.Column(db.Integer, nullable=False)
    storage = db.Column(db.Integer, nullable=False)
    camera = db.Column(db.Integer, nullable=False)
    battery = db.Column(db.Integer, nullable=False)
    processor = db.Column(db.String(160), nullable=False)
    performance_score = db.Column(db.Float, nullable=False)
    image_url = db.Column(db.String(500), nullable=False)
    display = db.Column(db.String(120), nullable=True)
    operating_system = db.Column(db.String(120), nullable=True)
    description = db.Column(db.Text, nullable=True)
    stock_quantity = db.Column(db.Integer, nullable=False, default=0)
    featured = db.Column(db.Boolean, nullable=False, default=False)
    status = db.Column(db.String(20), nullable=False, default="active")
    view_count = db.Column(db.Integer, nullable=False, default=0)
    purchase_count = db.Column(db.Integer, nullable=False, default=0)

    reviews = db.relationship("Review", backref="phone", lazy=True)

    def to_dict(self):
        return {
            "phone_id": self.phone_id,
            "brand": self.brand,
            "name": self.name,
            "price": self.price,
            "ram": self.ram,
            "storage": self.storage,
            "camera": self.camera,
            "battery": self.battery,
            "processor": self.processor,
            "performance_score": self.performance_score,
            "image_url": self.image_url,
            "display": self.display,
            "operating_system": self.operating_system,
            "description": self.description,
            "stock_quantity": self.stock_quantity,
            "featured": self.featured,
            "status": self.status,
            "view_count": self.view_count,
            "purchase_count": self.purchase_count,
        }


class Review(db.Model):
    __tablename__ = "reviews"

    review_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    phone_id = db.Column(db.Integer, db.ForeignKey("phones.phone_id"), nullable=False)
    rating = db.Column(db.Integer, nullable=False)
    comment = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    is_approved = db.Column(db.Boolean, nullable=False, default=True)
    is_hidden = db.Column(db.Boolean, nullable=False, default=False)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "review_id": self.review_id,
            "user_id": self.user_id,
            "phone_id": self.phone_id,
            "rating": self.rating,
            "comment": self.comment,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "user_name": self.user.name if self.user else None,
            "phone_name": self.phone.name if self.phone else None,
            "is_approved": self.is_approved,
            "is_hidden": self.is_hidden,
        }


class Order(db.Model):
    __tablename__ = "orders"

    order_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    customer_name = db.Column(db.String(160), nullable=False)
    customer_email = db.Column(db.String(255), nullable=True)
    products_json = db.Column(db.Text, nullable=False)
    total_amount = db.Column(db.Float, nullable=False, default=0.0)
    order_date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    payment_status = db.Column(db.String(20), nullable=False, default="Pending")
    delivery_status = db.Column(db.String(20), nullable=False, default="Pending")
    notes = db.Column(db.Text, nullable=True)

    def to_dict(self):
        import json

        try:
            products = json.loads(self.products_json or "[]")
        except Exception:
            products = []
        return {
            "order_id": self.order_id,
            "user_id": self.user_id,
            "customer_name": self.customer_name,
            "customer_email": self.customer_email,
            "products": products,
            "total_amount": self.total_amount,
            "order_date": self.order_date.isoformat() if self.order_date else None,
            "payment_status": self.payment_status,
            "delivery_status": self.delivery_status,
            "notes": self.notes,
        }


class Notification(db.Model):
    __tablename__ = "notifications"

    notification_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    type = db.Column(db.String(40), nullable=False)
    title = db.Column(db.String(160), nullable=False)
    message = db.Column(db.Text, nullable=False)
    is_read = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "notification_id": self.notification_id,
            "type": self.type,
            "title": self.title,
            "message": self.message,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class SavedComparison(db.Model):
    __tablename__ = "saved_comparisons"

    comparison_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    phone_ids = db.Column(db.String(120), nullable=False)
    saved_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "comparison_id": self.comparison_id,
            "user_id": self.user_id,
            "phone_ids": [int(item) for item in self.phone_ids.split(",") if item],
            "saved_at": self.saved_at.isoformat() if self.saved_at else None,
        }
