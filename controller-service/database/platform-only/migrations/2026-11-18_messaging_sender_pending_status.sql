-- tenant_messaging_senders.status gains 'pending': a WhatsApp number bought with Get a number is not sent from until
-- its sender is Online. The schema diff never changes an existing CHECK, so it is swapped here. Safe to run twice.
ALTER TABLE public.tenant_messaging_senders DROP CONSTRAINT IF EXISTS tenant_messaging_senders_status_check;
ALTER TABLE public.tenant_messaging_senders ADD CONSTRAINT tenant_messaging_senders_status_check CHECK (status IN ('active','pending','disabled'));
