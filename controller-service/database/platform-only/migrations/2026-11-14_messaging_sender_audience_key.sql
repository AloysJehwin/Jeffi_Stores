-- tenant_messaging_senders now has one row per (tenant, channel, audience). The schema diff adds the audience
-- column (existing rows become 'customer') and the new unique key; this drops the old (tenant, channel) key,
-- which would stop a store from having an admin number beside its customer number. Safe to run twice.
ALTER TABLE public.tenant_messaging_senders DROP CONSTRAINT IF EXISTS tenant_messaging_senders_tenant_channel_key;
