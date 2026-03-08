ALTER TABLE teams
    ADD COLUMN placement INT;

ALTER TABLE teams
    ADD CONSTRAINT teams_placement_positive
    CHECK (placement IS NULL OR placement > 0);
