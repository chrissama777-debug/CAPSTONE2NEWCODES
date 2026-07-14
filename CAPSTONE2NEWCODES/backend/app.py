from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, get_jwt_identity
from sqlalchemy import or_

from .admin_api import register_admin_routes
from .analytics import build_price_trend
from .auth import admin_required, create_token, hash_password, protected_user_required, verify_password
from .database import configure_database, ensure_schema, load_phone_seed_data
from .models import Phone, Review, SavedComparison, User, db
from .recommendation import recommend_phones

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_DIR = BASE_DIR / "data"


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config["SECRET_KEY"] = "capstone2-secret-key"
    app.config["JWT_SECRET_KEY"] = "capstone2-jwt-secret"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = False

    CORS(app, resources={r"/*": {"origins": "*"}})
    configure_database(app)
    JWTManager(app)

    register_routes(app)
    ensure_schema(app)
    return app


def register_routes(app: Flask) -> None:
    @app.get("/")
    def index():
        # show the welcome page first
        return send_from_directory(FRONTEND_DIR, "welcome.html")

    @app.get("/<path:filename>")
    def static_pages(filename: str):
        target = FRONTEND_DIR / filename
        if target.is_file():
            return send_from_directory(FRONTEND_DIR, filename)
        return jsonify({"message": "Not found"}), 404

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.post("/auth/register")
    def register():
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        if not name or not email or len(password) < 6:
            return jsonify({"message": "Invalid registration data"}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({"message": "Email already registered"}), 400
        user = User(name=name, email=email, password_hash=hash_password(password), role="user")
        db.session.add(user)
        db.session.commit()
        return jsonify({"message": "User registered successfully"}), 201

    @app.post("/auth/login")
    def login():
        payload = request.get_json(silent=True) or {}
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        user = User.query.filter_by(email=email).first()
        if not user or not verify_password(password, user.password_hash):
            return jsonify({"message": "Invalid email or password"}), 401
        token = create_token(user)
        return jsonify({"token": token, "user_id": user.user_id, "name": user.name, "role": user.role, "redirect_to": "/admin.html" if user.role == "admin" else "/index.html"})

    @app.get("/phones")
    def phones():
        return jsonify([phone.to_dict() for phone in Phone.query.order_by(Phone.phone_id.asc()).all()])

    @app.get("/phones/live")
    def phones_live():
        live = fetch_live_phones()
        return jsonify(live)

    @app.get("/phone/<int:phone_id>")
    def phone_detail(phone_id: int):
        phone = Phone.query.get_or_404(phone_id)
        payload = phone.to_dict()
        payload["pros"] = [
            f"Strong {phone.camera} MP camera",
            f"Large {phone.battery} mAh battery",
            f"Performance score {phone.performance_score}/10",
        ]
        payload["cons"] = [
            "Premium pricing relative to some competitors" if phone.price > 800 else "Entry-to-mid tier build",
        ]
        return jsonify(payload)

    @app.post("/recommend")
    def recommend():
        payload = request.get_json(silent=True) or {}
        try:
            budget = float(payload.get("budget", 0))
            min_ram = int(payload.get("min_ram", 0))
            min_storage = int(payload.get("min_storage", 0))
            min_battery = int(payload.get("min_battery", 0))
            camera_priority = int(payload.get("camera_priority", 3))
            performance_priority = int(payload.get("performance_priority", 3))
        except (TypeError, ValueError):
            return jsonify({"message": "Invalid recommendation inputs"}), 400
        brand_preference = payload.get("brand_preference") or None
        if budget <= 0:
            return jsonify({"message": "Budget must be greater than zero"}), 400
        results = recommend_phones(
            budget=budget,
            min_ram=min_ram,
            min_storage=min_storage,
            min_battery=min_battery,
            camera_priority=camera_priority,
            performance_priority=performance_priority,
            brand_preference=brand_preference,
        )
        return jsonify(results)

    @app.get("/trend")
    def trend():
        phone_id = request.args.get("phone_id", type=int)
        if not phone_id:
            return jsonify({"message": "phone_id is required"}), 400
        return jsonify(build_price_trend(phone_id))

    @app.get("/compare")
    def compare():
        ids = request.args.get("ids", "")
        phone_ids = [int(item) for item in ids.split(",") if item.strip().isdigit()]
        if not phone_ids:
            return jsonify({"message": "ids are required"}), 400
        phones = Phone.query.filter(Phone.phone_id.in_(phone_ids)).all()
        ordered = {phone.phone_id: phone.to_dict() for phone in phones}
        return jsonify([ordered[phone_id] for phone_id in phone_ids if phone_id in ordered])

    @app.post("/user/comparisons")
    @protected_user_required
    def save_comparison():
        payload = request.get_json(silent=True) or {}
        phone_ids = payload.get("phone_ids", [])
        if not isinstance(phone_ids, list) or not phone_ids:
            return jsonify({"message": "phone_ids must be a non-empty list"}), 400
        user = _current_user()
        comparison = SavedComparison(user_id=user.user_id, phone_ids=",".join(str(item) for item in phone_ids))
        db.session.add(comparison)
        db.session.commit()
        return jsonify({"message": "Comparison saved"}), 201

    @app.get("/user/comparisons")
    @protected_user_required
    def list_comparisons():
        user = _current_user()
        saved = SavedComparison.query.filter_by(user_id=user.user_id).order_by(SavedComparison.saved_at.desc()).all()
        return jsonify([item.to_dict() for item in saved])

    @app.post("/reviews")
    @protected_user_required
    def add_review():
        payload = request.get_json(silent=True) or {}
        try:
            phone_id = int(payload.get("phone_id"))
            rating = int(payload.get("rating"))
        except (TypeError, ValueError):
            return jsonify({"message": "Invalid review payload"}), 400
        comment = str(payload.get("comment", "")).strip()
        if rating < 1 or rating > 5 or not comment:
            return jsonify({"message": "Rating must be 1-5 and comment is required"}), 400
        user = _current_user()
        review = Review(user_id=user.user_id, phone_id=phone_id, rating=rating, comment=comment)
        db.session.add(review)
        db.session.commit()
        return jsonify({"message": "Review submitted"}), 201

    @app.get("/reviews/<int:phone_id>")
    def list_reviews(phone_id: int):
        reviews = Review.query.filter_by(phone_id=phone_id, is_approved=True, is_hidden=False).order_by(Review.created_at.desc()).all()
        return jsonify([review.to_dict() for review in reviews])

    @app.get("/user/data")
    @protected_user_required
    def user_data():
        user = _current_user()
        saved_comparisons = [item.to_dict() for item in SavedComparison.query.filter_by(user_id=user.user_id).all()]
        return jsonify({"name": user.name, "email": user.email, "saved_comparisons": saved_comparisons})

    @app.post("/admin/devices")
    @admin_required
    def admin_add_device():
        payload = request.get_json(silent=True) or {}
        phone, error = _validate_phone_payload(payload)
        if error:
            return jsonify({"message": error}), 400
        db.session.add(phone)
        db.session.commit()
        return jsonify({"message": "Phone added successfully", "phone": phone.to_dict()}), 201

    @app.put("/admin/devices/<int:phone_id>")
    @admin_required
    def admin_update_device(phone_id: int):
        phone = Phone.query.get_or_404(phone_id)
        payload = request.get_json(silent=True) or {}
        updated_phone, error = _validate_phone_payload(payload, existing=phone)
        if error:
            return jsonify({"message": error}), 400
        for key, value in updated_phone.to_dict().items():
            if hasattr(phone, key):
                setattr(phone, key, value)
        db.session.commit()
        return jsonify({"message": "Phone updated successfully", "phone": phone.to_dict()})

    @app.delete("/admin/devices/<int:phone_id>")
    @admin_required
    def admin_delete_device(phone_id: int):
        phone = Phone.query.get_or_404(phone_id)
        db.session.delete(phone)
        db.session.commit()
        return jsonify({"message": "Phone deleted successfully"})

    @app.get("/admin/users")
    @admin_required
    def admin_users():
        return jsonify([user.to_dict() for user in User.query.order_by(User.user_id.asc()).all()])

    @app.post("/sync-json")
    @admin_required
    def sync_json():
        phones = load_phone_seed_data()
        for entry in phones:
            existing = Phone.query.filter_by(brand=entry["brand"], name=entry["name"]).first()
            if existing:
                continue
            db.session.add(Phone(**entry))
        db.session.commit()
        from .models import Brand

        for brand_name in {entry["brand"] for entry in phones}:
            if not Brand.query.filter_by(name=brand_name).first():
                db.session.add(Brand(name=brand_name, logo_url=f"https://placehold.co/160x80/0f766e/ffffff?text={brand_name.replace(' ', '+')}"))
        db.session.commit()
        return jsonify({"message": "JSON data synchronized"})

    register_admin_routes(app)


def _current_user() -> User:
    identity = get_jwt_identity()
    return db.session.get(User, int(identity))


def _validate_phone_payload(payload: dict, existing: Phone | None = None):
    required = ["brand", "name", "price", "ram", "storage", "camera", "battery", "processor", "performance_score", "image_url"]
    if existing is None:
        missing = [field for field in required if field not in payload]
        if missing:
            return None, f"Missing fields: {', '.join(missing)}"
    try:
        phone = existing or Phone()
        phone.brand = str(payload.get("brand", phone.brand if existing else "")).strip()
        phone.name = str(payload.get("name", phone.name if existing else "")).strip()
        phone.price = float(payload.get("price", phone.price if existing else 0))
        phone.ram = int(payload.get("ram", phone.ram if existing else 0))
        phone.storage = int(payload.get("storage", phone.storage if existing else 0))
        phone.camera = int(payload.get("camera", phone.camera if existing else 0))
        phone.battery = int(payload.get("battery", phone.battery if existing else 0))
        phone.processor = str(payload.get("processor", phone.processor if existing else "")).strip()
        phone.performance_score = float(payload.get("performance_score", phone.performance_score if existing else 0))
        phone.image_url = str(payload.get("image_url", phone.image_url if existing else "")).strip()
    except (TypeError, ValueError):
        return None, "Invalid phone data"
    if not all([phone.brand, phone.name, phone.processor, phone.image_url]):
        return None, "All text fields are required"
    return phone, None


def fetch_live_phones() -> list[dict]:
    try:
        import requests

        response = requests.get("https://dummyjson.com/products/category/smartphones", timeout=3)
        response.raise_for_status()
        data = response.json().get("products", [])
        phones = []
        for item in data[:10]:
            phones.append({
                "brand": "Live",
                "name": item.get("title", "Unknown Phone"),
                "price": float(item.get("price", 0)),
                "ram": 8,
                "storage": 128,
                "camera": 48,
                "battery": 4500,
                "processor": item.get("brand", "Live Processor"),
                "performance_score": 7.0,
                "image_url": item.get("thumbnail", ""),
            })
        if phones:
            return phones
    except Exception:
        pass
    return load_phone_seed_data()


app = create_app()
