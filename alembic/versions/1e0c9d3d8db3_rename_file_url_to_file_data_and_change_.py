"""rename file_url to file_data and change to Text

Revision ID: 1e0c9d3d8db3
Revises: bfcacae91eb8
Create Date: 2026-03-25 15:14:41.714821

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1e0c9d3d8db3'
down_revision: Union[str, Sequence[str], None] = 'bfcacae91eb8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('file_data', sa.Text(), nullable=True))
        batch_op.drop_column('file_url')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('file_url', sa.String(), nullable=True))
        batch_op.drop_column('file_data')
