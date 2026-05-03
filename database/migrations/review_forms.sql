CREATE TABLE IF NOT EXISTS review_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  google_review_url TEXT NOT NULL,
  coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  submissions_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID REFERENCES review_forms(id) ON DELETE CASCADE,
  phone VARCHAR(15) NOT NULL,
  screenshot_url TEXT NOT NULL,
  coupon_code VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS review_form_submissions_phone_form ON review_form_submissions(form_id, phone);
