-- Add verified column to otp_verifications table
ALTER TABLE otp_verifications ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
