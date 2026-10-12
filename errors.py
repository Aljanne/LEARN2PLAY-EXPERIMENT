
from flask import render_template, jsonify, request


def wants_json():
    """Check whether the request expects a JSON response."""
    return (
        request.path.startswith("/api/")
        or request.accept_mimetypes.best == "application/json"
    )


def register_error_handlers(app):

    @app.errorhandler(400)
    def bad_request(error):
        message = "The request is invalid."

        if wants_json():
            return jsonify({
                "ok": False,
                "message": message
            }), 400

        return render_template(
            "errors/400.html",
            message=message
        ), 400

    @app.errorhandler(403)
    def forbidden(error):
        message = "You do not have permission to access this page."

        if wants_json():
            return jsonify({
                "ok": False,
                "message": message
            }), 403

        return render_template(
            "errors/403.html",
            message=message
        ), 403

    @app.errorhandler(404)
    def not_found(error):
        message = "The page or resource you requested could not be found."

        if wants_json():
            return jsonify({
                "ok": False,
                "message": message
            }), 404

        return render_template(
            "errors/404.html",
            message=message
        ), 404

    @app.errorhandler(405)
    def method_not_allowed(error):
        message = "This request method is not allowed."

        if wants_json():
            return jsonify({
                "ok": False,
                "message": message
            }), 405

        return render_template(
            "errors/405.html",
            message=message
        ), 405

    @app.errorhandler(500)
    def internal_server_error(error):
        # Roll back any unfinished database transaction.
        from extensions import db
        db.session.rollback()

        message = "Something went wrong. Please try again later."

        if wants_json():
            return jsonify({
                "ok": False,
                "message": message
            }), 500

        return render_template(
            "errors/500.html",
            message=message
        ), 500
