from models import User


def get_user(session, user_id):
    return session.query(User).filter_by(id=user_id).first()


def raw_get_user(cursor, user_id):
    cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
