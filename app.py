
if __package__:
    from . import create_app
else:
    from __init__ import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
