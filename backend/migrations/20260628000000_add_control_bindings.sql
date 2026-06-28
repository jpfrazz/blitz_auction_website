-- Add control_bindings column to users table for storing emulator control settings
ALTER TABLE users ADD COLUMN control_bindings JSONB;
ALTER TABLE guests ADD COLUMN control_bindings JSONB;
