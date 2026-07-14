from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from datetime import datetime

from flask import Response, jsonify, request
from sqlalchemy import or_

from .auth import admin_required, hash_password
from .models import Brand, Notification, Order, Phone, Review, User, db

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ORDER_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]
PAYMENT_STATUSES = ["Pending", "Paid", "Refunded"]
USER_STATUSES = ["active", "suspended"]


def register_admin_routes(app) -> None:
    @app.get("/admin/dashboard")
    @admin_required
    def admin_dashboard():
        phones = Phone.query.order_by(Phone.phone_id.asc()).all()
        users = User.query.order_by(User.created_at.desc(), User.user_id.desc()).all()
        orders = Order.query.order_by(Order.order_date.desc(), Order.order_id.desc()).all()
        reviews = Review.query.order_by(Review.created_at.desc(), Review.review_id.desc()).all()
        notifications = Notification.query.order_by(Notification.created_at.desc(), Notification.notification_id.desc()).limit(8).all()

        monthly_sales = [0.0 for _ in range(12)]
        monthly_registrations = [0 for _ in range(12)]
        for order in orders:
            if order.order_date:
                monthly_sales[order.order_date.month - 1] += float(order.total_amount or 0)
        for user in users:
            if user.created_at:
                monthly_registrations[user.created_at.month - 1] += 1

        low_stock = sorted([phone for phone in phones if (phone.stock_quantity or 0) <= 15], key=lambda item: item.stock_quantity or 0)
        most_viewed = sorted(phones, key=lambda item: item.view_count or 0, reverse=True)
        most_purchased = sorted(phones, key=lambda item: item.purchase_count or 0, reverse=True)

        return jsonify({
            "stats": {
                "total_mobiles": len(phones),
                "total_brands": Brand.query.count(),
                "total_users": User.query.count(),
                "total_orders": Order.query.count(),
                "total_reviews": Review.query.count(),
            },
            "recent_users": [user.to_dict() for user in users[:5]],
            "recent_orders": [order.to_dict() for order in orders[:5]],
            "low_stock_mobiles": [phone.to_dict() for phone in low_stock[:5]],
            "most_viewed_mobiles": [phone.to_dict() for phone in most_viewed[:5]],
            "most_purchased_mobiles": [phone.to_dict() for phone in most_purchased[:5]],
            "monthly_sales": [{"label": MONTH_LABELS[index], "value": round(value, 2)} for index, value in enumerate(monthly_sales)],
            "monthly_user_registrations": [{"label": MONTH_LABELS[index], "value": monthly_registrations[index]} for index in range(12)],
            "notifications": [notification.to_dict() for notification in notifications],
            "reviews": [review.to_dict() for review in reviews[:10]],
        })

    @app.get("/admin/brands")
    @admin_required
    def admin_list_brands():
        return jsonify([brand.to_dict() for brand in Brand.query.order_by(Brand.name.asc()).all()])

    @app.post("/admin/brands")
    @admin_required
    def admin_add_brand():
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        if not name:
            return jsonify({"message": "Brand name is required"}), 400
        if Brand.query.filter(db.func.lower(Brand.name) == name.lower()).first():
            return jsonify({"message": "Brand already exists"}), 400
        brand = Brand(
            name=name,
            logo_url=str(payload.get("logo_url", "")).strip() or None,
            description=str(payload.get("description", "")).strip() or None,
        )
        db.session.add(brand)
        db.session.commit()
        return jsonify({"message": "Brand added successfully", "brand": brand.to_dict()}), 201

    @app.put("/admin/brands/<int:brand_id>")
    @admin_required
    def admin_update_brand(brand_id: int):
        brand = Brand.query.get_or_404(brand_id)
        payload = request.get_json(silent=True) or {}
        new_name = str(payload.get("name", brand.name)).strip()
        if not new_name:
            return jsonify({"message": "Brand name is required"}), 400
        duplicate = Brand.query.filter(db.func.lower(Brand.name) == new_name.lower(), Brand.brand_id != brand.brand_id).first()
        if duplicate:
            return jsonify({"message": "Another brand already uses that name"}), 400
        old_name = brand.name
        brand.name = new_name
        brand.logo_url = str(payload.get("logo_url", brand.logo_url or "")).strip() or None
        brand.description = str(payload.get("description", brand.description or "")).strip() or None
        for phone in Phone.query.filter_by(brand=old_name).all():
            phone.brand = new_name
        db.session.commit()
        return jsonify({"message": "Brand updated successfully", "brand": brand.to_dict()})

    @app.delete("/admin/brands/<int:brand_id>")
    @admin_required
    def admin_delete_brand(brand_id: int):
        brand = Brand.query.get_or_404(brand_id)
        phone_count = Phone.query.filter_by(brand=brand.name).count()
        if phone_count:
            return jsonify({"message": "Move mobiles to another brand before deleting this brand"}), 400
        db.session.delete(brand)
        db.session.commit()
        return jsonify({"message": "Brand deleted successfully"})

    @app.get("/admin/users")
    @admin_required
    def admin_list_users():
        return jsonify([user.to_dict() for user in User.query.order_by(User.created_at.desc(), User.user_id.desc()).all()])

    @app.patch("/admin/users/<int:user_id>/status")
    @admin_required
    def admin_update_user_status(user_id: int):
        user = User.query.get_or_404(user_id)
        payload = request.get_json(silent=True) or {}
        status = str(payload.get("status", "")).strip().lower()
        if status not in USER_STATUSES:
            return jsonify({"message": "Invalid user status"}), 400
        user.status = status
        db.session.commit()
        return jsonify({"message": "User status updated", "user": user.to_dict()})

    @app.delete("/admin/users/<int:user_id>")
    @admin_required
    def admin_delete_user(user_id: int):
        from flask_jwt_extended import get_jwt_identity

        if str(user_id) == str(get_jwt_identity()):
            return jsonify({"message": "You cannot delete the logged-in admin account"}), 400
        user = User.query.get_or_404(user_id)
        Review.query.filter_by(user_id=user.user_id).delete(synchronize_session=False)
        Order.query.filter_by(user_id=user.user_id).delete(synchronize_session=False)
        for comparison in user.comparisons:
            db.session.delete(comparison)
        db.session.delete(user)
        db.session.commit()
        return jsonify({"message": "User deleted successfully"})

    @app.get("/admin/orders")
    @admin_required
    def admin_list_orders():
        return jsonify([order.to_dict() for order in Order.query.order_by(Order.order_date.desc(), Order.order_id.desc()).all()])

    @app.patch("/admin/orders/<int:order_id>/status")
    @admin_required
    def admin_update_order_status(order_id: int):
        order = Order.query.get_or_404(order_id)
        payload = request.get_json(silent=True) or {}
        delivery_status = payload.get("delivery_status")
        payment_status = payload.get("payment_status")
        if delivery_status is not None:
            delivery_status = str(delivery_status).strip().title()
            if delivery_status not in ORDER_STATUSES:
                return jsonify({"message": "Invalid delivery status"}), 400
            order.delivery_status = delivery_status
        if payment_status is not None:
            payment_status = str(payment_status).strip().title()
            if payment_status not in PAYMENT_STATUSES:
                return jsonify({"message": "Invalid payment status"}), 400
            order.payment_status = payment_status
        db.session.commit()
        return jsonify({"message": "Order updated successfully", "order": order.to_dict()})

    @app.delete("/admin/orders/<int:order_id>")
    @admin_required
    def admin_delete_order(order_id: int):
        order = Order.query.get_or_404(order_id)
        db.session.delete(order)
        db.session.commit()
        return jsonify({"message": "Order deleted successfully"})

    @app.get("/admin/reviews")
    @admin_required
    def admin_list_reviews():
        return jsonify([review.to_dict() for review in Review.query.order_by(Review.created_at.desc(), Review.review_id.desc()).all()])

    @app.patch("/admin/reviews/<int:review_id>")
    @admin_required
    def admin_update_review(review_id: int):
        review = Review.query.get_or_404(review_id)
        payload = request.get_json(silent=True) or {}
        action = str(payload.get("action", "")).strip().lower()
        if action == "approve":
            review.is_approved = True
            review.is_hidden = False
        elif action == "hide":
            review.is_hidden = True
        else:
            if "is_approved" in payload:
                review.is_approved = bool(payload.get("is_approved"))
            if "is_hidden" in payload:
                review.is_hidden = bool(payload.get("is_hidden"))
        db.session.commit()
        return jsonify({"message": "Review updated successfully", "review": review.to_dict()})

    @app.delete("/admin/reviews/<int:review_id>")
    @admin_required
    def admin_delete_review(review_id: int):
        review = Review.query.get_or_404(review_id)
        db.session.delete(review)
        db.session.commit()
        return jsonify({"message": "Review deleted successfully"})

    @app.get("/admin/notifications")
    @admin_required
    def admin_list_notifications():
        return jsonify([notification.to_dict() for notification in Notification.query.order_by(Notification.created_at.desc(), Notification.notification_id.desc()).all()])

    @app.patch("/admin/notifications/<int:notification_id>/read")
    @admin_required
    def admin_mark_notification(notification_id: int):
        notification = Notification.query.get_or_404(notification_id)
        notification.is_read = True
        db.session.commit()
        return jsonify({"message": "Notification marked as read", "notification": notification.to_dict()})

    @app.get("/admin/profile")
    @admin_required
    def admin_profile():
        user = _current_admin()
        return jsonify(user.to_dict())

    @app.patch("/admin/profile")
    @admin_required
    def admin_update_profile():
        user = _current_admin()
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", user.name)).strip()
        email = str(payload.get("email", user.email)).strip().lower()
        avatar_url = str(payload.get("avatar_url", user.avatar_url or "")).strip() or None
        password = str(payload.get("password", ""))
        if not name or not email:
            return jsonify({"message": "Name and email are required"}), 400
        existing = User.query.filter(User.email == email, User.user_id != user.user_id).first()
        if existing:
            return jsonify({"message": "Email already in use"}), 400
        user.name = name
        user.email = email
        user.avatar_url = avatar_url
        if password:
            if len(password) < 6:
                return jsonify({"message": "Password must be at least 6 characters"}), 400
            user.password_hash = hash_password(password)
        db.session.commit()
        return jsonify({"message": "Profile updated successfully", "user": user.to_dict()})

    @app.get("/admin/reports")
    @admin_required
    def admin_reports():
        dashboard = _build_report_payload()
        return jsonify(dashboard)

    @app.get("/admin/reports/export.csv")
    @admin_required
    def admin_export_report():
        report_type = str(request.args.get("type", "sales")).strip().lower()
        payload = _build_report_payload()
        output = io.StringIO()
        writer = csv.writer(output)
        if report_type == "users":
            writer.writerow(["Name", "Email", "Role", "Status", "Created At"])
            for user in User.query.order_by(User.created_at.desc(), User.user_id.desc()).all():
                writer.writerow([user.name, user.email, user.role, user.status, user.created_at.isoformat() if user.created_at else ""])
        elif report_type == "mobiles":
            writer.writerow(["Name", "Brand", "Price", "Stock", "Views", "Purchases"])
            for phone in Phone.query.order_by(Phone.name.asc()).all():
                writer.writerow([phone.name, phone.brand, phone.price, phone.stock_quantity, phone.view_count, phone.purchase_count])
        elif report_type == "orders":
            writer.writerow(["Order ID", "Customer", "Total Amount", "Payment Status", "Delivery Status", "Order Date"])
            for order in Order.query.order_by(Order.order_date.desc()).all():
                writer.writerow([order.order_id, order.customer_name, order.total_amount, order.payment_status, order.delivery_status, order.order_date.isoformat() if order.order_date else ""])
        else:
            writer.writerow(["Month", "Sales"])
            for item in payload["monthly_sales"]:
                writer.writerow([item["label"], item["value"]])
        csv_content = output.getvalue()
        filename = f"{report_type}_report.csv"
        return Response(csv_content, mimetype="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})


def _current_admin() -> User:
    from flask_jwt_extended import get_jwt_identity

    return db.session.get(User, int(get_jwt_identity()))


def _build_report_payload() -> dict:
    phones = Phone.query.all()
    users = User.query.all()
    orders = Order.query.all()
    reviews = Review.query.all()
    sales_by_month = defaultdict(float)
    users_by_month = defaultdict(int)
    for order in orders:
        if order.order_date:
            sales_by_month[order.order_date.month] += float(order.total_amount or 0)
    for user in users:
        if user.created_at:
            users_by_month[user.created_at.month] += 1
    return {
        "stats": {
            "total_sales": round(sum(float(order.total_amount or 0) for order in orders), 2),
            "total_users": len(users),
            "total_mobiles": len(phones),
            "total_orders": len(orders),
            "total_reviews": len(reviews),
        },
        "monthly_sales": [{"label": MONTH_LABELS[index], "value": round(sales_by_month.get(index + 1, 0.0), 2)} for index in range(12)],
        "monthly_users": [{"label": MONTH_LABELS[index], "value": users_by_month.get(index + 1, 0)} for index in range(12)],
        "orders": [order.to_dict() for order in orders],
        "users": [user.to_dict() for user in users],
        "phones": [phone.to_dict() for phone in phones],
    }