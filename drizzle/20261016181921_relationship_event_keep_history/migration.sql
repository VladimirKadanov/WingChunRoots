-- relationship_event keeps the history of every relationship (M01): ON DELETE RESTRICT instead
-- of CASCADE, so deleting a relationship can never remove its events through a cascade, which
-- would run with the rights of the table owner and bypass the append-only grants of app_rw.
ALTER TABLE "relationship_event" DROP CONSTRAINT "relationship_event_rXzULOL9Ks97_fkey", ADD CONSTRAINT "relationship_event_rXzULOL9Ks97_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE RESTRICT;