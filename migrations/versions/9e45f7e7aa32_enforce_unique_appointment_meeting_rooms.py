
"""enforce unique appointment meeting rooms

Revision ID: 9e45f7e7aa32
Revises: 0720c7d1e4ca
Create Date: 2026-11-06 23:21:48.674241

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9e45f7e7aa32'
down_revision = '0720c7d1e4ca'
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        'uq_appointments_meeting_room',
        'appointments',
        ['meeting_room']
    )


def downgrade():
    op.drop_constraint(
        'uq_appointments_meeting_room',
        'appointments',
        type_='unique'
    )
