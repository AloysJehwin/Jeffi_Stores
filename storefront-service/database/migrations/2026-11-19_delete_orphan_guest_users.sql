-- Guest users the cart/wishlist reads used to make for every visitor: delete those over an hour old that no row
-- references (any FK to users, or a user-id column without one), merged guests included. A deleted guest is made
-- again on its next cart or wishlist add; the hour only keeps clear of a guest made a moment before its first add.
-- Safe to run twice.
DO $$
DECLARE
  ids uuid[];
  aged int;
  ref record;
  n bigint;
BEGIN
  IF to_regclass('public.users') IS NULL OR (
    SELECT count(*) FROM pg_attribute
     WHERE attrelid = to_regclass('public.users') AND attnum > 0 AND NOT attisdropped
       AND attname IN ('id', 'is_guest', 'email', 'created_at')
  ) < 4 THEN
    RETURN;
  END IF;

  -- Locked first: a reference added meanwhile waits on the lock and then fails, rather than being cascaded away.
  SELECT array_agg(id) INTO ids FROM (
    SELECT id FROM public.users
     WHERE is_guest AND email LIKE 'guest%@temporary.local' AND created_at < now() - interval '1 hour'
       FOR UPDATE SKIP LOCKED
  ) g;
  aged := coalesce(cardinality(ids), 0);

  FOR ref IN
    SELECT c.conrelid AS rel, string_agg(format('x.%I = u.%I', a.attname, f.attname), ' AND ' ORDER BY k.n) AS cond
      FROM pg_constraint c
     CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(col, fcol, n)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.col
      JOIN pg_attribute f ON f.attrelid = c.confrelid AND f.attnum = k.fcol
     WHERE c.contype = 'f' AND c.confrelid = to_regclass('public.users') AND c.conparentid = 0
     GROUP BY c.oid, c.conrelid
    UNION
    SELECT a.attrelid, format(CASE WHEN a.atttypid = 'uuid'::regtype THEN 'x.%I = u.id'
                                   ELSE 'x.%I::text = u.id::text' END, a.attname)
      FROM (VALUES
        ('account_deletions', 'user_id'), ('address_change_requests', 'requested_by_user_id'),
        ('addresses', 'user_id'), ('admins', 'user_id'), ('ads_audience_members', 'user_id'),
        ('ai_feedback', 'user_id'), ('ai_queries', 'user_id'), ('auth_sessions', 'principal_id'),
        ('business_discounts', 'user_id'), ('business_profiles', 'user_id'), ('business_rfqs', 'user_id'),
        ('campaign_send_counts', 'user_id'), ('cart_items', 'user_id'), ('coupon_eligible_users', 'user_id'),
        ('coupon_usage', 'user_id'), ('coupons', 'generated_for_user_id'), ('customer_activity_log', 'user_id'),
        ('customer_health', 'user_id'), ('customer_health_history', 'user_id'), ('customer_notes', 'user_id'),
        ('customer_profiles', 'user_id'), ('customer_tags', 'user_id'), ('customer_tasks', 'user_id'),
        ('drive_access_log', 'user_id'), ('drive_files', 'uploaded_by_user_id'), ('drive_shares', 'created_by'),
        ('email_campaign_logs', 'user_id'), ('email_campaigns_sent', 'user_id'), ('email_logs', 'user_id'),
        ('failed_login_attempts', 'user_id'), ('gallery_videos', 'created_by'),
        ('homepage_draft_branches', 'updated_by'), ('inventory_transactions', 'created_by'),
        ('loyalty_accounts', 'user_id'), ('loyalty_ledger', 'created_by'), ('loyalty_ledger', 'user_id'),
        ('marketplace_ad_imports', 'imported_by'), ('message_logs', 'user_id'),
        ('notification_preferences', 'user_id'), ('notifications', 'user_id'),
        ('offer_display_settings', 'updated_by'), ('order_status_history', 'created_by'), ('orders', 'user_id'),
        ('page_events', 'user_id'), ('pending_payment_intents', 'user_id'), ('product_drafts', 'created_by'),
        ('product_files', 'uploaded_by'), ('product_reviews', 'user_id'), ('product_views', 'user_id'),
        ('push_devices', 'user_id'), ('push_sends', 'user_id'), ('referral_signups', 'referred_user_id'),
        ('referral_signups', 'referrer_user_id'), ('referrals', 'referred_user_id'),
        ('referrals', 'referrer_user_id'), ('reply_contexts', 'user_id'), ('return_requests', 'user_id'),
        ('reward_game_plays', 'user_id'), ('search_logs', 'user_id'), ('search_queries', 'user_id'),
        ('shelf_stock_transactions', 'created_by'), ('site_assets', 'created_by'), ('site_drafts', 'updated_by'),
        ('site_pages', 'published_by'), ('site_settings', 'updated_by'), ('site_templates', 'created_by'),
        ('site_theme', 'published_by'), ('site_versions', 'published_by'), ('subscriptions', 'user_id'),
        ('support_sessions', 'user_id'), ('template_asset', 'created_by'), ('template_family', 'created_by'),
        ('template_version', 'created_by'), ('upi_payment_intents', 'decided_by'), ('upload_sessions', 'created_by'),
        ('user_oauth_identities', 'user_id'), ('user_search_history', 'user_id'), ('users', 'merged_to_user_id'),
        ('vault_access_log', 'user_id'), ('vault_entitlements', 'user_id'), ('vault_tickets', 'user_id'),
        ('websocket_connections', 'user_id'), ('wishlist_items', 'user_id')
      ) AS v(tbl, col)
      JOIN pg_attribute a ON a.attrelid = to_regclass(format('public.%I', v.tbl)) AND a.attname = v.col
                         AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXIT WHEN ids IS NULL;
    EXECUTE format('SELECT array_agg(u.id) FROM public.users u WHERE u.id = ANY ($1) '
                || 'AND NOT EXISTS (SELECT 1 FROM %s x WHERE %s)', ref.rel::regclass, ref.cond)
       INTO ids USING ids;
  END LOOP;

  DELETE FROM public.users WHERE id = ANY (ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'deleted % orphan guest users (% guests over an hour old)', n, aged;
END $$;
