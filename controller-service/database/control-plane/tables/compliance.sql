--
-- tenant_compliance_documents: the licences and certificates an owner uploads in the onboarding wizard's Store step,
-- for what their selling categories need (controller-service/src/lib/catalog/compliance.ts names each doc_type). The
-- platform admin reviews them with the KYC (Stores > KYC), or one by one. The GST certificate stays on
-- tenant_kyc.gst_cert_s3_key. One row per document type per store: a new application, or the owner sending it again
-- from the console (Licences & certificates), replaces it and puts it back to review. The daily compliance_expiry job
-- marks lapsed ones expired and emails the owner 30 and 7 days before and once lapsed (expiry_notice, so each goes once).
--
CREATE TABLE IF NOT EXISTS public.tenant_compliance_documents (
    id           uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_id     uuid NOT NULL,
    tenant_id    uuid NOT NULL,
    category     character varying(64) NOT NULL,                  -- the selling category that asked for it, or General
    doc_type     character varying(32) NOT NULL,                  -- fssai | iec | bis_crs | drug_retail | ...
    doc_number   character varying(64),
    expires_on   date,                                            -- licences that lapse
    s3_key       character varying(512) NOT NULL,                 -- kyc/{owner_id}/{doc_type}/{uuid}.{ext}
    file_name    character varying(255),
    status       character varying(16) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired
    review_note  text,                                            -- shown to the owner
    created_at   timestamp with time zone NOT NULL DEFAULT now(),
    reviewed_at  timestamp with time zone,
    reviewed_by  character varying(255),                          -- the platform admin who approved or rejected it
    expiry_notice     smallint,                                   -- the last expiry email: 30, 7 or 0 (lapsed)
    expiry_notice_for date                                        -- the expires_on that email was for
);
