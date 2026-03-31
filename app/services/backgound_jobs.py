from datetime import timezone
from sqlalchemy.orm import Session

from app import models
from app.core.database import SessionLocal


def delete_cleared_messages(contact_id, user_id, now_utc):
    db: Session = SessionLocal()
    print("deleting the both user cleared message history.")
    try:
        # Storage Reclamation: check if the other user also has a clear record
        other_clear_record = db.query(models.ChatClear).filter(
            models.ChatClear.user_id == contact_id,
            models.ChatClear.contact_id == user_id
        ).first()
        
        if other_clear_record:
            # Determine the oldest timestamp (the latest point the oldest viewer can see)
            # Any message before this timestamp is mutually discarded by both users.
            t1 = now_utc
            t2 = other_clear_record.cleared_at.replace(tzinfo=timezone.utc)
            
            min_clear_time = min(t1, t2)
            
            # Hard delete mutually discarded messages
            db.query(models.Message).filter(((
                models.Message.sender_id == user_id
            ) & (
                models.Message.receiver_id == contact_id
            )) | ((
                models.Message.sender_id == contact_id
            ) & (
                models.Message.receiver_id == user_id
            ))).filter(
                models.Message.created_at <= min_clear_time
            ).delete(synchronize_session=False)
            
            db.commit()
    
    finally:
        print("Clear message execution completed.")
        db.close()