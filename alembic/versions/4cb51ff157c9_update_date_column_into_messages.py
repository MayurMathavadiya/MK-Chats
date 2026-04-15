"""update date column into messages

Revision ID: 4cb51ff157c9
Revises: 97d07d0409c5
Create Date: 2026-04-15 17:21:03.210120

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '4cb51ff157c9'
down_revision: Union[str, Sequence[str], None] = '97d07d0409c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('messages', sa.Column('updated_at', sa.DateTime(), nullable=True))
    op.execute("UPDATE messages SET updated_at = created_at WHERE updated_at IS NULL")
    op.drop_column('users', 'socket_sid')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('users', sa.Column('socket_sid', sa.VARCHAR(), autoincrement=False, nullable=True))
    op.drop_column('messages', 'updated_at')
